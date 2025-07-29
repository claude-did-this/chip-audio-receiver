import { jest } from '@jest/globals';
import { AudioProcessor } from '../audio-processor';
import { Writable } from 'stream';
import { ChildProcess } from 'child_process';
import Speaker from 'speaker';

// Mock dependencies
jest.mock('../logger');
jest.mock('../audio-devices');
jest.mock('speaker', () => {
  return jest.fn().mockImplementation(() => ({
    write: jest.fn().mockReturnValue(true),
    end: jest.fn(),
    once: jest.fn(),
    on: jest.fn(),
  }));
});
jest.mock('child_process');
jest.mock('fs');

describe('AudioProcessor - Audio Streaming Behavior', () => {
  let audioProcessor: AudioProcessor;
  const mockConfig = {
    output: {
      type: 'speaker' as const,
      device: undefined,
    },
    bufferSize: 4096,
    saveToFile: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    audioProcessor = new AudioProcessor(mockConfig);
  });

  describe('Stream Lifecycle', () => {
    it('should create a new audio stream for a session', async () => {
      const sessionId = 'test-session-123';
      const format = 'pcm';
      const sampleRate = 44100;

      const stream = await audioProcessor.createStream(sessionId, format, sampleRate);

      expect(stream).toBeDefined();
      expect(stream.sessionId).toBe(sessionId);
      expect(stream.format).toBe(format);
      expect(stream.sampleRate).toBe(sampleRate);
      expect(stream.buffer).toEqual([]);
      expect(stream.startTime).toBeLessThanOrEqual(Date.now());
    });

    it('should close existing stream when creating a new one for the same session', async () => {
      const sessionId = 'test-session-123';
      const finalizeSpy = jest.spyOn(audioProcessor, 'finalizeStream');

      // Create first stream
      await audioProcessor.createStream(sessionId, 'pcm', 44100);
      
      // Create second stream for same session
      await audioProcessor.createStream(sessionId, 'mp3', 24000);

      expect(finalizeSpy).toHaveBeenCalledWith(sessionId);
      expect(finalizeSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Audio Chunk Processing', () => {
    it('should process and buffer audio chunks', async () => {
      const sessionId = 'test-session-123';
      const audioData = Buffer.from('test-audio-data');
      
      const stream = await audioProcessor.createStream(sessionId, 'pcm', 44100);
      
      // Process chunk without error
      await expect(
        audioProcessor.processChunk(sessionId, audioData, 'pcm')
      ).resolves.not.toThrow();

      // Verify output was written (if speaker output)
      if (stream.output && 'write' in stream.output) {
        expect(stream.output.write).toHaveBeenCalledWith(audioData);
      }
    });

    it('should throw error when processing chunk for non-existent stream', async () => {
      const sessionId = 'non-existent-session';
      const audioData = Buffer.from('test-audio-data');

      await expect(
        audioProcessor.processChunk(sessionId, audioData, 'pcm')
      ).rejects.toThrow(`No stream found for session ${sessionId}`);
    });

    it('should handle backpressure when writing to output stream', async () => {
      const sessionId = 'test-session-123';
      const audioData = Buffer.from('test-audio-data');
      
      // Create a mock writable stream that simulates backpressure
      const mockWritable = {
        write: jest.fn().mockReturnValue(false),
        once: jest.fn((event, callback) => {
          if (event === 'drain') {
            // Simulate drain event after a short delay
            setTimeout(callback as () => void, 10);
          }
        }),
      };

      const stream = await audioProcessor.createStream(sessionId, 'pcm', 44100);
      stream.output = mockWritable as unknown as Writable;

      await audioProcessor.processChunk(sessionId, audioData, 'pcm');

      expect(mockWritable.write).toHaveBeenCalledWith(audioData);
      expect(mockWritable.once).toHaveBeenCalledWith('drain', expect.any(Function));
    });
  });

  describe('Stream Finalization', () => {
    it('should properly finalize and clean up a stream', async () => {
      const sessionId = 'test-session-123';
      
      await audioProcessor.createStream(sessionId, 'pcm', 44100);
      await audioProcessor.finalizeStream(sessionId);

      // Attempting to process a chunk should now fail
      await expect(
        audioProcessor.processChunk(sessionId, Buffer.from('data'), 'pcm')
      ).rejects.toThrow(`No stream found for session ${sessionId}`);
    });

    it('should handle finalization of non-existent stream gracefully', async () => {
      const sessionId = 'non-existent-session';

      // Should not throw
      await expect(
        audioProcessor.finalizeStream(sessionId)
      ).resolves.not.toThrow();
    });

    it('should close writable stream outputs on finalization', async () => {
      const sessionId = 'test-session-123';
      const mockEnd = jest.fn();
      
      const stream = await audioProcessor.createStream(sessionId, 'pcm', 44100);
      stream.output = { end: mockEnd } as unknown as Writable;

      await audioProcessor.finalizeStream(sessionId);

      expect(mockEnd).toHaveBeenCalled();
    });

    it('should kill child process outputs on finalization', async () => {
      const sessionId = 'test-session-123';
      const mockKill = jest.fn();
      
      const stream = await audioProcessor.createStream(sessionId, 'pcm', 44100);
      stream.output = { kill: mockKill } as unknown as ChildProcess;

      await audioProcessor.finalizeStream(sessionId);

      expect(mockKill).toHaveBeenCalled();
    });
  });

  describe('Output Type Behavior', () => {
    it('should create speaker output for PCM format', async () => {
      const mockSpeaker = jest.mocked(Speaker);
      audioProcessor = new AudioProcessor({ ...mockConfig, output: { type: 'speaker', device: undefined } });

      await audioProcessor.createStream('session-1', 'pcm', 44100);

      expect(mockSpeaker).toHaveBeenCalledWith({
        channels: 1,
        sampleRate: 44100,
        bitDepth: 32,
        float: true,
        signed: true,
      });
    });

    it('should create speaker output for MP3 format', async () => {
      const mockSpeaker = jest.mocked(Speaker);
      audioProcessor = new AudioProcessor({ ...mockConfig, output: { type: 'speaker', device: undefined } });

      await audioProcessor.createStream('session-1', 'mp3', 24000);

      expect(mockSpeaker).toHaveBeenCalledWith({
        channels: 1,
        sampleRate: 24000,
        bitDepth: 16,
      });
    });

    it('should handle file output type', async () => {
      audioProcessor = new AudioProcessor({ 
        ...mockConfig, 
        output: { type: 'file', device: undefined } 
      });

      const stream = await audioProcessor.createStream('session-1', 'pcm', 44100);

      expect(stream.output).toBeNull();
    });
  });

  describe('Cleanup Behavior', () => {
    it('should finalize all active streams on cleanup', async () => {
      const sessions = ['session-1', 'session-2', 'session-3'];
      const finalizeSpy = jest.spyOn(audioProcessor, 'finalizeStream');

      // Create multiple streams
      for (const sessionId of sessions) {
        await audioProcessor.createStream(sessionId, 'pcm', 44100);
      }

      await audioProcessor.cleanup();

      expect(finalizeSpy).toHaveBeenCalledTimes(sessions.length);
      sessions.forEach(sessionId => {
        expect(finalizeSpy).toHaveBeenCalledWith(sessionId);
      });
    });
  });
});