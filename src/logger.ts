import pino from 'pino';
import { config } from './config';

const isProduction = process.env.NODE_ENV === 'production';
const isPretty = process.env.LOG_PRETTY === 'true' || (!isProduction && process.stdout.isTTY);

// Create logger based on environment
export const logger = isPretty ? 
  pino({
    level: config.logging.level,
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
  pino({
    level: config.logging.level,
    base: {
      service: 'audio-receiver',
      version: '2.0.0'
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => {
        return { level: label };
      }
    }
  });

// Add custom logging methods for styled output
export const logBanner = (title: string) => {
  if (isPretty) {
    console.log('\n┌─────────────────────────────────────────────────┐');
    console.log(`│${title.padStart(33).padEnd(49)}│`);
    console.log('└─────────────────────────────────────────────────┘\n');
  } else {
    logger.info(title);
  }
};

export const logSection = (message: string) => {
  if (isPretty) {
    console.log(`\n▶ ${message}\n`);
  } else {
    logger.info(message);
  }
};

export const logSuccess = (message: string, details?: any) => {
  if (isPretty) {
    console.log(`✓ ${message}`);
    if (details) {
      Object.entries(details).forEach(([key, value]) => {
        console.log(`  ${key}: ${value}`);
      });
    }
  } else {
    logger.info(message, details);
  }
};

export const logError = (message: string, error?: any) => {
  if (isPretty) {
    console.log(`✗ ${message}`);
    if (error) {
      console.log(`  Error: ${error.message || error}`);
    }
  } else {
    logger.error(message, error);
  }
};

export const logInfo = (icon: string, message: string, details?: any) => {
  if (isPretty) {
    console.log(`${icon} ${message}`);
    if (details) {
      Object.entries(details).forEach(([key, value]) => {
        console.log(`  ${key}: ${value}`);
      });
    }
  } else {
    logger.info(message, details);
  }
};

export default logger;