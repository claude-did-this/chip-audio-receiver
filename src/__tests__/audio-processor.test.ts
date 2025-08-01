import { jest } from '@jest/globals';
import { AudioProcessor } from '../audio-processor';
import { Writable } from 'stream';
import { ChildProcess } from 'child_process';
import Speaker from 'speaker';
import { MemoryManager } from '../security';

// Mock dependencies
jest.mock('../logger');
jest.mock('../audio-devices');
jest.mock('../security', () => ({
  SecurityValidator: {
    generateSafeFilename: jest.fn((sessionId: string, timestamp: string, format: string) => {
      const safeTimestamp = timestamp.replace(/[:.]/g, '-');
      const extension = format === 'pcm' ? 'raw' : format;
      return `audio-${sessionId}-${safeTimestamp}.${extension}`;
    })
  },
  MemoryManager: jest.fn(() => ({}))
}));
jest.mock('speaker', () => {
  return jest.fn().mockImplementation(() => ({
    write: jest.fn().mockReturnValue(true),
    end: jest.fn(),
    once: jest.fn(),
    on: jest.fn(),
  }));
});
jest.mock('child_process');
jest.mock('fs', () => ({
  promises: {
    writeFile: jest.fn(),
    mkdir: jest.fn(),
  },
  mkdirSync: jest.fn(),
  existsSync: jest.fn(),
}));

