import { Writable } from 'stream';
import { ChildProcess } from 'child_process';
export declare enum MessageType {
    AUDIO_OUTPUT = "AUDIO_OUTPUT",
    STATUS = "STATUS",
    ERROR = "ERROR",
    TEXT_INPUT = "TEXT_INPUT"
}
export declare enum AudioFormat {
    MP3 = "mp3",
    PCM = "pcm",
    OPUS = "opus"
}
export declare enum StatusValue {
    QUEUED = "queued",
    PROCESSING = "processing",
    STREAMING = "streaming",
    COMPLETED = "completed",
    CANCELLED = "cancelled"
}
export interface AudioData {
    audio: string;
    format: string;
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
//# sourceMappingURL=types.d.ts.map