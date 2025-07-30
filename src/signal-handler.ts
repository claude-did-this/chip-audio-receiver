/**
 * Signal Handler Utility
 * Ensures proper handling of Ctrl+C and other signals, especially on Windows
 */

import { logger } from './logger';

export interface ShutdownHandler {
  (): Promise<void> | void;
}

class SignalHandler {
  private shutdownHandlers: ShutdownHandler[] = [];
  private isShuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;

  constructor() {
    this.setupSignalHandlers();
  }

  /**
   * Register a shutdown handler
   */
  onShutdown(handler: ShutdownHandler): void {
    this.shutdownHandlers.push(handler);
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  private setupSignalHandlers(): void {
    // Handle Ctrl+C (SIGINT)
    process.on('SIGINT', () => this.handleShutdown('SIGINT'));
    
    // Handle termination signal
    process.on('SIGTERM', () => this.handleShutdown('SIGTERM'));
    
    // Handle Windows specific signals
    if (process.platform === 'win32') {
      // On Windows, handle SIGBREAK (Ctrl+Break)
      process.on('SIGBREAK', () => this.handleShutdown('SIGBREAK'));
    }

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      console.error('Full uncaught exception details:', error);
      this.handleShutdown('uncaughtException');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection at:', promise, 'reason:', reason);
      this.handleShutdown('unhandledRejection');
    });
  }

  /**
   * Handle shutdown signal
   */
  private async handleShutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      if (signal === 'SIGINT' || signal === 'CTRL+C' || signal === 'SIGBREAK') {
        logger.warn('Force shutdown requested, exiting immediately...');
        process.exit(1);
      }
      return;
    }

    this.isShuttingDown = true;
    
    console.log(''); // New line for cleaner output
    logger.info(`Received ${signal}, shutting down gracefully...`);

    // Create shutdown promise if it doesn't exist
    if (!this.shutdownPromise) {
      this.shutdownPromise = this.executeShutdown();
    }

    try {
      await this.shutdownPromise;
      logger.info('Shutdown complete');
      
      // Kill the process group if running under ts-node-dev
      if (process.env.TS_NODE_DEV) {
        // ts-node-dev sets this environment variable
        process.kill(-process.pid, 'SIGTERM');
      }
      
      // Force exit
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }

  /**
   * Execute all shutdown handlers
   */
  private async executeShutdown(): Promise<void> {
    // Set a timeout for shutdown
    const shutdownTimeout = setTimeout(() => {
      logger.warn('Shutdown timeout exceeded, forcing exit...');
      process.exit(1);
    }, 10000); // 10 seconds timeout

    try {
      // Execute all handlers in reverse order (LIFO)
      for (let i = this.shutdownHandlers.length - 1; i >= 0; i--) {
        try {
          await this.shutdownHandlers[i]();
        } catch (error) {
          logger.error('Error in shutdown handler:', error);
        }
      }
    } finally {
      clearTimeout(shutdownTimeout);
    }
  }

  /**
   * Check if shutdown is in progress
   */
  isShuttingDownNow(): boolean {
    return this.isShuttingDown;
  }
}

// Export singleton instance
export const signalHandler = new SignalHandler();