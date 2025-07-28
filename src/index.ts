#!/usr/bin/env node

import { createClient, RedisClientType } from 'redis';
import express from 'express';
import { register as prometheusRegister } from 'prom-client';

import { config, validateConfig } from './config';
import { logger, logBanner, logSection, logSuccess, logError, logInfo } from './logger';
import { 
  VoiceResponseMessage, 
  MessageType,
  ServiceHealth,
  StatusValue,
  AudioOutputMessage,
  StatusMessage,
  ErrorMessage,
  AudioStream
} from './types';
import { setupMetrics } from './metrics';
import { AudioProcessor } from './audio-processor';
import { ResilienceManager } from './resilience';

class AudioReceiver {
  private redisClient: RedisClientType | null = null;
  private audioProcessor: AudioProcessor;
  private resilienceManager: ResilienceManager;
  private app: express.Application;
  private isShuttingDown = false;
  private startTime = Date.now();
  private activeStreams = new Map<string, AudioStream>();

  constructor() {
    this.audioProcessor = new AudioProcessor(config.audio);
    this.resilienceManager = new ResilienceManager(config.resilience);
    this.app = express();
    this.setupExpress();
  }

  async start(): Promise<void> {
    try {
      logBanner('CHIP Audio Receiver v2.0.0');
      
      validateConfig();
      
      logSection('Configuration');
      logInfo('[CONFIG]', 'Settings loaded', {
        redis: `${config.redis.host}:${config.redis.port}`,
        channels: config.channels.responses,
        audioOutput: config.audio.output.type,
        metricsPort: config.metrics.port
      });

      logSection('Connections');
      logInfo('[REDIS]', 'Connecting to Redis...');
      await this.connectRedis();
      
      logInfo('[CHANNEL]', 'Subscribing to channels...');
      await this.subscribeToChannels();
      
      if (config.metrics.enabled) {
        logInfo('[METRICS]', 'Starting metrics server...');
        this.startMetricsServer();
      }

      logInfo('[SYSTEM]', 'Setting up graceful shutdown handlers...');
      this.setupGracefulShutdown();
      
      logSection('Ready');
      logSuccess('Audio Receiver started successfully!');
      logInfo('[HEALTH]', `http://localhost:${config.metrics.port}/health`);
      logInfo('[METRICS]', `http://localhost:${config.metrics.port}/metrics`);
      console.log('\n');
    } catch (error) {
      logger.error('Failed to start audio receiver', { error });
      process.exit(1);
    }
  }

  private async connectRedis(): Promise<void> {
    this.redisClient = createClient({
      socket: {
        host: config.redis.host,
        port: config.redis.port
      },
      password: config.redis.password
    });

    this.redisClient.on('error', (err) => {
      logError('Redis connection error', err);
      this.resilienceManager.handleError(err);
    });

    this.redisClient.on('connect', () => {
      logSuccess('Connected to Redis', {
        host: config.redis.host,
        port: config.redis.port
      });
      this.resilienceManager.resetRetryCount();
    });

    this.redisClient.on('disconnect', () => {
      logger.warn('[REDIS] Disconnected from Redis');
      if (!this.isShuttingDown) {
        logInfo('[REDIS]', 'Attempting to reconnect...');
        this.resilienceManager.scheduleReconnect(() => this.connectRedis());
      }
    });

    await this.redisClient.connect();
  }

  private async subscribeToChannels(): Promise<void> {
    if (!this.redisClient) return;

    // Subscribe to voice responses
    await this.redisClient.subscribe(config.channels.responses, (message) => {
      this.handleVoiceResponse(message);
    });

    // Subscribe to health messages
    await this.redisClient.subscribe(config.channels.health, (message) => {
      this.handleHealthMessage(message);
    });

    logSuccess('Subscribed to Redis channels', {
      voiceResponses: config.channels.responses,
      healthMonitoring: config.channels.health
    });
  }

  private handleVoiceResponse(message: string): void {
    try {
      const response: VoiceResponseMessage = JSON.parse(message);
      
      logger.debug('Received voice response', {
        id: response.id,
        type: response.type,
        service: response.service,
        sessionId: response.sessionId,
        timestamp: response.timestamp
      });

      switch (response.type) {
        case MessageType.AUDIO_OUTPUT:
          this.handleAudioOutput(response as AudioOutputMessage);
          break;
        case MessageType.STATUS:
          this.handleStatus(response as StatusMessage);
          break;
        case MessageType.ERROR:
          this.handleError(response as ErrorMessage);
          break;
        default:
          logger.warn('Unknown message type', { type: (response as VoiceResponseMessage).type });
      }
    } catch (error) {
      logger.error('Failed to parse voice response', { error, message });
    }
  }

