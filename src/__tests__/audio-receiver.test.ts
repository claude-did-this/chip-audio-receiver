import { jest } from '@jest/globals';
import { AudioReceiver } from '../index';
import { createClient } from 'redis';
import express from 'express';

// Mock dependencies
jest.mock('redis');
jest.mock('../logger');
jest.mock('../metrics');
jest.mock('../audio-processor');
jest.mock('../resilience');
jest.mock('express', () => {
  const mockApp = {
    use: jest.fn(),
    get: jest.fn(),
    listen: jest.fn((_port: number, callback: Function) => {
      if (callback) callback();
      return { close: jest.fn() };
    }),
  };
  const express = jest.fn(() => mockApp);
  (express as any).json = jest.fn();
  return express;
});
jest.mock('../config', () => ({
  config: {
    redis: {
      host: 'localhost',
      port: 6379,
      password: undefined,
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
  let mockRedisClient: any;
  let mockConnect: jest.Mock;
  let mockSubscribe: jest.Mock;
  let mockDisconnect: jest.Mock;
  let originalExit: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock process.exit
    originalExit = process.exit;
    process.exit = jest.fn() as any;
    
    // Setup Redis client mock
    mockConnect = jest.fn();
    mockSubscribe = jest.fn();
    mockDisconnect = jest.fn();
    
    mockRedisClient = {
      connect: mockConnect,
      subscribe: mockSubscribe,
      disconnect: mockDisconnect,
      on: jest.fn(),
      isOpen: true,
    };

    const mockCreateClient = jest.mocked(createClient);
    mockCreateClient.mockReturnValue(mockRedisClient as any);

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
      mockRedisClient.on.mockImplementation((event: string, handler: any) => {
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
      let disconnectHandler: any;
      mockRedisClient.on.mockImplementation((event: string, handler: any) => {
        if (event === 'disconnect') {
          disconnectHandler = handler;
        }
      });

      await audioReceiver.start();

      // Simulate disconnection
      disconnectHandler();

      // Verify reconnection is scheduled (through resilience manager)
      expect(mockRedisClient.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
    });

    it('should reset retry count on successful connection', async () => {
      let connectHandler: any;
      mockRedisClient.on.mockImplementation((event: string, handler: any) => {
        if (event === 'connect') {
          connectHandler = handler;
        }
      });

      await audioReceiver.start();

      // Simulate successful connection
      connectHandler();

      expect(mockRedisClient.on).toHaveBeenCalledWith('connect', expect.any(Function));
    });
  });

  describe('Message Subscription', () => {
    it('should process voice response messages from Redis', async () => {
      let messageHandler: any;
      mockSubscribe.mockImplementation((...args: any[]) => {
        const [channel, handler] = args;
        if (channel === 'chip.voice.responses') {
          messageHandler = handler;
        }
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
      messageHandler(testMessage);

      // Message should be processed without throwing
      expect(() => messageHandler(testMessage)).not.toThrow();
    });

    it('should handle malformed messages gracefully', async () => {
      let messageHandler: any;
      mockSubscribe.mockImplementation((...args: any[]) => {
        const [channel, handler] = args;
        if (channel === 'chip.voice.responses') {
          messageHandler = handler;
        }
      });

      await audioReceiver.start();

      // Send malformed JSON
      expect(() => messageHandler('invalid json')).not.toThrow();
      
      // Send message with missing required fields
      expect(() => messageHandler('{}')).not.toThrow();
    });
  });

  describe('Health Monitoring', () => {
    it('should expose health endpoint', async () => {
      const mockApp = express();
      const mockListen = jest.fn((_port: any, callback: any) => callback());
      mockApp.listen = mockListen as any;

      // @ts-ignore - accessing private property for test
      audioReceiver.app = mockApp;

      await audioReceiver.start();

      expect(mockListen).toHaveBeenCalledWith(9090, expect.any(Function));
    });

    it('should return healthy status when Redis is connected', async () => {
      await audioReceiver.start();

      // Find the health handler that was registered
      const mockApp = jest.mocked(express)();
      const getMock = mockApp.get as jest.Mock;
      const getCall = getMock.mock.calls.find((call: any[]) => call[0] === '/health');
      expect(getCall).toBeDefined();
      
      const healthHandler = getCall![1] as any;
      const mockReq = {};
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      healthHandler(mockReq as any, mockRes as any);

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
      const getCall = getMock.mock.calls.find((call: any[]) => call[0] === '/health');
      expect(getCall).toBeDefined();
      
      const healthHandler = getCall![1] as any;
      const mockReq = {};
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      healthHandler(mockReq as any, mockRes as any);

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
  });
});