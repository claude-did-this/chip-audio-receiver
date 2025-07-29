import { SecurityValidator, RateLimiter, MemoryManager } from '../security';
import { AudioFormat } from '../types';

// Mock the logger to avoid console output during tests
jest.mock('../logger');

describe('Security Module', () => {
  describe('SecurityValidator', () => {
    describe('validateAudioData', () => {
      it('should validate valid audio data', () => {
        const validData = {
          audio: Buffer.from('test audio data').toString('base64'),
          format: AudioFormat.MP3
        };
        expect(SecurityValidator.validateAudioData(validData)).toBe(true);
      });

      it('should reject invalid audio data structure', () => {
        expect(SecurityValidator.validateAudioData(null as any)).toBe(false);
        expect(SecurityValidator.validateAudioData(undefined as any)).toBe(false);
        expect(SecurityValidator.validateAudioData('string' as any)).toBe(false);
      });

      it('should reject missing audio field', () => {
        const invalidData = { format: AudioFormat.MP3 } as any;
        expect(SecurityValidator.validateAudioData(invalidData)).toBe(false);
      });

      it('should reject invalid base64 data', () => {
        const invalidData = {
          audio: 'not-valid-base64!@#$%',
          format: AudioFormat.MP3
        };
        expect(SecurityValidator.validateAudioData(invalidData)).toBe(false);
      });

      it('should reject invalid audio format', () => {
        const invalidData = {
          audio: Buffer.from('test').toString('base64'),
          format: 'invalid-format'
        };
        expect(SecurityValidator.validateAudioData(invalidData)).toBe(false);
      });

      it('should reject oversized audio chunks', () => {
        // Create a base64 string that would decode to > 10MB
        const largeData = Buffer.alloc(11 * 1024 * 1024).toString('base64');
        const invalidData = {
          audio: largeData,
          format: AudioFormat.MP3
        };
        expect(SecurityValidator.validateAudioData(invalidData)).toBe(false);
      });
    });

    describe('validateSessionId', () => {
      it('should validate valid session IDs', () => {
        expect(SecurityValidator.validateSessionId('session-123')).toBe(true);
        expect(SecurityValidator.validateSessionId('user_456_session')).toBe(true);
        expect(SecurityValidator.validateSessionId('abc123XYZ')).toBe(true);
      });

      it('should reject invalid session IDs', () => {
        expect(SecurityValidator.validateSessionId('')).toBe(false);
        expect(SecurityValidator.validateSessionId(null as any)).toBe(false);
        expect(SecurityValidator.validateSessionId(undefined as any)).toBe(false);
        expect(SecurityValidator.validateSessionId(123 as any)).toBe(false);
      });

      it('should reject session IDs with invalid characters', () => {
        expect(SecurityValidator.validateSessionId('session/123')).toBe(false);
        expect(SecurityValidator.validateSessionId('session\\123')).toBe(false);
        expect(SecurityValidator.validateSessionId('session..123')).toBe(false);
        expect(SecurityValidator.validateSessionId('session<script>')).toBe(false);
      });

      it('should reject overly long session IDs', () => {
        const longId = 'a'.repeat(129);
        expect(SecurityValidator.validateSessionId(longId)).toBe(false);
      });
    });

    describe('sanitizeFilePath', () => {
      it('should sanitize file paths correctly', () => {
        expect(SecurityValidator.sanitizeFilePath('normal-file.mp3')).toBe('normal-file.mp3');
        expect(SecurityValidator.sanitizeFilePath('file with spaces.mp3')).toBe('file-with-spaces.mp3');
        expect(SecurityValidator.sanitizeFilePath('../../../etc/passwd')).toBe('passwd');
        expect(SecurityValidator.sanitizeFilePath('C:\\Windows\\System32\\file.mp3')).toBe('file.mp3');
      });

      it('should handle hidden files', () => {
        expect(SecurityValidator.sanitizeFilePath('.hidden-file')).toBe('audio-hidden-file');
        expect(SecurityValidator.sanitizeFilePath('.env')).toBe('audio-env');
      });
    });

    describe('generateSafeFilename', () => {
      it('should generate safe filenames', () => {
        const filename = SecurityValidator.generateSafeFilename(
          'session-123',
          '2024-01-10T12:00:00.000Z',
          'mp3'
        );
        expect(filename).toMatch(/^audio-session-123-2024-01-10T12-00-00-000Z\.mp3$/);
      });

      it('should sanitize all components', () => {
        const filename = SecurityValidator.generateSafeFilename(
          'session/123',
          '2024:01:10T12:00:00.000Z',
          'mp3<script>'
        );
        expect(filename).toMatch(/^audio-session123-2024-01-10T12-00-00-000Z\.mp3script$/);
      });

      it('should handle PCM format correctly', () => {
        const filename = SecurityValidator.generateSafeFilename(
          'session-123',
          '2024-01-10T12:00:00.000Z',
          'pcm'
        );
        expect(filename).toMatch(/\.raw$/);
      });
    });
  });

  describe('RateLimiter', () => {
    let rateLimiter: RateLimiter;

    beforeEach(() => {
      rateLimiter = new RateLimiter(1000, 3); // 3 requests per second
    });

    it('should allow requests within limit', () => {
      expect(rateLimiter.isAllowed('user1')).toBe(true);
      expect(rateLimiter.isAllowed('user1')).toBe(true);
      expect(rateLimiter.isAllowed('user1')).toBe(true);
    });

    it('should block requests exceeding limit', () => {
      expect(rateLimiter.isAllowed('user1')).toBe(true);
      expect(rateLimiter.isAllowed('user1')).toBe(true);
      expect(rateLimiter.isAllowed('user1')).toBe(true);
      expect(rateLimiter.isAllowed('user1')).toBe(false);
    });

    it('should track different identifiers separately', () => {
      expect(rateLimiter.isAllowed('user1')).toBe(true);
      expect(rateLimiter.isAllowed('user1')).toBe(true);
      expect(rateLimiter.isAllowed('user2')).toBe(true);
      expect(rateLimiter.isAllowed('user2')).toBe(true);
    });

    it('should allow requests after window expires', async () => {
      expect(rateLimiter.isAllowed('user1')).toBe(true);
      expect(rateLimiter.isAllowed('user1')).toBe(true);
      expect(rateLimiter.isAllowed('user1')).toBe(true);
      expect(rateLimiter.isAllowed('user1')).toBe(false);

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      expect(rateLimiter.isAllowed('user1')).toBe(true);
    });

    it('should cleanup old request data', () => {
      rateLimiter.isAllowed('user1');
      rateLimiter.isAllowed('user2');
      rateLimiter.isAllowed('user3');

      // Simulate time passing
      const now = Date.now() + 2000;
      jest.spyOn(Date, 'now').mockReturnValue(now);

      rateLimiter.cleanup();

      // All requests should be cleaned up
      expect(rateLimiter.isAllowed('user1')).toBe(true);
      expect(rateLimiter.isAllowed('user2')).toBe(true);
      expect(rateLimiter.isAllowed('user3')).toBe(true);

      jest.restoreAllMocks();
    });
  });

  describe('MemoryManager', () => {
    let memoryManager: MemoryManager;

    beforeEach(() => {
      memoryManager = new MemoryManager();
    });

    it('should allow allocation within limits', () => {
      expect(memoryManager.canAllocate('session1', 1000000)).toBe(true); // 1MB
      memoryManager.allocate('session1', 1000000);
      expect(memoryManager.canAllocate('session1', 1000000)).toBe(true); // Another 1MB
    });

    it('should reject allocation exceeding per-stream limit', () => {
      const largeSize = 51 * 1024 * 1024; // 51MB
      expect(memoryManager.canAllocate('session1', largeSize)).toBe(false);
    });

    it('should reject allocation exceeding total limit', () => {
      // Allocate close to the total limit
      let allocated = 0;
      for (let i = 0; i < 15; i++) {
        const sessionId = `session${i}`;
        const size = 40 * 1024 * 1024; // 40MB per stream
        if (memoryManager.canAllocate(sessionId, size)) {
          memoryManager.allocate(sessionId, size);
          allocated++;
        }
      }

      // Should have allocated some but not all
      expect(allocated).toBeGreaterThan(0);
      expect(allocated).toBeLessThan(15);

      // Try to allocate more - should fail
      expect(memoryManager.canAllocate('sessionNew', 40 * 1024 * 1024)).toBe(false);
    });

    it('should track memory per session correctly', () => {
      memoryManager.allocate('session1', 1000000);
      memoryManager.allocate('session1', 500000);
      memoryManager.allocate('session2', 2000000);

      const stats = memoryManager.getMemoryStats();
      expect(stats.totalUsed).toBe(3500000);
      expect(stats.streamCount).toBe(2);
    });

    it('should deallocate memory correctly', () => {
      memoryManager.allocate('session1', 1000000);
      memoryManager.allocate('session2', 2000000);
      
      memoryManager.deallocate('session1');
      
      const stats = memoryManager.getMemoryStats();
      expect(stats.totalUsed).toBe(2000000);
      expect(stats.streamCount).toBe(1);
    });

    it('should identify abandoned streams', () => {
      memoryManager.allocate('session1', 1000000);
      memoryManager.allocate('session2', 1000000);

      // Simulate time passing
      const futureTime = Date.now() + 6 * 60 * 1000; // 6 minutes
      jest.spyOn(Date, 'now').mockReturnValue(futureTime);

      const abandoned = memoryManager.getAbandonedStreams();
      expect(abandoned).toContain('session1');
      expect(abandoned).toContain('session2');

      jest.restoreAllMocks();
    });

    it('should update activity timestamp', () => {
      memoryManager.allocate('session1', 1000000);
      
      // Simulate time passing
      const futureTime = Date.now() + 4 * 60 * 1000; // 4 minutes
      jest.spyOn(Date, 'now').mockReturnValue(futureTime);
      
      memoryManager.updateActivity('session1');
      
      // Move another 2 minutes forward
      jest.spyOn(Date, 'now').mockReturnValue(futureTime + 2 * 60 * 1000);
      
      const abandoned = memoryManager.getAbandonedStreams();
      expect(abandoned).not.toContain('session1');

      jest.restoreAllMocks();
    });

    it('should provide accurate memory statistics', () => {
      memoryManager.allocate('session1', 1000000);
      memoryManager.allocate('session2', 2000000);
      memoryManager.updateActivity('session1');

      const stats = memoryManager.getMemoryStats();
      expect(stats.totalUsed).toBe(3000000);
      expect(stats.totalLimit).toBe(500 * 1024 * 1024);
      expect(stats.streamCount).toBe(2);
      expect(stats.streams).toHaveLength(2);
      expect(stats.streams[0].sessionId).toBeDefined();
      expect(stats.streams[0].usage).toBeDefined();
      expect(stats.streams[0].lastActivity).toBeDefined();
    });
  });
});