import * as path from 'path';
import { AudioData, AudioFormat } from './types';
import { logger } from './logger';

export class SecurityValidator {
  private static readonly MAX_AUDIO_CHUNK_SIZE = 10 * 1024 * 1024; // 10MB per chunk
  private static readonly MAX_SESSION_ID_LENGTH = 128;
  private static readonly VALID_AUDIO_FORMATS = Object.values(AudioFormat);

  static validateAudioData(data: AudioData): boolean {
    try {
      if (!data || typeof data !== 'object') {
        logger.warn('Invalid audio data: not an object');
        return false;
      }

      if (!data.audio || typeof data.audio !== 'string') {
        logger.warn('Invalid audio data: missing or invalid audio field');
        return false;
      }

      if (!this.isValidBase64(data.audio)) {
        logger.warn('Invalid audio data: not valid base64');
        return false;
      }

      const decodedSize = this.getBase64DecodedSize(data.audio);
      if (decodedSize > this.MAX_AUDIO_CHUNK_SIZE) {
        logger.warn('Audio chunk exceeds maximum size', { 
          size: decodedSize, 
          maxSize: this.MAX_AUDIO_CHUNK_SIZE 
        });
        return false;
      }

      if (!data.format || !this.VALID_AUDIO_FORMATS.includes(data.format as AudioFormat)) {
        logger.warn('Invalid audio format', { format: data.format });
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Error validating audio data', { error });
      return false;
    }
  }

  static validateSessionId(sessionId: string): boolean {
    if (!sessionId || typeof sessionId !== 'string') {
      return false;
    }

    if (sessionId.length > this.MAX_SESSION_ID_LENGTH) {
      return false;
    }

    // Allow alphanumeric, hyphens, and underscores
    return /^[a-zA-Z0-9-_]+$/.test(sessionId);
  }

  static sanitizeFilePath(filename: string): string {
    // Extract just the filename without any path components
    const basename = path.basename(filename);
    
    // Remove any potentially dangerous characters
    const sanitized = basename.replace(/[^a-zA-Z0-9.-]/g, '-');
    
    // Ensure it doesn't start with a dot (hidden file)
    if (sanitized.startsWith('.')) {
      return 'audio-' + sanitized.substring(1);
    }
    
    return sanitized;
  }

  static generateSafeFilename(sessionId: string, timestamp: string, format: string): string {
    // Sanitize each component
    const safeSessionId = sessionId.replace(/[^a-zA-Z0-9-]/g, '');
    const safeTimestamp = timestamp.replace(/[:.]/g, '-');
    const safeFormat = format.replace(/[^a-zA-Z0-9]/g, '');
    
    // Ensure the extension is valid
    const extension = safeFormat === 'pcm' ? 'raw' : safeFormat;
    
    return `audio-${safeSessionId}-${safeTimestamp}.${extension}`;
  }

  private static isValidBase64(str: string): boolean {
    try {
      // Check if string matches base64 pattern
      const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
      if (!base64Regex.test(str)) {
        return false;
      }
      
      // Try to decode to verify it's valid
      Buffer.from(str, 'base64');
      return true;
    } catch {
      return false;
    }
  }

  private static getBase64DecodedSize(base64: string): number {
    // Calculate the decoded size without actually decoding
    const padding = (base64.match(/=/g) || []).length;
    return Math.floor((base64.length * 3) / 4) - padding;
  }
}

export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(windowMs: number = 60000, maxRequests: number = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  isAllowed(identifier: string): boolean {
    const now = Date.now();
    const requests = this.requests.get(identifier) || [];
    
    // Remove old requests outside the window
    const validRequests = requests.filter(time => now - time < this.windowMs);
    
    if (validRequests.length >= this.maxRequests) {
      this.requests.set(identifier, validRequests);
      return false;
    }
    
    validRequests.push(now);
    this.requests.set(identifier, validRequests);
    return true;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [identifier, requests] of this.requests.entries()) {
      const validRequests = requests.filter(time => now - time < this.windowMs);
      if (validRequests.length === 0) {
        this.requests.delete(identifier);
      } else {
        this.requests.set(identifier, validRequests);
      }
    }
  }
}

export class MemoryManager {
  private static readonly MAX_BUFFER_SIZE = 50 * 1024 * 1024; // 50MB per stream
  private static readonly MAX_TOTAL_MEMORY = 500 * 1024 * 1024; // 500MB total
  private static readonly STREAM_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  
  private totalMemoryUsed = 0;
  private streamMemoryUsage = new Map<string, number>();
  private streamLastActivity = new Map<string, number>();

  canAllocate(sessionId: string, size: number): boolean {
    const currentStreamUsage = this.streamMemoryUsage.get(sessionId) || 0;
    
    // Check if this would exceed per-stream limit
    if (currentStreamUsage + size > MemoryManager.MAX_BUFFER_SIZE) {
      logger.warn('Stream buffer size limit exceeded', {
        sessionId,
        currentUsage: currentStreamUsage,
        requestedSize: size,
        limit: MemoryManager.MAX_BUFFER_SIZE
      });
      return false;
    }
    
    // Check if this would exceed total memory limit
    if (this.totalMemoryUsed + size > MemoryManager.MAX_TOTAL_MEMORY) {
      logger.warn('Total memory limit exceeded', {
        totalUsage: this.totalMemoryUsed,
        requestedSize: size,
        limit: MemoryManager.MAX_TOTAL_MEMORY
      });
      return false;
    }
    
    return true;
  }

  allocate(sessionId: string, size: number): void {
    const currentUsage = this.streamMemoryUsage.get(sessionId) || 0;
    this.streamMemoryUsage.set(sessionId, currentUsage + size);
    this.totalMemoryUsed += size;
    this.streamLastActivity.set(sessionId, Date.now());
  }

  deallocate(sessionId: string): void {
    const usage = this.streamMemoryUsage.get(sessionId) || 0;
    this.totalMemoryUsed -= usage;
    this.streamMemoryUsage.delete(sessionId);
    this.streamLastActivity.delete(sessionId);
  }

  getAbandonedStreams(): string[] {
    const now = Date.now();
    const abandoned: string[] = [];
    
    for (const [sessionId, lastActivity] of this.streamLastActivity.entries()) {
      if (now - lastActivity > MemoryManager.STREAM_TIMEOUT) {
        abandoned.push(sessionId);
      }
    }
    
    return abandoned;
  }

  updateActivity(sessionId: string): void {
    this.streamLastActivity.set(sessionId, Date.now());
  }

  getMemoryStats(): {
    totalUsed: number;
    totalLimit: number;
    streamCount: number;
    streams: Array<{
      sessionId: string;
      usage: number;
      lastActivity: number | undefined;
    }>;
  } {
    return {
      totalUsed: this.totalMemoryUsed,
      totalLimit: MemoryManager.MAX_TOTAL_MEMORY,
      streamCount: this.streamMemoryUsage.size,
      streams: Array.from(this.streamMemoryUsage.entries()).map(([sessionId, usage]) => ({
        sessionId,
        usage,
        lastActivity: this.streamLastActivity.get(sessionId)
      }))
    };
  }
}