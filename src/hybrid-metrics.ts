import { EventEmitter } from 'events';
import * as promClient from 'prom-client';
import express from 'express';
import { logger } from './logger';
import { ConnectionNegotiator } from './connection-negotiator';

export class HybridMetricsCollector extends EventEmitter {
  private app: express.Application;
  private server: any;
  
  // Prometheus metrics
  private metrics = {
    // Session metrics
    activeSessions: new promClient.Gauge({
      name: 'audio_active_sessions',
      help: 'Number of active audio streaming sessions'
    }),
    
    sessionDuration: new promClient.Histogram({
      name: 'audio_session_duration_seconds',
      help: 'Duration of audio sessions',
      buckets: [1, 5, 10, 30, 60, 120, 300, 600]
    }),
    
    // UDP streaming metrics
    udpPacketsReceived: new promClient.Counter({
      name: 'audio_udp_packets_received_total',
      help: 'Total UDP audio packets received',
      labelNames: ['sessionId']
    }),
    
    udpPacketsLost: new promClient.Counter({
      name: 'audio_udp_packets_lost_total',
      help: 'Total UDP audio packets lost',
      labelNames: ['sessionId']
    }),
    
    udpLatency: new promClient.Histogram({
      name: 'audio_udp_latency_ms',
      help: 'UDP packet latency in milliseconds',
      labelNames: ['sessionId'],
      buckets: [1, 5, 10, 20, 50, 100, 200, 500]
    }),
    
    // Jitter buffer metrics
    jitterBufferSize: new promClient.Gauge({
      name: 'audio_jitter_buffer_size_ms',
      help: 'Current jitter buffer size in milliseconds',
      labelNames: ['sessionId']
    }),
    
    jitterBufferUnderruns: new promClient.Counter({
      name: 'audio_jitter_buffer_underruns_total',
      help: 'Total jitter buffer underruns',
      labelNames: ['sessionId']
    }),
    
    jitterBufferOverruns: new promClient.Counter({
      name: 'audio_jitter_buffer_overruns_total',
      help: 'Total jitter buffer overruns',
      labelNames: ['sessionId']
    }),
    
    // Audio synchronization metrics
    audioSyncDrift: new promClient.Histogram({
      name: 'audio_sync_drift_ms',
      help: 'Audio synchronization drift in milliseconds',
      labelNames: ['sessionId'],
      buckets: [-50, -20, -10, -5, 0, 5, 10, 20, 50]
    }),
    
    audioPlaybackDelay: new promClient.Histogram({
      name: 'audio_playback_delay_ms',
      help: 'Delay between scheduled and actual playback',
      labelNames: ['sessionId'],
      buckets: [0, 1, 5, 10, 20, 50, 100]
    }),
    
    // Subtitle metrics
    subtitleSyncError: new promClient.Histogram({
      name: 'subtitle_sync_error_ms',
      help: 'Subtitle synchronization error in milliseconds',
      labelNames: ['sessionId'],
      buckets: [-100, -50, -20, -10, 0, 10, 20, 50, 100]
    }),
    
    subtitlesDisplayed: new promClient.Counter({
      name: 'subtitles_displayed_total',
      help: 'Total subtitles displayed',
      labelNames: ['sessionId', 'method']
    }),
    
    // Network condition metrics
    networkJitter: new promClient.Gauge({
      name: 'audio_network_jitter_ms',
      help: 'Network jitter in milliseconds',
      labelNames: ['sessionId']
    }),
    
    networkPacketLoss: new promClient.Gauge({
      name: 'audio_network_packet_loss_ratio',
      help: 'Network packet loss ratio (0-1)',
      labelNames: ['sessionId']
    }),
    
    estimatedBandwidth: new promClient.Gauge({
      name: 'audio_estimated_bandwidth_kbps',
      help: 'Estimated network bandwidth in kbps',
      labelNames: ['sessionId']
    }),
    
    // System metrics
    memoryUsage: new promClient.Gauge({
      name: 'audio_service_memory_usage_bytes',
      help: 'Memory usage of the audio service'
    }),
    
    cpuUsage: new promClient.Gauge({
      name: 'audio_service_cpu_usage_percent',
      help: 'CPU usage percentage of the audio service'
    }),
    
    // Redis control plane metrics
    redisCommands: new promClient.Counter({
      name: 'redis_commands_total',
      help: 'Total Redis commands executed',
      labelNames: ['command', 'status']
    }),
    
    redisLatency: new promClient.Histogram({
      name: 'redis_command_latency_ms',
      help: 'Redis command latency',
      labelNames: ['command'],
      buckets: [1, 5, 10, 20, 50, 100]
    }),
    
    // Error metrics
    errors: new promClient.Counter({
      name: 'audio_service_errors_total',
      help: 'Total errors in audio service',
      labelNames: ['type', 'component']
    })
  };

  constructor(
    private negotiator: ConnectionNegotiator,
    private port: number = 9090
  ) {
    super();
    this.app = express();
    this.setupRoutes();
    this.setupEventListeners();
  }

