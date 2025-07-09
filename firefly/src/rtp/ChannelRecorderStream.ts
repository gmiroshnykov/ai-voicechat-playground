import { Writable } from 'stream';
import { StereoRecorderStream, AudioChannel } from './StereoRecorderStream';
import { createLogger, Logger } from '../utils/logger';

/**
 * Writable stream that forwards audio data to a specific channel of a stereo recorder
 * This allows for clean stream pipeline composition:
 * 
 * callerAudioStream.pipe(new ChannelRecorderStream(stereoRecorder, 'caller'))
 * aiAudioStream.pipe(new ChannelRecorderStream(stereoRecorder, 'ai'))
 */
export class ChannelRecorderStream extends Writable {
  private readonly stereoRecorder: StereoRecorderStream;
  private readonly channel: AudioChannel;
  private readonly logger: Logger;

  constructor(stereoRecorder: StereoRecorderStream, channel: AudioChannel) {
    super({ 
      objectMode: false,
      highWaterMark: 64 * 1024 // 64KB buffer
    });
    
    this.stereoRecorder = stereoRecorder;
    this.channel = channel;
    this.logger = createLogger({ 
      component: `ChannelRecorderStream-${channel}` 
    });
  }

  _write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void): void {
    try {
      // Forward audio data to the appropriate channel of the stereo recorder
      this.stereoRecorder.writeChannelAudio(this.channel, chunk);
      callback();
    } catch (error) {
      this.logger.error(`Error writing ${this.channel} audio to stereo recorder`, error);
      callback(error as Error);
    }
  }

  public getChannel(): AudioChannel {
    return this.channel;
  }
}