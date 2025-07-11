import { Writable } from 'stream';
import { createWriteStream, WriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { CodecInfo } from './types';
import { Logger } from '../utils/logger';
import { getBitsPerSample, convertAudioData } from './AudioCodecUtils';
import { writeWavHeaderToStream, finalizeWavHeader, WavHeaderConfig } from './WavFileUtils';

export interface ChannelRecorderStreamConfig {
  filePath: string;
  codec: CodecInfo;
  sessionId: string;
  channelName: string; // 'inbound' or 'outbound'
  logger?: Logger;
}

export class ChannelRecorderStream extends Writable {
  private readonly config: ChannelRecorderStreamConfig;
  private readonly logger: Logger;
  private fileStream?: WriteStream;
  private wavHeaderWritten = false;
  private bytesWritten = 0;
  private sampleRate: number;
  private bitsPerSample: number;

  constructor(config: ChannelRecorderStreamConfig) {
    super({ objectMode: false });
    this.config = config;
    this.logger = config.logger || {
      trace: console.trace.bind(console),
      debug: console.debug.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      child: () => this.logger
    } as Logger;
    
    // Set audio parameters based on codec
    this.sampleRate = config.codec.clockRate;
    this.bitsPerSample = getBitsPerSample(config.codec.name);
  }


  private async ensureDirectoryExists(): Promise<void> {
    const dir = dirname(this.config.filePath);
    try {
      await mkdir(dir, { recursive: true });
    } catch (error) {
      this.logger.error('Failed to create recording directory', { 
        directory: dir, 
        error,
        sessionId: this.config.sessionId 
      });
      throw error;
    }
  }

  private async createFileStream(): Promise<void> {
    await this.ensureDirectoryExists();
    
    this.fileStream = createWriteStream(this.config.filePath);
    
    this.fileStream.on('error', (error) => {
      this.logger.error('Recording file stream error', { 
        filePath: this.config.filePath,
        channelName: this.config.channelName,
        error,
        sessionId: this.config.sessionId 
      });
      this.emit('error', error);
    });

    this.fileStream.on('close', () => {
      this.logger.debug('Recording file stream closed', { 
        filePath: this.config.filePath,
        channelName: this.config.channelName,
        bytesWritten: this.bytesWritten,
        sessionId: this.config.sessionId 
      });
    });
  }

  private writeWavHeader(): void {
    if (!this.fileStream || this.wavHeaderWritten) return;

    const wavConfig: WavHeaderConfig = {
      channels: 1, // Mono recording
      sampleRate: this.sampleRate,
      bitsPerSample: this.bitsPerSample
    };

    writeWavHeaderToStream(this.fileStream, wavConfig, this.logger);
    this.wavHeaderWritten = true;
    
    this.logger.debug('WAV header written', { 
      filePath: this.config.filePath,
      channelName: this.config.channelName,
      sampleRate: this.sampleRate,
      bitsPerSample: this.bitsPerSample,
      sessionId: this.config.sessionId 
    });
  }







  async _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): Promise<void> {
    try {
      if (!this.fileStream) {
        await this.createFileStream();
      }
      
      if (!this.wavHeaderWritten) {
        this.writeWavHeader();
      }
      
      const convertedAudio = convertAudioData(chunk, this.config.codec);
      this.fileStream!.write(convertedAudio);
      this.bytesWritten += convertedAudio.length;
      
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  async _final(callback: (error?: Error | null) => void): Promise<void> {
    try {
      if (this.fileStream) {
        // Close the stream first
        await new Promise<void>((resolve) => {
          this.fileStream!.end(() => {
            resolve();
          });
        });
        
        // Update WAV header with final sizes
        await finalizeWavHeader(this.config.filePath, this.bytesWritten, this.logger);
        
        this.logger.info('Recording completed', { 
          filePath: this.config.filePath,
          channelName: this.config.channelName,
          bytesWritten: this.bytesWritten,
          sessionId: this.config.sessionId 
        });
      }
      
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }


  public getStats() {
    return {
      filePath: this.config.filePath,
      channelName: this.config.channelName,
      bytesWritten: this.bytesWritten,
      wavHeaderWritten: this.wavHeaderWritten,
      sampleRate: this.sampleRate,
      bitsPerSample: this.bitsPerSample
    };
  }
}