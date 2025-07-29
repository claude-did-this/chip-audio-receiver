import { Writable } from 'stream';
import { ChildProcess } from 'child_process';

export enum MessageType {
  AUDIO_OUTPUT = 'AUDIO_OUTPUT',
  STATUS = 'STATUS',
  ERROR = 'ERROR',
  TEXT_INPUT = 'TEXT_INPUT'
}

export enum AudioFormat {
  MP3 = 'mp3',
  PCM = 'pcm',
  OPUS = 'opus'
}

export enum StatusValue {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  STREAMING = 'streaming',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled'
}

export interface AudioData {
  audio: string; // base64 encoded
  format: string; // "mp3" or "pcm"
}

export interface AudioMetadata {
  correlationId?: string;
  sampleRate: number;
  isFirst: boolean;
  isFinal: boolean;
  subtitles?: {
    text: string;
    startTime: number;
    endTime: number;
  };
}

export interface StatusData {
  status: string;
  message?: string;
  progress?: {
    current: number;
    total: number;
    percentage: number;
  };
}

export interface ErrorData {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface BaseMessage {
  id: string;
  type: string;
  service: string;
  sessionId: string;
  timestamp: string;
}

export interface AudioOutputMessage extends BaseMessage {
  type: MessageType.AUDIO_OUTPUT;
  data: AudioData;
  metadata: AudioMetadata;
}

export interface StatusMessage extends BaseMessage {
  type: MessageType.STATUS;
  data: StatusData;
}

export interface ErrorMessage extends BaseMessage {
  type: MessageType.ERROR;
  error: ErrorData;
}

export type VoiceResponseMessage = AudioOutputMessage | StatusMessage | ErrorMessage;

export interface ServiceHealth {
  service: string;
  status: 'healthy' | 'unhealthy';
  timestamp: number;
  details: {
    uptime: number;
    memoryUsage: number;
    activeRequests: number;
  };
}

export interface AudioPlayerConfig {
  type: 'speaker' | 'ffplay' | 'vlc' | 'file';
  device?: string;
}

export interface Config {
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  channels: {
    responses: string;
    health: string;
  };
  audio: {
    output: AudioPlayerConfig;
    bufferSize: number;
    saveToFile: boolean;
  };
  metrics: {
    port: number;
    enabled: boolean;
  };
  resilience: {
    reconnectMaxAttempts: number;
    reconnectBaseDelay: number;
    reconnectMaxDelay: number;
    healthCheckInterval: number;
  };
  logging: {
    level: string;
    format: 'json' | 'simple';
  };
  // Phase 2/3 configuration sections (optional for now)
  udp?: {
    port: number;
    enabled: boolean;
  };
  jitterBuffer?: JitterBufferConfig;
  vtubeStudio?: {
    enabled: boolean;
    host: string;
    port: number;
    apiKey?: string;
    lipSyncSensitivity: number;
  };
  subtitles?: {
    enabled: boolean;
    method: 'obs-websocket' | 'overlay' | 'toast';
    displayDuration: number;
    obsWebSocketHost?: string;
    obsWebSocketPort?: number;
    obsWebSocketPassword?: string;
  };
}

export interface AudioStream {
  sessionId: string;
  format: string;
  sampleRate: number;
  output: Writable | ChildProcess | null;
  buffer: Buffer[];
  startTime: number;
}

export interface SpeakerConfig {
  channels: number;
  sampleRate: number;
  bitDepth: number;
  float?: boolean;
  signed?: boolean;
  device?: string;
}

export interface WindowsAudioDevice {
  ID: string;
  Name: string;
  Type: string;
}

export interface WindowsWMIDevice {
  DeviceID: string;
  Name: string;
}

export interface MacAudioDevice {
  _name: string;
  coreaudio_input_source?: boolean;
}

export interface MacAudioItem {
  _items?: MacAudioDevice[];
}

export interface MacAudioData {
  SPAudioDataType?: MacAudioItem[];
}

export interface ResilienceConfig {
  reconnectMaxAttempts: number;
  reconnectBaseDelay: number;
  reconnectMaxDelay: number;
  healthCheckInterval: number;
}

export interface ResilienceMetrics {
  circuitState: string;
  reconnectAttempts: number;
  isReconnecting: boolean;
}

// UDP Audio Streaming Types
export interface AudioPacket {
  sessionId: string;
  sequenceNumber: number;
  timestamp: number;          // TTS generation timestamp
  playbackTime: number;       // When this should be played
  audioData: Buffer;
  format: AudioFormat;
  sampleRate: number;
  isLast: boolean;
  checksum?: string;          // For packet integrity
}

export interface SubtitleData {
  text: string;
  startTime: number;          // Relative to audio start (ms)
  endTime: number;            // Relative to audio start (ms)
  ttsOffset: number;          // TTS processing delay
  confidence?: number;        // TTS confidence score
}

export interface TimedAudioChunk {
  sessionId: string;
  audio: Buffer;
  playbackTime: number;       // Absolute timestamp when to play
  duration: number;           // Duration in ms
  subtitles?: SubtitleData;
  sequenceNumber: number;
}

// Control Messages (via Redis)
export interface SessionStartMessage {
  type: 'SESSION_START';
  sessionId: string;
  audioStreamPort: number;    // UDP port for direct audio streaming
  clientEndpoint: string;     // IP:port of voice service
  expectedFormat: AudioFormat;
  sampleRate: number;
  estimatedDuration?: number; // Expected session duration (ms)
}

export interface SessionReadyMessage {
  type: 'SESSION_READY';
  sessionId: string;
  receiverReady: boolean;
  udpEndpoint: string;        // Our UDP endpoint for audio
  bufferSize: number;         // Suggested buffer size
}

export interface SessionEndMessage {
  type: 'SESSION_END';
  sessionId: string;
  reason: 'COMPLETED' | 'ERROR' | 'TIMEOUT' | 'CLIENT_DISCONNECT';
  statistics?: SessionStatistics;
}

export interface SessionStatistics {
  totalPackets: number;
  lostPackets: number;
  avgLatency: number;
  jitterMs: number;
  audioDuration: number;
  startTime: number;
  endTime: number;
}

// Network and Timing
export interface NetworkConditions {
  avgLatency: number;
  jitterMs: number;
  packetLoss: number;
  bandwidth: number;
}

export interface JitterBufferConfig {
  targetBufferMs: number;     // Target buffer size
  minBufferMs: number;        // Minimum buffer before playback
  maxBufferMs: number;        // Maximum buffer (discard old packets)
  adaptiveMode: boolean;      // Adjust buffer based on network conditions
}

// Synchronization
export interface SyncTimestamps {
  ttsGenerated: number;       // When TTS generated the audio
  packetSent: number;         // When voice service sent UDP packet
  packetReceived: number;     // When we received UDP packet
  scheduledPlayback: number;  // When we plan to play it
  actualPlayback?: number;    // When we actually played it
}

// Enhanced Audio Output Message (still used for some control data)
export interface EnhancedAudioOutputMessage extends AudioOutputMessage {
  metadata: {
    isFirst: boolean;
    isFinal: boolean;
    sampleRate: number;
    correlationId?: string;
    
    // TTS timing data
    ttsTimestamp: number;        // When TTS generated this chunk
    audioStartTime: number;      // Audio playback start time (ms)
    audioDuration: number;       // Duration of this chunk (ms)
    
    // Subtitle sync
    subtitles?: SubtitleData;
    
    // Network negotiation
    udpStreamingEnabled?: boolean;
    udpPort?: number;
  };
}