"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResilienceManager = exports.CircuitBreaker = exports.CircuitState = void 0;
const logger_1 = require("./logger");
var CircuitState;
(function (CircuitState) {
    CircuitState["CLOSED"] = "CLOSED";
    CircuitState["OPEN"] = "OPEN";
    CircuitState["HALF_OPEN"] = "HALF_OPEN";
})(CircuitState || (exports.CircuitState = CircuitState = {}));
class CircuitBreaker {
    state = CircuitState.CLOSED;
    failureCount = 0;
    lastFailureTime;
    successCount = 0;
    options;
    constructor(options = {}) {
        this.options = {
            failureThreshold: options.failureThreshold || 5,
            resetTimeout: options.resetTimeout || 60000, // 1 minute
            monitoringPeriod: options.monitoringPeriod || 10000 // 10 seconds
        };
    }
    async execute(operation) {
        if (this.state === CircuitState.OPEN) {
            if (this.shouldAttemptReset()) {
                this.state = CircuitState.HALF_OPEN;
                logger_1.logger.info('Circuit breaker entering HALF_OPEN state');
            }
            else {
                throw new Error('Circuit breaker is OPEN');
            }
        }
        try {
            const result = await operation();
            this.onSuccess();
            return result;
        }
        catch (error) {
            this.onFailure();
            throw error;
        }
    }
    shouldAttemptReset() {
        return this.lastFailureTime
            ? Date.now() - this.lastFailureTime > this.options.resetTimeout
            : false;
    }
    onSuccess() {
        this.failureCount = 0;
        if (this.state === CircuitState.HALF_OPEN) {
            this.successCount++;
            if (this.successCount >= 3) {
                this.state = CircuitState.CLOSED;
                this.successCount = 0;
                logger_1.logger.info('Circuit breaker entering CLOSED state');
            }
        }
    }
    onFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        this.successCount = 0;
        if (this.failureCount >= this.options.failureThreshold) {
            this.state = CircuitState.OPEN;
            logger_1.logger.warn('Circuit breaker entering OPEN state', {
                failureCount: this.failureCount,
                threshold: this.options.failureThreshold
            });
        }
    }
    getState() {
        return this.state;
    }
    reset() {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = undefined;
    }
}
exports.CircuitBreaker = CircuitBreaker;
class ResilienceManager {
    circuitBreaker;
    reconnectAttempts = 0;
    reconnectTimeout;
    config;
    constructor(config) {
        this.config = config;
        this.circuitBreaker = new CircuitBreaker({
            failureThreshold: 5,
            resetTimeout: 30000
        });
    }
    async executeWithResilience(operation) {
        return this.circuitBreaker.execute(operation);
    }
    scheduleReconnect(reconnectFn) {
        if (this.reconnectTimeout)
            return;
        this.reconnectAttempts++;
        if (this.reconnectAttempts > this.config.reconnectMaxAttempts) {
            logger_1.logger.error('Max reconnection attempts reached', {
                attempts: this.reconnectAttempts,
                maxAttempts: this.config.reconnectMaxAttempts
            });
            return;
        }
        const delay = Math.min(this.config.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts - 1), this.config.reconnectMaxDelay);
        logger_1.logger.info(`Scheduling reconnection attempt ${this.reconnectAttempts}`, {
            delayMs: delay
        });
        this.reconnectTimeout = setTimeout(async () => {
            this.reconnectTimeout = undefined;
            try {
                await this.executeWithResilience(reconnectFn);
                this.resetRetryCount();
            }
            catch (error) {
                logger_1.logger.error('Reconnection attempt failed', {
                    error,
                    attempt: this.reconnectAttempts
                });
                this.scheduleReconnect(reconnectFn);
            }
        }, delay);
    }
    handleError(error) {
        logger_1.logger.error('Resilience manager handling error', { error });
        // Categorize errors
        if (this.isRetryableError(error)) {
            logger_1.logger.info('Error is retryable');
        }
        else {
            logger_1.logger.warn('Error is not retryable');
        }
    }
    isRetryableError(error) {
        // Network errors
        if (error.code === 'ECONNREFUSED' ||
            error.code === 'ETIMEDOUT' ||
            error.code === 'ENOTFOUND') {
            return true;
        }
        // Redis errors
        if (error.message?.includes('Redis') &&
            error.message?.includes('connect')) {
            return true;
        }
        return false;
    }
    resetRetryCount() {
        this.reconnectAttempts = 0;
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = undefined;
        }
    }
    getCircuitState() {
        return this.circuitBreaker.getState();
    }
    getMetrics() {
        return {
            circuitState: this.getCircuitState(),
            reconnectAttempts: this.reconnectAttempts,
            isReconnecting: !!this.reconnectTimeout
        };
    }
}
exports.ResilienceManager = ResilienceManager;
//# sourceMappingURL=resilience.js.map