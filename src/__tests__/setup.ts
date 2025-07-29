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

// Mock the speaker module to prevent audio hardware access
jest.mock('speaker', () => {
  return jest.fn().mockImplementation(() => ({
    write: jest.fn().mockReturnValue(true),
    end: jest.fn(),
    once: jest.fn(),
    on: jest.fn(),
  }));
});

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});