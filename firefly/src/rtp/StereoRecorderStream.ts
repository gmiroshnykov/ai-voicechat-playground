import { Writable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger, Logger } from '../utils/logger';
import { 
  CODEC_SILENCE_VALUES, 
  AUDIO_CONSTANTS, 
  WAV_CONSTANTS
} from '../constants';
import { CallRecorderConfig, CallRecorderStats, CallMetadata } from './CallRecorder';

/**
 * Channel identifier for stereo recording
 */
export type AudioChannel = 'caller' | 'ai';

/**
 * Stream-based stereo call recorder that mixes caller and AI audio in real-time
 * No timers or buffering - pure stream-based approach
 */
export class StereoRecorderStream extends Writable {
  private readonly config: CallRecorderConfig;
  private readonly logger: Logger;
  private readonly startTime: Date;
  private callDirectory?: string;
  private stereoStream?: fs.WriteStream;
  private stats: CallRecorderStats;
  private isRecording = false;
  private silenceValue!: number;
  private totalFramesWritten = 0;

  // Real-time frame mixing
  private currentCallerFrame: Buffer = Buffer.alloc(0);
  private currentAIFrame: Buffer = Buffer.alloc(0);
  private readonly frameSize = AUDIO_CONSTANTS.G711_FRAME_SIZE; // 160 bytes = 20ms

  constructor(config: CallRecorderConfig) {
    super({ 
      objectMode: false,
      highWaterMark: 64 * 1024 // 64KB buffer
    });
    
    this.config = config;
    this.startTime = new Date();
    this.logger = createLogger({ 
      component: 'StereoRecorderStream',
      callId: config.callId 
    });
    
    this.stats = {
      callerPackets: 0,
      callerBytes: 0,
      aiPackets: 0,
      aiBytes: 0
    };
  }

  public async start(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.debug('Call recording disabled, skipping');
      return;
    }

    try {
      this.logger.debug('Starting stereo recording stream');
      
      // Create directory structure
      await this.createCallDirectory();
      
      // Initialize WAV file
      await this.initializeStereoRecording();
      
      this.isRecording = true;
      
      this.logger.info('Stereo recording stream started', {
        callDirectory: this.callDirectory,
        codec: this.config.codec.name
      });
      
    } catch (error) {
      this.logger.error('Failed to start stereo recording stream', error);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRecording) {
      return;
    }

