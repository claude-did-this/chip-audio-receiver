import { EventEmitter } from 'events';
import { logger } from './logger';
import { 
  AudioPacket, 
  TimedAudioChunk, 
  SyncTimestamps, 
  NetworkConditions,
  SubtitleData 
} from './types';

interface SyncSession {
  sessionId: string;
  baseTimestamp: number;      // Reference timestamp for this session
  audioStartTime: number;     // When audio playback began
  clockOffset: number;        // Offset between our clock and TTS clock
  isActive: boolean;
}

export class AudioSyncManager extends EventEmitter {
  private sessions = new Map<string, SyncSession>();
  private playbackQueue = new Map<string, TimedAudioChunk[]>();
  private playbackTimers = new Map<string, NodeJS.Timeout>();
  private subtitleTimers = new Map<string, NodeJS.Timeout[]>();

  constructor() {
    super();
  }

  createSession(sessionId: string): void {
    const session: SyncSession = {
      sessionId,
      baseTimestamp: Date.now(),
      audioStartTime: 0,
      clockOffset: 0,
      isActive: true
    };

    this.sessions.set(sessionId, session);
    this.playbackQueue.set(sessionId, []);
    this.subtitleTimers.set(sessionId, []);

    logger.info('Sync session created', { sessionId });
  }

  calculatePlaybackTime(
    packet: AudioPacket, 
    syncTimestamps: SyncTimestamps, 
    networkConditions: NetworkConditions
  ): number {
    const session = this.sessions.get(packet.sessionId);
    if (!session) {
      throw new Error(`No sync session found for ${packet.sessionId}`);
    }

    // If this is the first packet, establish timing baseline
    if (session.audioStartTime === 0) {
      const processingDelay = syncTimestamps.packetReceived - syncTimestamps.ttsGenerated;
      const networkLatency = networkConditions.avgLatency || 20; // Default 20ms
      const bufferTime = 50; // 50ms buffer for smooth playback
      
      session.audioStartTime = Date.now() + bufferTime;
      session.clockOffset = processingDelay + networkLatency;
      
      logger.info('Audio timing baseline established', {
        sessionId: packet.sessionId,
        audioStartTime: session.audioStartTime,
        processingDelay,
        networkLatency,
        clockOffset: session.clockOffset
      });
    }

    // Calculate when this specific chunk should play
    // playbackTime in packet is relative to TTS generation
    const relativePlaybackTime = packet.playbackTime - packet.timestamp;
    const absolutePlaybackTime = session.audioStartTime + relativePlaybackTime;

    // Adjust for network conditions
    const jitterCompensation = Math.min(networkConditions.jitterMs * 2, 20); // Max 20ms compensation
    const targetPlaybackTime = absolutePlaybackTime + jitterCompensation;

    // Never schedule playback in the past
    const now = Date.now();
    const finalPlaybackTime = Math.max(targetPlaybackTime, now + 5); // At least 5ms in future

    logger.debug('Playback time calculated', {
      sessionId: packet.sessionId,
      sequenceNumber: packet.sequenceNumber,
      ttsTimestamp: packet.timestamp,
      packetPlaybackTime: packet.playbackTime,
      relativeTime: relativePlaybackTime,
      absoluteTime: absolutePlaybackTime,
      finalTime: finalPlaybackTime,
      delayFromNow: finalPlaybackTime - now
    });

    return finalPlaybackTime;
  }

  scheduleAudioChunk(
    packet: AudioPacket, 
    syncTimestamps: SyncTimestamps, 
    networkConditions: NetworkConditions,
    subtitles?: SubtitleData
  ): void {
    const playbackTime = this.calculatePlaybackTime(packet, syncTimestamps, networkConditions);
    
    // Calculate audio duration for this chunk
    const bytesPerSample = packet.format === 'pcm' ? 4 : 2; // 32-bit PCM or 16-bit compressed
    const samplesPerSecond = packet.sampleRate;
    const totalSamples = packet.audioData.length / bytesPerSample;
    const durationMs = (totalSamples / samplesPerSecond) * 1000;

    const timedChunk: TimedAudioChunk = {
      sessionId: packet.sessionId,
      audio: packet.audioData,
      playbackTime,
      duration: durationMs,
      subtitles,
      sequenceNumber: packet.sequenceNumber
    };

    // Add to playback queue (ordered by playback time)
    const queue = this.playbackQueue.get(packet.sessionId) || [];
    queue.push(timedChunk);
    queue.sort((a, b) => a.playbackTime - b.playbackTime);
    this.playbackQueue.set(packet.sessionId, queue);

    // Start playback loop if not already running
    if (!this.playbackTimers.has(packet.sessionId)) {
      this.startPlaybackLoop(packet.sessionId);
    }

    // Schedule subtitles if present
    if (subtitles) {
      this.scheduleSubtitle(packet.sessionId, subtitles, playbackTime);
    }

    logger.debug('Audio chunk scheduled', {
      sessionId: packet.sessionId,
      sequenceNumber: packet.sequenceNumber,
      playbackTime,
      duration: durationMs,
      queueLength: queue.length
    });
  }

