import { Writable } from 'stream';
import { createWriteStream, WriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { CodecInfo } from './types';
import { Logger } from '../utils/logger';
import { getBitsPerSample, convertAudioData } from './AudioCodecUtils';
import { writeWavHeaderToStream, finalizeWavHeader, WavHeaderConfig } from './WavFileUtils';

export interface StereoRecorderStreamConfig {
  filePath: string;
  codec: CodecInfo;
  sessionId: string;
  bufferSizeMs?: number; // Buffer size for synchronization (default: 100ms)
  logger?: Logger;
}


export class StereoRecorderStream extends Writable {
  private readonly config: StereoRecorderStreamConfig;
  private readonly logger: Logger;
  private fileStream?: WriteStream;
  private wavHeaderWritten = false;
  private bytesWritten = 0;
  private sampleRate: number;
  private bitsPerSample: number;
  
  // Chunk-based stereo mixing (no timers!)
  private leftBuffer: Buffer[] = [];
  private rightBuffer: Buffer[] = [];
  private isClosing = false;

  constructor(config: StereoRecorderStreamConfig) {
    super({ objectMode: true }); // Accept objects with channel info
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
      this.logger.error('Stereo recording file stream error', { 
        filePath: this.config.filePath,
        error,
        sessionId: this.config.sessionId 
      });
      this.emit('error', error);
    });

    this.fileStream.on('close', () => {
      this.logger.debug('Stereo recording file stream closed', { 
        filePath: this.config.filePath,
        bytesWritten: this.bytesWritten,
        sessionId: this.config.sessionId 
      });
    });
  }

  private writeWavHeader(): void {
    if (!this.fileStream || this.wavHeaderWritten) return;

    const wavConfig: WavHeaderConfig = {
      channels: 2, // Stereo recording
      sampleRate: this.sampleRate,
      bitsPerSample: this.bitsPerSample
    };

    writeWavHeaderToStream(this.fileStream, wavConfig, this.logger);
    this.wavHeaderWritten = true;
    
    this.logger.debug('Stereo WAV header written', { 
      filePath: this.config.filePath,
      sampleRate: this.sampleRate,
      bitsPerSample: this.bitsPerSample,
      sessionId: this.config.sessionId 
    });
  }






  private tryMixAndWrite(): void {
    if (!this.fileStream || !this.wavHeaderWritten || this.isClosing) return;
    if (this.leftBuffer.length === 0 || this.rightBuffer.length === 0) return;

    // Combine buffers from each channel
    const leftCombined = Buffer.concat(this.leftBuffer);
    const rightCombined = Buffer.concat(this.rightBuffer);
    
    // Find minimum available audio to mix (ensure we don't run out of one channel)
    const minLength = Math.min(leftCombined.length, rightCombined.length);
    
    // Ensure we have at least one complete stereo sample (4 bytes)
    const chunkSize = Math.floor(minLength / 4) * 4;
    
    if (chunkSize >= 4) {
      // Extract portions to mix
      const leftChunk = leftCombined.slice(0, chunkSize);
      const rightChunk = rightCombined.slice(0, chunkSize);
      
      // Mix to stereo and write
      const stereoChunk = this.mixToStereo(leftChunk, rightChunk);
      this.fileStream.write(stereoChunk);
      this.bytesWritten += stereoChunk.length;
      
      // Update buffers with remainders
      const leftRemainder = leftCombined.slice(chunkSize);
      const rightRemainder = rightCombined.slice(chunkSize);
      
      this.leftBuffer = leftRemainder.length > 0 ? [leftRemainder] : [];
      this.rightBuffer = rightRemainder.length > 0 ? [rightRemainder] : [];
      
      // Try to mix more if data is still available
      this.tryMixAndWrite();
    }
  }

  private mixToStereo(leftMono: Buffer, rightMono: Buffer): Buffer {
    const sampleCount = leftMono.length / 2; // 16-bit samples
    const stereoBuffer = Buffer.alloc(sampleCount * 4); // 2 channels * 2 bytes per sample
    
    for (let i = 0; i < sampleCount; i++) {
      const leftSample = leftMono.readInt16LE(i * 2);
      const rightSample = rightMono.readInt16LE(i * 2);
      
      // Write true stereo: both channels playing simultaneously
      stereoBuffer.writeInt16LE(leftSample, i * 4);       // Left channel
      stereoBuffer.writeInt16LE(rightSample, i * 4 + 2);  // Right channel
    }
    
    return stereoBuffer;
  }

  async _write(chunk: any, _encoding: BufferEncoding, callback: (error?: Error | null) => void): Promise<void> {
    try {
      if (!this.fileStream) {
        await this.createFileStream();
      }
      
      if (!this.wavHeaderWritten) {
        this.writeWavHeader();
      }
      
      // Expect chunk to be an object with channel and audio data
      const { channel, audio } = chunk;
      
      if (channel === 'inbound') {
        const convertedAudio = convertAudioData(audio, this.config.codec);
        this.leftBuffer.push(convertedAudio);
        this.tryMixAndWrite(); // Mix immediately when data arrives
      } else if (channel === 'outbound') {
        const convertedAudio = convertAudioData(audio, this.config.codec);
        this.rightBuffer.push(convertedAudio);
        this.tryMixAndWrite(); // Mix immediately when data arrives
      } else {
        this.logger.warn('Unknown channel in stereo recorder', { 
          channel, 
          sessionId: this.config.sessionId 
        });
      }
      
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  async _final(callback: (error?: Error | null) => void): Promise<void> {
    try {
      this.isClosing = true;
      
      // Process any remaining buffered audio before closing
      this.flushBuffers();
      
      if (this.fileStream) {
        // Close the stream first
        await new Promise<void>((resolve) => {
          this.fileStream!.end(() => {
            resolve();
          });
        });
        
        // Update WAV header with final sizes
        await finalizeWavHeader(this.config.filePath, this.bytesWritten, this.logger);
        
        this.logger.info('Stereo recording completed', { 
          filePath: this.config.filePath,
          bytesWritten: this.bytesWritten,
          sessionId: this.config.sessionId 
        });
      }
      
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  private flushBuffers(): void {
    // Mix any remaining audio in buffers, even if one channel is empty
    if (this.leftBuffer.length > 0 || this.rightBuffer.length > 0) {
      const leftCombined = this.leftBuffer.length > 0 ? Buffer.concat(this.leftBuffer) : Buffer.alloc(0);
      const rightCombined = this.rightBuffer.length > 0 ? Buffer.concat(this.rightBuffer) : Buffer.alloc(0);
      
      // Pad the shorter buffer with silence to match lengths
      const maxLength = Math.max(leftCombined.length, rightCombined.length);
      const paddedLeft = maxLength > leftCombined.length ? 
        Buffer.concat([leftCombined, Buffer.alloc(maxLength - leftCombined.length)]) : leftCombined;
      const paddedRight = maxLength > rightCombined.length ?
        Buffer.concat([rightCombined, Buffer.alloc(maxLength - rightCombined.length)]) : rightCombined;
      
      if (maxLength >= 4) {
        const finalChunkSize = Math.floor(maxLength / 4) * 4;
        const finalLeft = paddedLeft.slice(0, finalChunkSize);
        const finalRight = paddedRight.slice(0, finalChunkSize);
        
        const stereoChunk = this.mixToStereo(finalLeft, finalRight);
        if (this.fileStream) {
          this.fileStream.write(stereoChunk);
          this.bytesWritten += stereoChunk.length;
        }
      }
      
      // Clear buffers
      this.leftBuffer = [];
      this.rightBuffer = [];
    }
  }


  public writeInboundAudio(audio: Buffer): void {
    if (!this.isClosing) {
      this.write({ channel: 'inbound', audio });
    }
  }

  public writeOutboundAudio(audio: Buffer): void {
    if (!this.isClosing) {
      this.write({ channel: 'outbound', audio });
    }
  }

  public getStats() {
    return {
      filePath: this.config.filePath,
      bytesWritten: this.bytesWritten,
      wavHeaderWritten: this.wavHeaderWritten,
      sampleRate: this.sampleRate,
      bitsPerSample: this.bitsPerSample,
      leftBufferChunks: this.leftBuffer.length,
      rightBufferChunks: this.rightBuffer.length,
      leftBufferBytes: this.leftBuffer.reduce((total, buf) => total + buf.length, 0),
      rightBufferBytes: this.rightBuffer.reduce((total, buf) => total + buf.length, 0)
    };
  }
}