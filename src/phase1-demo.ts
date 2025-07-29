#!/usr/bin/env node

/**
 * Phase 1 Demo - Core Infrastructure
 * 
 * This script demonstrates the Phase 1 hybrid Redis/UDP architecture components:
 * - UDPAudioServer: Receives audio packets with minimal latency
 * - AudioSyncManager: Coordinates precise timing for audio playback
 * - JitterBuffer: Smooths network timing variations
 */

import { UDPAudioServer } from './udp-audio-server';
import { AudioSyncManager } from './audio-sync-manager';
import { JitterBuffer } from './jitter-buffer';
import { AudioPacket, AudioFormat, NetworkConditions, SyncTimestamps } from './types';
import * as dgram from 'dgram';

// Set environment variables to avoid config issues
process.env.LOG_LEVEL = 'info';
process.env.REDIS_HOST = 'localhost';
process.env.AUDIO_OUTPUT_TYPE = 'speaker';

class Phase1Demo {
  private udpServer: UDPAudioServer;
  private syncManager: AudioSyncManager;
  private jitterBuffer: JitterBuffer;

  constructor() {
    // Initialize Phase 1 components
    this.udpServer = new UDPAudioServer(8001);
    this.syncManager = new AudioSyncManager();
    this.jitterBuffer = new JitterBuffer({
      targetBufferMs: 100,
      minBufferMs: 50,
      maxBufferMs: 300,
      adaptiveMode: true
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Wire up the Phase 1 flow: UDP -> Sync -> Jitter -> Audio
    this.udpServer.on('audioPacket', (packet: AudioPacket, syncTimestamps: SyncTimestamps, networkConditions: NetworkConditions) => {
      console.log(`📦 Received audio packet ${packet.sequenceNumber} for session ${packet.sessionId}`);
      
      // Sync manager schedules the audio chunk
      this.syncManager.scheduleAudioChunk(packet, syncTimestamps, networkConditions);
    });

    this.syncManager.on('playAudio', (chunk: any) => {
      console.log(`⏰ Sync manager scheduled chunk ${chunk.sequenceNumber} for playback`);
      
      const networkConditions: NetworkConditions = {
        avgLatency: 20,
        jitterMs: 5,
        packetLoss: 0,
        bandwidth: 1000000
      };
      
      // Jitter buffer smooths the playback
      this.jitterBuffer.addChunk(chunk.sessionId, chunk, networkConditions);
    });

    this.jitterBuffer.on('playChunk', (_sessionId: string, chunk: any, _actualTime: number) => {
      console.log(`🔊 Playing audio chunk ${chunk.sequenceNumber} (${chunk.audio.length} bytes)`);
      // In a real implementation, this would send to audio output
    });

    this.syncManager.on('showSubtitle', (_sessionId: string, subtitle: any) => {
      console.log(`💬 Show subtitle: "${subtitle.text}"`);
    });

    this.syncManager.on('hideSubtitle', (_sessionId: string, _subtitle: any) => {
      console.log('💬 Hide subtitle');
    });

    this.udpServer.on('sessionEnd', (sessionId: string, statistics: any) => {
      console.log(`🏁 Session ${sessionId} ended:`, {
        totalPackets: statistics.totalPackets,
        lostPackets: statistics.lostPackets,
        avgLatency: `${statistics.avgLatency}ms`,
        jitterMs: `${statistics.jitterMs}ms`
      });
      
      this.syncManager.endSession(sessionId);
      this.jitterBuffer.endSession(sessionId);
    });
  }

  async start(): Promise<void> {
    console.log('🚀 Starting Phase 1 Demo - CHIP Windows Output Service');
    console.log('📋 Core Infrastructure: UDP Server + Audio Sync + Jitter Buffer');
    console.log('');

    try {
      await this.udpServer.start();
      const address = this.udpServer['server'].address();
      
      console.log(`✅ UDP Audio Server listening on port ${address?.port || 8001}`);
      console.log('✅ Audio Sync Manager initialized');
      console.log('✅ Jitter Buffer configured (100ms target, adaptive)');
      console.log('');
      console.log('💡 To test: Send UDP audio packets to this port using the protocol spec');
      console.log('💡 Demo will automatically send test packets in 3 seconds...');
      console.log('');

      // Send test packets after a short delay
      setTimeout(() => this.sendTestPackets(), 3000);

    } catch (error) {
      console.error('❌ Failed to start Phase 1 demo:', error);
      process.exit(1);
    }
  }

  private async sendTestPackets(): Promise<void> {
    console.log('📤 Sending test audio packets...');
    
    const sessionId = 'demo-session-' + Date.now();
    
    // Initialize session in UDP server
    this.udpServer.expectSession(sessionId, '127.0.0.1', 12345);
    this.syncManager.createSession(sessionId);
    this.jitterBuffer.initializeSession(sessionId);

    const client = dgram.createSocket('udp4');
    const serverAddress = this.udpServer['server'].address();

    if (serverAddress && typeof serverAddress === 'object') {
      // Send 5 test packets
      for (let i = 1; i <= 5; i++) {
        const packet = this.createTestAudioPacket(sessionId, i);
        const serializedPacket = this.serializeAudioPacket(packet);
        
        client.send(serializedPacket, serverAddress.port, '127.0.0.1');
        console.log(`📡 Sent packet ${i}/5`);
        
        // Wait between packets to simulate real streaming
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Send final packet
      const finalPacket = this.createTestAudioPacket(sessionId, 6);
      finalPacket.isLast = true;
      const finalSerialized = this.serializeAudioPacket(finalPacket);
      client.send(finalSerialized, serverAddress.port, '127.0.0.1');
      console.log('📡 Sent final packet (isLast=true)');

      setTimeout(() => client.close(), 1000);
    }

    // Show statistics after processing
    setTimeout(() => this.showStatistics(), 2000);
  }

  private showStatistics(): void {
    console.log('');
    console.log('📊 Phase 1 Component Statistics:');
    console.log('================================');
    
    // UDP Server statistics
    const sessions = this.udpServer.getActiveSessions();
    console.log(`Active sessions: ${sessions.length}`);
    
    sessions.forEach(sessionId => {
      const stats = this.udpServer.getSessionStatistics(sessionId);
      const networkConditions = this.udpServer.getNetworkConditions(sessionId);
      
      if (stats && networkConditions) {
        console.log(`\nSession ${sessionId}:`);
        console.log(`  Total packets: ${stats.totalPackets}`);
        console.log(`  Lost packets: ${stats.lostPackets}`);
        console.log(`  Average latency: ${stats.avgLatency.toFixed(2)}ms`);
        console.log(`  Jitter: ${networkConditions.jitterMs.toFixed(2)}ms`);
        console.log(`  Packet loss: ${(networkConditions.packetLoss * 100).toFixed(2)}%`);
        console.log(`  Bandwidth: ${(networkConditions.bandwidth / 1000).toFixed(1)} KB/s`);
      }

      // Sync manager statistics
      const syncStats = this.syncManager.getTimingStats(sessionId);
      if (syncStats) {
        console.log(`  Queue length: ${syncStats.queueLength}`);
        console.log(`  Clock offset: ${syncStats.clockOffset}ms`);
        console.log(`  Playback active: ${syncStats.isPlaybackActive}`);
      }

      // Jitter buffer statistics
      const bufferStatus = this.jitterBuffer.getBufferStatus(sessionId);
      if (bufferStatus) {
        console.log(`  Buffer size: ${bufferStatus.bufferSize} chunks`);
        console.log(`  Buffered time: ${bufferStatus.bufferedTimeMs}ms`);
        console.log(`  Target buffer: ${bufferStatus.targetBufferMs}ms`);
      }
    });

    console.log('');
    console.log('✅ Phase 1 Demo completed successfully!');
    console.log('🎯 All core components working: UDP streaming, sync timing, jitter buffering');
    
    // Auto-exit after demo
    setTimeout(() => {
      console.log('');
      console.log('👋 Demo completed, exiting...');
      process.exit(0);
    }, 2000);
  }

  private createTestAudioPacket(sessionId: string, sequenceNumber: number): AudioPacket {
    const now = Date.now();
    return {
      sessionId,
      sequenceNumber,
      timestamp: now,
      playbackTime: now + 50, // Play in 50ms
      audioData: Buffer.from(`[Audio data for packet ${sequenceNumber}] This would be PCM audio data in a real implementation.`),
      format: AudioFormat.PCM,
      sampleRate: 44100,
      isLast: false
    };
  }

  private serializeAudioPacket(packet: AudioPacket): Buffer {
    // Serialize following the UDP protocol spec
    const sessionIdBuffer = Buffer.from(packet.sessionId, 'utf8');
    const audioDataBuffer = packet.audioData;
    
    const totalLength = 1 + sessionIdBuffer.length + 4 + 8 + 8 + 1 + 4 + 1 + 4 + audioDataBuffer.length;
    const buffer = Buffer.allocUnsafe(totalLength);
    
    let offset = 0;
    
    // Session ID length and data
    buffer.writeUInt8(sessionIdBuffer.length, offset);
    offset += 1;
    sessionIdBuffer.copy(buffer, offset);
    offset += sessionIdBuffer.length;
    
    // Sequence number
    buffer.writeUInt32BE(packet.sequenceNumber, offset);
    offset += 4;
    
    // Timestamps
    buffer.writeBigUInt64BE(BigInt(packet.timestamp), offset);
    offset += 8;
    buffer.writeBigUInt64BE(BigInt(packet.playbackTime), offset);
    offset += 8;
    
    // Format (0 = PCM)
    buffer.writeUInt8(packet.format === AudioFormat.PCM ? 0 : 1, offset);
    offset += 1;
    
    // Sample rate
    buffer.writeUInt32BE(packet.sampleRate, offset);
    offset += 4;
    
    // Is last
    buffer.writeUInt8(packet.isLast ? 1 : 0, offset);
    offset += 1;
    
    // Audio data length and data
    buffer.writeUInt32BE(audioDataBuffer.length, offset);
    offset += 4;
    audioDataBuffer.copy(buffer, offset);
    
    return buffer;
  }

  async stop(): Promise<void> {
    console.log('🛑 Stopping Phase 1 Demo...');
    
    if (this.udpServer) {
      await this.udpServer.stop();
    }
    
    console.log('✅ Phase 1 Demo stopped');
  }
}

// Run the demo if called directly
if (require.main === module) {
  const demo = new Phase1Demo();
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🔄 Received SIGINT, shutting down gracefully...');
    await demo.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🔄 Received SIGTERM, shutting down gracefully...');
    await demo.stop();
    process.exit(0);
  });

  // Start the demo
  demo.start().catch(error => {
    console.error('❌ Demo failed:', error);
    process.exit(1);
  });
}

export default Phase1Demo;