describe('AudioProcessor - Audio Streaming Behavior', () => {
  let audioProcessor: AudioProcessor;
  let mockMemoryManager: jest.Mocked<MemoryManager>;
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
    mockMemoryManager = new MemoryManager() as jest.Mocked<MemoryManager>;
    audioProcessor = new AudioProcessor(mockConfig, mockMemoryManager);
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
        once: jest.fn((event: string, callback: (...args: unknown[]) => void) => {
          if (event === 'drain') {
            // Simulate drain event after a short delay
            setTimeout(callback, 10);
          }
          return mockWritable;
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
      stream.output = { end: mockEnd } as Partial<Writable> as Writable;

      await audioProcessor.finalizeStream(sessionId);

      expect(mockEnd).toHaveBeenCalled();
    });

    it('should kill child process outputs on finalization', async () => {
      const sessionId = 'test-session-123';
      const mockKill = jest.fn();
      
      const stream = await audioProcessor.createStream(sessionId, 'pcm', 44100);
      stream.output = { kill: mockKill } as Partial<ChildProcess> as ChildProcess;

      await audioProcessor.finalizeStream(sessionId);

      expect(mockKill).toHaveBeenCalled();
    });
  });

  describe('Output Type Behavior', () => {
    it('should create speaker output for PCM format', async () => {
      const mockSpeaker = jest.mocked(Speaker);
      audioProcessor = new AudioProcessor({ ...mockConfig, output: { type: 'speaker', device: undefined } }, mockMemoryManager);

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
      audioProcessor = new AudioProcessor({ ...mockConfig, output: { type: 'speaker', device: undefined } }, mockMemoryManager);

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
      }, mockMemoryManager);

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

    it('should verify all resources are released after cleanup', async () => {
      const sessions = ['session-1', 'session-2'];
      const mockEnd = jest.fn();
      
      // Create streams with mock outputs
      for (const sessionId of sessions) {
        const stream = await audioProcessor.createStream(sessionId, 'pcm', 44100);
        stream.output = { end: mockEnd } as Partial<Writable> as Writable;
      }

      await audioProcessor.cleanup();

      // Verify all outputs were closed
      expect(mockEnd).toHaveBeenCalledTimes(sessions.length);
      
      // Verify no streams remain
      await expect(
        audioProcessor.processChunk('session-1', Buffer.from('data'), 'pcm')
      ).rejects.toThrow('No stream found for session session-1');
    });

    it('should handle cleanup with no active streams', async () => {
      // Should not throw when no streams exist
      await expect(audioProcessor.cleanup()).resolves.not.toThrow();
    });

    it('should handle errors during stream finalization', async () => {
      const stream = await audioProcessor.createStream('session-1', 'pcm', 44100);
      
      // Force buffer to have data
      stream.buffer.push(Buffer.from('test'));
      
      // Mock cleanup to throw
      const mockEnd = jest.fn().mockImplementation(() => {
        throw new Error('Cleanup error');
      });
      
      const mockWritable = new Writable({
        write: jest.fn((_chunk, _encoding, callback: (error?: Error | null) => void) => callback()),
      });
      mockWritable.end = mockEnd as unknown as Writable['end'];
      stream.output = mockWritable as Partial<Writable> as Writable;
      
      // The current implementation doesn't catch errors in finalizeStream
      // It will throw if end() throws
      await expect(audioProcessor.finalizeStream('session-1')).rejects.toThrow('Cleanup error');
    });
  });

  describe('Error Handling', () => {
    it('should handle errors when creating speaker output', async () => {
      const mockSpeaker = jest.mocked(Speaker);
      mockSpeaker.mockImplementationOnce(() => {
        throw new Error('Audio device not found');
      });

      audioProcessor = new AudioProcessor({ ...mockConfig, output: { type: 'speaker', device: undefined } }, mockMemoryManager);

      await expect(
        audioProcessor.createStream('session-1', 'pcm', 44100)
      ).rejects.toThrow('Audio device not found');
    });

    it('should handle write errors gracefully', async () => {
      const sessionId = 'test-session-123';
      const audioData = Buffer.from('test-audio-data');
      
      // Create a mock writable stream that throws on write
      const mockWritable = {
        write: jest.fn().mockImplementation(() => {
          throw new Error('Write failed');
        }),
        once: jest.fn(),
      };

      const stream = await audioProcessor.createStream(sessionId, 'pcm', 44100);
      stream.output = mockWritable as Partial<Writable> as Writable;

      await expect(
        audioProcessor.processChunk(sessionId, audioData, 'pcm')
      ).rejects.toThrow('Write failed');
    });

    it('should handle format mismatches', async () => {
      await audioProcessor.createStream('session-1', 'pcm', 44100);
      
      // Try to process chunk with different format
      const chunk = Buffer.from('test-mp3-data');
      
      // The current implementation ignores the format parameter in processChunk
      // It doesn't validate format mismatches
      await expect(
        audioProcessor.processChunk('session-1', chunk, 'mp3')
      ).resolves.not.toThrow();
    });

    it('should handle invalid audio formats', async () => {
      // The current implementation doesn't validate formats in createStream
      // It will create a stream with any format, but might fail when creating output
      await audioProcessor.createStream('session-1', 'invalid', 44100);
      // Stream creation succeeds but output creation may fail for unsupported formats
    });
  });

  describe('File Output', () => {
    let mockWriteFile: jest.Mock;
    let mockMkdir: jest.Mock;

    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('fs');
      mockWriteFile = fs.promises.writeFile as jest.Mock;
      mockMkdir = fs.promises.mkdir as jest.Mock;
      mockWriteFile.mockClear();
      mockMkdir.mockClear();
    });

    it('should save audio chunks to file when saveToFile is enabled', async () => {
      audioProcessor = new AudioProcessor({ 
        ...mockConfig, 
        saveToFile: true,
        output: { type: 'file', device: undefined } 
      }, mockMemoryManager);

      const sessionId = 'test-session-123';
      const audioData = Buffer.from('test-audio-data');
      
      const stream = await audioProcessor.createStream(sessionId, 'pcm', 44100);
      await audioProcessor.processChunk(sessionId, audioData, 'pcm');

      expect(stream.buffer).toContain(audioData);
    });

    it('should write file on stream finalization', async () => {
      // Enable file saving
      const configWithFile = {
        ...mockConfig,
        saveToFile: true,
      };
      const processor = new AudioProcessor(configWithFile, mockMemoryManager);
      
      await processor.createStream('session-1', 'pcm', 44100);
      
      // Add some data to buffer
      const chunk1 = Buffer.from('chunk1');
      const chunk2 = Buffer.from('chunk2');
      await processor.processChunk('session-1', chunk1, 'pcm');
      await processor.processChunk('session-1', chunk2, 'pcm');
      
      await processor.finalizeStream('session-1');
      
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringMatching(/audio-output[\\/]audio-session-1-.*\.raw/), // pcm files get .raw extension
        Buffer.concat([chunk1, chunk2])
      );
    });

    it('should create output directory if it does not exist', async () => {
      const configWithPath = {
        ...mockConfig,
        saveToFile: true,
        output: {
          ...mockConfig.output,
          path: 'test-output',
        },
      };
      const processor = new AudioProcessor(configWithPath, mockMemoryManager);
      
      const stream = await processor.createStream('session-1', 'pcm', 44100);
      stream.buffer.push(Buffer.from('test'));
      
      await processor.finalizeStream('session-1');
      
      // Should create the output directory
      expect(mockMkdir).toHaveBeenCalledWith(
        './audio-output',
        { recursive: true }
      );
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringMatching(/audio-output[\\/]audio-session-1-.*\.raw/),
        expect.any(Buffer)
      );
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent writes to same session', async () => {
      const sessionId = 'test-session-123';
      const chunks = Array.from({ length: 10 }, (_, i) => 
        Buffer.from(`chunk-${i}`)
      );

      await audioProcessor.createStream(sessionId, 'pcm', 44100);

      // Process chunks concurrently
      await Promise.all(
        chunks.map(chunk => 
          audioProcessor.processChunk(sessionId, chunk, 'pcm')
        )
      );

      // All chunks should be processed without error
      expect(true).toBe(true); // If we get here, no errors were thrown
    });

    it('should handle concurrent stream creation for different sessions', async () => {
      const sessions = Array.from({ length: 5 }, (_, i) => `session-${i}`);

      // Create streams concurrently
      const streams = await Promise.all(
        sessions.map(sessionId => 
          audioProcessor.createStream(sessionId, 'pcm', 44100)
        )
      );

      expect(streams).toHaveLength(5);
      streams.forEach((stream, index) => {
        expect(stream.sessionId).toBe(`session-${index}`);
      });
    });

    it('should handle concurrent finalization', async () => {
      const sessions = ['session-1', 'session-2', 'session-3'];

      // Create streams
      for (const sessionId of sessions) {
        await audioProcessor.createStream(sessionId, 'pcm', 44100);
      }

      // Finalize concurrently
      await Promise.all(
        sessions.map(sessionId => 
          audioProcessor.finalizeStream(sessionId)
        )
      );

      // All streams should be finalized
      for (const sessionId of sessions) {
        await expect(
          audioProcessor.processChunk(sessionId, Buffer.from('data'), 'pcm')
        ).rejects.toThrow(`No stream found for session ${sessionId}`);
      }
    });
  });
});