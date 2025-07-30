import { createClient, RedisClientType } from 'redis';
import { EventEmitter } from 'events';
import {
  SessionStartMessage,
  SessionReadyMessage,
  SessionEndMessage,
  Config
} from './types';
import { logger } from './logger';
import { UDPAudioServer } from './udp-audio-server';
import { AudioSyncManager } from './audio-sync-manager';
import { SubtitleSyncManager } from './subtitle-sync-manager';

interface ActiveSession {
  sessionId: string;
  startTime: number;
  udpPort: number;
  clientEndpoint: string;
  expectedFormat: string;
  sampleRate: number;
  syncManager: AudioSyncManager;
  subtitleManager?: SubtitleSyncManager;
}

export class RedisControlPlane extends EventEmitter {
  private client: RedisClientType;
  private subscriber: RedisClientType;
  private sessions: Map<string, ActiveSession> = new Map();
  private isConnected: boolean = false;

  constructor(
    private config: Config,
    private udpServer: UDPAudioServer
  ) {
    super();
    this.client = createClient({
      url: `redis://${config.redis.host}:${config.redis.port}`,
      password: config.redis.password
    });
    this.subscriber = this.client.duplicate();
    
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('error', (err) => {
      logger.error('Redis client error', err);
      this.isConnected = false;
      this.emit('error', err);
    });

    this.subscriber.on('error', (err) => {
      logger.error('Redis subscriber error', err);
      this.isConnected = false;
      this.emit('error', err);
    });

    this.client.on('ready', () => {
      logger.info('Redis client connected');
      this.isConnected = true;
      this.emit('connected');
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
    await this.subscriber.connect();
    
    // Subscribe to control channels
    await this.subscriber.subscribe('chip.sessions.start', (message) => {
      this.handleSessionStart(JSON.parse(message));
    });
    
    await this.subscriber.subscribe('chip.sessions.end', (message) => {
      this.handleSessionEnd(JSON.parse(message));
    });
    
    await this.subscriber.subscribe('chip.sessions.control', (message) => {
      this.handleControlMessage(JSON.parse(message));
    });

    logger.info('Redis control plane initialized');
  }

  private async handleSessionStart(message: SessionStartMessage): Promise<void> {
    logger.info('Received session start', { 
      sessionId: message.sessionId,
      audioPort: message.audioStreamPort,
      clientEndpoint: message.clientEndpoint
    });

    try {
      // Create sync managers for this session
      const syncManager = new AudioSyncManager();
      syncManager.createSession(message.sessionId);
      const subtitleManager = this.config.subtitles?.enabled 
        ? new SubtitleSyncManager(this.config.subtitles.method)
        : undefined;

      // Store session information
      const session: ActiveSession = {
        sessionId: message.sessionId,
        startTime: Date.now(),
        udpPort: message.audioStreamPort,
        clientEndpoint: message.clientEndpoint,
        expectedFormat: message.expectedFormat,
        sampleRate: message.sampleRate,
        syncManager,
        subtitleManager
      };

      this.sessions.set(message.sessionId, session);

      // Initialize UDP server for this session
      const [host, port] = message.clientEndpoint.split(':');
      this.udpServer.expectSession(message.sessionId, host, parseInt(port));

      // Send ready confirmation
      const readyMessage: SessionReadyMessage = {
        type: 'SESSION_READY',
        sessionId: message.sessionId,
        receiverReady: true,
        udpEndpoint: `localhost:${this.config.udp?.port || 8001}`,
        bufferSize: this.config.jitterBuffer?.targetBufferMs || 100
      };

      await this.publishMessage('chip.sessions.ready', readyMessage);

      logger.info('Session initialized and ready', { sessionId: message.sessionId });
      this.emit('sessionStarted', session);

    } catch (error) {
      logger.error('Failed to initialize session', { 
        sessionId: message.sessionId, 
        error 
      });
      
      // Send error response
      await this.publishMessage('chip.sessions.error', {
        type: 'SESSION_ERROR',
        sessionId: message.sessionId,
        error: {
          code: 'INIT_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  }

  private async handleSessionEnd(message: SessionEndMessage): Promise<void> {
    logger.info('Received session end', { 
      sessionId: message.sessionId,
      reason: message.reason 
    });

    const session = this.sessions.get(message.sessionId);
    if (!session) {
      logger.warn('Received end for unknown session', { sessionId: message.sessionId });
      return;
    }

    try {
      // Get final statistics from UDP server
      const stats = this.udpServer.getSessionStatistics(message.sessionId);
      
      // Clean up session resources
      // UDP server will clean up internally when session ends
      session.syncManager.endSession(message.sessionId);
      session.subtitleManager?.endSession(message.sessionId);
      
      // Remove from active sessions
      this.sessions.delete(message.sessionId);

      // Send acknowledgment with statistics
      await this.publishMessage('chip.sessions.ended', {
        type: 'SESSION_ENDED',
        sessionId: message.sessionId,
        statistics: {
          ...stats,
          totalDuration: Date.now() - session.startTime
        }
      });

      logger.info('Session cleaned up', { 
        sessionId: message.sessionId,
        duration: Date.now() - session.startTime
      });
      
      this.emit('sessionEnded', message.sessionId);

    } catch (error) {
      logger.error('Error during session cleanup', { 
        sessionId: message.sessionId, 
        error 
      });
    }
  }

  private async handleControlMessage(message: any): Promise<void> {
    logger.debug('Received control message', { type: message.type });

    switch (message.type) {
      case 'ADJUST_TIMING':
        this.handleTimingAdjustment(message);
        break;
      
      case 'UPDATE_SUBTITLES':
        this.handleSubtitleUpdate(message);
        break;
      
      case 'NETWORK_CONDITIONS':
        this.handleNetworkConditions(message);
        break;
      
      case 'HEALTH_CHECK':
        await this.handleHealthCheck(message);
        break;
      
      default:
        logger.warn('Unknown control message type', { type: message.type });
    }
  }

  private handleTimingAdjustment(message: any): void {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;

    session.syncManager.adjustTiming(message.sessionId, {
      avgLatency: 20,
      jitterMs: 5,
      packetLoss: 0,
      bandwidth: 0
    });
    
    if (session.subtitleManager) {
      session.subtitleManager.adjustTiming(message.sessionId, message.clockOffset);
    }

    logger.info('Adjusted session timing', { 
      sessionId: message.sessionId,
      clockOffset: message.clockOffset
    });
  }

  private handleSubtitleUpdate(message: any): void {
    const session = this.sessions.get(message.sessionId);
    if (!session || !session.subtitleManager) return;

    if (message.subtitles && Array.isArray(message.subtitles)) {
      session.subtitleManager.initializeSession(
        message.sessionId,
        message.subtitles,
        Date.now(),
        0
      );
    }
  }

  private handleNetworkConditions(_message: any): void {
    // Network conditions are tracked internally by UDP server
  }

  private async handleHealthCheck(message: any): Promise<void> {
    const health = {
      type: 'HEALTH_RESPONSE',
      sessionId: message.sessionId,
      timestamp: Date.now(),
      activeSessions: this.sessions.size,
      components: {
        redis: this.isConnected ? 'healthy' : 'unhealthy',
        udpServer: this.udpServer.getActiveSessions().length > 0 || this.sessions.size === 0 ? 'healthy' : 'unhealthy',
        memory: process.memoryUsage()
      }
    };

    await this.publishMessage('chip.sessions.health', health);
  }

  private async publishMessage(channel: string, message: any): Promise<void> {
    try {
      await this.client.publish(channel, JSON.stringify(message));
    } catch (error) {
      logger.error('Failed to publish message', { channel, error });
      throw error;
    }
  }

  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  getSessionInfo(sessionId: string): ActiveSession | undefined {
    return this.sessions.get(sessionId);
  }

  async publishSessionStats(): Promise<void> {
    for (const [sessionId, session] of this.sessions) {
      const stats = this.udpServer.getSessionStatistics(sessionId);
      const subtitleStats = session.subtitleManager?.getSessionStats(sessionId);
      
      await this.publishMessage('chip.sessions.stats', {
        type: 'SESSION_STATS',
        sessionId,
        timestamp: Date.now(),
        duration: Date.now() - session.startTime,
        udpStats: stats,
        subtitleStats
      });
    }
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down Redis control plane');

    // End all active sessions
    for (const sessionId of this.sessions.keys()) {
      await this.handleSessionEnd({
        type: 'SESSION_END',
        sessionId,
        reason: 'CLIENT_DISCONNECT'
      });
    }

    // Disconnect Redis clients
    await this.subscriber.unsubscribe();
    await this.subscriber.disconnect();
    await this.client.disconnect();

    this.removeAllListeners();
    logger.info('Redis control plane shutdown complete');
  }
}