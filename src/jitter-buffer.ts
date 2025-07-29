import { EventEmitter } from 'events';
import { logger } from './logger';
import { 
  TimedAudioChunk, 
  JitterBufferConfig, 
  NetworkConditions 
} from './types';

interface BufferedChunk extends TimedAudioChunk {
  receivedAt: number;
  bufferTime: number;        // How long this chunk should be buffered
}

interface BufferStatistics {
  avgBufferSize: number;
  maxBufferSize: number;
  underruns: number;         // Times buffer went empty
  overruns: number;          // Times buffer was too full
  droppedPackets: number;    // Packets dropped due to being too late
  adaptations: number;       // Number of buffer size adaptations
}

export class JitterBuffer extends EventEmitter {
  private config: JitterBufferConfig;
  private buffer = new Map<string, BufferedChunk[]>(); // sessionId -> chunks
  private statistics = new Map<string, BufferStatistics>();
  private playbackTimers = new Map<string, NodeJS.Timeout>();
  private lastNetworkUpdate = new Map<string, number>();

  constructor(config: Partial<JitterBufferConfig> = {}) {
    super();
    
    this.config = {
      targetBufferMs: config.targetBufferMs || 100,    // 100ms target buffer
      minBufferMs: config.minBufferMs || 50,           // 50ms minimum buffer
      maxBufferMs: config.maxBufferMs || 300,          // 300ms maximum buffer
      adaptiveMode: config.adaptiveMode ?? true        // Enable adaptive buffering
    };

    logger.info('Jitter buffer initialized', { config: this.config });
  }

  initializeSession(sessionId: string): void {
    this.buffer.set(sessionId, []);
    this.statistics.set(sessionId, {
      avgBufferSize: 0,
      maxBufferSize: 0,
      underruns: 0,
      overruns: 0,
      droppedPackets: 0,
      adaptations: 0
    });
    this.lastNetworkUpdate.set(sessionId, Date.now());

    logger.debug('Jitter buffer session initialized', { sessionId });
  }

  addChunk(sessionId: string, chunk: TimedAudioChunk, networkConditions: NetworkConditions): void {
    const sessionBuffer = this.buffer.get(sessionId);
    const stats = this.statistics.get(sessionId);
    
    if (!sessionBuffer || !stats) {
      logger.error('Jitter buffer session not initialized', { sessionId });
      return;
    }

    const now = Date.now();
    
    // Calculate buffer time based on network conditions
    const bufferTime = this.calculateBufferTime(networkConditions);
    
    // Check if this chunk is too late (arrived after its playback time)
    if (chunk.playbackTime < now) {
      stats.droppedPackets++;
      logger.warn('Dropped late audio chunk', {
        sessionId,
        sequenceNumber: chunk.sequenceNumber,
        playbackTime: chunk.playbackTime,
        currentTime: now,
        lateness: now - chunk.playbackTime
      });
      return;
    }

    const bufferedChunk: BufferedChunk = {
      ...chunk,
      receivedAt: now,
      bufferTime
    };

    // Insert chunk in correct position (sorted by playback time)
    const insertIndex = sessionBuffer.findIndex(c => c.playbackTime > chunk.playbackTime);
    if (insertIndex === -1) {
      sessionBuffer.push(bufferedChunk);
    } else {
      sessionBuffer.splice(insertIndex, 0, bufferedChunk);
    }

    // Update statistics
    stats.maxBufferSize = Math.max(stats.maxBufferSize, sessionBuffer.length);
    stats.avgBufferSize = (stats.avgBufferSize * 0.95) + (sessionBuffer.length * 0.05);

    // Handle buffer overrun
    if (sessionBuffer.length > this.getMaxBufferChunks(networkConditions)) {
      const dropped = sessionBuffer.shift()!; // Remove oldest chunk
      stats.overruns++;
      stats.droppedPackets++;
      
      logger.warn('Buffer overrun - dropped oldest chunk', {
        sessionId,
        droppedSequence: dropped.sequenceNumber,
        bufferSize: sessionBuffer.length
      });
    }

    // Start playback if we have enough buffered data
    if (!this.playbackTimers.has(sessionId) && this.shouldStartPlayback(sessionId, networkConditions)) {
      this.startPlayback(sessionId);
    }

    // Adapt buffer size if enabled
    if (this.config.adaptiveMode) {
      this.adaptBufferSize(sessionId, networkConditions);
    }

    logger.debug('Chunk added to jitter buffer', {
      sessionId,
      sequenceNumber: chunk.sequenceNumber,
      bufferSize: sessionBuffer.length,
      bufferTime,
      playbackIn: chunk.playbackTime - now
    });
  }

  private calculateBufferTime(networkConditions: NetworkConditions): number {
    let bufferTime = this.config.targetBufferMs;

    if (this.config.adaptiveMode) {
      // Increase buffer time based on network jitter and packet loss
      const jitterCompensation = Math.min(networkConditions.jitterMs * 2, 100);
      const lossCompensation = networkConditions.packetLoss * 50; // 50ms per 1% loss
      
      bufferTime += jitterCompensation + lossCompensation;
      
      // Clamp to configured limits
      bufferTime = Math.max(this.config.minBufferMs, 
                           Math.min(this.config.maxBufferMs, bufferTime));
    }

    return bufferTime;
  }

