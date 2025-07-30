import { EventEmitter } from 'events';
import { SubtitleData, AudioPacket } from './types';
import { logger } from './logger';

interface SubtitleEvent {
  subtitle: SubtitleData;
  scheduledTime: number;
  sessionId: string;
}

interface SessionSubtitleState {
  subtitles: SubtitleData[];
  currentIndex: number;
  baselineTime: number;
  clockOffset: number;
}

export class SubtitleSyncManager extends EventEmitter {
  private sessions: Map<string, SessionSubtitleState> = new Map();
  private scheduledSubtitles: Map<NodeJS.Timeout, SubtitleEvent> = new Map();
  private displayMethod: 'obs-websocket' | 'overlay' | 'toast';

  constructor(displayMethod: 'obs-websocket' | 'overlay' | 'toast' = 'obs-websocket') {
    super();
    this.displayMethod = displayMethod;
  }

  initializeSession(sessionId: string, subtitles: SubtitleData[], baselineTime: number, clockOffset: number): void {
    logger.info('Initializing subtitle session', { sessionId, subtitleCount: subtitles.length });
    
    this.sessions.set(sessionId, {
      subtitles,
      currentIndex: 0,
      baselineTime,
      clockOffset
    });

    // Schedule all subtitles for this session
    this.scheduleSessionSubtitles(sessionId);
  }

  private scheduleSessionSubtitles(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    const now = Date.now();
    
    state.subtitles.forEach((subtitle) => {
      // Calculate when this subtitle should appear
      const displayTime = state.baselineTime + subtitle.startTime + state.clockOffset;
      const delay = displayTime - now;

      if (delay > 0) {
        const timeout = setTimeout(() => {
          this.displaySubtitle(sessionId, subtitle);
          this.scheduledSubtitles.delete(timeout);
        }, delay);

        this.scheduledSubtitles.set(timeout, {
          subtitle,
          scheduledTime: displayTime,
          sessionId
        });

        // Schedule subtitle removal
        const hideDelay = state.baselineTime + subtitle.endTime + state.clockOffset - now;
        if (hideDelay > 0) {
          setTimeout(() => {
            this.hideSubtitle(sessionId, subtitle);
          }, hideDelay);
        }
      }
    });

    logger.debug('Scheduled subtitles for session', { 
      sessionId, 
      scheduledCount: this.scheduledSubtitles.size 
    });
  }

  adjustTiming(sessionId: string, clockOffset: number): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    // Cancel existing scheduled subtitles for this session
    this.cancelSessionSubtitles(sessionId);

    // Update clock offset and reschedule
    state.clockOffset = clockOffset;
    this.scheduleSessionSubtitles(sessionId);

    logger.info('Adjusted subtitle timing', { sessionId, newClockOffset: clockOffset });
  }

  private displaySubtitle(sessionId: string, subtitle: SubtitleData): void {
    logger.debug('Displaying subtitle', { sessionId, text: subtitle.text });

    this.emit('subtitle:display', {
      sessionId,
      subtitle,
      displayMethod: this.displayMethod,
      timestamp: Date.now()
    });

    // Update current index
    const state = this.sessions.get(sessionId);
    if (state) {
      const index = state.subtitles.indexOf(subtitle);
      if (index >= 0) {
        state.currentIndex = index;
      }
    }
  }

  private hideSubtitle(sessionId: string, subtitle: SubtitleData): void {
    logger.debug('Hiding subtitle', { sessionId, text: subtitle.text });

    this.emit('subtitle:hide', {
      sessionId,
      subtitle,
      displayMethod: this.displayMethod,
      timestamp: Date.now()
    });
  }

  private cancelSessionSubtitles(sessionId: string): void {
    const toCancel: NodeJS.Timeout[] = [];

    this.scheduledSubtitles.forEach((event, timeout) => {
      if (event.sessionId === sessionId) {
        clearTimeout(timeout);
        toCancel.push(timeout);
      }
    });

    toCancel.forEach(timeout => this.scheduledSubtitles.delete(timeout));
  }

  onAudioPacket(packet: AudioPacket): void {
    const state = this.sessions.get(packet.sessionId);
    if (!state) return;

    // Check if we need to adjust timing based on actual playback
    const expectedTime = state.baselineTime + packet.playbackTime;
    const actualTime = Date.now();
    const drift = actualTime - expectedTime;

    if (Math.abs(drift) > 50) { // More than 50ms drift
      logger.warn('Subtitle sync drift detected', { 
        sessionId: packet.sessionId, 
        drift,
        expectedTime,
        actualTime
      });

      // Adjust timing to compensate
      this.adjustTiming(packet.sessionId, state.clockOffset + drift);
    }
  }

  getSessionStats(sessionId: string): any {
    const state = this.sessions.get(sessionId);
    if (!state) return null;

    const scheduledCount = Array.from(this.scheduledSubtitles.values())
      .filter(event => event.sessionId === sessionId).length;

    return {
      totalSubtitles: state.subtitles.length,
      currentIndex: state.currentIndex,
      scheduledCount,
      clockOffset: state.clockOffset,
      progress: (state.currentIndex / state.subtitles.length) * 100
    };
  }

  endSession(sessionId: string): void {
    logger.info('Ending subtitle session', { sessionId });

    // Cancel all scheduled subtitles
    this.cancelSessionSubtitles(sessionId);

    // Remove session state
    this.sessions.delete(sessionId);

    // Emit session end event
    this.emit('subtitle:sessionEnd', { sessionId });
  }

  destroy(): void {
    // Cancel all scheduled subtitles
    this.scheduledSubtitles.forEach((_, timeout) => {
      clearTimeout(timeout);
    });

    this.scheduledSubtitles.clear();
    this.sessions.clear();
    this.removeAllListeners();
  }
}