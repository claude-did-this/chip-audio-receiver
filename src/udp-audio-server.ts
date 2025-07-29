import * as dgram from 'dgram';
import { EventEmitter } from 'events';
import { logger } from './logger';
import { 
  AudioPacket, 
  SessionStatistics, 
  NetworkConditions,
  SyncTimestamps 
} from './types';

interface ActiveSession {
  sessionId: string;
  remoteAddress: string;
  remotePort: number;
  startTime: number;
  lastPacketTime: number;
  expectedSequence: number;
  statistics: SessionStatistics;
  networkConditions: NetworkConditions;
}

export class UDPAudioServer extends EventEmitter {
  private server: dgram.Socket;
  private port: number;
  private activeSessions = new Map<string, ActiveSession>();

  constructor(port: number = 8001) {
    super();
    this.port = port;
    this.server = dgram.createSocket('udp4');
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.server.on('message', (msg, rinfo) => {
      this.handleIncomingPacket(msg, rinfo);
    });

    this.server.on('error', (err) => {
      logger.error('UDP server error', { error: err });
      this.emit('error', err);
    });

    this.server.on('listening', () => {
      const address = this.server.address();
      logger.info('UDP audio server listening', { 
        address: address?.address, 
        port: address?.port 
      });
      this.emit('listening', address);
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.on('error', reject);
      this.server.bind(this.port, () => {
        this.server.removeListener('error', reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        logger.info('UDP audio server stopped');
        resolve();
      });
    });
  }

  expectSession(sessionId: string, remoteAddress: string, remotePort: number): void {
    const session: ActiveSession = {
      sessionId,
      remoteAddress,
      remotePort,
      startTime: Date.now(),
      lastPacketTime: Date.now(),
      expectedSequence: 0,
      statistics: {
        totalPackets: 0,
        lostPackets: 0,
        avgLatency: 0,
        jitterMs: 0,
        audioDuration: 0,
        startTime: Date.now(),
        endTime: 0
      },
      networkConditions: {
        avgLatency: 0,
        jitterMs: 0,
        packetLoss: 0,
        bandwidth: 0
      }
    };

    this.activeSessions.set(sessionId, session);
    logger.info('UDP session initialized', { 
      sessionId, 
      remoteAddress, 
      remotePort 
    });
  }

  private handleIncomingPacket(buffer: Buffer, rinfo: dgram.RemoteInfo): void {
    try {
      const packet = this.deserializePacket(buffer);
      const receiveTime = Date.now();
      
      // Update sync timestamps
      const syncTimestamps: SyncTimestamps = {
        ttsGenerated: packet.timestamp,
        packetSent: packet.timestamp, // Assume minimal processing time
        packetReceived: receiveTime,
        scheduledPlayback: packet.playbackTime
      };

      const session = this.activeSessions.get(packet.sessionId);
      if (!session) {
        logger.warn('Received packet for unknown session', { 
          sessionId: packet.sessionId 
        });
        return;
      }

      // Update session statistics
      this.updateSessionStatistics(session, packet, receiveTime, rinfo);

      // Check for packet loss
      if (packet.sequenceNumber !== session.expectedSequence) {
        const lostPackets = packet.sequenceNumber - session.expectedSequence;
        if (lostPackets > 0) {
          session.statistics.lostPackets += lostPackets;
          logger.warn('Packet loss detected', {
            sessionId: packet.sessionId,
            expected: session.expectedSequence,
            received: packet.sequenceNumber,
            lostCount: lostPackets
          });
        }
      }

      session.expectedSequence = packet.sequenceNumber + 1;
      session.lastPacketTime = receiveTime;

      // Emit the packet for processing
      this.emit('audioPacket', packet, syncTimestamps, session.networkConditions);

      // Handle session end
      if (packet.isLast) {
        this.endSession(packet.sessionId);
      }

    } catch (error) {
      logger.error('Failed to process UDP packet', { error, rinfo });
    }
  }

  private deserializePacket(buffer: Buffer): AudioPacket {
    // Simple binary protocol:
    // [sessionId length:1][sessionId:variable][sequenceNumber:4][timestamp:8]
    // [playbackTime:8][format:1][sampleRate:4][isLast:1][audioData length:4][audioData:variable]
    
    let offset = 0;

    // Session ID
    const sessionIdLength = buffer.readUInt8(offset);
    offset += 1;
    const sessionId = buffer.subarray(offset, offset + sessionIdLength).toString('utf8');
    offset += sessionIdLength;

    // Sequence number
    const sequenceNumber = buffer.readUInt32BE(offset);
    offset += 4;

    // Timestamps
    const timestamp = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
    const playbackTime = Number(buffer.readBigUInt64BE(offset));
    offset += 8;

    // Format
    const formatByte = buffer.readUInt8(offset);
    offset += 1;
    const format = formatByte === 0 ? 'pcm' : formatByte === 1 ? 'mp3' : 'unknown';

    // Sample rate
    const sampleRate = buffer.readUInt32BE(offset);
    offset += 4;

    // Is last
    const isLast = buffer.readUInt8(offset) === 1;
    offset += 1;

    // Audio data
    const audioDataLength = buffer.readUInt32BE(offset);
    offset += 4;
    const audioData = buffer.subarray(offset, offset + audioDataLength);

    return {
      sessionId,
      sequenceNumber,
      timestamp,
      playbackTime,
      audioData,
      format: format as any,
      sampleRate,
      isLast
    };
  }

  private updateSessionStatistics(
    session: ActiveSession,
    packet: AudioPacket,
    receiveTime: number,
    _rinfo: dgram.RemoteInfo
  ): void {
    session.statistics.totalPackets++;
    
    // Calculate latency (time from TTS generation to reception)
    const latency = receiveTime - packet.timestamp;
    session.statistics.avgLatency = 
      (session.statistics.avgLatency * (session.statistics.totalPackets - 1) + latency) 
      / session.statistics.totalPackets;

    // Calculate jitter (variation in packet arrival times)
    const expectedArrival = session.lastPacketTime + (packet.playbackTime - session.statistics.startTime);
    const jitter = Math.abs(receiveTime - expectedArrival);
    session.networkConditions.jitterMs = 
      (session.networkConditions.jitterMs * 0.9) + (jitter * 0.1); // Exponential smoothing

    // Update network conditions
    session.networkConditions.avgLatency = session.statistics.avgLatency;
    session.networkConditions.packetLoss = 
      session.statistics.lostPackets / session.statistics.totalPackets;

    // Estimate bandwidth (bytes per second)
    const elapsed = (receiveTime - session.statistics.startTime) / 1000;
    if (elapsed > 0) {
      session.networkConditions.bandwidth = 
        (session.statistics.totalPackets * packet.audioData.length) / elapsed;
    }

    logger.debug('Session statistics updated', {
      sessionId: session.sessionId,
      totalPackets: session.statistics.totalPackets,
      avgLatency: session.statistics.avgLatency,
      jitter: session.networkConditions.jitterMs,
      packetLoss: session.networkConditions.packetLoss
    });
  }

  private endSession(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.statistics.endTime = Date.now();
    session.statistics.audioDuration = session.statistics.endTime - session.statistics.startTime;

    logger.info('UDP session ended', {
      sessionId,
      statistics: session.statistics,
      networkConditions: session.networkConditions
    });

    this.emit('sessionEnd', sessionId, session.statistics);
    this.activeSessions.delete(sessionId);
  }

  getSessionStatistics(sessionId: string): SessionStatistics | null {
    const session = this.activeSessions.get(sessionId);
    return session ? { ...session.statistics } : null;
  }

  getNetworkConditions(sessionId: string): NetworkConditions | null {
    const session = this.activeSessions.get(sessionId);
    return session ? { ...session.networkConditions } : null;
  }

  getActiveSessions(): string[] {
    return Array.from(this.activeSessions.keys());
  }

  isSessionActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }
}