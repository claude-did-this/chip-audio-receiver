import { AudioStream, Config } from './types';
export declare class AudioProcessor {
    private streams;
    private config;
    constructor(config: Config['audio']);
    createStream(sessionId: string, format: string, sampleRate: number): Promise<AudioStream>;
    private createOutput;
    private createSpeakerOutput;
    private createFFplayOutput;
    private createVLCOutput;
    processChunk(sessionId: string, chunk: Buffer, _format: string): Promise<void>;
    finalizeStream(sessionId: string): Promise<void>;
    private saveToFile;
    private updateMetrics;
    cleanup(): Promise<void>;
}
//# sourceMappingURL=audio-processor.d.ts.map