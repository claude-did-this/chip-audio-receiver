import { UDPAudioServer } from './udp-audio-server';
import { AudioPacket, AudioFormat } from './types';
import * as dgram from 'dgram';

// Mock logger to avoid config dependency
jest.mock('./logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }
}));

describe('UDP Audio Server', () => {
  let udpServer: UDPAudioServer;
  
  beforeEach(() => {
    udpServer = new UDPAudioServer(0); // Use port 0 for random port
  });

  afterEach(async () => {
    try {
      if (udpServer) {
        await udpServer.stop();
      }
    } catch (error) {
      // Ignore cleanup errors in tests
    }
  });

  describe('Basic Operations', () => {
    it('should start and stop successfully', async () => {
      await udpServer.start();
      expect(udpServer.getActiveSessions()).toEqual([]);
      await udpServer.stop();
    });

    it('should manage sessions', async () => {
      await udpServer.start();
      
      const sessionId = 'test-session-1';
      udpServer.expectSession(sessionId, '127.0.0.1', 12345);
      
      expect(udpServer.isSessionActive(sessionId)).toBe(true);
      expect(udpServer.getActiveSessions()).toContain(sessionId);
      
      const stats = udpServer.getSessionStatistics(sessionId);
      expect(stats).toBeTruthy();
      expect(stats?.totalPackets).toBe(0);
      expect(stats?.lostPackets).toBe(0);

      const networkConditions = udpServer.getNetworkConditions(sessionId);
      expect(networkConditions).toBeTruthy();
      expect(networkConditions?.avgLatency).toBe(0);
    });

    it('should return null for non-existent session statistics', async () => {
      await udpServer.start();
      
      const stats = udpServer.getSessionStatistics('non-existent');
      expect(stats).toBeNull();
      
      const networkConditions = udpServer.getNetworkConditions('non-existent');  
      expect(networkConditions).toBeNull();
    });

    it('should handle session initialization correctly', async () => {
      await udpServer.start();
      
      const sessionId = 'init-test';
      expect(udpServer.isSessionActive(sessionId)).toBe(false);
      
      udpServer.expectSession(sessionId, '192.168.1.100', 8080);
      
      expect(udpServer.isSessionActive(sessionId)).toBe(true);
      const sessions = udpServer.getActiveSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toBe(sessionId);
    });
  });

  describe('Packet Processing', () => {
    it('should deserialize audio packets correctly', async () => {
      await udpServer.start();
      
      const sessionId = 'deserialize-test';
      udpServer.expectSession(sessionId, '127.0.0.1', 12345);
      
      // Test the private deserializePacket method indirectly
      const testPacket = createTestAudioPacket(sessionId, 42);
      const serializedPacket = serializeAudioPacket(testPacket);
      
      // Access private method for testing
      const deserializedPacket = (udpServer as any).deserializePacket(serializedPacket);
      
      expect(deserializedPacket.sessionId).toBe(sessionId);
      expect(deserializedPacket.sequenceNumber).toBe(42);
      expect(deserializedPacket.format).toBe('pcm');
      expect(deserializedPacket.sampleRate).toBe(44100);
      expect(deserializedPacket.isLast).toBe(false);
      expect(deserializedPacket.audioData.toString()).toContain('test-audio-data-42');
    });

    it('should handle malformed packets gracefully', async () => {
      await udpServer.start();
      
      const sessionId = 'malformed-test';
      udpServer.expectSession(sessionId, '127.0.0.1', 12345);
      
      // Create malformed packet (too short)
      const malformedPacket = Buffer.from([0x01, 0x02, 0x03]);
      
      // This should not crash the server
      expect(() => {
        (udpServer as any).deserializePacket(malformedPacket);
      }).toThrow();
    });

    it('should send events for received packets', async () => {
      await udpServer.start();
      
      const sessionId = 'event-test';
      udpServer.expectSession(sessionId, '127.0.0.1', 12345);
      
      let eventEmitted = false;
      udpServer.on('audioPacket', () => {
        eventEmitted = true;
      });
      
      // Send a real UDP packet
      const testPacket = createTestAudioPacket(sessionId, 1);
      const serializedPacket = serializeAudioPacket(testPacket);
      
      const client = dgram.createSocket('udp4');
      const serverAddress = udpServer['server'].address();
      
      if (serverAddress && typeof serverAddress === 'object') {
        client.send(serializedPacket, serverAddress.port, '127.0.0.1');
        
        // Wait for processing
        await new Promise(resolve => setTimeout(resolve, 100));
        
        expect(eventEmitted).toBe(true);
        
        // Check statistics were updated
        const stats = udpServer.getSessionStatistics(sessionId);
        expect(stats?.totalPackets).toBe(1);
      }
      
      client.close();
    });

    it('should detect packet loss', async () => {
      await udpServer.start();
      
      const sessionId = 'packet-loss-test';
      udpServer.expectSession(sessionId, '127.0.0.1', 12345);
      
      const client = dgram.createSocket('udp4');
      const serverAddress = udpServer['server'].address();
      
      if (serverAddress && typeof serverAddress === 'object') {
        // Send packet 1
        const packet1 = createTestAudioPacket(sessionId, 1);
        const serialized1 = serializeAudioPacket(packet1);
        client.send(serialized1, serverAddress.port, '127.0.0.1');
        
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Skip packet 2, send packet 3 (simulate packet loss)
        const packet3 = createTestAudioPacket(sessionId, 3);
        const serialized3 = serializeAudioPacket(packet3);
        client.send(serialized3, serverAddress.port, '127.0.0.1');
        
        await new Promise(resolve => setTimeout(resolve, 50));
        
        const stats = udpServer.getSessionStatistics(sessionId);
        expect(stats?.totalPackets).toBe(2);
        expect(stats?.lostPackets).toBeGreaterThanOrEqual(1); // Should detect packet loss
      }
      
      client.close();
    });

    it('should handle session end packets', async () => {
      await udpServer.start();
      
      const sessionId = 'session-end-test';
      udpServer.expectSession(sessionId, '127.0.0.1', 12345);
      
      let sessionEnded = false;
      udpServer.on('sessionEnd', (endedSessionId) => {
        if (endedSessionId === sessionId) {
          sessionEnded = true;
        }
      });
      
      const client = dgram.createSocket('udp4');
      const serverAddress = udpServer['server'].address();
      
      if (serverAddress && typeof serverAddress === 'object') {
        // Send final packet
        const packet = createTestAudioPacket(sessionId, 1);
        packet.isLast = true;
        const serialized = serializeAudioPacket(packet);
        client.send(serialized, serverAddress.port, '127.0.0.1');
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        expect(sessionEnded).toBe(true);
        expect(udpServer.isSessionActive(sessionId)).toBe(false);
      }
      
      client.close();
    });

    it('should handle unknown session packets', async () => {
      await udpServer.start();
      
      const unknownSessionId = 'unknown-session';
      
      const client = dgram.createSocket('udp4');
      const serverAddress = udpServer['server'].address();
      
      if (serverAddress && typeof serverAddress === 'object') {
        const packet = createTestAudioPacket(unknownSessionId, 1);
        const serialized = serializeAudioPacket(packet);
        client.send(serialized, serverAddress.port, '127.0.0.1');
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Should not crash, just log warning and ignore
        expect(udpServer.isSessionActive(unknownSessionId)).toBe(false);
      }
      
      client.close();
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should track network statistics accurately', async () => {
      await udpServer.start();
      
      const sessionId = 'stats-test';
      udpServer.expectSession(sessionId, '127.0.0.1', 12345);
      
      const client = dgram.createSocket('udp4');
      const serverAddress = udpServer['server'].address();
      
      if (serverAddress && typeof serverAddress === 'object') {
        // Send multiple packets
        for (let i = 1; i <= 3; i++) {
          const packet = createTestAudioPacket(sessionId, i);
          const serialized = serializeAudioPacket(packet);
          client.send(serialized, serverAddress.port, '127.0.0.1');
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const stats = udpServer.getSessionStatistics(sessionId);
        expect(stats?.totalPackets).toBe(3);
        expect(stats?.avgLatency).toBeGreaterThanOrEqual(0);
        
        const networkConditions = udpServer.getNetworkConditions(sessionId);
        expect(networkConditions?.bandwidth).toBeGreaterThan(0);
        expect(networkConditions?.packetLoss).toBeGreaterThanOrEqual(0); // Packet loss rate
      }
      
      client.close();
    });

    it('should update session statistics correctly', async () => {
      await udpServer.start();
      
      const sessionId = 'stats-update-test';
      udpServer.expectSession(sessionId, '127.0.0.1', 12345);
      
      // Test the private updateSessionStatistics method
      const session = (udpServer as any).activeSessions.get(sessionId);
      const packet = createTestAudioPacket(sessionId, 1);
      const rinfo = { address: '127.0.0.1', port: 12345, family: 'IPv4', size: 100 };
      
      const initialPackets = session.statistics.totalPackets;
      
      (udpServer as any).updateSessionStatistics(session, packet, Date.now(), rinfo);
      
      expect(session.statistics.totalPackets).toBe(initialPackets + 1);
      expect(session.statistics.avgLatency).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle server errors gracefully', async () => {
      await udpServer.start();
      
      let errorEmitted = false;
      udpServer.on('error', () => {
        errorEmitted = true;
      });
      
      // Trigger an error by emitting on the underlying server
      udpServer['server'].emit('error', new Error('Test error'));
      
      expect(errorEmitted).toBe(true);
    });

    it('should handle listening event', async () => {
      await udpServer.start();
      
      let listeningEmitted = false;
      udpServer.on('listening', () => {
        listeningEmitted = true;
      });
      
      // Trigger listening event
      udpServer['server'].emit('listening');
      
      expect(listeningEmitted).toBe(true);
    });
  });
});

// Helper functions
function createTestAudioPacket(sessionId: string, sequenceNumber: number): AudioPacket {
  const now = Date.now();
  return {
    sessionId,
    sequenceNumber,
    timestamp: now,
    playbackTime: now + 100,
    audioData: Buffer.from('test-audio-data-' + sequenceNumber),
    format: AudioFormat.PCM,
    sampleRate: 44100,
    isLast: false
  };
}

function serializeAudioPacket(packet: AudioPacket): Buffer {
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