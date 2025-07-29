"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.voiceServiceUptime = exports.voiceServiceHealth = exports.audioBufferSize = exports.audioLatency = exports.memoryUsage = exports.uptime = exports.circuitBreakerState = exports.errorCount = exports.redisMessagesReceived = exports.redisReconnectAttempts = exports.redisConnectionStatus = exports.activeStreams = exports.audioStreamDuration = exports.audioBytesProcessed = exports.audioChunksReceived = void 0;
exports.setupMetrics = setupMetrics;
exports.updateCircuitBreakerMetrics = updateCircuitBreakerMetrics;
const prom_client_1 = require("prom-client");
// Audio processing metrics
exports.audioChunksReceived = new prom_client_1.Counter({
    name: 'audio_chunks_received_total',
    help: 'Total number of audio chunks received',
    labelNames: ['format', 'session_id']
});
exports.audioBytesProcessed = new prom_client_1.Counter({
    name: 'audio_bytes_processed_total',
    help: 'Total bytes of audio processed',
    labelNames: ['format', 'session_id']
});
exports.audioStreamDuration = new prom_client_1.Histogram({
    name: 'audio_stream_duration_seconds',
    help: 'Duration of audio streams in seconds',
    labelNames: ['format'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120]
});
exports.activeStreams = new prom_client_1.Gauge({
    name: 'active_audio_streams',
    help: 'Number of currently active audio streams',
    labelNames: ['format']
});
// Redis connection metrics
exports.redisConnectionStatus = new prom_client_1.Gauge({
    name: 'redis_connection_status',
    help: 'Redis connection status (1=connected, 0=disconnected)'
});
exports.redisReconnectAttempts = new prom_client_1.Counter({
    name: 'redis_reconnect_attempts_total',
    help: 'Total number of Redis reconnection attempts'
});
exports.redisMessagesReceived = new prom_client_1.Counter({
    name: 'redis_messages_received_total',
    help: 'Total number of messages received from Redis',
    labelNames: ['channel', 'message_type']
});
// Error metrics
exports.errorCount = new prom_client_1.Counter({
    name: 'audio_receiver_errors_total',
    help: 'Total number of errors',
    labelNames: ['error_type', 'retryable']
});
// Circuit breaker metrics
exports.circuitBreakerState = new prom_client_1.Gauge({
    name: 'circuit_breaker_state',
    help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)'
});
// System metrics
exports.uptime = new prom_client_1.Gauge({
    name: 'audio_receiver_uptime_seconds',
    help: 'Uptime of the audio receiver in seconds'
});
exports.memoryUsage = new prom_client_1.Gauge({
    name: 'audio_receiver_memory_usage_bytes',
    help: 'Memory usage of the audio receiver',
    labelNames: ['type']
});
// Audio quality metrics
exports.audioLatency = new prom_client_1.Histogram({
    name: 'audio_processing_latency_seconds',
    help: 'Latency between receiving and playing audio',
    labelNames: ['format'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2]
});
exports.audioBufferSize = new prom_client_1.Gauge({
    name: 'audio_buffer_size_bytes',
    help: 'Current size of audio buffer',
    labelNames: ['session_id']
});
// Voice service health metrics
exports.voiceServiceHealth = new prom_client_1.Gauge({
    name: 'voice_service_health',
    help: 'Health status of the voice service (1=healthy, 0=unhealthy)'
});
exports.voiceServiceUptime = new prom_client_1.Gauge({
    name: 'voice_service_uptime_seconds',
    help: 'Uptime of the voice service'
});
function setupMetrics() {
    // Register all metrics
    prom_client_1.register.registerMetric(exports.audioChunksReceived);
    prom_client_1.register.registerMetric(exports.audioBytesProcessed);
    prom_client_1.register.registerMetric(exports.audioStreamDuration);
    prom_client_1.register.registerMetric(exports.activeStreams);
    prom_client_1.register.registerMetric(exports.redisConnectionStatus);
    prom_client_1.register.registerMetric(exports.redisReconnectAttempts);
    prom_client_1.register.registerMetric(exports.redisMessagesReceived);
    prom_client_1.register.registerMetric(exports.errorCount);
    prom_client_1.register.registerMetric(exports.circuitBreakerState);
    prom_client_1.register.registerMetric(exports.uptime);
    prom_client_1.register.registerMetric(exports.memoryUsage);
    prom_client_1.register.registerMetric(exports.audioLatency);
    prom_client_1.register.registerMetric(exports.audioBufferSize);
    prom_client_1.register.registerMetric(exports.voiceServiceHealth);
    prom_client_1.register.registerMetric(exports.voiceServiceUptime);
    // Update system metrics periodically
    setInterval(() => {
        const usage = process.memoryUsage();
        exports.memoryUsage.set({ type: 'heapUsed' }, usage.heapUsed);
        exports.memoryUsage.set({ type: 'heapTotal' }, usage.heapTotal);
        exports.memoryUsage.set({ type: 'rss' }, usage.rss);
        exports.memoryUsage.set({ type: 'external' }, usage.external);
        exports.uptime.set(process.uptime());
    }, 10000);
}
function updateCircuitBreakerMetrics(state) {
    const stateValue = state === 'CLOSED' ? 0 : state === 'OPEN' ? 1 : 2;
    exports.circuitBreakerState.set(stateValue);
}
//# sourceMappingURL=metrics.js.map