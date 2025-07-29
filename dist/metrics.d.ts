import { Counter, Gauge, Histogram } from 'prom-client';
export declare const audioChunksReceived: Counter<"format" | "session_id">;
export declare const audioBytesProcessed: Counter<"format" | "session_id">;
export declare const audioStreamDuration: Histogram<"format">;
export declare const activeStreams: Gauge<"format">;
export declare const redisConnectionStatus: Gauge<string>;
export declare const redisReconnectAttempts: Counter<string>;
export declare const redisMessagesReceived: Counter<"channel" | "message_type">;
export declare const errorCount: Counter<"error_type" | "retryable">;
export declare const circuitBreakerState: Gauge<string>;
export declare const uptime: Gauge<string>;
export declare const memoryUsage: Gauge<"type">;
export declare const audioLatency: Histogram<"format">;
export declare const audioBufferSize: Gauge<"session_id">;
export declare const voiceServiceHealth: Gauge<string>;
export declare const voiceServiceUptime: Gauge<string>;
export declare function setupMetrics(): void;
export declare function updateCircuitBreakerMetrics(state: string): void;
//# sourceMappingURL=metrics.d.ts.map