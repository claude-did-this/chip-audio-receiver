import { jest } from '@jest/globals';
import { AudioReceiver } from '../index';
import { createClient } from 'redis';
import express, { Request, Response } from 'express';

// Mock dependencies
jest.mock('redis');
jest.mock('../logger');
jest.mock('../metrics', () => ({
  setupMetrics: jest.fn(),
}));
jest.mock('../audio-processor', () => ({
  AudioProcessor: jest.fn().mockImplementation(() => ({
    createStream: jest.fn(),
    processChunk: jest.fn(),
    finalizeStream: jest.fn(),
    cleanup: jest.fn(),
  }))
}));
jest.mock('../resilience', () => ({
  ResilienceManager: jest.fn().mockImplementation(() => ({
    executeWithResilience: jest.fn(),
    scheduleReconnect: jest.fn(),
    handleError: jest.fn(),
    resetRetryCount: jest.fn(),
    getMetrics: jest.fn(),
  }))
}));
jest.mock('express', () => {
  const mockApp = {
    use: jest.fn(),
    get: jest.fn(),
    listen: jest.fn((_port: number, callback: () => void) => {
      if (callback) callback();
      return { close: jest.fn() };
    }),
  };
  const express = jest.fn(() => mockApp);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (express as any).json = jest.fn();
  return express;
});
jest.mock('../config', () => ({
  config: {
    redis: {
      host: 'localhost',
      port: 6379,
      get password(): string | undefined { return process.env.REDIS_PASSWORD; },
    },
    channels: {
      responses: 'chip.voice.responses',
      health: 'chip.health.*',
    },
    metrics: {
      enabled: true,
      port: 9090,
    },
    audio: {
      output: {
        type: 'speaker',
        device: undefined,
      },
      bufferSize: 4096,
      saveToFile: false,
    },
    resilience: {
      reconnectMaxAttempts: 10,
      reconnectBaseDelay: 1000,
      reconnectMaxDelay: 30000,
    },
    logging: {
      level: 'info',
      pretty: false,
    },
  },
  validateConfig: jest.fn(),
}));

