# Phase 2 Implementation - Hybrid Redis/UDP Architecture

## Overview

Phase 2 implements the hybrid Redis/UDP architecture that separates control plane (Redis) from data plane (UDP) to achieve sub-20ms audio latency while maintaining synchronized subtitles.

## What's New in Phase 2

### 1. **Subtitle Synchronization System** (`subtitle-sync-manager.ts`)
- Precise subtitle timing synchronized with TTS timestamps
- Support for multiple display methods (OBS WebSocket, Overlay, Toast)
- Automatic timing adjustment based on network conditions
- Per-session subtitle scheduling and management

### 2. **Redis Control Plane** (`redis-control-plane.ts`)
- Session negotiation via Redis pub/sub
- Control message handling (start, end, timing adjustments)
- Health monitoring and statistics reporting
- Clean separation from audio data transport

### 3. **Connection Negotiation** (`connection-negotiator.ts`)
- Orchestrates the handshake between voice service and Windows service
- Manages session lifecycle and resources
- Coordinates UDP server, sync managers, and subtitle display
- Adaptive network monitoring and jitter buffer adjustment

### 4. **Hybrid Metrics System** (`hybrid-metrics.ts`)
- Comprehensive Prometheus metrics for all components
- Real-time session monitoring
- Network condition tracking
- Health check endpoints

## Architecture

```
Voice Service                     Windows Service
     |                                  |
     |------ Redis Control Plane -------|
     |         (Session Mgmt)           |
     |                                  |
     |------- Direct UDP Audio ---------|
     |         (<20ms latency)          |
```

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure Phase 2 settings:**
   ```bash
   cp .env.phase2.example .env
   # Edit .env with your configuration
   ```

3. **Run Phase 2 demo:**
   ```bash
   npm run dev:phase2
   ```

## Configuration

Key Phase 2 environment variables:

```env
# UDP Audio Streaming
UDP_AUDIO_ENABLED=true
UDP_AUDIO_PORT=8001

# Jitter Buffer
JITTER_BUFFER_TARGET_MS=100
JITTER_BUFFER_ADAPTIVE=true

# Subtitles
SUBTITLES_ENABLED=true
SUBTITLES_METHOD=obs-websocket
OBS_WEBSOCKET_HOST=localhost
OBS_WEBSOCKET_PORT=4455
```

## Session Flow

1. **Voice Service** publishes session start message to Redis
2. **Windows Service** receives message and initializes:
   - UDP listener on specified port
   - Audio sync manager with TTS timing
   - Subtitle sync manager (if enabled)
   - Jitter buffer for network compensation

3. **Voice Service** streams audio packets directly via UDP
4. **Windows Service** processes packets:
   - Jitter buffer smooths network variations
   - Sync manager schedules precise playback
   - Subtitles display at exact timestamps

5. Session ends cleanly with statistics reporting

## Monitoring

Access monitoring endpoints:

- **Health Check:** http://localhost:9090/health
- **Prometheus Metrics:** http://localhost:9090/metrics
- **Session Details:** http://localhost:9090/metrics/sessions

## Key Metrics

- `audio_udp_latency_ms` - End-to-end UDP latency
- `audio_sync_drift_ms` - Audio synchronization accuracy
- `subtitle_sync_error_ms` - Subtitle timing precision
- `audio_jitter_buffer_size_ms` - Current buffer size
- `audio_network_packet_loss_ratio` - Packet loss rate

## Testing

To test the Phase 2 implementation:

1. Start the Windows service: `npm run dev:phase2`
2. Send a session start message via Redis
3. Stream UDP audio packets to the configured port
4. Monitor metrics and logs for performance

## Next Steps

Phase 3 will add:
- VTube Studio WebSocket integration
- Windows system tray service
- Configuration GUI
- MSI installer package

## Troubleshooting

### High Latency
- Check jitter buffer settings (reduce target buffer)
- Verify network path between services
- Monitor `audio_udp_latency_ms` metric

### Subtitle Desync
- Ensure TTS timestamps are accurate
- Check system clock synchronization
- Adjust `SUBTITLES_DISPLAY_DURATION`

### Connection Issues
- Verify Redis connectivity
- Check UDP port availability
- Review firewall settings