  private startPlaybackLoop(sessionId: string): void {
    const timer = setInterval(() => {
      this.processPlaybackQueue(sessionId);
    }, 5); // Check every 5ms for precise timing

    this.playbackTimers.set(sessionId, timer);
    logger.debug('Playback loop started', { sessionId });
  }

  private processPlaybackQueue(sessionId: string): void {
    const queue = this.playbackQueue.get(sessionId);
    if (!queue || queue.length === 0) return;

    const now = Date.now();
    
    // Process all chunks that should be playing now
    while (queue.length > 0 && queue[0].playbackTime <= now) {
      const chunk = queue.shift()!;
      
      // Update sync timestamps with actual playback time
      const actualPlaybackTime = Date.now();
      
      // Emit for audio playback
      this.emit('playAudio', chunk, actualPlaybackTime);

      // Log timing accuracy
      const timingError = actualPlaybackTime - chunk.playbackTime;
      if (Math.abs(timingError) > 10) { // More than 10ms off
        logger.warn('Playback timing drift detected', {
          sessionId,
          sequenceNumber: chunk.sequenceNumber,
          scheduledTime: chunk.playbackTime,
          actualTime: actualPlaybackTime,
          error: timingError
        });
      } else {
        logger.debug('Audio chunk played', {
          sessionId,
          sequenceNumber: chunk.sequenceNumber,
          timingError
        });
      }
    }
  }

  private scheduleSubtitle(
    sessionId: string, 
    subtitle: SubtitleData, 
    audioStartTime: number
  ): void {
    const showTime = audioStartTime + subtitle.startTime;
    const hideTime = audioStartTime + subtitle.endTime;
    const now = Date.now();

    const timers = this.subtitleTimers.get(sessionId) || [];

    // Schedule subtitle show
    if (showTime > now) {
      const showTimer = setTimeout(() => {
        this.emit('showSubtitle', sessionId, subtitle);
        logger.debug('Subtitle shown', {
          sessionId,
          text: subtitle.text,
          timing: `${subtitle.startTime}-${subtitle.endTime}ms`
        });
      }, showTime - now);
      
      timers.push(showTimer);
    }

    // Schedule subtitle hide
    if (hideTime > now) {
      const hideTimer = setTimeout(() => {
        this.emit('hideSubtitle', sessionId, subtitle);
        logger.debug('Subtitle hidden', { sessionId });
      }, hideTime - now);
      
      timers.push(hideTimer);
    }

    this.subtitleTimers.set(sessionId, timers);

    logger.debug('Subtitle scheduled', {
      sessionId,
      text: subtitle.text,
      showTime,
      hideTime,
      showDelay: showTime - now,
      hideDelay: hideTime - now
    });
  }

  endSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.isActive = false;

    // Clear playback timer
    const timer = this.playbackTimers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.playbackTimers.delete(sessionId);
    }

    // Clear subtitle timers
    const subtitleTimers = this.subtitleTimers.get(sessionId) || [];
    subtitleTimers.forEach(timer => clearTimeout(timer));
    this.subtitleTimers.delete(sessionId);

    // Clear queues
    this.playbackQueue.delete(sessionId);
    this.sessions.delete(sessionId);

    logger.info('Sync session ended', { sessionId });
  }

  getSessionInfo(sessionId: string): SyncSession | null {
    const session = this.sessions.get(sessionId);
    return session ? { ...session } : null;
  }

  getQueueLength(sessionId: string): number {
    const queue = this.playbackQueue.get(sessionId);
    return queue ? queue.length : 0;
  }

  // Adaptive timing adjustment based on network conditions
  adjustTiming(sessionId: string, networkConditions: NetworkConditions): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Adjust clock offset based on observed network conditions
    const latencyChange = networkConditions.avgLatency - (session.clockOffset - 50); // 50ms was our buffer
    if (Math.abs(latencyChange) > 10) { // Significant change
      session.clockOffset += latencyChange * 0.1; // Gradual adjustment
      
      logger.info('Timing adjustment applied', {
        sessionId,
        latencyChange,
        newClockOffset: session.clockOffset
      });
    }
  }

  // Get timing statistics for monitoring
  getTimingStats(sessionId: string): any {
    const session = this.sessions.get(sessionId);
    const queueLength = this.getQueueLength(sessionId);
    
    return {
      sessionActive: !!session?.isActive,
      baseTimestamp: session?.baseTimestamp,
      audioStartTime: session?.audioStartTime,
      clockOffset: session?.clockOffset,
      queueLength,
      isPlaybackActive: this.playbackTimers.has(sessionId)
    };
  }
}