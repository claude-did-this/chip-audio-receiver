declare module 'speaker' {
  import { Writable } from 'stream';

  interface SpeakerOptions {
    channels?: number;
    bitDepth?: number;
    sampleRate?: number;
    float?: boolean;
    signed?: boolean;
    samplesPerFrame?: number;
    device?: string;
  }

  class Speaker extends Writable {
    constructor(options?: SpeakerOptions);
  }

  export = Speaker;
}