  private setupRoutes(): void {
    // Prometheus metrics endpoint
    this.app.get('/metrics', (_req, res) => {
      res.set('Content-Type', promClient.register.contentType);
      promClient.register.metrics().then(metrics => {
        res.end(metrics);
      });
    });

    // Health check endpoint
    this.app.get('/health', (_req, res) => {
      const sessions = this.negotiator.getAllSessionMetrics();
      const health = {
        status: 'healthy',
        timestamp: Date.now(),
        uptime: process.uptime(),
        activeSessions: sessions.size,
        memory: process.memoryUsage(),
        versions: {
          node: process.version,
          service: '2.0.0' // Phase 2
        }
      };
      
      res.json(health);
    });

    // Detailed metrics endpoint
    this.app.get('/metrics/sessions', (_req, res) => {
      const sessions = this.negotiator.getAllSessionMetrics();
      const sessionArray = Array.from(sessions.entries()).map(([id, metrics]) => ({
        sessionId: id,
        ...metrics
      }));
      
      res.json(sessionArray);
    });

    // Session-specific metrics
    this.app.get('/metrics/sessions/:sessionId', (req, res) => {
      const metrics = this.negotiator.getSessionMetrics(req.params.sessionId);
      if (!metrics) {
        res.status(404).json({ error: 'Session not found' });
      } else {
        res.json(metrics);
      }
    });
  }

  private setupEventListeners(): void {
    // Session lifecycle events
    this.negotiator.on('sessionReady', (sessionId) => {
      this.metrics.activeSessions.inc();
      logger.debug('Session metrics: ready', { sessionId });
    });

    this.negotiator.on('sessionClosed', (sessionId) => {
      this.metrics.activeSessions.dec();
      
      // Record session duration
      const metrics = this.negotiator.getSessionMetrics(sessionId);
      if (metrics) {
        this.metrics.sessionDuration.observe(metrics.uptime / 1000);
      }
      
      logger.debug('Session metrics: closed', { sessionId });
    });

    // Audio packet events
    this.negotiator.on('audioReady', (data) => {
      const { sessionId, packet, playbackTime } = data;
      
      // Record playback delay
      const delay = Date.now() - playbackTime;
      this.metrics.audioPlaybackDelay.labels(sessionId).observe(Math.abs(delay));
      
      // Record sync drift
      const drift = packet.playbackTime - playbackTime;
      this.metrics.audioSyncDrift.labels(sessionId).observe(drift);
    });

    // Error events
    this.negotiator.on('sessionError', (_data) => {
      this.metrics.errors.labels('session', 'negotiator').inc();
    });
  }

  private startSystemMetrics(): void {
    // Collect system metrics every 5 seconds
    setInterval(() => {
      // Memory usage
      const memUsage = process.memoryUsage();
      this.metrics.memoryUsage.set(memUsage.heapUsed);
      
      // CPU usage (simplified - in production use proper CPU monitoring)
      const cpuUsage = process.cpuUsage();
      const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds
      this.metrics.cpuUsage.set(cpuPercent);
      
      // Update session-specific metrics
      const sessions = this.negotiator.getAllSessionMetrics();
      sessions.forEach((metrics, sessionId) => {
        if (metrics.network) {
          this.metrics.networkJitter.labels(sessionId).set(metrics.network.jitter);
          this.metrics.networkPacketLoss.labels(sessionId).set(metrics.network.packetLossRate);
          this.metrics.estimatedBandwidth.labels(sessionId).set(metrics.network.estimatedBandwidth);
          
          // UDP metrics
          this.metrics.udpPacketsReceived.labels(sessionId).inc(metrics.network.packetsReceived || 0);
          this.metrics.udpPacketsLost.labels(sessionId).inc(metrics.network.packetsLost || 0);
          this.metrics.udpLatency.labels(sessionId).observe(metrics.network.avgLatency);
        }
        
        if (metrics.jitterBuffer) {
          this.metrics.jitterBufferSize.labels(sessionId).set(metrics.jitterBuffer.currentSize);
          this.metrics.jitterBufferUnderruns.labels(sessionId).inc(metrics.jitterBuffer.underruns || 0);
          this.metrics.jitterBufferOverruns.labels(sessionId).inc(metrics.jitterBuffer.overruns || 0);
        }
      });
    }, 5000);
  }

  recordUDPPacket(sessionId: string, latency: number): void {
    this.metrics.udpPacketsReceived.labels(sessionId).inc();
    this.metrics.udpLatency.labels(sessionId).observe(latency);
  }

  recordPacketLoss(sessionId: string, count: number): void {
    this.metrics.udpPacketsLost.labels(sessionId).inc(count);
  }

  recordSubtitleDisplay(sessionId: string, method: string, syncError: number): void {
    this.metrics.subtitlesDisplayed.labels(sessionId, method).inc();
    this.metrics.subtitleSyncError.labels(sessionId).observe(syncError);
  }

  recordRedisCommand(command: string, latency: number, success: boolean): void {
    this.metrics.redisCommands.labels(command, success ? 'success' : 'error').inc();
    this.metrics.redisLatency.labels(command).observe(latency);
  }

  recordError(type: string, component: string): void {
    this.metrics.errors.labels(type, component).inc();
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        logger.info(`Metrics server listening on port ${this.port}`);
        logger.info(`Prometheus metrics available at http://localhost:${this.port}/metrics`);
        logger.info(`Health check available at http://localhost:${this.port}/health`);
        this.startSystemMetrics();
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('Metrics server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}