# CHIP Audio Receiver

Production-ready audio receiver for the CHIP Voice Service with raw PCM support, Prometheus metrics, and self-healing capabilities.

## Features

- ✅ Raw PCM audio support (32-bit float, 44.1kHz)
- ✅ MP3 audio support
- ✅ Redis pub/sub integration with CHIP Voice Service
- ✅ Prometheus metrics endpoint at `/metrics`
- ✅ Health check endpoint at `/health`
- ✅ Circuit breaker pattern for resilience
- ✅ Automatic reconnection with exponential backoff
- ✅ Multiple audio output options (speaker, ffplay, VLC, file)
- ✅ Real-time subtitle support
- ✅ Comprehensive logging with Winston
- ✅ TypeScript for type safety

## Prerequisites

- Node.js 16+ 
- Redis server
- Audio output (one of):
  - Node.js speaker module (requires build tools)
  - FFmpeg with ffplay
  - VLC media player

## Installation

```bash
npm install
npm run build
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Key configuration options:

- `REDIS_HOST`: Redis server host
- `REDIS_PORT`: Redis server port
- `AUDIO_OUTPUT_TYPE`: Output method (speaker/ffplay/vlc/file)
- `METRICS_PORT`: Prometheus metrics port

## Usage

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

### With Docker

```bash
docker build -t chip-audio-receiver .
docker run -e REDIS_HOST=your-redis-host chip-audio-receiver
```

## Audio Formats

### PCM (Cartesia)
- Format: 32-bit float PCM
- Sample Rate: 44100 Hz
- Channels: Mono
- Endianness: Little-endian

### MP3 (Azure)
- Bitrate: Variable
- Sample Rate: 24000 Hz (typical)
- Channels: Mono

## Monitoring

### Prometheus Metrics

Available at `http://localhost:9090/metrics`:

- `audio_chunks_received_total`: Total audio chunks received
- `audio_bytes_processed_total`: Total bytes processed
- `audio_stream_duration_seconds`: Stream duration histogram
- `active_audio_streams`: Currently active streams
- `redis_connection_status`: Redis connection health
- `circuit_breaker_state`: Circuit breaker status

### Health Check

Available at `http://localhost:9090/health`:

```json
{
  "status": "healthy",
  "uptime": 3600000,
  "activeStreams": 2,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Development

### Running Tests

```bash
npm test
```

### Linting

```bash
npm run lint
```

### Type Checking

```bash
npm run typecheck
```

## Architecture

The receiver subscribes to Redis channels and processes audio messages from the CHIP Voice Service:

1. **Redis Subscriber**: Listens to `chip.voice.responses` for audio data
2. **Audio Processor**: Handles PCM/MP3 decoding and playback
3. **Resilience Manager**: Implements circuit breaker and retry logic
4. **Metrics Collector**: Exposes Prometheus metrics
5. **Health Monitor**: Tracks service health and dependencies

## Troubleshooting

### No Audio Output

1. Check Redis connection: `redis-cli ping`
2. Verify audio output device: `AUDIO_OUTPUT_TYPE` in `.env`
3. Check logs for errors: `LOG_LEVEL=debug`

### High Memory Usage

1. Reduce buffer size: `AUDIO_BUFFER_SIZE=2048`
2. Disable file saving: `SAVE_TO_FILE=false`

### Connection Issues

1. Check Redis credentials
2. Verify network connectivity
3. Monitor circuit breaker state in metrics

## License

MIT