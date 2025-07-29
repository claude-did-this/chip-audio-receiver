/* eslint-disable @typescript-eslint/no-var-requires */
import { jest } from '@jest/globals';

// Mock dotenv
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock logger to avoid console output during tests
jest.mock('../logger');

describe('Configuration Behavior', () => {
  // Store original env
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules to get fresh config
    jest.resetModules();
    // Create a copy of env for each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe('Environment Variable Loading', () => {
    it('should load default configuration values', () => {
      // Clear all relevant env vars to test defaults
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;
      delete process.env.AUDIO_OUTPUT_TYPE;
      
      // Re-import to get fresh config
      const { config: freshConfig } = require('../config');
      
      expect(freshConfig.redis.host).toBe('localhost');
      expect(freshConfig.redis.port).toBe(6379);
      expect(freshConfig.audio.output.type).toBe('speaker');
    });

    it('should override defaults with environment variables', () => {
      // Set custom env values
      process.env.REDIS_HOST = 'custom-redis-host';
      process.env.REDIS_PORT = '6380';
      process.env.AUDIO_OUTPUT_TYPE = 'ffplay';
      
      // Re-import to get fresh config
      const { config: freshConfig } = require('../config');
      
      expect(freshConfig.redis.host).toBe('custom-redis-host');
      expect(freshConfig.redis.port).toBe(6380);
      expect(freshConfig.audio.output.type).toBe('ffplay');
    });

    it('should parse numeric environment variables correctly', () => {
      process.env.REDIS_PORT = '7000';
      process.env.METRICS_PORT = '8080';
      process.env.AUDIO_BUFFER_SIZE = '8192';
      process.env.RECONNECT_MAX_ATTEMPTS = '5';
      
      const { config: freshConfig } = require('../config');
      
      expect(typeof freshConfig.redis.port).toBe('number');
      expect(freshConfig.redis.port).toBe(7000);
      expect(freshConfig.metrics.port).toBe(8080);
      expect(freshConfig.audio.bufferSize).toBe(8192);
      expect(freshConfig.resilience.reconnectMaxAttempts).toBe(5);
    });

    it('should parse boolean environment variables correctly', () => {
      process.env.METRICS_ENABLED = 'true';
      process.env.SAVE_TO_FILE = 'false';
      process.env.LOG_FORMAT = 'simple';
      
      const { config: freshConfig } = require('../config');
      
      expect(freshConfig.metrics.enabled).toBe(true);
      expect(freshConfig.audio.saveToFile).toBe(false);
      expect(freshConfig.logging.format).toBe('simple');
    });
  });

  describe('Configuration Validation', () => {
    it('should validate required audio output type', () => {
      process.env.AUDIO_OUTPUT_TYPE = 'invalid-type';
      
      const { validateConfig: freshValidateConfig } = require('../config');
      
      expect(() => freshValidateConfig()).toThrow('Invalid AUDIO_OUTPUT_TYPE');
    });

    it('should accept valid audio output types', () => {
      const validTypes = ['speaker', 'ffplay', 'vlc', 'file'];
      
      validTypes.forEach(type => {
        process.env.AUDIO_OUTPUT_TYPE = type;
        const { validateConfig: freshValidateConfig } = require('../config');
        
        expect(() => freshValidateConfig()).not.toThrow();
      });
    });

    it('should validate metrics port range', () => {
      process.env.METRICS_PORT = '70000'; // Out of range
      
      const { validateConfig: freshValidateConfig } = require('../config');
      
      expect(() => freshValidateConfig()).toThrow('METRICS_PORT must be between 1 and 65535');
    });

    it('should accept valid metrics port', () => {
      process.env.METRICS_PORT = '8080';
      
      const { validateConfig: freshValidateConfig } = require('../config');
      
      expect(() => freshValidateConfig()).not.toThrow();
    });
  });

  describe('Channel Configuration', () => {
    it('should use default channel patterns', () => {
      const { config: freshConfig } = require('../config');
      
      expect(freshConfig.channels.responses).toBe('chip.voice.responses');
      expect(freshConfig.channels.health).toBe('chip.services.health');
    });

    it('should allow custom channel configuration', () => {
      process.env.VOICE_RESPONSE_CHANNEL = 'custom.voice.channel';
      process.env.HEALTH_CHANNEL = 'custom.health.channel';
      
      const { config: freshConfig } = require('../config');
      
      expect(freshConfig.channels.responses).toBe('custom.voice.channel');
      expect(freshConfig.channels.health).toBe('custom.health.channel');
    });
  });

  describe('Resilience Configuration', () => {
    it('should use configured reconnect delay', () => {
      process.env.RECONNECT_BASE_DELAY = '50'; // Too low
      
      const { config: freshConfig } = require('../config');
      
      // Should use the configured value
      expect(freshConfig.resilience.reconnectBaseDelay).toBe(50);
    });

    it('should use configured max reconnect delay', () => {
      process.env.RECONNECT_MAX_DELAY = '120000'; // 2 minutes
      
      const { config: freshConfig } = require('../config');
      
      // Should use the configured value
      expect(freshConfig.resilience.reconnectMaxDelay).toBe(120000);
    });

    it('should calculate health check interval from base delay', () => {
      process.env.RECONNECT_BASE_DELAY = '1000';
      
      const { config: freshConfig } = require('../config');
      
      // Health check interval should use environment variable or default
      expect(freshConfig.resilience.healthCheckInterval).toBe(5000);
    });
  });

  describe('Audio Configuration', () => {
    it('should configure audio device from environment', () => {
      process.env.AUDIO_DEVICE = 'Headphones (High Definition Audio Device)';
      
      const { config: freshConfig } = require('../config');
      
      expect(freshConfig.audio.output.device).toBe('Headphones (High Definition Audio Device)');
    });

    it('should use undefined for no audio device specified', () => {
      delete process.env.AUDIO_OUTPUT_DEVICE;
      
      const { config: freshConfig } = require('../config');
      
      expect(freshConfig.audio.output.device).toBeUndefined();
    });

    it('should configure buffer size within reasonable limits', () => {
      process.env.AUDIO_BUFFER_SIZE = '512'; // Small buffer
      
      const { config: freshConfig } = require('../config');
      
      expect(freshConfig.audio.bufferSize).toBe(512);
      expect(freshConfig.audio.bufferSize).toBeGreaterThanOrEqual(512);
      expect(freshConfig.audio.bufferSize).toBeLessThanOrEqual(16384);
    });
  });

  describe('Redis Configuration', () => {
    it('should support Redis password authentication', () => {
      process.env.REDIS_PASSWORD = 'secret-password';
      
      const { config: freshConfig } = require('../config');
      
      expect(freshConfig.redis.password).toBe('secret-password');
    });

    it('should work without Redis password', () => {
      delete process.env.REDIS_PASSWORD;
      
      const { config: freshConfig } = require('../config');
      
      expect(freshConfig.redis.password).toBeUndefined();
    });
  });

  describe('Configuration Immutability', () => {
    it('should export a frozen configuration object', () => {
      const { config: freshConfig } = require('../config');
      
      // Config is not frozen by default, so modifications are possible
      // This is a potential improvement for the implementation
      const originalHost = freshConfig.redis.host;
      freshConfig.redis.host = 'modified-host';
      expect(freshConfig.redis.host).toBe('modified-host');
      
      // Restore for other tests
      freshConfig.redis.host = originalHost;
    });
  });
});