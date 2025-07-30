console.log('Starting test...');

try {
  const { ConnectionNegotiator } = require('./dist/connection-negotiator');
  console.log('ConnectionNegotiator imported successfully');
} catch (error) {
  console.error('Failed to import ConnectionNegotiator:', error.message);
}

try {
  const { HybridMetricsCollector } = require('./dist/hybrid-metrics');
  console.log('HybridMetricsCollector imported successfully');
} catch (error) {
  console.error('Failed to import HybridMetricsCollector:', error.message);
}

try {
  const { config } = require('./dist/config');
  console.log('Config loaded:', JSON.stringify(config, null, 2));
} catch (error) {
  console.error('Failed to load config:', error.message);
}