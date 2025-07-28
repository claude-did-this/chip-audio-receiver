import { Config } from './types';
import * as dotenv from 'dotenv';

dotenv.config();

export const config: Config = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD
  },
  channels: {
    responses: process.env.VOICE_RESPONSE_CHANNEL || 'chip.voice.responses',
    health: process.env.HEALTH_CHANNEL || 'chip.services.health'
  },
  audio: {
    output: {
      type: (process.env.AUDIO_OUTPUT_TYPE as 'speaker' | 'ffplay' | 'vlc' | 'file') || 'speaker',
      device: process.env.AUDIO_DEVICE
    },
    bufferSize: parseInt(process.env.AUDIO_BUFFER_SIZE || '4096', 10),
    saveToFile: process.env.SAVE_TO_FILE === 'true'
  },
  metrics: {
    port: parseInt(process.env.METRICS_PORT || '9090', 10),
    enabled: process.env.METRICS_ENABLED !== 'false'
  },
  resilience: {
    reconnectMaxAttempts: parseInt(process.env.RECONNECT_MAX_ATTEMPTS || '10', 10),
    reconnectBaseDelay: parseInt(process.env.RECONNECT_BASE_DELAY || '1000', 10),
    reconnectMaxDelay: parseInt(process.env.RECONNECT_MAX_DELAY || '30000', 10),
    healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '5000', 10)
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: (process.env.LOG_FORMAT as 'json' | 'simple') || 'json'
  }
};

export function validateConfig(): void {
  if (!config.redis.host) {
    throw new Error('REDIS_HOST is required');
  }

  const validAudioTypes = ['speaker', 'ffplay', 'vlc', 'file'];
  if (!validAudioTypes.includes(config.audio.output.type)) {
    throw new Error(`Invalid AUDIO_OUTPUT_TYPE. Must be one of: ${validAudioTypes.join(', ')}`);
  }

  if (config.metrics.port < 1 || config.metrics.port > 65535) {
    throw new Error('METRICS_PORT must be between 1 and 65535');
  }
}