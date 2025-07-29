import { Writable } from 'stream';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import Speaker from 'speaker';
import { logger } from './logger';
import { AudioDeviceManager } from './audio-devices';
import { AudioStream, SpeakerConfig, Config } from './types';
import { SecurityValidator, MemoryManager } from './security';

export class AudioProcessor {
  private streams = new Map<string, AudioStream>();
  private config: Config['audio'];

  constructor(config: Config['audio'], _memoryManager: MemoryManager) {
    this.config = config;
    // Memory manager is used by the parent AudioReceiver
  }

  async createStream(sessionId: string, format: string, sampleRate: number): Promise<AudioStream> {
    // Close existing stream if any
    if (this.streams.has(sessionId)) {
      await this.finalizeStream(sessionId);
    }

    const stream: AudioStream = {
      sessionId,
      format,
      sampleRate,
      output: null,
      buffer: [],
      startTime: Date.now()
    };

    // Create appropriate output based on format and config
    stream.output = await this.createOutput(format, sampleRate);
    
    this.streams.set(sessionId, stream);
    return stream;
  }

  private async createOutput(format: string, sampleRate: number): Promise<Writable | ChildProcess | null> {
    const outputType = this.config.output.type;

    switch (outputType) {
      case 'speaker':
        return await this.createSpeakerOutput(format, sampleRate);
      
      case 'ffplay':
        return this.createFFplayOutput(format, sampleRate);
      
      case 'vlc':
        return this.createVLCOutput(format);
      
      case 'file':
        return null; // File output handled separately
      
      default:
        throw new Error(`Unsupported output type: ${outputType}`);
    }
  }

  private async createSpeakerOutput(format: string, sampleRate: number): Promise<Speaker> {
    const speakerConfig: SpeakerConfig = {
      channels: 1,          // Mono
      sampleRate: sampleRate,
      bitDepth: 16          // Default bitDepth
    };

    if (format === 'pcm') {
      // PCM configuration for 32-bit float
      speakerConfig.bitDepth = 32;
      speakerConfig.float = true;
      speakerConfig.signed = true;
    } else {
      // Default configuration for compressed formats
      speakerConfig.bitDepth = 16;
    }

    // Add device configuration if specified
    if (this.config.output.device) {
      const deviceName = this.config.output.device;
      logger.info('Configuring audio output device', { device: deviceName });

      // On Windows, check if it's a valid device
      if (process.platform === 'win32') {
        try {
          const devices = await AudioDeviceManager.listDevices();
          const targetDevice = AudioDeviceManager.findDeviceByName(devices, deviceName);
          
          if (targetDevice) {
            speakerConfig.device = targetDevice.name;
            logger.info('Found matching audio device', { 
              requestedDevice: deviceName,
              foundDevice: targetDevice.name,
              deviceId: targetDevice.id 
            });
          } else {
            // Try using the device name as-is
            speakerConfig.device = deviceName;
            logger.warn('Audio device not found in enumeration, using as-is', { 
              device: deviceName,
              availableDevices: devices.map(d => d.name)
            });
          }
        } catch (error) {
          logger.error('Failed to enumerate audio devices', { error });
          speakerConfig.device = deviceName;
        }
      } else {
        // For non-Windows platforms, use the device name directly
        speakerConfig.device = deviceName;
      }
    }

    return new Speaker(speakerConfig);
  }

  private createFFplayOutput(format: string, sampleRate: number): ChildProcess {
    const args = ['-nodisp', '-autoexit'];

    if (format === 'pcm') {
      // Raw PCM input configuration
      args.push(
        '-f', 'f32le',           // 32-bit float little-endian
        '-ar', String(sampleRate),
        '-ac', '1',              // Mono
        '-i', 'pipe:0'
      );
    } else if (format === 'mp3') {
      args.push('-f', 'mp3', '-i', 'pipe:0');
    }

    args.push('-volume', '100');

    const ffplay = spawn('ffplay', args, {
      stdio: ['pipe', 'ignore', 'ignore']
    });

    ffplay.on('error', (err) => {
      logger.error('FFplay error', { error: err });
    });

    return ffplay;
  }

  private createVLCOutput(format: string): ChildProcess {
    const args = [
      '-I', 'dummy',
      '--play-and-exit',
      '--intf', 'dummy'
    ];

    if (format === 'pcm') {
      args.push('--demux', 'rawaud');
      args.push('--rawaud-channels', '1');
      args.push('--rawaud-samplerate', '44100');
      args.push('--rawaud-fourcc', 'f32l');
    }

    args.push('fd://0');

    const vlc = spawn('vlc', args, {
      stdio: ['pipe', 'ignore', 'ignore']
    });

    vlc.on('error', (err) => {
      logger.error('VLC error', { error: err });
    });

    return vlc;
  }

  async processChunk(sessionId: string, chunk: Buffer, _format: string): Promise<void> {
    const stream = this.streams.get(sessionId);
    if (!stream) {
      throw new Error(`No stream found for session ${sessionId}`);
    }

    // Buffer the chunk
    stream.buffer.push(chunk);

    // Write to output if available
    if (stream.output) {
      if ('write' in stream.output) {
        // Writable stream (Speaker)
        const written = stream.output.write(chunk);
        if (!written) {
          // Handle backpressure
          await new Promise(resolve => stream.output!.once('drain', resolve));
        }
      } else if ('stdin' in stream.output && stream.output.stdin) {
        // Child process (ffplay/vlc)
        stream.output.stdin.write(chunk);
      }
    }

    // Update metrics
    this.updateMetrics(sessionId, chunk.length);
  }

  async finalizeStream(sessionId: string): Promise<void> {
    const stream = this.streams.get(sessionId);
    if (!stream) return;

    // Save to file if configured
    if (this.config.saveToFile && stream.buffer.length > 0) {
      await this.saveToFile(stream);
    }

    // Close output
    if (stream.output) {
      if ('end' in stream.output) {
        stream.output.end();
      } else if ('kill' in stream.output) {
        stream.output.kill();
      }
    }

    // Clean up
    this.streams.delete(sessionId);

    const duration = Date.now() - stream.startTime;
    logger.info('Stream finalized', {
      sessionId,
      duration,
      chunks: stream.buffer.length,
      totalBytes: stream.buffer.reduce((sum, buf) => sum + buf.length, 0)
    });
  }

  private async saveToFile(stream: AudioStream): Promise<void> {
    const timestamp = new Date().toISOString();
    const filename = SecurityValidator.generateSafeFilename(
      stream.sessionId,
      timestamp,
      stream.format
    );
    
    const fullAudio = Buffer.concat(stream.buffer);
    
    // Ensure we save to a specific directory
    const outputDir = process.env.AUDIO_OUTPUT_DIR || './audio-output';
    
    // Create directory if it doesn't exist
    try {
      await fs.promises.mkdir(outputDir, { recursive: true });
    } catch (error) {
      logger.error('Failed to create output directory', { error, outputDir });
      return;
    }
    
    // Use sanitized path
    const safePath = path.join(outputDir, filename);
    
    await fs.promises.writeFile(safePath, fullAudio);
    
    logger.info('Audio saved to file', {
      filename: safePath,
      size: fullAudio.length,
      format: stream.format
    });
  }

  private updateMetrics(_sessionId: string, _bytesProcessed: number): void {
    // Update Prometheus metrics here
  }

  async cleanup(): Promise<void> {
    // Finalize all active streams
    for (const sessionId of this.streams.keys()) {
      await this.finalizeStream(sessionId);
    }
  }
}