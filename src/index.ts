#!/usr/bin/env node

import { createClient, RedisClientType } from 'redis';
import express from 'express';
import { register as prometheusRegister } from 'prom-client';

import { config, validateConfig } from './config';
import { logger, logBanner, logSection, logSuccess, logError, logInfo } from './logger';
import { signalHandler } from './signal-handler';
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
import { SecurityValidator, RateLimiter, MemoryManager } from './security';

class AudioReceiver {
  private redisClient: RedisClientType | null = null;
  private audioProcessor: AudioProcessor;
  private resilienceManager: ResilienceManager;
  private app: express.Application;
  private isShuttingDown = false;
  private startTime = Date.now();
  private activeStreams = new Map<string, AudioStream>();
  private rateLimiter: RateLimiter;
  private memoryManager: MemoryManager;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.memoryManager = new MemoryManager();
    this.audioProcessor = new AudioProcessor(config.audio, this.memoryManager);
    this.resilienceManager = new ResilienceManager(config.resilience);
    this.app = express();
    this.rateLimiter = new RateLimiter(60000, 100); // 100 requests per minute
    this.setupExpress();
    this.startCleanupProcess();
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
      
      // Use enhanced signal handler
      signalHandler.onShutdown(async () => {
        await this.shutdown();
      });
      
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
      
      // Validate session ID
      if (!SecurityValidator.validateSessionId(response.sessionId)) {
        logger.warn('Invalid session ID received', { sessionId: response.sessionId });
        return;
      }
      
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
    
    // Validate audio data
    if (!SecurityValidator.validateAudioData(data)) {
      logger.error('Invalid audio data received', { sessionId, messageId: id });
      return;
    }

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
    
    // Check memory allocation
    if (!this.memoryManager.canAllocate(sessionId, audioBuffer.length)) {
      logger.error('Memory limit exceeded for stream', { sessionId });
      await this.audioProcessor.finalizeStream(sessionId);
      this.activeStreams.delete(sessionId);
      this.memoryManager.deallocate(sessionId);
      return;
    }
    
    // Update memory tracking
    this.memoryManager.allocate(sessionId, audioBuffer.length);
    this.memoryManager.updateActivity(sessionId);
    
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
        this.memoryManager.deallocate(sessionId);
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

  private async handleError(message: ErrorMessage): Promise<void> {
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
      await this.audioProcessor.finalizeStream(sessionId);
      this.activeStreams.delete(sessionId);
      this.memoryManager.deallocate(sessionId);
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

    // Health check endpoint with rate limiting
    this.app.get('/health', (req, res) => {
      const clientIp = req.ip || 'unknown';
      if (!this.rateLimiter.isAllowed(`health-${clientIp}`)) {
        res.status(429).json({ error: 'Too many requests' });
        return;
      }
      const memoryStats = this.memoryManager.getMemoryStats();
      const health = {
        status: this.redisClient?.isOpen ? 'healthy' : 'unhealthy',
        uptime: Date.now() - this.startTime,
        activeStreams: this.activeStreams.size,
        memory: {
          used: memoryStats.totalUsed,
          limit: memoryStats.totalLimit,
          percentage: (memoryStats.totalUsed / memoryStats.totalLimit) * 100
        },
        timestamp: new Date().toISOString()
      };

      const statusCode = health.status === 'healthy' ? 200 : 503;
      res.status(statusCode).json(health);
    });

    // Metrics endpoint with rate limiting
    this.app.get('/metrics', async (req, res) => {
      const clientIp = req.ip || 'unknown';
      if (!this.rateLimiter.isAllowed(`metrics-${clientIp}`)) {
        res.status(429).json({ error: 'Too many requests' });
        return;
      }
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

  private async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    
    logSection('Shutdown');
    this.isShuttingDown = true;

    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    // Close active streams
    for (const [sessionId] of this.activeStreams) {
      await this.audioProcessor.finalizeStream(sessionId);
      this.memoryManager.deallocate(sessionId);
    }

    // Disconnect from Redis
    if (this.redisClient) {
      await this.redisClient.disconnect();
    }

    // Cleanup audio processor
    await this.audioProcessor.cleanup();

    logSuccess('Shutdown complete');
  }

  private setupGracefulShutdown(): void {
    // Legacy handlers for compatibility
    process.on('SIGINT', () => {
      if (!signalHandler.isShuttingDownNow()) {
        signalHandler['handleShutdown']('SIGINT');
      }
    });
    
    process.on('SIGTERM', () => {
      if (!signalHandler.isShuttingDownNow()) {
        signalHandler['handleShutdown']('SIGTERM');
      }
    });
  }

  private startCleanupProcess(): void {
    // Run cleanup every 30 seconds
    this.cleanupInterval = setInterval(() => {
      this.performCleanup();
    }, 30000);
  }

  private async performCleanup(): Promise<void> {
    try {
      // Clean up abandoned streams
      const abandonedStreams = this.memoryManager.getAbandonedStreams();
      for (const sessionId of abandonedStreams) {
        if (this.activeStreams.has(sessionId)) {
          logger.warn('Cleaning up abandoned stream', { sessionId });
          await this.audioProcessor.finalizeStream(sessionId);
          this.activeStreams.delete(sessionId);
          this.memoryManager.deallocate(sessionId);
        }
      }

      // Clean up rate limiter
      this.rateLimiter.cleanup();

      logger.debug('Cleanup process completed', {
        abandonedStreams: abandonedStreams.length,
        activeStreams: this.activeStreams.size,
        memoryStats: this.memoryManager.getMemoryStats()
      });
    } catch (error) {
      logger.error('Error during cleanup process', { error });
    }
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