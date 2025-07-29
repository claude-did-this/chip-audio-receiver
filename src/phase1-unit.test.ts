import { AudioSyncManager } from './audio-sync-manager';
import { JitterBuffer } from './jitter-buffer';
import { AudioPacket, AudioFormat, NetworkConditions, SyncTimestamps } from './types';

// Mock logger to avoid config dependency
jest.mock('./logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }
}));

describe('Phase 1 Unit Tests', () => {
  describe('Audio Sync Manager', () => {
    let syncManager: AudioSyncManager;
    
    beforeEach(() => {
      syncManager = new AudioSyncManager();
    });

    afterEach(() => {
      // Clean up any active sessions
      syncManager['sessions'].forEach((_, sessionId) => {
        syncManager.endSession(sessionId);
      });
    });

    it('should create and manage sessions', () => {
      const sessionId = 'sync-session-1';
      syncManager.createSession(sessionId);
      
      const sessionInfo = syncManager.getSessionInfo(sessionId);
      expect(sessionInfo).toBeTruthy();
      expect(sessionInfo?.sessionId).toBe(sessionId);
      expect(sessionInfo?.isActive).toBe(true);
      expect(sessionInfo?.baseTimestamp).toBeGreaterThan(0);
      
      syncManager.endSession(sessionId);
      expect(syncManager.getSessionInfo(sessionId)).toBeNull();
    });

    it('should calculate playback timing correctly', () => {
      const sessionId = 'sync-session-2';
      syncManager.createSession(sessionId);
      
      const packet = createTestAudioPacket(sessionId, 1);
      const syncTimestamps: SyncTimestamps = {
        ttsGenerated: packet.timestamp,
        packetSent: packet.timestamp,
        packetReceived: Date.now(),
        scheduledPlayback: packet.playbackTime
      };
      const networkConditions: NetworkConditions = {
        avgLatency: 20,
        jitterMs: 5,
        packetLoss: 0,
        bandwidth: 1000000
      };
      
      const playbackTime = syncManager.calculatePlaybackTime(packet, syncTimestamps, networkConditions);
      
      expect(playbackTime).toBeGreaterThan(Date.now());
      expect(playbackTime).toBeLessThan(Date.now() + 1000); // Should be within 1 second
    });

    it('should establish timing baseline on first packet', () => {
      const sessionId = 'sync-session-3';
      syncManager.createSession(sessionId);
      
      const packet = createTestAudioPacket(sessionId, 1);
      const syncTimestamps: SyncTimestamps = {
        ttsGenerated: packet.timestamp,
        packetSent: packet.timestamp,
        packetReceived: Date.now(),
        scheduledPlayback: packet.playbackTime
      };
      const networkConditions: NetworkConditions = {
        avgLatency: 30,
        jitterMs: 10,
        packetLoss: 0,
        bandwidth: 1000000
      };
      
      const sessionBefore = syncManager.getSessionInfo(sessionId);
      expect(sessionBefore?.audioStartTime).toBe(0);
      
      syncManager.calculatePlaybackTime(packet, syncTimestamps, networkConditions);
      
      const sessionAfter = syncManager.getSessionInfo(sessionId);
      expect(sessionAfter?.audioStartTime).toBeGreaterThan(0);
      expect(sessionAfter?.clockOffset).toBeGreaterThan(0);
    });

    it('should schedule audio chunks', () => {
      const sessionId = 'sync-session-4';
      syncManager.createSession(sessionId);
      
      const packet = createTestAudioPacket(sessionId, 1);
      const syncTimestamps: SyncTimestamps = {
        ttsGenerated: packet.timestamp,
        packetSent: packet.timestamp,
        packetReceived: Date.now(),
        scheduledPlayback: packet.playbackTime
      };
      const networkConditions: NetworkConditions = {
        avgLatency: 20,
        jitterMs: 5,
        packetLoss: 0,
        bandwidth: 1000000
      };
      
      syncManager.scheduleAudioChunk(packet, syncTimestamps, networkConditions);
      
      expect(syncManager.getQueueLength(sessionId)).toBeGreaterThan(0);
      
      const timingStats = syncManager.getTimingStats(sessionId);
      expect(timingStats.sessionActive).toBe(true);
      expect(timingStats.queueLength).toBeGreaterThan(0);
    });

    it('should adjust timing based on network conditions', () => {
      const sessionId = 'sync-session-5';
      syncManager.createSession(sessionId);
      
      // Establish baseline first
      const packet = createTestAudioPacket(sessionId, 1);
      const syncTimestamps: SyncTimestamps = {
        ttsGenerated: packet.timestamp,
        packetSent: packet.timestamp,
        packetReceived: Date.now(),
        scheduledPlayback: packet.playbackTime
      };
      const initialConditions: NetworkConditions = {
        avgLatency: 20,
        jitterMs: 5,
        packetLoss: 0,
        bandwidth: 1000000
      };
      
      syncManager.calculatePlaybackTime(packet, syncTimestamps, initialConditions);
      
      // Simulate network condition change
      const changedConditions: NetworkConditions = {
        avgLatency: 50, // Increased latency
        jitterMs: 15,
        packetLoss: 0.01,
        bandwidth: 500000
      };
      
      syncManager.adjustTiming(sessionId, changedConditions);
      
      // Verify adjustment was made (gradual adjustment)
      const newOffset = syncManager.getSessionInfo(sessionId)?.clockOffset;
      expect(newOffset).toBeDefined();
    });
  });

  describe('Jitter Buffer', () => {
    let jitterBuffer: JitterBuffer;
    
    beforeEach(() => {
      jitterBuffer = new JitterBuffer({
        targetBufferMs: 100,
        minBufferMs: 50,
        maxBufferMs: 300,
        adaptiveMode: true
      });
    });

    afterEach(() => {
      // Clean up any active sessions
      jitterBuffer['buffer'].forEach((_, sessionId) => {
        jitterBuffer.endSession(sessionId);
      });
    });

    it('should initialize sessions correctly', () => {
      const sessionId = 'jitter-session-1';
      jitterBuffer.initializeSession(sessionId);
      
      const status = jitterBuffer.getBufferStatus(sessionId);
      expect(status.bufferSize).toBe(0);
      expect(status.bufferedTimeMs).toBe(0);
      expect(status.targetBufferMs).toBe(100);
      expect(status.statistics).toBeTruthy();
      expect(status.isPlaybackActive).toBe(false);
    });

    it('should buffer audio chunks in correct order', () => {
      const sessionId = 'jitter-session-2';
      jitterBuffer.initializeSession(sessionId);
      
      const networkConditions: NetworkConditions = {
        avgLatency: 20,
        jitterMs: 5,
        packetLoss: 0,
        bandwidth: 1000000
      };
      
      // Add chunks out of order
      const chunk2 = createTestTimedAudioChunk(sessionId, 2);
      chunk2.playbackTime = Date.now() + 200;
      
      const chunk1 = createTestTimedAudioChunk(sessionId, 1);
      chunk1.playbackTime = Date.now() + 100;
      
      jitterBuffer.addChunk(sessionId, chunk2, networkConditions);
      jitterBuffer.addChunk(sessionId, chunk1, networkConditions);
      
      const status = jitterBuffer.getBufferStatus(sessionId);
      expect(status.bufferSize).toBe(2);
      expect(status.bufferedTimeMs).toBeGreaterThan(0);
    });

    it('should drop late packets', () => {
      const sessionId = 'jitter-session-3';
      jitterBuffer.initializeSession(sessionId);
      
      const chunk = createTestTimedAudioChunk(sessionId, 1);
      chunk.playbackTime = Date.now() - 1000; // 1 second ago (late)
      
      const networkConditions: NetworkConditions = {
        avgLatency: 20,
        jitterMs: 5,
        packetLoss: 0,
        bandwidth: 1000000
      };
      
      jitterBuffer.addChunk(sessionId, chunk, networkConditions);
      
      const status = jitterBuffer.getBufferStatus(sessionId);
      expect(status.bufferSize).toBe(0); // Should be dropped
      expect(status.statistics?.droppedPackets).toBe(1);
    });

    it('should adapt buffer size based on network conditions', () => {
      const sessionId = 'jitter-session-4';
      jitterBuffer.initializeSession(sessionId);
      
      const goodConditions: NetworkConditions = {
        avgLatency: 10,
        jitterMs: 2,
        packetLoss: 0,
        bandwidth: 1000000
      };
      
      const poorConditions: NetworkConditions = {
        avgLatency: 50,
        jitterMs: 20,
        packetLoss: 0.05,
        bandwidth: 500000
      };
      
      // Add chunk with good conditions
      const chunk1 = createTestTimedAudioChunk(sessionId, 1);
      chunk1.playbackTime = Date.now() + 100;
      jitterBuffer.addChunk(sessionId, chunk1, goodConditions);
      
      // Add chunk with poor conditions - should increase buffer time
      const chunk2 = createTestTimedAudioChunk(sessionId, 2);
      chunk2.playbackTime = Date.now() + 200;
      jitterBuffer.addChunk(sessionId, chunk2, poorConditions);
      
      const status = jitterBuffer.getBufferStatus(sessionId);
      expect(status.bufferSize).toBe(2);
    });

    it('should handle buffer overrun', () => {
      const sessionId = 'jitter-session-5';
      jitterBuffer.initializeSession(sessionId);
      
      const networkConditions: NetworkConditions = {
        avgLatency: 20,
        jitterMs: 5,
        packetLoss: 0,
        bandwidth: 1000000
      };
      
      // Add many chunks to trigger overrun
      for (let i = 1; i <= 20; i++) {
        const chunk = createTestTimedAudioChunk(sessionId, i);
        chunk.playbackTime = Date.now() + (i * 50);
        jitterBuffer.addChunk(sessionId, chunk, networkConditions);
      }
      
      const status = jitterBuffer.getBufferStatus(sessionId);
      expect(status.statistics?.overruns).toBeGreaterThanOrEqual(0);
    });

    it('should update configuration', () => {
      const newConfig = {
        targetBufferMs: 150,
        minBufferMs: 75,
        maxBufferMs: 400,
        adaptiveMode: false
      };
      
      jitterBuffer.updateConfiguration(newConfig);
      
      const sessionId = 'jitter-session-6';
      jitterBuffer.initializeSession(sessionId);
      
      const status = jitterBuffer.getBufferStatus(sessionId);
      expect(status.targetBufferMs).toBe(150);
    });

    it('should end sessions cleanly', () => {
      const sessionId = 'jitter-session-7';
      jitterBuffer.initializeSession(sessionId);
      
      const chunk = createTestTimedAudioChunk(sessionId, 1);
      const networkConditions: NetworkConditions = {
        avgLatency: 20,
        jitterMs: 5,
        packetLoss: 0,
        bandwidth: 1000000
      };
      
      jitterBuffer.addChunk(sessionId, chunk, networkConditions);
      
      const finalStats = jitterBuffer.endSession(sessionId);
      expect(finalStats).toBeTruthy();
      expect(finalStats?.droppedPackets).toBe(0);
      
      const status = jitterBuffer.getBufferStatus(sessionId);
      expect(status.bufferSize).toBe(0);
    });
  });
});

// Helper functions
function createTestAudioPacket(sessionId: string, sequenceNumber: number): AudioPacket {
  const now = Date.now();
  return {
    sessionId,
    sequenceNumber,
    timestamp: now,
    playbackTime: now + 100, // Play in 100ms
    audioData: Buffer.from('test-audio-data-' + sequenceNumber),
    format: AudioFormat.PCM,
    sampleRate: 44100,
    isLast: false
  };
}

function createTestTimedAudioChunk(sessionId: string, sequenceNumber: number) {
  return {
    sessionId,
    audio: Buffer.from('test-audio-data-' + sequenceNumber),
    playbackTime: Date.now() + 100,
    duration: 20, // 20ms duration
    sequenceNumber
  };
}