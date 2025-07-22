#!/usr/bin/env node

/**
 * Windows Audio Receiver
 * Connects to the audio broadcast server and pipes audio to Virtual Audio Cable
 * Run this on your Windows machine with Reaper
 */

const WebSocket = require('ws');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const BROADCAST_URL = process.env.BROADCAST_URL || 'ws://192.168.1.3:8765';
const SAVE_TO_FILE = process.argv.includes('--save');
const USE_FFPLAY = process.argv.includes('--ffplay');
const USE_VLC = process.argv.includes('--vlc');
const DEBUG = process.argv.includes('--debug');

console.log('🎧 CHIP Audio Receiver for Windows');
console.log('==================================');
console.log(`Server: ${BROADCAST_URL}`);
console.log(`Output: ${USE_FFPLAY ? 'ffplay' : USE_VLC ? 'VLC' : 'CABLE Input (VB-Audio Virtual Cable)'}`);
console.log(`Options: ${SAVE_TO_FILE ? 'Saving to files' : 'Streaming only'}`);
console.log();

// Audio output setup
let audioPlayer = null;
let audioBuffer = [];
let currentSession = null;
let isPlaying = false;

// Setup audio player based on preference
function setupAudioPlayer() {
  if (USE_FFPLAY) {
    // Use ffplay (requires ffmpeg installation)
    audioPlayer = spawn('ffplay', [
      '-nodisp',
      '-f', 'mp3',
      '-i', 'pipe:0',
      '-volume', '100'
    ], {
      stdio: ['pipe', 'ignore', 'ignore']
    });
    console.log('✅ Using ffplay for audio output');
  } else if (USE_VLC) {
    // Use VLC (requires VLC installation)
    audioPlayer = spawn('vlc', [
      '-I', 'dummy',
      '--play-and-exit',
      '--intf', 'dummy',
      'fd://0'
    ], {
      stdio: ['pipe', 'ignore', 'ignore']
    });
    console.log('✅ Using VLC for audio output');
  } else {
    // Default: Use Windows Audio API via Node
    try {
      const Speaker = require('speaker');
      audioPlayer = new Speaker({
        channels: 1,
        bitDepth: 16,
        sampleRate: 24000
      });
      console.log('✅ Using speaker module for audio output');
    } catch (e) {
      console.log('⚠️  Speaker module not found. Install with: npm install speaker');
      console.log('   Falling back to file saving only.');
      SAVE_TO_FILE = true;
    }
  }

  if (audioPlayer && audioPlayer.on) {
    audioPlayer.on('error', (err) => {
      console.error('❌ Audio player error:', err.message);
    });
  }
}

// WebSocket connection
let ws = null;
let reconnectTimeout = null;
let reconnectAttempts = 0;

function connect() {
  console.log(`🔌 Connecting to ${BROADCAST_URL}...`);

  ws = new WebSocket(BROADCAST_URL);

  ws.on('open', () => {
    console.log('✅ Connected to broadcast server!');
    reconnectAttempts = 0;

    // Send ping every 30 seconds to keep connection alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'PING' }));
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);

      // Debug all messages
      if (DEBUG) {
        console.log(`\n[DEBUG] Received message type: ${message.type}`);
        if (message.type === 'AUDIO_OUTPUT') {
          console.log('[DEBUG] Audio message structure:', {
            hasData: !!message.data,
            hasAudio: !!message.data?.audio,
            dataKeys: message.data ? Object.keys(message.data) : []
          });
        }
      }

      if (message.type === 'AUDIO_OUTPUT') {
        handleAudioMessage(message);
      } else if (message.type === 'CONNECTION') {
        console.log('📡', message.message);
      } else if (message.type === 'PONG') {
        // Ping response received
        if (DEBUG) console.log('🏓 Pong received');
      }
    } catch (error) {
      console.error('❌ Error parsing message:', error.message);
    }
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error.message);
  });

  ws.on('close', () => {
    console.log('🔌 Disconnected from server');
    scheduleReconnect();
  });
}

