export declare enum CircuitState {
    CLOSED = "CLOSED",
    OPEN = "OPEN",
    HALF_OPEN = "HALF_OPEN"
}
interface CircuitBreakerOptions {
    failureThreshold: number;
    resetTimeout: number;
    monitoringPeriod: number;
}
export declare class CircuitBreaker {
    private state;
    private failureCount;
    private lastFailureTime?;
    private successCount;
    private readonly options;
    constructor(options?: Partial<CircuitBreakerOptions>);
    execute<T>(operation: () => Promise<T>): Promise<T>;
    private shouldAttemptReset;
    private onSuccess;
    private onFailure;
    getState(): CircuitState;
    reset(): void;
}
export declare class ResilienceManager {
    private circuitBreaker;
    private reconnectAttempts;
    private reconnectTimeout?;
    private readonly config;
    constructor(config: any);
    executeWithResilience<T>(operation: () => Promise<T>): Promise<T>;
    scheduleReconnect(reconnectFn: () => Promise<void>): void;
    handleError(error: any): void;
    private isRetryableError;
    resetRetryCount(): void;
    getCircuitState(): CircuitState;
    getMetrics(): {
        circuitState: CircuitState;
        reconnectAttempts: number;
        isReconnecting: boolean;
    };
}
export {};
//# sourceMappingURL=resilience.d.ts.map