  private async handleAudioOutput(message: AudioOutputMessage): Promise<void> {
    const { id, sessionId, service, data, metadata } = message;

    // Initialize stream if first chunk
    if (metadata.isFirst) {
      logInfo('[AUDIO]', 'New stream started', {
        id,
        sessionId,
        service,
        format: data.format,
        sampleRate: `${metadata.sampleRate}Hz`,
        correlationId: metadata.correlationId,
        output: config.audio.output.type
      });

      const stream = await this.audioProcessor.createStream(sessionId, data.format, metadata.sampleRate);
      this.activeStreams.set(sessionId, stream);
    }

    // Process audio chunk
    const audioBuffer = Buffer.from(data.audio, 'base64');
    
    try {
      await this.audioProcessor.processChunk(sessionId, audioBuffer, data.format);
      
      // Handle subtitles if present
      if (metadata.subtitles) {
        logInfo('[SUBTITLE]', metadata.subtitles.text, {
          sessionId,
          timing: `${metadata.subtitles.startTime}-${metadata.subtitles.endTime}ms`
        });
      }

      // Finalize stream if last chunk
      if (metadata.isFinal) {
        logSuccess('Stream completed', { 
          id,
          sessionId,
          duration: `${(Date.now() - (this.activeStreams.get(sessionId)?.startTime || Date.now())) / 1000}s`
        });
        await this.audioProcessor.finalizeStream(sessionId);
        this.activeStreams.delete(sessionId);
      }
    } catch (error) {
      logger.error('Failed to process audio chunk', { error, sessionId, messageId: id });
      this.resilienceManager.handleError(error);
    }
  }

  private handleStatus(message: StatusMessage): void {
    const { id, sessionId, service, timestamp, data } = message;
    
    logger.info('Status update', {
      id,
      sessionId,
      service,
      timestamp,
      status: data.status,
      message: data.message,
      progress: data.progress
    });

    // Update metrics based on status
    if (data.status === StatusValue.COMPLETED) {
      // Update completion metrics
    }
  }

  private handleError(message: ErrorMessage): void {
    const { id, sessionId, service, timestamp, error } = message;
    
    logger.error('Voice service error', {
      id,
      sessionId,
      service,
      timestamp,
      code: error.code,
      message: error.message,
      details: error.details
    });

    // Clean up any active streams for this session
    if (this.activeStreams.has(sessionId)) {
      this.activeStreams.delete(sessionId);
      logger.info('Cleaned up active stream due to error', { sessionId });
    }
  }

  private handleHealthMessage(message: string): void {
    try {
      const health: ServiceHealth = JSON.parse(message);
      
      if (health.service === 'voice') {
        logger.debug('Voice service health', health);
        // Update health metrics
      }
    } catch (error) {
      logger.error('Failed to parse health message', { error });
    }
  }

  private setupExpress(): void {
    this.app.use(express.json());

    // Health check endpoint
    this.app.get('/health', (_req, res) => {
      const health = {
        status: this.redisClient?.isOpen ? 'healthy' : 'unhealthy',
        uptime: Date.now() - this.startTime,
        activeStreams: this.activeStreams.size,
        timestamp: new Date().toISOString()
      };

      const statusCode = health.status === 'healthy' ? 200 : 503;
      res.status(statusCode).json(health);
    });

    // Metrics endpoint
    this.app.get('/metrics', async (_req, res) => {
      try {
        const metrics = await prometheusRegister.metrics();
        res.set('Content-Type', prometheusRegister.contentType);
        res.send(metrics);
      } catch (error) {
        res.status(500).send('Error collecting metrics');
      }
    });
  }

  private startMetricsServer(): void {
    this.app.listen(config.metrics.port, () => {
      logSuccess(`Metrics server started on port ${config.metrics.port}`);
    });
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string): Promise<void> => {
      logSection('Shutdown');
      logInfo('[SIGNAL]', `Received ${signal}, shutting down gracefully...`);
      this.isShuttingDown = true;

      // Close active streams
      for (const [sessionId] of this.activeStreams) {
        await this.audioProcessor.finalizeStream(sessionId);
      }

      // Disconnect from Redis
      if (this.redisClient) {
        await this.redisClient.disconnect();
      }

      // Cleanup audio processor
      await this.audioProcessor.cleanup();

      logSuccess('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }
}

// Main entry point
if (require.main === module) {
  console.clear();
  logInfo('[STARTUP]', 'Initializing CHIP Audio Receiver...');
  logInfo('[NODE]', `Version ${process.version}`);
  logInfo('[ENV]', process.env.NODE_ENV || 'development');
  
  setupMetrics();
  
  const receiver = new AudioReceiver();
  receiver.start().catch((error) => {
    logError('Fatal error during startup', error);
    process.exit(1);
  });
}

export { AudioReceiver };