    try {
      this.logger.debug('Stopping stereo recording stream');
      
      // Finalize WAV file
      await this.finalizeStereoRecording();
      
      // Save metadata
      await this.saveCallMetadata();
      
      this.isRecording = false;
      
      this.logger.info('Stereo recording stream stopped', {
        totalFrames: this.totalFramesWritten,
        stats: this.stats
      });
      
    } catch (error) {
      this.logger.error('Error stopping stereo recording stream', error);
      throw error;
    }
  }

  /**
   * Main write method - receives mixed audio chunks tagged with channel info
   */
  _write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void): void {
    if (!this.isRecording) {
      callback();
      return;
    }

    try {
      // This implementation expects pre-mixed stereo audio
      // Individual channel writes should use writeChannelAudio() method
      this.writeToStereoStream(chunk);
      callback();
    } catch (error) {
      this.logger.error('Error writing to stereo recording', error);
      callback(error as Error);
    }
  }

  /**
   * Write audio from a specific channel (caller or AI)
   * This method handles real-time mixing of the two channels
   */
  public writeChannelAudio(channel: AudioChannel, audioData: Buffer): void {
    if (!this.isRecording) {
      return;
    }

    // Update stats
    if (channel === 'caller') {
      this.stats.callerPackets++;
      this.stats.callerBytes += audioData.length;
    } else {
      this.stats.aiPackets++;
      this.stats.aiBytes += audioData.length;
    }

    // Process audio data in frame-sized chunks
    let offset = 0;
    while (offset < audioData.length) {
      const remainingBytes = audioData.length - offset;
      const chunkSize = Math.min(this.frameSize, remainingBytes);
      const chunk = audioData.subarray(offset, offset + chunkSize);
      
      this.processChannelChunk(channel, chunk);
      offset += chunkSize;
    }
  }

  /**
   * Process a chunk of audio for a specific channel
   * Mixes with the other channel and writes complete stereo frames
   */
  private processChannelChunk(channel: AudioChannel, chunk: Buffer): void {
    if (channel === 'caller') {
      this.currentCallerFrame = Buffer.concat([this.currentCallerFrame, chunk]);
    } else {
      this.currentAIFrame = Buffer.concat([this.currentAIFrame, chunk]);
    }

    // When we have enough data for a complete frame, mix and write
    const minFrameLength = Math.min(this.currentCallerFrame.length, this.currentAIFrame.length);
    
    if (minFrameLength >= this.frameSize) {
      const callerFrameData = this.currentCallerFrame.subarray(0, this.frameSize);
      const aiFrameData = this.currentAIFrame.subarray(0, this.frameSize);
      
      // Create interleaved stereo frame
      const stereoFrame = this.interleaveStereoAudio(callerFrameData, aiFrameData);
      this.writeToStereoStream(stereoFrame);
      
      // Remove processed data from buffers
      this.currentCallerFrame = this.currentCallerFrame.subarray(this.frameSize);
      this.currentAIFrame = this.currentAIFrame.subarray(this.frameSize);
    }
  }

  /**
   * Force write any remaining buffered audio (called during stop)
   */
  public flushBufferedAudio(): void {
    if (this.currentCallerFrame.length > 0 || this.currentAIFrame.length > 0) {
      const maxLength = Math.max(this.currentCallerFrame.length, this.currentAIFrame.length);
      
      // Pad shorter buffer with silence
      const callerPadded = this.padWithSilence(this.currentCallerFrame, maxLength);
      const aiPadded = this.padWithSilence(this.currentAIFrame, maxLength);
      
      const stereoFrame = this.interleaveStereoAudio(callerPadded, aiPadded);
      this.writeToStereoStream(stereoFrame);
      
      // Clear buffers
      this.currentCallerFrame = Buffer.alloc(0);
      this.currentAIFrame = Buffer.alloc(0);
    }
  }

  private padWithSilence(buffer: Buffer, targetLength: number): Buffer {
    if (buffer.length >= targetLength) {
      return buffer;
    }
    
    const padded = Buffer.alloc(targetLength);
    buffer.copy(padded);
    padded.fill(this.silenceValue, buffer.length);
    return padded;
  }

  private interleaveStereoAudio(leftChannel: Buffer, rightChannel: Buffer): Buffer {
    const maxLength = Math.max(leftChannel.length, rightChannel.length);
    const stereoBuffer = Buffer.alloc(maxLength * 2);
    
    for (let i = 0; i < maxLength; i++) {
      const leftSample = i < leftChannel.length ? leftChannel[i]! : this.silenceValue;
      const rightSample = i < rightChannel.length ? rightChannel[i]! : this.silenceValue;
      
      stereoBuffer[i * 2] = leftSample;
      stereoBuffer[i * 2 + 1] = rightSample;
    }
    
    return stereoBuffer;
  }

  private writeToStereoStream(stereoData: Buffer): void {
    if (!this.stereoStream) {
      return;
    }

    this.stereoStream.write(stereoData);
    this.totalFramesWritten += stereoData.length / 2; // Divide by 2 for stereo
  }

  private async createCallDirectory(): Promise<void> {
    const dateStr = this.startTime.toISOString().split('T')[0]!;
    const timeStr = this.startTime.getTime().toString();
    const callerStr = this.config.caller.phoneNumber || 'unknown';
    
    this.callDirectory = path.join(
      this.config.recordingsPath,
      dateStr,
      `call-${timeStr}-${callerStr}`
    );
    
    await fs.promises.mkdir(this.callDirectory, { recursive: true });
    
    this.logger.debug('Created call directory', {
      directory: this.callDirectory
    });
  }

  private async initializeStereoRecording(): Promise<void> {
    if (!this.callDirectory) {
      throw new Error('Call directory not initialized');
    }

    // Set silence value based on codec
    this.silenceValue = this.config.codec.name === 'PCMU' ? 
      CODEC_SILENCE_VALUES.PCMU : CODEC_SILENCE_VALUES.PCMA;

    // Create stereo WAV file
    const stereoPath = path.join(this.callDirectory, 'conversation.wav');
    this.stereoStream = fs.createWriteStream(stereoPath);
    
    // Write WAV header for stereo (2 channels)
    const wavHeader = this.createWavHeader(2);
    this.stereoStream.write(wavHeader);
    
    this.logger.debug('Initialized stereo recording', {
      path: stereoPath,
      codec: this.config.codec.name,
      silenceValue: this.silenceValue
    });
  }

  private createWavHeader(channels: number): Buffer {
    const sampleRate = AUDIO_CONSTANTS.SAMPLE_RATE;
    const bitsPerSample = WAV_CONSTANTS.BITS_PER_SAMPLE;
    const header = Buffer.alloc(WAV_CONSTANTS.HEADER_SIZE);
    
    // RIFF header
    header.write('RIFF', 0);
    header.writeUInt32LE(0xFFFFFFFF, 4); // File size (will be updated later)
    header.write('WAVE', 8);
    
    // fmt chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Subchunk1Size
    header.writeUInt16LE(1, 20); // AudioFormat (PCM)
    header.writeUInt16LE(channels, 22); // NumChannels
    header.writeUInt32LE(sampleRate, 24); // SampleRate
    header.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28); // ByteRate
    header.writeUInt16LE(channels * bitsPerSample / 8, 32); // BlockAlign
    header.writeUInt16LE(bitsPerSample, 34); // BitsPerSample
    
    // data chunk
    header.write('data', 36);
    header.writeUInt32LE(0xFFFFFFFF, 40); // Subchunk2Size (will be updated later)
    
    return header;
  }

  private async finalizeStereoRecording(): Promise<void> {
    if (!this.stereoStream) {
      return;
    }

    // Flush any remaining buffered audio
    this.flushBufferedAudio();
    
    // Update WAV header with actual file size
    const filePath = (this.stereoStream as any).path;
    this.stereoStream.end();
    
    // Wait for stream to finish
    await new Promise<void>((resolve, reject) => {
      this.stereoStream!.on('finish', resolve);
      this.stereoStream!.on('error', reject);
    });
    
    // Update WAV header with correct sizes
    await this.updateWavHeader(filePath, this.totalFramesWritten);
    
    this.logger.debug('Finalized stereo recording', {
      path: filePath,
      totalFrames: this.totalFramesWritten
    });
  }

  private async updateWavHeader(filePath: string, dataSize: number): Promise<void> {
    const handle = await fs.promises.open(filePath, 'r+');
    
    try {
      // Update file size (total file size - 8 bytes)
      const fileSize = dataSize + WAV_CONSTANTS.HEADER_SIZE - 8;
      await handle.write(Buffer.from([
        fileSize & 0xff,
        (fileSize >> 8) & 0xff,
        (fileSize >> 16) & 0xff,
        (fileSize >> 24) & 0xff
      ]), 0, 4, 4);
      
      // Update data chunk size
      await handle.write(Buffer.from([
        dataSize & 0xff,
        (dataSize >> 8) & 0xff,
        (dataSize >> 16) & 0xff,
        (dataSize >> 24) & 0xff
      ]), 0, 4, 40);
      
    } finally {
      await handle.close();
    }
  }

  private async saveCallMetadata(): Promise<void> {
    if (!this.callDirectory) {
      return;
    }

    const endTime = new Date();
    const metadata: CallMetadata = {
      callId: this.config.callId,
      startTime: this.startTime.toISOString(),
      endTime: endTime.toISOString(),
      duration: endTime.getTime() - this.startTime.getTime(),
      caller: this.config.caller,
      diversion: this.config.diversion,
      codec: {
        name: this.config.codec.name,
        sampleRate: this.config.codec.clockRate,
        channels: this.config.codec.channels || 1
      },
      stats: this.stats
    };

    const metadataPath = path.join(this.callDirectory, 'metadata.json');
    await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    
    this.logger.debug('Saved call metadata', {
      path: metadataPath,
      metadata
    });
  }

  public getCallDirectory(): string | undefined {
    return this.callDirectory;
  }

  public getStats(): Readonly<CallRecorderStats> {
    return { ...this.stats };
  }
}