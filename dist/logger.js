"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logInfo = exports.logError = exports.logSuccess = exports.logSection = exports.logBanner = exports.logger = void 0;
const pino_1 = __importDefault(require("pino"));
const config_1 = require("./config");
const isProduction = process.env.NODE_ENV === 'production';
const isPretty = process.env.LOG_PRETTY === 'true' || (!isProduction && process.stdout.isTTY);
// Create logger based on environment
exports.logger = isPretty ?
    (0, pino_1.default)({
        level: config_1.config.logging.level,
        base: {
            service: 'audio-receiver',
            version: '2.0.0'
        },
        transport: {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'HH:MM:ss',
                ignore: 'pid,hostname,service,version,time',
                messageFormat: '{msg}',
                singleLine: true
            }
        }
    }) :
    (0, pino_1.default)({
        level: config_1.config.logging.level,
        base: {
            service: 'audio-receiver',
            version: '2.0.0'
        },
        timestamp: pino_1.default.stdTimeFunctions.isoTime,
        formatters: {
            level: (label) => {
                return { level: label };
            }
        }
    });
// Add custom logging methods for styled output
const logBanner = (title) => {
    if (isPretty) {
        console.log('\n┌─────────────────────────────────────────────────┐');
        console.log(`│${title.padStart(33).padEnd(49)}│`);
        console.log('└─────────────────────────────────────────────────┘\n');
    }
    else {
        exports.logger.info(title);
    }
};
exports.logBanner = logBanner;
const logSection = (message) => {
    if (isPretty) {
        console.log(`\n▶ ${message}\n`);
    }
    else {
        exports.logger.info(message);
    }
};
exports.logSection = logSection;
const logSuccess = (message, details) => {
    if (isPretty) {
        console.log(`✓ ${message}`);
        if (details) {
            Object.entries(details).forEach(([key, value]) => {
                console.log(`  ${key}: ${value}`);
            });
        }
    }
    else {
        exports.logger.info(message, details);
    }
};
exports.logSuccess = logSuccess;
const logError = (message, error) => {
    if (isPretty) {
        console.log(`✗ ${message}`);
        if (error) {
            console.log(`  Error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    else {
        exports.logger.error(message, error);
    }
};
exports.logError = logError;
const logInfo = (icon, message, details) => {
    if (isPretty) {
        console.log(`${icon} ${message}`);
        if (details) {
            Object.entries(details).forEach(([key, value]) => {
                console.log(`  ${key}: ${value}`);
            });
        }
    }
    else {
        exports.logger.info(message, details);
    }
};
exports.logInfo = logInfo;
exports.default = exports.logger;
//# sourceMappingURL=logger.js.map