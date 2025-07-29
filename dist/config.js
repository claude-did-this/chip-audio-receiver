"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.validateConfig = validateConfig;
const dotenv = __importStar(require("dotenv"));
dotenv.config();
exports.config = {
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD
    },
    channels: {
        responses: process.env.VOICE_RESPONSE_CHANNEL || 'chip.voice.responses',
        health: process.env.HEALTH_CHANNEL || 'chip.services.health'
    },
    audio: {
        output: {
            type: process.env.AUDIO_OUTPUT_TYPE || 'speaker',
            device: process.env.AUDIO_DEVICE
        },
        bufferSize: parseInt(process.env.AUDIO_BUFFER_SIZE || '4096', 10),
        saveToFile: process.env.SAVE_TO_FILE === 'true'
    },
    metrics: {
        port: parseInt(process.env.METRICS_PORT || '9090', 10),
        enabled: process.env.METRICS_ENABLED !== 'false'
    },
    resilience: {
        reconnectMaxAttempts: parseInt(process.env.RECONNECT_MAX_ATTEMPTS || '10', 10),
        reconnectBaseDelay: parseInt(process.env.RECONNECT_BASE_DELAY || '1000', 10),
        reconnectMaxDelay: parseInt(process.env.RECONNECT_MAX_DELAY || '30000', 10),
        healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '5000', 10)
    },
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        format: process.env.LOG_FORMAT || 'json'
    }
};
function validateConfig() {
    if (!exports.config.redis.host) {
        throw new Error('REDIS_HOST is required');
    }
    const validAudioTypes = ['speaker', 'ffplay', 'vlc', 'file'];
    if (!validAudioTypes.includes(exports.config.audio.output.type)) {
        throw new Error(`Invalid AUDIO_OUTPUT_TYPE. Must be one of: ${validAudioTypes.join(', ')}`);
    }
    if (exports.config.metrics.port < 1 || exports.config.metrics.port > 65535) {
        throw new Error('METRICS_PORT must be between 1 and 65535');
    }
}
//# sourceMappingURL=config.js.map