  private getMaxBufferChunks(networkConditions: NetworkConditions): number {
    // Estimate chunks based on typical chunk duration (assume 20ms chunks)
    const avgChunkDuration = 20;
    const maxBufferTime = this.calculateBufferTime(networkConditions) * 2; // 2x safety margin
    return Math.ceil(maxBufferTime / avgChunkDuration);
  }

  private shouldStartPlayback(sessionId: string, networkConditions: NetworkConditions): boolean {
    const sessionBuffer = this.buffer.get(sessionId);
    if (!sessionBuffer || sessionBuffer.length === 0) return false;

    const targetBufferTime = this.calculateBufferTime(networkConditions);
    const bufferedTime = this.getBufferedTimeMs(sessionId);
    
    return bufferedTime >= Math.max(this.config.minBufferMs, targetBufferTime * 0.8);
  }

  private startPlayback(sessionId: string): void {
    const timer = setInterval(() => {
      this.processBuffer(sessionId);
    }, 5); // Check every 5ms

    this.playbackTimers.set(sessionId, timer);
    logger.debug('Jitter buffer playback started', { sessionId });
  }

  private processBuffer(sessionId: string): void {
    const sessionBuffer = this.buffer.get(sessionId);
    const stats = this.statistics.get(sessionId);
    
    if (!sessionBuffer || !stats) return;

    const now = Date.now();
    
    // Check if buffer is empty (underrun)
    if (sessionBuffer.length === 0) {
      stats.underruns++;
      logger.warn('Buffer underrun detected', { 
        sessionId, 
        underruns: stats.underruns 
      });
      return;
    }

    // Play chunks that are ready
    while (sessionBuffer.length > 0) {
      const chunk = sessionBuffer[0];
      const playbackTime = chunk.playbackTime + chunk.bufferTime;
      
      if (playbackTime <= now) {
        sessionBuffer.shift(); // Remove from buffer
        
        // Emit for actual audio playback
        this.emit('playChunk', sessionId, chunk, now);
        
        logger.debug('Chunk played from jitter buffer', {
          sessionId,
          sequenceNumber: chunk.sequenceNumber,
          bufferTime: chunk.bufferTime,
          actualDelay: now - chunk.playbackTime
        });
      } else {
        break; // Wait for next chunk's time
      }
    }
  }

  private getBufferedTimeMs(sessionId: string): number {
    const sessionBuffer = this.buffer.get(sessionId);
    if (!sessionBuffer || sessionBuffer.length === 0) return 0;

    const firstChunk = sessionBuffer[0];
    const lastChunk = sessionBuffer[sessionBuffer.length - 1];
    
    return lastChunk.playbackTime - firstChunk.playbackTime + lastChunk.duration;
  }

  private adaptBufferSize(sessionId: string, networkConditions: NetworkConditions): void {
    const stats = this.statistics.get(sessionId);
    const lastUpdate = this.lastNetworkUpdate.get(sessionId) || 0;
    const now = Date.now();
    
    if (!stats || now - lastUpdate < 5000) return; // Adapt at most every 5 seconds

    // Analyze recent performance
    const recentUnderruns = stats.underruns;
    const recentOverruns = stats.overruns;

    let newTargetBuffer = this.config.targetBufferMs;

    // Increase buffer if experiencing underruns
    if (recentUnderruns > 0) {
      newTargetBuffer = Math.min(this.config.maxBufferMs, newTargetBuffer * 1.2);
      stats.adaptations++;
      
      logger.info('Increased jitter buffer due to underruns', {
        sessionId,
        oldTarget: this.config.targetBufferMs,
        newTarget: newTargetBuffer,
        underruns: recentUnderruns
      });
    }
    // Decrease buffer if experiencing overruns and network is stable
    else if (recentOverruns > 0 && networkConditions.jitterMs < 10) {
      newTargetBuffer = Math.max(this.config.minBufferMs, newTargetBuffer * 0.9);
      stats.adaptations++;
      
      logger.info('Decreased jitter buffer due to overruns', {
        sessionId,
        oldTarget: this.config.targetBufferMs,
        newTarget: newTargetBuffer,
        overruns: recentOverruns
      });
    }

    // Apply adaptation
    if (newTargetBuffer !== this.config.targetBufferMs) {
      this.config.targetBufferMs = newTargetBuffer;
      this.lastNetworkUpdate.set(sessionId, now);
    }

    // Reset counters after adaptation
    stats.underruns = 0;
    stats.overruns = 0;
  }

  endSession(sessionId: string): BufferStatistics | null {
    const timer = this.playbackTimers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.playbackTimers.delete(sessionId);
    }

    const stats = this.statistics.get(sessionId);
    
    this.buffer.delete(sessionId);
    this.statistics.delete(sessionId);
    this.lastNetworkUpdate.delete(sessionId);

    logger.info('Jitter buffer session ended', { 
      sessionId, 
      finalStats: stats 
    });

    return stats || null;
  }

  getBufferStatus(sessionId: string): any {
    const sessionBuffer = this.buffer.get(sessionId);
    const stats = this.statistics.get(sessionId);
    
    return {
      bufferSize: sessionBuffer?.length || 0,
      bufferedTimeMs: this.getBufferedTimeMs(sessionId),
      targetBufferMs: this.config.targetBufferMs,
      statistics: stats,
      isPlaybackActive: this.playbackTimers.has(sessionId)
    };
  }

  updateConfiguration(newConfig: Partial<JitterBufferConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('Jitter buffer configuration updated', { config: this.config });
  }
}