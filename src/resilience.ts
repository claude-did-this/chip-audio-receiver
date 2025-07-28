import { logger } from './logger';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
  monitoringPeriod: number;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime?: number;
  private successCount = 0;
  private readonly options: CircuitBreakerOptions;

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    this.options = {
      failureThreshold: options.failureThreshold || 5,
      resetTimeout: options.resetTimeout || 60000, // 1 minute
      monitoringPeriod: options.monitoringPeriod || 10000 // 10 seconds
    };
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.state = CircuitState.HALF_OPEN;
        logger.info('Circuit breaker entering HALF_OPEN state');
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private shouldAttemptReset(): boolean {
    return this.lastFailureTime 
      ? Date.now() - this.lastFailureTime > this.options.resetTimeout 
      : false;
  }

  private onSuccess(): void {
    this.failureCount = 0;
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= 3) {
        this.state = CircuitState.CLOSED;
        this.successCount = 0;
        logger.info('Circuit breaker entering CLOSED state');
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.successCount = 0;

    if (this.failureCount >= this.options.failureThreshold) {
      this.state = CircuitState.OPEN;
      logger.warn('Circuit breaker entering OPEN state', {
        failureCount: this.failureCount,
        threshold: this.options.failureThreshold
      });
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = undefined;
  }
}

export class ResilienceManager {
  private circuitBreaker: CircuitBreaker;
  private reconnectAttempts = 0;
  private reconnectTimeout?: NodeJS.Timeout;
  private readonly config: any;

  constructor(config: any) {
    this.config = config;
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeout: 30000
    });
  }

  async executeWithResilience<T>(operation: () => Promise<T>): Promise<T> {
    return this.circuitBreaker.execute(operation);
  }

  scheduleReconnect(reconnectFn: () => Promise<void>): void {
    if (this.reconnectTimeout) return;

    this.reconnectAttempts++;
    
    if (this.reconnectAttempts > this.config.reconnectMaxAttempts) {
      logger.error('Max reconnection attempts reached', {
        attempts: this.reconnectAttempts,
        maxAttempts: this.config.reconnectMaxAttempts
      });
      return;
    }

    const delay = Math.min(
      this.config.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.config.reconnectMaxDelay
    );

    logger.info(`Scheduling reconnection attempt ${this.reconnectAttempts}`, {
      delayMs: delay
    });

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = undefined;
      
      try {
        await this.executeWithResilience(reconnectFn);
        this.resetRetryCount();
      } catch (error) {
        logger.error('Reconnection attempt failed', { 
          error, 
          attempt: this.reconnectAttempts 
        });
        this.scheduleReconnect(reconnectFn);
      }
    }, delay);
  }

  handleError(error: any): void {
    logger.error('Resilience manager handling error', { error });

    // Categorize errors
    if (this.isRetryableError(error)) {
      logger.info('Error is retryable');
    } else {
      logger.warn('Error is not retryable');
    }
  }

  private isRetryableError(error: any): boolean {
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

  resetRetryCount(): void {
    this.reconnectAttempts = 0;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }
  }

  getCircuitState(): CircuitState {
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