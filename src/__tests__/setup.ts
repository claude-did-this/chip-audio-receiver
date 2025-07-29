// Test setup file
import { jest } from '@jest/globals';

// Increase timeout for async operations
jest.setTimeout(10000);

// Mock console methods to reduce noise during tests
global.console = {
  ...console,
  log: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  // Keep error for debugging
  error: console.error,
};

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});