# Security and Memory Management Improvements

This document outlines the security and memory management improvements implemented in the audio receiver application.

## Security Enhancements

### 1. Input Validation for Audio Data
- **Location**: `src/security.ts` - `SecurityValidator.validateAudioData()`
- **Implementation**:
  - Validates audio data is a proper object with required fields
  - Ensures audio field contains valid base64 encoded data
  - Validates audio format against allowed formats (mp3, pcm, opus)
  - Enforces maximum chunk size limit (10MB per chunk)
  - Validates session IDs to prevent injection attacks

### 2. Rate Limiting for HTTP Endpoints
- **Location**: `src/index.ts` - health and metrics endpoints
- **Implementation**:
  - Rate limiter allows 100 requests per minute per IP address
  - Applies to both `/health` and `/metrics` endpoints
  - Returns 429 (Too Many Requests) when limit exceeded
  - Automatically cleans up old request records

### 3. File Path Sanitization
- **Location**: `src/security.ts` - `SecurityValidator.sanitizeFilePath()` and `generateSafeFilename()`
- **Implementation**:
  - Sanitizes filenames to prevent directory traversal attacks
  - Removes potentially dangerous characters
  - Ensures files are saved to a designated output directory
  - Prevents hidden file creation (files starting with '.')

## Memory Management Enhancements

### 4. Audio Buffer Size Limits
- **Location**: `src/security.ts` - `MemoryManager` class
- **Implementation**:
  - Enforces 50MB limit per audio stream
  - Enforces 500MB total memory limit across all streams
  - Checks memory allocation before accepting new chunks
  - Automatically rejects chunks that would exceed limits

### 5. Abandoned Stream Cleanup
- **Location**: `src/index.ts` - `performCleanup()` method
- **Implementation**:
  - Runs cleanup process every 30 seconds
  - Identifies streams inactive for more than 5 minutes
  - Automatically finalizes and removes abandoned streams
  - Frees associated memory allocations

### 6. Memory Leak Prevention
- **Location**: Throughout `src/index.ts` and `src/audio-processor.ts`
- **Implementation**:
  - Proper cleanup of all resources on stream finalization
  - Memory deallocation when streams are closed or encounter errors
  - Cleanup interval is properly cleared on shutdown
  - All active streams are finalized during graceful shutdown

## Additional Security Measures

### Session ID Validation
- Validates session IDs are alphanumeric with hyphens/underscores only
- Limits session ID length to 128 characters
- Rejects messages with invalid session IDs

### Error Handling
- Graceful error handling prevents information leakage
- Proper logging without exposing sensitive data
- Failed validations are logged but don't crash the application

### Resource Management
- Automatic cleanup of rate limiter data
- Memory usage statistics available via health endpoint
- Configurable limits via environment variables

## Usage

The security features are automatically enabled. Configuration options:

```env
# Maximum audio chunk size (bytes)
MAX_AUDIO_CHUNK_SIZE=10485760  # 10MB

# Rate limiting
RATE_LIMIT_WINDOW_MS=60000      # 1 minute
RATE_LIMIT_MAX_REQUESTS=100     # requests per window

# Memory limits
MAX_BUFFER_SIZE=52428800        # 50MB per stream
MAX_TOTAL_MEMORY=524288000      # 500MB total

# Stream timeout
STREAM_TIMEOUT_MS=300000        # 5 minutes

# Audio output directory
AUDIO_OUTPUT_DIR=./audio-output
```

## Monitoring

The health endpoint now includes memory usage information:

```json
{
  "status": "healthy",
  "uptime": 123456,
  "activeStreams": 3,
  "memory": {
    "used": 15728640,
    "limit": 524288000,
    "percentage": 3.0
  },
  "timestamp": "2024-01-10T12:00:00.000Z"
}
```

## Testing

All security and memory management features have comprehensive test coverage:
- Input validation tests
- Rate limiting tests
- Memory limit enforcement tests
- Cleanup mechanism tests
- File path sanitization tests

Run tests with: `npm test`