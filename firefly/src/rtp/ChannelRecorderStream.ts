import { Writable } from 'stream';
import { createWriteStream, WriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { CodecInfo, CodecType } from './types';
import { Logger } from '../utils/logger';

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
    this.bitsPerSample = this.getBitsPerSample(config.codec.name);
  }

  private getBitsPerSample(codecName: string): number {
    // All codecs are converted to 16-bit PCM for WAV output
    switch (codecName) {
      case CodecType.PCMU:
      case CodecType.PCMA:
        return 16; // G.711 converted to 16-bit PCM
      case CodecType.G722:
        return 16; // G.722 uses 16 bits per sample
      case CodecType.OPUS:
        return 16; // OPUS typically decoded to 16 bits
      default:
        return 16; // Default to 16 bits
    }
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

    const channels = 1; // Mono recording
    const byteRate = this.sampleRate * channels * (this.bitsPerSample / 8);
    const blockAlign = channels * (this.bitsPerSample / 8);

    // WAV header structure
    const header = Buffer.alloc(44);
    
    // RIFF header
    header.write('RIFF', 0);
    header.writeUInt32LE(0, 4); // File size - 8 (will be updated later)
    header.write('WAVE', 8);
    
    // fmt chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // fmt chunk size
    header.writeUInt16LE(1, 20); // PCM format
    header.writeUInt16LE(channels, 22); // Number of channels
    header.writeUInt32LE(this.sampleRate, 24); // Sample rate
    header.writeUInt32LE(byteRate, 28); // Byte rate
    header.writeUInt16LE(blockAlign, 32); // Block align
    header.writeUInt16LE(this.bitsPerSample, 34); // Bits per sample
    
    // data chunk
    header.write('data', 36);
    header.writeUInt32LE(0, 40); // Data size (will be updated later)
    
    this.fileStream.write(header);
    this.wavHeaderWritten = true;
    
    this.logger.debug('WAV header written', { 
      filePath: this.config.filePath,
      channelName: this.config.channelName,
      sampleRate: this.sampleRate,
      bitsPerSample: this.bitsPerSample,
      sessionId: this.config.sessionId 
    });
  }

  private convertAudioData(audioBuffer: Buffer): Buffer {
    // Convert codec-specific audio data to PCM for WAV
    switch (this.config.codec.name) {
      case CodecType.PCMU:
        return this.convertPCMUToPCM(audioBuffer);
      case CodecType.PCMA:
        return this.convertPCMAToPCM(audioBuffer);
      case CodecType.G722:
      case CodecType.OPUS:
        // For G.722 and OPUS, assume they're already decoded to PCM
        return audioBuffer;
      default:
        return audioBuffer;
    }
  }

  private convertPCMUToPCM(pcmuBuffer: Buffer): Buffer {
    // Simple G.711 μ-law to 16-bit PCM conversion
    const pcmBuffer = Buffer.alloc(pcmuBuffer.length * 2);
    for (let i = 0; i < pcmuBuffer.length; i++) {
      const byte = pcmuBuffer[i];
      if (byte !== undefined) {
        const sample = this.ulaw2linear(byte);
        pcmBuffer.writeInt16LE(sample, i * 2);
      }
    }
    return pcmBuffer;
  }

  private convertPCMAToPCM(pcmaBuffer: Buffer): Buffer {
    // Simple G.711 A-law to 16-bit PCM conversion
    const pcmBuffer = Buffer.alloc(pcmaBuffer.length * 2);
    for (let i = 0; i < pcmaBuffer.length; i++) {
      const byte = pcmaBuffer[i];
      if (byte !== undefined) {
        const sample = this.alaw2linear(byte);
        pcmBuffer.writeInt16LE(sample, i * 2);
      }
    }
    return pcmBuffer;
  }

  private ulaw2linear(ulaw: number): number {
    // G.711 μ-law to linear PCM conversion
    const BIAS = 0x84;
    const CLIP = 8159;
    
    ulaw = ~ulaw;
    const sign = (ulaw & 0x80) ? -1 : 1;
    const exponent = (ulaw >> 4) & 0x07;
    const mantissa = ulaw & 0x0F;
    
    let sample = mantissa * 2 + 33;
    sample = sample << (exponent + 2);
    sample -= BIAS;
    
    return sign * Math.min(sample, CLIP);
  }

  private alaw2linear(alaw: number): number {
    // G.711 A-law to linear PCM conversion
    const sign = (alaw & 0x80) ? -1 : 1;
    const exponent = (alaw >> 4) & 0x07;
    const mantissa = alaw & 0x0F;
    
    let sample = mantissa * 2;
    if (exponent > 0) {
      sample += 33;
      sample = sample << (exponent - 1);
    } else {
      sample += 1;
    }
    
    return sign * sample * 16;
  }


  async _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): Promise<void> {
    try {
      if (!this.fileStream) {
        await this.createFileStream();
      }
      
      if (!this.wavHeaderWritten) {
        this.writeWavHeader();
      }
      
      const convertedAudio = this.convertAudioData(chunk);
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
        await this.finalizeWavHeader();
        
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

  private async finalizeWavHeader(): Promise<void> {
    if (!this.wavHeaderWritten || this.bytesWritten === 0) return;

    try {
      const fs = await import('fs');
      const fileHandle = await fs.promises.open(this.config.filePath, 'r+');
      
      try {
        // Update file size (total file size - 8) at offset 4
        const fileSizeBuffer = Buffer.alloc(4);
        fileSizeBuffer.writeUInt32LE(this.bytesWritten + 36, 0); // 44 - 8 = 36
        await fileHandle.write(fileSizeBuffer, 0, 4, 4);
        
        // Update data chunk size at offset 40
        const dataSizeBuffer = Buffer.alloc(4);
        dataSizeBuffer.writeUInt32LE(this.bytesWritten, 0);
        await fileHandle.write(dataSizeBuffer, 0, 4, 40);
        
        this.logger.debug('WAV header finalized', {
          filePath: this.config.filePath,
          channelName: this.config.channelName,
          totalFileSize: this.bytesWritten + 44,
          audioDataSize: this.bytesWritten,
          sessionId: this.config.sessionId
        });
      } finally {
        await fileHandle.close();
      }
    } catch (error) {
      this.logger.error('Failed to finalize WAV header', {
        filePath: this.config.filePath,
        channelName: this.config.channelName,
        error,
        sessionId: this.config.sessionId
      });
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