"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudioProcessor = void 0;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const speaker_1 = __importDefault(require("speaker"));
const logger_1 = require("./logger");
const audio_devices_1 = require("./audio-devices");
class AudioProcessor {
    streams = new Map();
    config;
    constructor(config) {
        this.config = config;
    }
    async createStream(sessionId, format, sampleRate) {
        // Close existing stream if any
        if (this.streams.has(sessionId)) {
            await this.finalizeStream(sessionId);
        }
        const stream = {
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
    async createOutput(format, sampleRate) {
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
    async createSpeakerOutput(format, sampleRate) {
        const speakerConfig = {
            channels: 1, // Mono
            sampleRate: sampleRate,
            bitDepth: 16 // Default bitDepth
        };
        if (format === 'pcm') {
            // PCM configuration for 32-bit float
            speakerConfig.bitDepth = 32;
            speakerConfig.float = true;
            speakerConfig.signed = true;
        }
        else {
            // Default configuration for compressed formats
            speakerConfig.bitDepth = 16;
        }
        // Add device configuration if specified
        if (this.config.output.device) {
            const deviceName = this.config.output.device;
            logger_1.logger.info('Configuring audio output device', { device: deviceName });
            // On Windows, check if it's a valid device
            if (process.platform === 'win32') {
                try {
                    const devices = await audio_devices_1.AudioDeviceManager.listDevices();
                    const targetDevice = audio_devices_1.AudioDeviceManager.findDeviceByName(devices, deviceName);
                    if (targetDevice) {
                        speakerConfig.device = targetDevice.name;
                        logger_1.logger.info('Found matching audio device', {
                            requestedDevice: deviceName,
                            foundDevice: targetDevice.name,
                            deviceId: targetDevice.id
                        });
                    }
                    else {
                        // Try using the device name as-is
                        speakerConfig.device = deviceName;
                        logger_1.logger.warn('Audio device not found in enumeration, using as-is', {
                            device: deviceName,
                            availableDevices: devices.map(d => d.name)
                        });
                    }
                }
                catch (error) {
                    logger_1.logger.error('Failed to enumerate audio devices', { error });
                    speakerConfig.device = deviceName;
                }
            }
            else {
                // For non-Windows platforms, use the device name directly
                speakerConfig.device = deviceName;
            }
        }
        return new speaker_1.default(speakerConfig);
    }
    createFFplayOutput(format, sampleRate) {
        const args = ['-nodisp', '-autoexit'];
        if (format === 'pcm') {
            // Raw PCM input configuration
            args.push('-f', 'f32le', // 32-bit float little-endian
            '-ar', String(sampleRate), '-ac', '1', // Mono
            '-i', 'pipe:0');
        }
        else if (format === 'mp3') {
            args.push('-f', 'mp3', '-i', 'pipe:0');
        }
        args.push('-volume', '100');
        const ffplay = (0, child_process_1.spawn)('ffplay', args, {
            stdio: ['pipe', 'ignore', 'ignore']
        });
        ffplay.on('error', (err) => {
            logger_1.logger.error('FFplay error', { error: err });
        });
        return ffplay;
    }
    createVLCOutput(format) {
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
        const vlc = (0, child_process_1.spawn)('vlc', args, {
            stdio: ['pipe', 'ignore', 'ignore']
        });
        vlc.on('error', (err) => {
            logger_1.logger.error('VLC error', { error: err });
        });
        return vlc;
    }
    async processChunk(sessionId, chunk, _format) {
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
                    await new Promise(resolve => stream.output.once('drain', resolve));
                }
            }
            else if ('stdin' in stream.output && stream.output.stdin) {
                // Child process (ffplay/vlc)
                stream.output.stdin.write(chunk);
            }
        }
        // Update metrics
        this.updateMetrics(sessionId, chunk.length);
    }
    async finalizeStream(sessionId) {
        const stream = this.streams.get(sessionId);
        if (!stream)
            return;
        // Save to file if configured
        if (this.config.saveToFile && stream.buffer.length > 0) {
            await this.saveToFile(stream);
        }
        // Close output
        if (stream.output) {
            if ('end' in stream.output) {
                stream.output.end();
            }
            else if ('kill' in stream.output) {
                stream.output.kill();
            }
        }
        // Clean up
        this.streams.delete(sessionId);
        const duration = Date.now() - stream.startTime;
        logger_1.logger.info('Stream finalized', {
            sessionId,
            duration,
            chunks: stream.buffer.length,
            totalBytes: stream.buffer.reduce((sum, buf) => sum + buf.length, 0)
        });
    }
    async saveToFile(stream) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const extension = stream.format === 'pcm' ? 'raw' : stream.format;
        const filename = `audio-${stream.sessionId}-${timestamp}.${extension}`;
        const fullAudio = Buffer.concat(stream.buffer);
        await fs.promises.writeFile(filename, fullAudio);
        logger_1.logger.info('Audio saved to file', {
            filename,
            size: fullAudio.length,
            format: stream.format
        });
    }
    updateMetrics(_sessionId, _bytesProcessed) {
        // Update Prometheus metrics here
    }
    async cleanup() {
        // Finalize all active streams
        for (const sessionId of this.streams.keys()) {
            await this.finalizeStream(sessionId);
        }
    }
}
exports.AudioProcessor = AudioProcessor;
//# sourceMappingURL=audio-processor.js.map