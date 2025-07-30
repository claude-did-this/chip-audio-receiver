import { EventEmitter } from 'events';
import { RedisControlPlane } from './redis-control-plane';
import { UDPAudioServer } from './udp-audio-server';
import { AudioSyncManager } from './audio-sync-manager';
import { JitterBuffer } from './jitter-buffer';
import { SubtitleSyncManager } from './subtitle-sync-manager';
import { SubtitleDisplayManager } from './subtitle-display-adapters';
import { Config, NetworkConditions } from './types';
import { logger } from './logger';

interface SessionComponents {
  sessionId: string;
  syncManager: AudioSyncManager;
  jitterBuffer: JitterBuffer;
  subtitleManager?: SubtitleSyncManager;
  startTime: number;
  negotiationTime: number;
  isActive: boolean;
}

export class ConnectionNegotiator extends EventEmitter {
  private controlPlane: RedisControlPlane;
  private udpServer: UDPAudioServer;
  private displayManager: SubtitleDisplayManager;
  private sessions: Map<string, SessionComponents> = new Map();
  private networkProbe: NodeJS.Timeout | null = null;

  constructor(private config: Config) {
    super();
    
    // Initialize UDP server
    this.udpServer = new UDPAudioServer(config.udp?.port || 8001);
    
    // Initialize control plane
    this.controlPlane = new RedisControlPlane(config, this.udpServer);
    
    // Initialize subtitle display manager if enabled
    this.displayManager = new SubtitleDisplayManager({
      obsWebsocket: {
        enabled: config.subtitles?.method === 'obs-websocket',
        host: config.subtitles?.obsWebSocketHost,
        port: config.subtitles?.obsWebSocketPort,
        password: config.subtitles?.obsWebSocketPassword
      },
      overlay: {
        enabled: config.subtitles?.method === 'overlay'
      },
      toast: {
        enabled: config.subtitles?.method === 'toast'
      }
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Control plane events
    this.controlPlane.on('sessionStarted', (session) => {
      this.handleSessionStart(session);
    });

    this.controlPlane.on('sessionEnded', (sessionId) => {
      this.handleSessionEnd(sessionId);
    });

    // UDP server events
    this.udpServer.on('packetReceived', (packet) => {
      this.handleAudioPacket(packet);
    });

    this.udpServer.on('packetLoss', (data) => {
      this.handlePacketLoss(data);
    });

    // Network monitoring
    this.startNetworkMonitoring();
  }

  private async handleSessionStart(sessionInfo: any): Promise<void> {
    const { sessionId, syncManager, subtitleManager } = sessionInfo;
    
    logger.info('Negotiating session connection', { sessionId });

    try {
      // Create jitter buffer for this session
      const jitterBuffer = new JitterBuffer(this.config.jitterBuffer || {
        targetBufferMs: 100,
        minBufferMs: 50,
        maxBufferMs: 300,
        adaptiveMode: true
      });
      
      // Initialize the jitter buffer session
      jitterBuffer.initializeSession(sessionId);

      // Set up subtitle display if enabled
      if (subtitleManager && this.config.subtitles?.enabled) {
        await this.displayManager.setDisplayMethod(this.config.subtitles.method);
        
        // Connect subtitle events to display manager
        subtitleManager.on('subtitle:display', (event: any) => {
          this.displayManager.displaySubtitle(event);
        });

        subtitleManager.on('subtitle:hide', (event: any) => {
          this.displayManager.hideSubtitle(event);
        });
      }

      // Store session components
      const components: SessionComponents = {
        sessionId,
        syncManager,
        jitterBuffer,
        subtitleManager,
        startTime: Date.now(),
        negotiationTime: Date.now(),
        isActive: true
      };

      this.sessions.set(sessionId, components);

      // Set up packet flow: UDP -> Jitter Buffer -> Sync Manager -> Audio Output
      jitterBuffer.on('playChunk', (sessionId: string, chunk: any) => {
        this.processBufferedPacket(sessionId, chunk);
      });

      logger.info('Session negotiation complete', { 
        sessionId,
        negotiationTime: Date.now() - components.negotiationTime
      });

      this.emit('sessionReady', sessionId);

    } catch (error) {
      logger.error('Session negotiation failed', { sessionId, error });
      this.emit('sessionError', { sessionId, error });
    }
  }

  private handleAudioPacket(packet: any): void {
    const session = this.sessions.get(packet.sessionId);
    if (!session || !session.isActive) {
      logger.warn('Received packet for unknown/inactive session', { 
        sessionId: packet.sessionId 
      });
      return;
    }

    // Get network conditions from UDP server
    const networkConditions = this.udpServer.getNetworkConditions(packet.sessionId) || {
      avgLatency: 20,
      jitterMs: 5,
      packetLoss: 0,
      bandwidth: 0
    };
    
    // Add to jitter buffer
    session.jitterBuffer.addChunk(packet.sessionId, {
      sessionId: packet.sessionId,
      audio: packet.audioData,
      playbackTime: packet.playbackTime,
      duration: 20, // Default 20ms chunk duration
      sequenceNumber: packet.sequenceNumber
    }, networkConditions);

    // Update subtitle sync if present
    if (session.subtitleManager) {
      session.subtitleManager.onAudioPacket(packet);
    }
  }

  private processBufferedPacket(sessionId: string, packet: any): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Calculate final playback timing
    const syncTimestamps: any = {
      ttsGenerated: packet.timestamp,
      packetSent: packet.timestamp,
      packetReceived: Date.now(),
      scheduledPlayback: packet.playbackTime
    };
    const networkConditions: any = {
      avgLatency: 20,
      jitterMs: 5,
      packetLoss: 0,
      bandwidth: 0
    };
    const playbackTime = session.syncManager.calculatePlaybackTime(packet, syncTimestamps, networkConditions);
    
    // Schedule audio playback
    const delay = playbackTime - Date.now();
    if (delay > 0) {
      setTimeout(() => {
        this.emit('audioReady', {
          sessionId,
          packet,
          playbackTime
        });
      }, delay);
    } else {
      // Play immediately if we're behind
      this.emit('audioReady', {
        sessionId,
        packet,
        playbackTime: Date.now()
      });
    }
  }

  private handlePacketLoss(data: any): void {
    const session = this.sessions.get(data.sessionId);
    if (!session) return;

    logger.warn('Packet loss detected', {
      sessionId: data.sessionId,
      lostSequences: data.lostSequences,
      totalLost: data.totalLost
    });

    // Adjust jitter buffer if needed
    if (data.lossRate > 0.05) { // More than 5% loss
      // Adjust buffer target when packet loss is high
      session.jitterBuffer.updateConfiguration({
        targetBufferMs: 150 // Increase buffer target
      });
    }

    // Notify sync manager to potentially adjust timing
    // Sync manager doesn't have onPacketLoss, adjust timing instead
    session.syncManager.adjustTiming(data.sessionId, {
      avgLatency: 20,
      jitterMs: 10,
      packetLoss: data.lossRate,
      bandwidth: 0
    });
  }

  private handleSessionEnd(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    logger.info('Cleaning up session', { sessionId });

    // Mark as inactive
    session.isActive = false;

    // Clean up resources
    session.jitterBuffer.endSession(sessionId);
    
    if (session.subtitleManager) {
      session.subtitleManager.endSession(sessionId);
    }

    // Remove from active sessions
    this.sessions.delete(sessionId);

    this.emit('sessionClosed', sessionId);
  }

  private startNetworkMonitoring(): void {
    // Monitor network conditions every 5 seconds
    this.networkProbe = setInterval(() => {
      this.sessions.forEach((session, sessionId) => {
        if (!session.isActive) return;

        const stats = this.udpServer.getSessionStatistics(sessionId);
        const conditions: NetworkConditions = {
          avgLatency: stats ? stats.avgLatency : 20,
          jitterMs: stats ? stats.jitterMs : 5,
          packetLoss: stats ? (stats.lostPackets / stats.totalPackets) : 0,
          bandwidth: 0
        };

        // Adapt jitter buffer based on conditions
        if (conditions.jitterMs > 20) {
          session.jitterBuffer.updateConfiguration({
            targetBufferMs: Math.min(300, session.jitterBuffer.getBufferStatus(sessionId).targetBufferMs * 1.2)
          });
        } else if (conditions.jitterMs < 5 && conditions.packetLoss < 0.01) {
          session.jitterBuffer.updateConfiguration({
            targetBufferMs: Math.max(50, session.jitterBuffer.getBufferStatus(sessionId).targetBufferMs * 0.9)
          });
        }

        // Update sync manager with network conditions
        session.syncManager.adjustTiming(sessionId, conditions);
      });
    }, 5000);
  }

  getSessionMetrics(sessionId: string): any {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const udpStats = this.udpServer.getSessionStatistics(sessionId);
    const jitterStats = session.jitterBuffer.getBufferStatus(sessionId);
    const syncStats = session.syncManager.getTimingStats(sessionId);
    const subtitleStats = session.subtitleManager?.getSessionStats(sessionId);

    return {
      sessionId,
      uptime: Date.now() - session.startTime,
      negotiationTime: session.negotiationTime,
      isActive: session.isActive,
      network: udpStats,
      jitterBuffer: jitterStats,
      synchronization: syncStats,
      subtitles: subtitleStats
    };
  }

  getAllSessionMetrics(): Map<string, any> {
    const metrics = new Map();
    this.sessions.forEach((_, sessionId) => {
      metrics.set(sessionId, this.getSessionMetrics(sessionId));
    });
    return metrics;
  }

  async initialize(): Promise<void> {
    logger.info('Initializing connection negotiator');

    // Connect to Redis control plane
    await this.controlPlane.connect();

    // Start UDP server
    await this.udpServer.start();

    // Initialize subtitle display if enabled
    if (this.config.subtitles?.enabled) {
      await this.displayManager.setDisplayMethod(this.config.subtitles.method);
    }

    logger.info('Connection negotiator initialized successfully');
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down connection negotiator');

    // Stop network monitoring
    if (this.networkProbe) {
      clearInterval(this.networkProbe);
      this.networkProbe = null;
    }

    // Clean up all active sessions
    for (const sessionId of this.sessions.keys()) {
      this.handleSessionEnd(sessionId);
    }

    // Shutdown components
    await this.displayManager.shutdown();
    await this.udpServer.stop();
    await this.controlPlane.shutdown();

    this.removeAllListeners();
    logger.info('Connection negotiator shutdown complete');
  }
}