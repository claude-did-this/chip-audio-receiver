#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudioReceiver = void 0;
const redis_1 = require("redis");
const express_1 = __importDefault(require("express"));
const prom_client_1 = require("prom-client");
const config_1 = require("./config");
const logger_1 = require("./logger");
const types_1 = require("./types");
const metrics_1 = require("./metrics");
const audio_processor_1 = require("./audio-processor");
const resilience_1 = require("./resilience");
class AudioReceiver {
    redisClient = null;
    audioProcessor;
    resilienceManager;
    app;
    isShuttingDown = false;
    startTime = Date.now();
    activeStreams = new Map();
    constructor() {
        this.audioProcessor = new audio_processor_1.AudioProcessor(config_1.config.audio);
        this.resilienceManager = new resilience_1.ResilienceManager(config_1.config.resilience);
        this.app = (0, express_1.default)();
        this.setupExpress();
    }
    async start() {
        try {
            (0, logger_1.logBanner)('CHIP Audio Receiver v2.0.0');
            (0, config_1.validateConfig)();
            (0, logger_1.logSection)('Configuration');
            (0, logger_1.logInfo)('[CONFIG]', 'Settings loaded', {
                redis: `${config_1.config.redis.host}:${config_1.config.redis.port}`,
                channels: config_1.config.channels.responses,
                audioOutput: config_1.config.audio.output.type,
                metricsPort: config_1.config.metrics.port
            });
            (0, logger_1.logSection)('Connections');
            (0, logger_1.logInfo)('[REDIS]', 'Connecting to Redis...');
            await this.connectRedis();
            (0, logger_1.logInfo)('[CHANNEL]', 'Subscribing to channels...');
            await this.subscribeToChannels();
            if (config_1.config.metrics.enabled) {
                (0, logger_1.logInfo)('[METRICS]', 'Starting metrics server...');
                this.startMetricsServer();
            }
            (0, logger_1.logInfo)('[SYSTEM]', 'Setting up graceful shutdown handlers...');
            this.setupGracefulShutdown();
            (0, logger_1.logSection)('Ready');
            (0, logger_1.logSuccess)('Audio Receiver started successfully!');
            (0, logger_1.logInfo)('[HEALTH]', `http://localhost:${config_1.config.metrics.port}/health`);
            (0, logger_1.logInfo)('[METRICS]', `http://localhost:${config_1.config.metrics.port}/metrics`);
            console.log('\n');
        }
        catch (error) {
            logger_1.logger.error('Failed to start audio receiver', { error });
            process.exit(1);
        }
    }
    async connectRedis() {
        this.redisClient = (0, redis_1.createClient)({
            socket: {
                host: config_1.config.redis.host,
                port: config_1.config.redis.port
            },
            password: config_1.config.redis.password
        });
        this.redisClient.on('error', (err) => {
            (0, logger_1.logError)('Redis connection error', err);
            this.resilienceManager.handleError(err);
        });
        this.redisClient.on('connect', () => {
            (0, logger_1.logSuccess)('Connected to Redis', {
                host: config_1.config.redis.host,
                port: config_1.config.redis.port
            });
            this.resilienceManager.resetRetryCount();
        });
        this.redisClient.on('disconnect', () => {
            logger_1.logger.warn('[REDIS] Disconnected from Redis');
            if (!this.isShuttingDown) {
                (0, logger_1.logInfo)('[REDIS]', 'Attempting to reconnect...');
                this.resilienceManager.scheduleReconnect(() => this.connectRedis());
            }
        });
        await this.redisClient.connect();
    }
    async subscribeToChannels() {
        if (!this.redisClient)
            return;
        // Subscribe to voice responses
        await this.redisClient.subscribe(config_1.config.channels.responses, (message) => {
            this.handleVoiceResponse(message);
        });
        // Subscribe to health messages
        await this.redisClient.subscribe(config_1.config.channels.health, (message) => {
            this.handleHealthMessage(message);
        });
        (0, logger_1.logSuccess)('Subscribed to Redis channels', {
            voiceResponses: config_1.config.channels.responses,
            healthMonitoring: config_1.config.channels.health
        });
    }
    handleVoiceResponse(message) {
        try {
            const response = JSON.parse(message);
            logger_1.logger.debug('Received voice response', {
                id: response.id,
                type: response.type,
                service: response.service,
                sessionId: response.sessionId,
                timestamp: response.timestamp
            });
            switch (response.type) {
                case types_1.MessageType.AUDIO_OUTPUT:
                    this.handleAudioOutput(response);
                    break;
                case types_1.MessageType.STATUS:
                    this.handleStatus(response);
                    break;
                case types_1.MessageType.ERROR:
                    this.handleError(response);
                    break;
                default:
                    logger_1.logger.warn('Unknown message type', { type: response.type });
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to parse voice response', { error, message });
        }
    }
    async handleAudioOutput(message) {
        const { id, sessionId, service, data, metadata } = message;
        // Initialize stream if first chunk
        if (metadata.isFirst) {
            (0, logger_1.logInfo)('[AUDIO]', 'New stream started', {
                id,
                sessionId,
                service,
                format: data.format,
                sampleRate: `${metadata.sampleRate}Hz`,
                correlationId: metadata.correlationId,
                output: config_1.config.audio.output.type
            });
            const stream = await this.audioProcessor.createStream(sessionId, data.format, metadata.sampleRate);
            this.activeStreams.set(sessionId, stream);
        }
        // Process audio chunk
        const audioBuffer = Buffer.from(data.audio, 'base64');
        try {
            await this.audioProcessor.processChunk(sessionId, audioBuffer, data.format);
            // Handle subtitles if present
            if (metadata.subtitles) {
                (0, logger_1.logInfo)('[SUBTITLE]', metadata.subtitles.text, {
                    sessionId,
                    timing: `${metadata.subtitles.startTime}-${metadata.subtitles.endTime}ms`
                });
            }
            // Finalize stream if last chunk
            if (metadata.isFinal) {
                (0, logger_1.logSuccess)('Stream completed', {
                    id,
                    sessionId,
                    duration: `${(Date.now() - this.activeStreams.get(sessionId)?.startTime || 0) / 1000}s`
                });
                await this.audioProcessor.finalizeStream(sessionId);
                this.activeStreams.delete(sessionId);
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to process audio chunk', { error, sessionId, messageId: id });
            this.resilienceManager.handleError(error);
        }
    }
    handleStatus(message) {
        const { id, sessionId, service, timestamp, data } = message;
        logger_1.logger.info('Status update', {
            id,
            sessionId,
            service,
            timestamp,
            status: data.status,
            message: data.message,
            progress: data.progress
        });
        // Update metrics based on status
        if (data.status === types_1.StatusValue.COMPLETED) {
            // Update completion metrics
        }
    }
    handleError(message) {
        const { id, sessionId, service, timestamp, error } = message;
        logger_1.logger.error('Voice service error', {
            id,
            sessionId,
            service,
            timestamp,
            code: error.code,
            message: error.message,
            details: error.details
        });
        // Clean up any active streams for this session
        if (this.activeStreams.has(sessionId)) {
            this.activeStreams.delete(sessionId);
            logger_1.logger.info('Cleaned up active stream due to error', { sessionId });
        }
    }
    handleHealthMessage(message) {
        try {
            const health = JSON.parse(message);
            if (health.service === 'voice') {
                logger_1.logger.debug('Voice service health', health);
                // Update health metrics
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to parse health message', { error });
        }
    }
    setupExpress() {
        this.app.use(express_1.default.json());
        // Health check endpoint
        this.app.get('/health', (_req, res) => {
            const health = {
                status: this.redisClient?.isOpen ? 'healthy' : 'unhealthy',
                uptime: Date.now() - this.startTime,
                activeStreams: this.activeStreams.size,
                timestamp: new Date().toISOString()
            };
            const statusCode = health.status === 'healthy' ? 200 : 503;
            res.status(statusCode).json(health);
        });
        // Metrics endpoint
        this.app.get('/metrics', async (_req, res) => {
            try {
                const metrics = await prom_client_1.register.metrics();
                res.set('Content-Type', prom_client_1.register.contentType);
                res.send(metrics);
            }
            catch (error) {
                res.status(500).send('Error collecting metrics');
            }
        });
    }
    startMetricsServer() {
        this.app.listen(config_1.config.metrics.port, () => {
            (0, logger_1.logSuccess)(`Metrics server started on port ${config_1.config.metrics.port}`);
        });
    }
    setupGracefulShutdown() {
        const shutdown = async (signal) => {
            (0, logger_1.logSection)('Shutdown');
            (0, logger_1.logInfo)('[SIGNAL]', `Received ${signal}, shutting down gracefully...`);
            this.isShuttingDown = true;
            // Close active streams
            for (const [sessionId] of this.activeStreams) {
                await this.audioProcessor.finalizeStream(sessionId);
            }
            // Disconnect from Redis
            if (this.redisClient) {
                await this.redisClient.disconnect();
            }
            // Cleanup audio processor
            await this.audioProcessor.cleanup();
            (0, logger_1.logSuccess)('Shutdown complete');
            process.exit(0);
        };
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
    }
}
exports.AudioReceiver = AudioReceiver;
// Main entry point
if (require.main === module) {
    console.clear();
    (0, logger_1.logInfo)('[STARTUP]', 'Initializing CHIP Audio Receiver...');
    (0, logger_1.logInfo)('[NODE]', `Version ${process.version}`);
    (0, logger_1.logInfo)('[ENV]', process.env.NODE_ENV || 'development');
    (0, metrics_1.setupMetrics)();
    const receiver = new AudioReceiver();
    receiver.start().catch((error) => {
        (0, logger_1.logError)('Fatal error during startup', error);
        process.exit(1);
    });
}
//# sourceMappingURL=index.js.map