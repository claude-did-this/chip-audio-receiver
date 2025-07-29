#!/usr/bin/env node
declare class AudioReceiver {
    private redisClient;
    private audioProcessor;
    private resilienceManager;
    private app;
    private isShuttingDown;
    private startTime;
    private activeStreams;
    constructor();
    start(): Promise<void>;
    private connectRedis;
    private subscribeToChannels;
    private handleVoiceResponse;
    private handleAudioOutput;
    private handleStatus;
    private handleError;
    private handleHealthMessage;
    private setupExpress;
    private startMetricsServer;
    private setupGracefulShutdown;
}
export { AudioReceiver };
//# sourceMappingURL=index.d.ts.map