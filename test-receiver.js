// Test script to verify the audio receiver
const { spawn } = require('child_process');

console.log('Testing Audio Receiver...\n');

// Start the receiver
const receiver = spawn('node', ['dist/index.js'], {
  env: {
    ...process.env,
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379',
    AUDIO_OUTPUT_TYPE: 'file',
    SAVE_TO_FILE: 'true',
    METRICS_ENABLED: 'true',
    LOG_LEVEL: 'debug'
  }
});

receiver.stdout.on('data', (data) => {
  console.log(`RECEIVER: ${data}`);
});

receiver.stderr.on('data', (data) => {
  console.error(`RECEIVER ERROR: ${data}`);
});

// Give it time to start
setTimeout(() => {
  console.log('\nChecking health endpoint...');
  
  fetch('http://localhost:9090/health')
    .then(res => res.json())
    .then(data => {
      console.log('Health check:', data);
    })
    .catch(err => console.error('Health check failed:', err.message));
  
  console.log('\nChecking metrics endpoint...');
  
  fetch('http://localhost:9090/metrics')
    .then(res => res.text())
    .then(data => {
      console.log('Metrics sample:', data.split('\n').slice(0, 10).join('\n'));
    })
    .catch(err => console.error('Metrics check failed:', err.message));
}, 3000);

// Shutdown after 10 seconds
setTimeout(() => {
  console.log('\nShutting down test...');
  receiver.kill('SIGTERM');
}, 10000);

receiver.on('close', (code) => {
  console.log(`Receiver exited with code ${code}`);
});