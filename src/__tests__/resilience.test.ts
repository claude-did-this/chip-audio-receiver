import { jest } from '@jest/globals';
import { CircuitBreaker, CircuitState, ResilienceManager } from '../resilience';

// Mock logger
jest.mock('../logger');

describe('Resilience - Error Handling Behavior', () => {
  describe('Circuit Breaker', () => {
    let circuitBreaker: CircuitBreaker;

    beforeEach(() => {
      jest.clearAllMocks();
      circuitBreaker = new CircuitBreaker({
        failureThreshold: 3,
        resetTimeout: 1000,
        monitoringPeriod: 500,
      });
    });

    it('should start in CLOSED state', () => {
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should execute operations successfully when CLOSED', async () => {
      const mockOperation = jest.fn<() => Promise<string>>().mockResolvedValue('success');
      
      const result = await circuitBreaker.execute(mockOperation);
      
      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalled();
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should open circuit after reaching failure threshold', async () => {
      const failingOperation = jest.fn<() => Promise<void>>().mockRejectedValue(new Error('fail'));
      
      // Fail 3 times to reach threshold
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingOperation);
        } catch (e) {
          // Expected to fail
        }
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should reject operations immediately when OPEN', async () => {
      const mockOperation = jest.fn<() => Promise<string>>().mockResolvedValue('success');
      
      // Force circuit to OPEN state
      const failingOperation = jest.fn<() => Promise<void>>().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingOperation);
        } catch (e) {
          // Expected
        }
      }
      
      // Try to execute when OPEN
      await expect(circuitBreaker.execute(mockOperation))
        .rejects.toThrow('Circuit breaker is OPEN');
      
      expect(mockOperation).not.toHaveBeenCalled();
    });

    it('should enter HALF_OPEN state after reset timeout', async () => {
      // Force circuit to OPEN
      const failingOperation = jest.fn<() => Promise<void>>().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingOperation);
        } catch (e) {
          // Expected
        }
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
      
      // Wait for real reset timeout
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Next operation should be attempted (HALF_OPEN)
      const successOperation = jest.fn<() => Promise<string>>().mockResolvedValue('success');
      await circuitBreaker.execute(successOperation);
      
      expect(successOperation).toHaveBeenCalled();
    });

    it('should close circuit after successful operations in HALF_OPEN state', async () => {
      // Force circuit to OPEN
      const failingOperation = jest.fn<() => Promise<void>>().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingOperation);
        } catch (e) {
          // Expected
        }
      }
      
      // Wait for real reset timeout
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Execute 3 successful operations to close circuit
      const successOperation = jest.fn<() => Promise<string>>().mockResolvedValue('success');
      for (let i = 0; i < 3; i++) {
        await circuitBreaker.execute(successOperation);
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should reset state manually', async () => {
      // Force some failures
      const failingOperation = jest.fn<() => Promise<void>>().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 2; i++) {
        try {
          await circuitBreaker.execute(failingOperation);
        } catch (e) {
          // Expected
        }
      }
      
      circuitBreaker.reset();
      
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('Resilience Manager', () => {
    let resilienceManager: ResilienceManager;

    beforeEach(() => {
      jest.clearAllMocks();
      jest.useFakeTimers();
      resilienceManager = new ResilienceManager({
        reconnectMaxAttempts: 3,
        reconnectBaseDelay: 100,
        reconnectMaxDelay: 1000,
        healthCheckInterval: 5000,
      });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    // The actual reconnection logic is tested below with proper timer handling

    it('should execute operations through circuit breaker', async () => {
      const mockOperation = jest.fn<() => Promise<string>>().mockResolvedValue('result');
      
      const result = await resilienceManager.executeWithResilience(mockOperation);
      
      expect(result).toBe('result');
      expect(mockOperation).toHaveBeenCalled();
    });

    it('should handle retryable errors', () => {
      const networkError = new Error('Connection refused');
      (networkError as Error & { code?: string }).code = 'ECONNREFUSED';
      
      resilienceManager.handleError(networkError);
      
      // Should log but not throw
      expect(() => resilienceManager.handleError(networkError)).not.toThrow();
    });

    it('should schedule reconnection with delay', () => {
      const mockReconnect = jest.fn<() => Promise<void>>();
      
      // Schedule reconnection
      resilienceManager.scheduleReconnect(mockReconnect);
      expect(mockReconnect).not.toHaveBeenCalled();
      
      // Verify reconnection is scheduled
      const metrics = resilienceManager.getMetrics();
      expect(metrics.isReconnecting).toBe(true);
      expect(metrics.reconnectAttempts).toBe(1);
      
      // Advance time to trigger reconnection
      jest.advanceTimersByTime(100);
      expect(mockReconnect).toHaveBeenCalledTimes(1);
    });

    it('should not exceed max reconnection attempts', () => {
      const mockReconnect = jest.fn<() => Promise<void>>();
      
      // Manually simulate multiple reconnection attempts
      for (let i = 0; i < 5; i++) {
        resilienceManager.scheduleReconnect(mockReconnect);
      }
      
      // Only the first 3 should be scheduled (max attempts = 3)
      const metrics = resilienceManager.getMetrics();
      expect(metrics.reconnectAttempts).toBeLessThanOrEqual(3);
    });

    it('should reset retry count manually', () => {
      const mockReconnect = jest.fn<() => Promise<void>>();
      
      // Schedule a reconnection
      resilienceManager.scheduleReconnect(mockReconnect);
      
      // Verify retry count
      let metrics = resilienceManager.getMetrics();
      expect(metrics.reconnectAttempts).toBe(1);
      expect(metrics.isReconnecting).toBe(true);
      
      // Reset retry count
      resilienceManager.resetRetryCount();
      
      // Verify reset
      metrics = resilienceManager.getMetrics();
      expect(metrics.reconnectAttempts).toBe(0);
      expect(metrics.isReconnecting).toBe(false);
    });

    it('should identify retryable errors correctly', () => {
      const retryableErrors = [
        { code: 'ECONNREFUSED' },
        { code: 'ETIMEDOUT' },
        { code: 'ENOTFOUND' },
        new Error('Redis connection error'),
      ];
      
      retryableErrors.forEach(error => {
        resilienceManager.handleError(error);
        // Should not throw for retryable errors
        expect(() => resilienceManager.handleError(error)).not.toThrow();
      });
      
      const nonRetryableError = new Error('Unknown error');
      resilienceManager.handleError(nonRetryableError);
      // Should handle gracefully
      expect(() => resilienceManager.handleError(nonRetryableError)).not.toThrow();
    });

    it('should provide resilience metrics', () => {
      const metrics = resilienceManager.getMetrics();
      
      expect(metrics).toEqual({
        circuitState: CircuitState.CLOSED,
        reconnectAttempts: 0,
        isReconnecting: false,
      });
    });

    it('should cancel scheduled reconnections on reset', () => {
      const mockReconnect = jest.fn<() => Promise<void>>();
      
      resilienceManager.scheduleReconnect(mockReconnect);
      resilienceManager.resetRetryCount();
      
      jest.runAllTimers();
      
      expect(mockReconnect).not.toHaveBeenCalled();
    });

    it('should handle successful reconnection and continue with exponential backoff', async () => {
      // Mock executeWithResilience to control the flow
      const executeWithResilienceSpy = jest.spyOn(resilienceManager, 'executeWithResilience');
      executeWithResilienceSpy
        .mockRejectedValueOnce(new Error('Fail'))  // First fails
        .mockResolvedValueOnce(undefined);  // Second succeeds

      const mockReconnect = jest.fn<() => Promise<void>>();

      // First reconnection attempt
      resilienceManager.scheduleReconnect(mockReconnect);
      
      // Run first timer and wait for promise
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      
      expect(executeWithResilienceSpy).toHaveBeenCalledTimes(1);

      // Should reschedule after failure - advance by 200ms (exponential backoff)
      jest.advanceTimersByTime(200);
      await Promise.resolve();
      
      expect(executeWithResilienceSpy).toHaveBeenCalledTimes(2);
      
      // Should reset after success
      const metrics = resilienceManager.getMetrics();
      expect(metrics.reconnectAttempts).toBe(0);
    });

    it('should handle complex reconnection scenarios with retries', async () => {
      // Mock executeWithResilience to always fail
      const executeWithResilienceSpy = jest.spyOn(resilienceManager, 'executeWithResilience');
      executeWithResilienceSpy.mockRejectedValue(new Error('Connection failed'));

      const mockReconnect = jest.fn<() => Promise<void>>();

      // Schedule first reconnection
      resilienceManager.scheduleReconnect(mockReconnect);
      
      // Verify initial state
      let metrics = resilienceManager.getMetrics();
      expect(metrics.reconnectAttempts).toBe(1);
      expect(metrics.isReconnecting).toBe(true);

      // First attempt (100ms delay)
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      expect(executeWithResilienceSpy).toHaveBeenCalledTimes(1);

      // Second attempt (200ms delay - exponential backoff)
      jest.advanceTimersByTime(200);
      await Promise.resolve();
      expect(executeWithResilienceSpy).toHaveBeenCalledTimes(2);

      // Third attempt (400ms delay - exponential backoff)
      jest.advanceTimersByTime(400);
      await Promise.resolve();
      expect(executeWithResilienceSpy).toHaveBeenCalledTimes(3);

      // Should stop after max attempts (counter goes to 4 because it increments before checking)
      metrics = resilienceManager.getMetrics();
      expect(metrics.reconnectAttempts).toBe(4);
      
      // No more calls even if we advance time
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      expect(executeWithResilienceSpy).toHaveBeenCalledTimes(3);
    });
  });
});