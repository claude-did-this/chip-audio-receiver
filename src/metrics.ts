import { Counter, Gauge, Histogram, register } from 'prom-client';

// Audio processing metrics
export const audioChunksReceived = new Counter({
  name: 'audio_chunks_received_total',
  help: 'Total number of audio chunks received',
  labelNames: ['format', 'session_id']
});

export const audioBytesProcessed = new Counter({
  name: 'audio_bytes_processed_total',
  help: 'Total bytes of audio processed',
  labelNames: ['format', 'session_id']
});

export const audioStreamDuration = new Histogram({
  name: 'audio_stream_duration_seconds',
  help: 'Duration of audio streams in seconds',
  labelNames: ['format'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120]
});

export const activeStreams = new Gauge({
  name: 'active_audio_streams',
  help: 'Number of currently active audio streams',
  labelNames: ['format']
});

// Redis connection metrics
export const redisConnectionStatus = new Gauge({
  name: 'redis_connection_status',
  help: 'Redis connection status (1=connected, 0=disconnected)'
});

export const redisReconnectAttempts = new Counter({
  name: 'redis_reconnect_attempts_total',
  help: 'Total number of Redis reconnection attempts'
});

export const redisMessagesReceived = new Counter({
  name: 'redis_messages_received_total',
  help: 'Total number of messages received from Redis',
  labelNames: ['channel', 'message_type']
});

// Error metrics
export const errorCount = new Counter({
  name: 'audio_receiver_errors_total',
  help: 'Total number of errors',
  labelNames: ['error_type', 'retryable']
});

// Circuit breaker metrics
export const circuitBreakerState = new Gauge({
  name: 'circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)'
});

// System metrics
export const uptime = new Gauge({
  name: 'audio_receiver_uptime_seconds',
  help: 'Uptime of the audio receiver in seconds'
});

export const memoryUsage = new Gauge({
  name: 'audio_receiver_memory_usage_bytes',
  help: 'Memory usage of the audio receiver',
  labelNames: ['type']
});

// Audio quality metrics
export const audioLatency = new Histogram({
  name: 'audio_processing_latency_seconds',
  help: 'Latency between receiving and playing audio',
  labelNames: ['format'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2]
});

export const audioBufferSize = new Gauge({
  name: 'audio_buffer_size_bytes',
  help: 'Current size of audio buffer',
  labelNames: ['session_id']
});

// Voice service health metrics
export const voiceServiceHealth = new Gauge({
  name: 'voice_service_health',
  help: 'Health status of the voice service (1=healthy, 0=unhealthy)'
});

export const voiceServiceUptime = new Gauge({
  name: 'voice_service_uptime_seconds',
  help: 'Uptime of the voice service'
});

export function setupMetrics(): void {
  // Register all metrics
  register.registerMetric(audioChunksReceived);
  register.registerMetric(audioBytesProcessed);
  register.registerMetric(audioStreamDuration);
  register.registerMetric(activeStreams);
  register.registerMetric(redisConnectionStatus);
  register.registerMetric(redisReconnectAttempts);
  register.registerMetric(redisMessagesReceived);
  register.registerMetric(errorCount);
  register.registerMetric(circuitBreakerState);
  register.registerMetric(uptime);
  register.registerMetric(memoryUsage);
  register.registerMetric(audioLatency);
  register.registerMetric(audioBufferSize);
  register.registerMetric(voiceServiceHealth);
  register.registerMetric(voiceServiceUptime);

  // Update system metrics periodically
  setInterval(() => {
    const usage = process.memoryUsage();
    memoryUsage.set({ type: 'heapUsed' }, usage.heapUsed);
    memoryUsage.set({ type: 'heapTotal' }, usage.heapTotal);
    memoryUsage.set({ type: 'rss' }, usage.rss);
    memoryUsage.set({ type: 'external' }, usage.external);
    
    uptime.set(process.uptime());
  }, 10000);
}

export function updateCircuitBreakerMetrics(state: string): void {
  const stateValue = state === 'CLOSED' ? 0 : state === 'OPEN' ? 1 : 2;
  circuitBreakerState.set(stateValue);
}