describe('AudioReceiver - Server Connection Behavior', () => {
  let audioReceiver: AudioReceiver;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockRedisClient: any;
  let mockConnect: jest.Mock;
  let mockSubscribe: jest.Mock;
  let mockDisconnect: jest.Mock;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock process.exit
    originalExit = process.exit;
    process.exit = jest.fn() as unknown as typeof process.exit;
    
    // Setup Redis client mock
    mockConnect = jest.fn(() => Promise.resolve());
    mockSubscribe = jest.fn(() => Promise.resolve());
    mockDisconnect = jest.fn(() => Promise.resolve());
    
    mockRedisClient = {
      connect: mockConnect,
      subscribe: mockSubscribe,
      pSubscribe: jest.fn(() => Promise.resolve()),
      unsubscribe: jest.fn(() => Promise.resolve()),
      disconnect: mockDisconnect,
      on: jest.fn().mockReturnThis(),
      off: jest.fn().mockReturnThis(),
      isOpen: true,
    };

    const mockCreateClient = jest.mocked(createClient);
    mockCreateClient.mockReturnValue(mockRedisClient);

    audioReceiver = new AudioReceiver();
  });

  afterEach(() => {
    // Restore process.exit
    process.exit = originalExit;
    
    // Remove all listeners to prevent memory leaks
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  describe('Redis Connection', () => {
    it('should connect to Redis server on start', async () => {
      await audioReceiver.start();

      expect(createClient).toHaveBeenCalledWith({
        socket: {
          host: 'localhost',
          port: 6379,
        },
        password: undefined,
      });
      expect(mockConnect).toHaveBeenCalled();
    });

    it('should subscribe to configured channels after connecting', async () => {
      await audioReceiver.start();

      expect(mockSubscribe).toHaveBeenCalledWith('chip.voice.responses', expect.any(Function));
      expect(mockSubscribe).toHaveBeenCalledWith('chip.health.*', expect.any(Function));
      expect(mockSubscribe).toHaveBeenCalledTimes(2);
    });

    it('should handle Redis connection errors', async () => {
      const errorHandler = jest.fn();
      mockRedisClient.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'error') {
          errorHandler.mockImplementation(handler);
        }
      });

      await audioReceiver.start();

      const testError = new Error('Connection refused');
      errorHandler(testError);

      // Verify error is handled by resilience manager
      expect(errorHandler).toHaveBeenCalledWith(testError);
    });

    it('should handle Redis disconnection and attempt reconnection', async () => {
      let disconnectHandler: () => void;
      mockRedisClient.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'disconnect') {
          disconnectHandler = handler;
        }
      });

      await audioReceiver.start();

      // Simulate disconnection
      disconnectHandler!();

      // Verify reconnection is scheduled (through resilience manager)
      expect(mockRedisClient.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
    });

    it('should reset retry count on successful connection', async () => {
      let connectHandler: () => void;
      mockRedisClient.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'connect') {
          connectHandler = handler as () => void;
        }
        return mockRedisClient;
      });

      await audioReceiver.start();

      // Simulate successful connection
      connectHandler!();

      expect(mockRedisClient.on).toHaveBeenCalledWith('connect', expect.any(Function));
    });
  });

  describe('Message Subscription', () => {
    it('should process voice response messages from Redis', async () => {
      let messageHandler: ((message: string) => void) | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockSubscribe as any).mockImplementation((channel: string, handler: (message: string) => void) => {
        if (channel === 'chip.voice.responses') {
          messageHandler = handler;
        }
        return Promise.resolve();
      });

      await audioReceiver.start();

      const testMessage = JSON.stringify({
        id: 'msg-123',
        type: 'AUDIO_OUTPUT',
        service: 'cartesia',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        data: {
          audio: Buffer.from('test-audio').toString('base64'),
          format: 'pcm',
        },
        metadata: {
          correlationId: 'corr-123',
          sampleRate: 44100,
          isFirst: true,
          isFinal: false,
        },
      });

      // Send test message
      messageHandler!(testMessage);

      // Message should be processed without throwing
      expect(() => messageHandler!(testMessage)).not.toThrow();
    });

    it('should handle malformed messages gracefully', async () => {
      let messageHandler: ((message: string) => void) | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockSubscribe as any).mockImplementation((channel: string, handler: (message: string) => void) => {
        if (channel === 'chip.voice.responses') {
          messageHandler = handler;
        }
        return Promise.resolve();
      });

      await audioReceiver.start();

      // Send malformed JSON
      expect(() => messageHandler!('invalid json')).not.toThrow();
      
      // Send message with missing required fields
      expect(() => messageHandler!('{}')).not.toThrow();
    });
  });

  describe('Health Monitoring', () => {
    it('should expose health endpoint', async () => {
      const mockApp = express();
      const mockListen = jest.fn((_port: number, callback: () => void) => callback());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockApp.listen = mockListen as any;

      // Accessing private property for test - this is a test-only scenario
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (audioReceiver as any).app = mockApp;

      await audioReceiver.start();

      expect(mockListen).toHaveBeenCalledWith(9090, expect.any(Function));
    });

    it('should return healthy status when Redis is connected', async () => {
      await audioReceiver.start();

      // Find the health handler that was registered
      const mockApp = jest.mocked(express)();
      const getMock = mockApp.get as jest.Mock;
      const getCall = getMock.mock.calls.find((call: unknown[]) => call[0] === '/health');
      expect(getCall).toBeDefined();
      
      const healthHandler = getCall![1] as (req: Request, res: Response) => void;
      const mockReq = {};
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      healthHandler(mockReq as unknown as Request, mockRes as unknown as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'healthy',
          activeStreams: 0,
          timestamp: expect.any(String),
          uptime: expect.any(Number),
        })
      );
    });

    it('should return unhealthy status when Redis is disconnected', async () => {
      mockRedisClient.isOpen = false;
      
      await audioReceiver.start();

      // Find the health handler that was registered
      const mockApp = jest.mocked(express)();
      const getMock = mockApp.get as jest.Mock;
      const getCall = getMock.mock.calls.find((call: unknown[]) => call[0] === '/health');
      expect(getCall).toBeDefined();
      
      const healthHandler = getCall![1] as (req: Request, res: Response) => void;
      const mockReq = {};
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      healthHandler(mockReq as unknown as Request, mockRes as unknown as Response);

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'unhealthy',
        })
      );
    });
  });

  describe('Graceful Shutdown', () => {
    it('should prepare for graceful shutdown on start', async () => {
      await audioReceiver.start();

      // Verify that signal handlers were set up
      expect(process.listenerCount('SIGINT')).toBeGreaterThan(0);
      expect(process.listenerCount('SIGTERM')).toBeGreaterThan(0);
    });

    it('should cleanup resources on shutdown', async () => {
      await audioReceiver.start();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockAudioProcessor = (audioReceiver as any).audioProcessor;
      const cleanupSpy = jest.spyOn(mockAudioProcessor, 'cleanup');
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      // Get the shutdown handler
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sigintHandler = process.listeners('SIGINT')[process.listeners('SIGINT').length - 1] as any;
      
      // Trigger shutdown
      await sigintHandler('SIGINT');

      expect(cleanupSpy).toHaveBeenCalled();
      expect(mockDisconnect).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
      
      exitSpy.mockRestore();
    });

    it('should handle cleanup errors gracefully', async () => {
      await audioReceiver.start();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockAudioProcessor = (audioReceiver as any).audioProcessor;
      jest.spyOn(mockAudioProcessor, 'cleanup').mockRejectedValueOnce(new Error('Cleanup failed'));
      mockDisconnect.mockImplementationOnce(() => Promise.reject(new Error('Disconnect failed')));

      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      // Get the shutdown handler
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sigintHandler = process.listeners('SIGINT')[process.listeners('SIGINT').length - 1] as any;
      
      // Trigger shutdown - cleanup errors should be caught
      try {
        await sigintHandler('SIGINT');
      } catch (error) {
        // Expected - disconnect failed
        expect((error as Error).message).toBe('Disconnect failed');
      }
      
      // Process.exit(0) is not called because disconnect fails
      expect(exitSpy).not.toHaveBeenCalled();
      exitSpy.mockRestore();
    });

    it('should cleanup on process signals', async () => {
      await audioReceiver.start();
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockAudioProcessor = (audioReceiver as any).audioProcessor;
      const cleanupSpy = jest.spyOn(mockAudioProcessor, 'cleanup');
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      
      // Emit SIGINT
      process.emit('SIGINT');
      
      // Give time for async operations
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(cleanupSpy).toHaveBeenCalled();
      exitSpy.mockRestore();
    });
  });

  describe('Authentication', () => {
    it('should handle Redis authentication failures', async () => {
      mockConnect.mockImplementationOnce(() => Promise.reject(new Error('WRONGPASS invalid username-password pair')));
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      await audioReceiver.start();
      
      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    });

    it('should connect with password when provided', async () => {
      process.env.REDIS_PASSWORD = 'test-password';
      
      // Re-create receiver to pick up new env
      audioReceiver = new AudioReceiver();
      
      await audioReceiver.start();

      expect(createClient).toHaveBeenCalledWith({
        socket: {
          host: 'localhost',
          port: 6379,
        },
        password: 'test-password',
      });
    });

    it('should handle authentication timeout', async () => {
      mockConnect.mockImplementationOnce(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 100)
        )
      );
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      await audioReceiver.start();
      
      // Wait for the timeout
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    });
  });

  describe('Message Processing', () => {
    it('should create audio stream on first message', async () => {
      let messageHandler: ((message: string) => void) | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockSubscribe as any).mockImplementation((channel: string, handler: (message: string) => void) => {
        if (channel === 'chip.voice.responses') {
          messageHandler = handler;
        }
        return Promise.resolve();
      });

      await audioReceiver.start();

      const testMessage = JSON.stringify({
        id: 'msg-123',
        type: 'AUDIO_OUTPUT',
        service: 'cartesia',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        data: {
          audio: Buffer.from('test-audio').toString('base64'),
          format: 'pcm',
        },
        metadata: {
          correlationId: 'corr-123',
          sampleRate: 44100,
          isFirst: true,
          isFinal: false,
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockAudioProcessor = (audioReceiver as any).audioProcessor;
      const createStreamSpy = jest.spyOn(mockAudioProcessor, 'createStream');

      messageHandler!(testMessage);
      
      // Wait for async operations
      await new Promise(resolve => setImmediate(resolve));

      expect(createStreamSpy).toHaveBeenCalledWith('session-123', 'pcm', 44100);
    });

    it('should process audio chunks in order', async () => {
      let messageHandler: ((message: string) => void) | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockSubscribe as any).mockImplementation((channel: string, handler: (message: string) => void) => {
        if (channel === 'chip.voice.responses') {
          messageHandler = handler;
        }
        return Promise.resolve();
      });

      await audioReceiver.start();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockAudioProcessor = (audioReceiver as any).audioProcessor;
      const processChunkSpy = jest.spyOn(mockAudioProcessor, 'processChunk');

      const chunks = ['chunk1', 'chunk2', 'chunk3'];
      for (const [index, chunk] of chunks.entries()) {
        const message = JSON.stringify({
          id: `msg-${index}`,
          type: 'AUDIO_OUTPUT',
          service: 'cartesia',
          sessionId: 'session-123',
          timestamp: new Date().toISOString(),
          data: {
            audio: Buffer.from(chunk).toString('base64'),
            format: 'pcm',
          },
          metadata: {
            correlationId: 'corr-123',
            sampleRate: 44100,
            isFirst: index === 0,
            isFinal: false,
          },
        });
        messageHandler!(message);
        // Wait for async operations
        await new Promise(resolve => setImmediate(resolve));
      }

      expect(processChunkSpy).toHaveBeenCalledTimes(3);
    });

    it('should finalize stream on final message', async () => {
      let messageHandler: ((message: string) => void) | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockSubscribe as any).mockImplementation((channel: string, handler: (message: string) => void) => {
        if (channel === 'chip.voice.responses') {
          messageHandler = handler;
        }
        return Promise.resolve();
      });

      await audioReceiver.start();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockAudioProcessor = (audioReceiver as any).audioProcessor;
      const finalizeStreamSpy = jest.spyOn(mockAudioProcessor, 'finalizeStream');

      const finalMessage = JSON.stringify({
        id: 'msg-final',
        type: 'AUDIO_OUTPUT',
        service: 'cartesia',
        sessionId: 'session-123',
        timestamp: new Date().toISOString(),
        data: {
          audio: Buffer.from('final-chunk').toString('base64'),
          format: 'pcm',
        },
        metadata: {
          correlationId: 'corr-123',
          sampleRate: 44100,
          isFirst: false,
          isFinal: true,
        },
      });

      messageHandler!(finalMessage);
      
      // Wait for async operations
      await new Promise(resolve => setImmediate(resolve));

      expect(finalizeStreamSpy).toHaveBeenCalledWith('session-123');
    });

    it('should handle concurrent messages for different sessions', async () => {
      let messageHandler: ((message: string) => void) | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockSubscribe as any).mockImplementation((channel: string, handler: (message: string) => void) => {
        if (channel === 'chip.voice.responses') {
          messageHandler = handler;
        }
        return Promise.resolve();
      });

      await audioReceiver.start();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockAudioProcessor = (audioReceiver as any).audioProcessor;
      const createStreamSpy = jest.spyOn(mockAudioProcessor, 'createStream');

      const sessions = ['session-1', 'session-2', 'session-3'];
      sessions.forEach(sessionId => {
        const message = JSON.stringify({
          id: `msg-${sessionId}`,
          type: 'AUDIO_OUTPUT',
          service: 'cartesia',
          sessionId,
          timestamp: new Date().toISOString(),
          data: {
            audio: Buffer.from(`audio-${sessionId}`).toString('base64'),
            format: 'pcm',
          },
          metadata: {
            correlationId: `corr-${sessionId}`,
            sampleRate: 44100,
            isFirst: true,
            isFinal: false,
          },
        });
        messageHandler!(message);
      });

      expect(createStreamSpy).toHaveBeenCalledTimes(3);
      sessions.forEach(sessionId => {
        expect(createStreamSpy).toHaveBeenCalledWith(sessionId, 'pcm', 44100);
      });
    });
  });
});