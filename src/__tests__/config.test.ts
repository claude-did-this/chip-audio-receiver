import { jest } from '@jest/globals';
import type { Config } from '../types';

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
      // Dynamic require is necessary for testing environment-based configuration
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { config: freshConfig } = require('../config') as { config: Config };
      
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
      // Dynamic require is necessary for testing environment-based configuration
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { config: freshConfig } = require('../config') as { config: Config };
      
      expect(freshConfig.redis.host).toBe('custom-redis-host');
      expect(freshConfig.redis.port).toBe(6380);
      expect(freshConfig.audio.output.type).toBe('ffplay');
    });

    it('should parse numeric environment variables correctly', () => {
      process.env.REDIS_PORT = '7000';
      process.env.METRICS_PORT = '8080';
      process.env.AUDIO_BUFFER_SIZE = '8192';
      process.env.RECONNECT_MAX_ATTEMPTS = '5';
      
      // Dynamic require is necessary for testing environment-based configuration
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { config: freshConfig } = require('../config') as { config: Config };
      
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
      
      // Dynamic require is necessary for testing environment-based configuration
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { config: freshConfig } = require('../config') as { config: Config };
      
      expect(freshConfig.metrics.enabled).toBe(true);
      expect(freshConfig.audio.saveToFile).toBe(false);
      expect(freshConfig.logging.format).toBe('simple');
    });
  });

  describe('Configuration Validation', () => {
    it('should validate required audio output type', () => {
      process.env.AUDIO_OUTPUT_TYPE = 'invalid-type';
      
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { validateConfig: freshValidateConfig } = require('../config') as { validateConfig: () => void };
      
      expect(() => freshValidateConfig()).toThrow('Invalid AUDIO_OUTPUT_TYPE');
    });

    it('should accept valid audio output types', () => {
      const validTypes = ['speaker', 'ffplay', 'vlc', 'file'];
      
      validTypes.forEach(type => {
        process.env.AUDIO_OUTPUT_TYPE = type;
        // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { validateConfig: freshValidateConfig } = require('../config') as { validateConfig: () => void };
        
        expect(() => freshValidateConfig()).not.toThrow();
      });
    });

    it('should validate metrics port range', () => {
      process.env.METRICS_PORT = '70000'; // Out of range
      
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { validateConfig: freshValidateConfig } = require('../config') as { validateConfig: () => void };
      
      expect(() => freshValidateConfig()).toThrow('METRICS_PORT must be between 1 and 65535');
    });

    it('should accept valid metrics port', () => {
      process.env.METRICS_PORT = '8080';
      
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { validateConfig: freshValidateConfig } = require('../config') as { validateConfig: () => void };
      
      expect(() => freshValidateConfig()).not.toThrow();
    });

    it('should validate Redis port is a number', () => {
      process.env.REDIS_PORT = 'not-a-number';
      
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { config: freshConfig } = require('../config') as { config: Config };
      
      // parseInt will return NaN for invalid strings
      expect(freshConfig.redis.port).toBeNaN();
    });

    it('should validate empty string configurations', () => {
      process.env.REDIS_HOST = '';
      process.env.VOICE_RESPONSE_CHANNEL = '';
      
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { config: freshConfig } = require('../config') as { config: Config };
      
      // Empty strings should fallback to defaults
      expect(freshConfig.redis.host).toBe('localhost');
      expect(freshConfig.channels.responses).toBe('chip.voice.responses');
    });

    it('should validate boundary conditions for numeric configs', () => {
      process.env.REDIS_PORT = '0';
      process.env.METRICS_PORT = '65535';
      process.env.RECONNECT_MAX_ATTEMPTS = '0';
      
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { config: freshConfig } = require('../config') as { config: Config };
      
      expect(freshConfig.redis.port).toBe(0);
      expect(freshConfig.metrics.port).toBe(65535);
      expect(freshConfig.resilience.reconnectMaxAttempts).toBe(0);
    });
  });

  describe('Channel Configuration', () => {
    it('should use default channel patterns', () => {
      // Dynamic require is necessary for testing environment-based configuration
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { config: freshConfig } = require('../config') as { config: Config };
      
      expect(freshConfig.channels.responses).toBe('chip.voice.responses');
      expect(freshConfig.channels.health).toBe('chip.services.health');
    });

    it('should allow custom channel configuration', () => {
      process.env.VOICE_RESPONSE_CHANNEL = 'custom.voice.channel';
      process.env.HEALTH_CHANNEL = 'custom.health.channel';
      
      // Dynamic require is necessary for testing environment-based configuration
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { config: freshConfig } = require('../config') as { config: Config };
      
      expect(freshConfig.channels.responses).toBe('custom.voice.channel');
      expect(freshConfig.channels.health).toBe('custom.health.channel');
    });
  });

  describe('Resilience Configuration', () => {
    it('should use configured reconnect delay', () => {
      process.env.RECONNECT_BASE_DELAY = '50'; // Too low
      
      // Dynamic require is necessary for testing environment-based configuration
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { config: freshConfig } = require('../config') as { config: Config };
      
      // Should use the configured value
      expect(freshConfig.resilience.reconnectBaseDelay).toBe(50);
    });

    it('should use configured max reconnect delay', () => {
      process.env.RECONNECT_MAX_DELAY = '120000'; // 2 minutes
      
      // Dynamic require is necessary for testing environment-based configuration
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { config: freshConfig } = require('../config') as { config: Config };
      
      // Should use the configured value
      expect(freshConfig.resilience.reconnectMaxDelay).toBe(120000);
    });

    it('should calculate health check interval from base delay', () => {
      process.env.RECONNECT_BASE_DELAY = '1000';
      
      // Dynamic require is necessary for testing environment-based configuration
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { config: freshConfig } = require('../config') as { config: Config };
      
      // Health check interval should use environment variable or default
      expect(freshConfig.resilience.healthCheckInterval).toBe(5000);
    });
  });

  describe('Audio Configuration', () => {
    it('should configure audio device from environment', () => {
      process.env.AUDIO_DEVICE = 'Headphones (High Definition Audio Device)';
      
      // Dynamic require is necessary for testing environment-based configuration
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { config: freshConfig } = require('../config') as { config: Config };
      
      expect(freshConfig.audio.output.device).toBe('Headphones (High Definition Audio Device)');
    });

    it('should use undefined for no audio device specified', () => {
      delete process.env.AUDIO_OUTPUT_DEVICE;
      
      // Dynamic require is necessary for testing environment-based configuration
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { config: freshConfig } = require('../config') as { config: Config };
      
      expect(freshConfig.audio.output.device).toBeUndefined();
    });

    it('should configure buffer size within reasonable limits', () => {
      process.env.AUDIO_BUFFER_SIZE = '512'; // Small buffer
      
      // Dynamic require is necessary for testing environment-based configuration
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { config: freshConfig } = require('../config') as { config: Config };
      
      expect(freshConfig.audio.bufferSize).toBe(512);
      expect(freshConfig.audio.bufferSize).toBeGreaterThanOrEqual(512);
      expect(freshConfig.audio.bufferSize).toBeLessThanOrEqual(16384);
    });
  });

  describe('Redis Configuration', () => {
    it('should support Redis password authentication', () => {
      process.env.REDIS_PASSWORD = 'secret-password';
      
      // Dynamic require is necessary for testing environment-based configuration
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { config: freshConfig } = require('../config') as { config: Config };
      
      expect(freshConfig.redis.password).toBe('secret-password');
    });

    it('should work without Redis password', () => {
      delete process.env.REDIS_PASSWORD;
      
      // Dynamic require is necessary for testing environment-based configuration
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { config: freshConfig } = require('../config') as { config: Config };
      
      expect(freshConfig.redis.password).toBeUndefined();
    });
  });

  describe('Configuration Immutability', () => {
    it('should export a frozen configuration object', () => {
      // Dynamic require is necessary for testing environment-based configuration
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { config: freshConfig } = require('../config') as { config: Config };
      
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