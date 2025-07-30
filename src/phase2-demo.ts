import { ConnectionNegotiator } from './connection-negotiator';
import { HybridMetricsCollector } from './hybrid-metrics';
import { config } from './config';
import { logger } from './logger';
import { AudioProcessor } from './audio-processor';
import { MemoryManager } from './security';
import { signalHandler } from './signal-handler';

// Add debug logging
console.log('Phase 2 demo starting...');

async function runPhase2Demo() {
  logger.info('Starting Phase 2 Demo - Hybrid Redis/UDP Architecture');

  let negotiator: ConnectionNegotiator;
  let metrics: HybridMetricsCollector;
  let memoryManager: MemoryManager;
  let audioProcessor: AudioProcessor;
  
  try {
    // Initialize the connection negotiator
    logger.info('Creating ConnectionNegotiator...');
    negotiator = new ConnectionNegotiator(config);
    logger.info('ConnectionNegotiator created successfully');
    
    // Initialize metrics collector
    logger.info('Creating HybridMetricsCollector...');
    metrics = new HybridMetricsCollector(negotiator, config.metrics.port);
    logger.info('HybridMetricsCollector created successfully');
    
    // Initialize memory manager and audio processor
    logger.info('Creating MemoryManager...');
    memoryManager = new MemoryManager();
    logger.info('MemoryManager created successfully');
    
    logger.info('Creating AudioProcessor...');
    audioProcessor = new AudioProcessor(config.audio, memoryManager);
    logger.info('AudioProcessor created successfully');
    // Start metrics server
    await metrics.start();
    logger.info('Metrics server started');

    // Initialize connection negotiator (starts UDP server and Redis control plane)
    await negotiator.initialize();
    logger.info('Connection negotiator initialized');

    // Set up audio playback handler
    negotiator.on('audioReady', async (data) => {
      const { packet, playbackTime } = data;
      
      logger.debug('Audio ready for playback', {
        sessionId: packet.sessionId,
        sequenceNumber: packet.sequenceNumber,
        scheduledTime: playbackTime,
        currentTime: Date.now(),
        delay: playbackTime - Date.now()
      });

      // Play the audio
      try {
        // Create audio stream if it doesn't exist
        await audioProcessor.createStream(
          packet.sessionId,
          packet.format,
          packet.sampleRate
        );
        
        // Process the audio chunk
        await audioProcessor.processChunk(packet.sessionId, packet.audioData, packet.format);

        // Record successful playback
        metrics.recordUDPPacket(packet.sessionId, Date.now() - packet.timestamp);
      } catch (error) {
        logger.error('Audio playback error', { error, sessionId: packet.sessionId });
        metrics.recordError('playback', 'audio-processor');
      }
    });

    // Handle session lifecycle
    negotiator.on('sessionReady', (sessionId) => {
      logger.info('Session ready for streaming', { sessionId });
    });

    negotiator.on('sessionClosed', (sessionId) => {
      logger.info('Session closed', { sessionId });
    });

    negotiator.on('sessionError', ({ sessionId, error }) => {
      logger.error('Session error', { sessionId, error });
    });

    // Log status
    logger.info('Phase 2 audio service ready', {
      udpPort: config.udp?.port || 8001,
      subtitlesEnabled: config.subtitles?.enabled,
      subtitleMethod: config.subtitles?.method,
      metricsPort: config.metrics.port
    });

    // Demo information
    logger.info('');
    logger.info('=== Phase 2 Demo Running ===');
    logger.info('The service is now ready to receive:');
    logger.info('1. Control messages via Redis pub/sub on channels:');
    logger.info('   - chip.sessions.start');
    logger.info('   - chip.sessions.end');
    logger.info('   - chip.sessions.control');
    logger.info('2. Direct UDP audio packets on port:', config.udp?.port || 8001);
    logger.info('');
    logger.info('Monitoring endpoints:');
    logger.info(`   - Health: http://localhost:${config.metrics.port}/health`);
    logger.info(`   - Metrics: http://localhost:${config.metrics.port}/metrics`);
    logger.info(`   - Sessions: http://localhost:${config.metrics.port}/metrics/sessions`);
    logger.info('');

    // Register shutdown handler
    signalHandler.onShutdown(async () => {
      logger.info('Shutting down Phase 2 demo...');
      
      await negotiator.shutdown();
      // Clean up audio processor
      await audioProcessor.cleanup();
      await metrics.stop();
      
      logger.info('Shutdown complete');
    });

  } catch (error) {
    logger.error('Failed to start Phase 2 demo', error);
    process.exit(1);
  }
}

// Run the demo
if (require.main === module) {
  runPhase2Demo().catch(error => {
    logger.error('Phase 2 demo error', { 
      error: error.message,
      stack: error.stack,
      name: error.name
    });
    console.error('Full error:', error);
    process.exit(1);
  });
}

export { runPhase2Demo };