function handleAudioMessage(message) {
  const { sessionId, data } = message;

  // Debug: Log the data field which contains metadata
  if (DEBUG) {
    console.log(`\n[DEBUG] Audio message data:`, {
      format: data.format,
      audioLength: data.audio?.length,
      isFirst: data.isFirst,
      isFinal: data.isFinal,
      hasSubtitles: !!data.subtitles
    });
  }

  // New session started - check isFirst in data field
  if (data?.isFirst) {
    if (currentSession && audioBuffer.length > 0) {
      // Save previous session if needed
      finishCurrentSession();
    }

    currentSession = sessionId;
    audioBuffer = [];
    isPlaying = true;
    console.log(`\n🎵 New audio stream started - Session: ${sessionId}`);
  }

  // Only process if it's for the current session
  if (sessionId !== currentSession) {
    // If we don't have a current session but we're receiving audio, start one
    if (!currentSession && data?.audio) {
      console.log(`\n⚠️  Receiving audio without isFirst flag - starting session: ${sessionId}`);
      currentSession = sessionId;
      audioBuffer = [];
      isPlaying = true;
    } else {
      return;
    }
  }

  // Decode audio chunk
  const audioChunk = Buffer.from(data.audio, 'base64');
  audioBuffer.push(audioChunk);

  // Output to audio player
  if (audioPlayer) {
    if (audioPlayer.write) {
      // Speaker module
      audioPlayer.write(audioChunk);
    } else if (audioPlayer.stdin && audioPlayer.stdin.writable) {
      // ffplay/VLC
      audioPlayer.stdin.write(audioChunk);
    }
  }

  // Show progress
  process.stdout.write(data?.isFinal ? '🏁' : '.');

  // Show subtitles if available
  if (data?.subtitles && DEBUG) {
    console.log(`\n[Subtitle] ${data.subtitles.text}`);
  }

  // Handle final chunk
  if (data?.isFinal) {
    console.log(`\n✅ Stream complete - ${audioBuffer.length} chunks received`);
    finishCurrentSession();
  }
}

function finishCurrentSession() {
  if (SAVE_TO_FILE && audioBuffer.length > 0) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `audio-${currentSession}-${timestamp}.mp3`;
    const fullAudio = Buffer.concat(audioBuffer);

    fs.writeFileSync(filename, fullAudio);
    console.log(`💾 Saved: ${filename} (${(fullAudio.length / 1024).toFixed(2)} KB)`);
  }

  audioBuffer = [];
  currentSession = null;
  isPlaying = false;
}

function scheduleReconnect() {
  if (reconnectTimeout) return;

  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 10000);

  console.log(`🔄 Reconnecting in ${delay / 1000} seconds...`);

  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    connect();
  }, delay);
}

// Virtual Audio Cable setup instructions
function showVACInstructions() {
  console.log('\n📌 Virtual Audio Cable Setup:');
  console.log('1. Install Virtual Audio Cable (VB-Audio or similar)');
  console.log('2. Set "CABLE Input" as your default playback device');
  console.log('3. In Reaper:');
  console.log('   - Go to Options > Preferences > Audio > Device');
  console.log('   - Add "CABLE Output" as an input device');
  console.log('   - Create a new track and set input to "CABLE Output"');
  console.log('   - Arm the track for recording');
  console.log('4. Run this script - audio will flow to Reaper!');
  console.log();
}

// Main
console.log('🚀 Starting audio receiver...\n');

// Show VAC instructions if not using external player
if (!USE_FFPLAY && !USE_VLC) {
  showVACInstructions();
}

// Check for required modules
try {
  require('ws');
} catch (e) {
  console.error('❌ Missing required module: ws');
  console.error('   Install with: npm install ws');
  process.exit(1);
}

// Setup audio output
setupAudioPlayer();

// Connect to broadcast server
connect();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down...');

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }

  if (audioPlayer) {
    if (audioPlayer.end) audioPlayer.end();
    if (audioPlayer.kill) audioPlayer.kill();
  }

  // Save any remaining audio
  if (currentSession && audioBuffer.length > 0) {
    finishCurrentSession();
  }

  console.log('👋 Goodbye!');
  process.exit(0);
});

// Usage help
console.log('💡 Usage Options:');
console.log('  node windows-audio-receiver.js                # Use default audio device');
console.log('  node windows-audio-receiver.js --ffplay       # Use ffplay (requires ffmpeg)');
console.log('  node windows-audio-receiver.js --vlc          # Use VLC player');
console.log('  node windows-audio-receiver.js --save         # Save audio files');
console.log('  node windows-audio-receiver.js --debug        # Show debug info');
console.log();
console.log('Environment Variables:');
console.log('  BROADCAST_URL=ws://server:8765  # Set broadcast server URL');
console.log();