import { Writable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger, Logger } from '../utils/logger';
// import { CodecInfo } from './types';
import { 
  CODEC_SILENCE_VALUES, 
  AUDIO_CONSTANTS, 
  WAV_CONSTANTS
} from '../constants';
import { CallRecorderConfig, CallRecorderStats, CallMetadata } from './CallRecorder';

/**
 * Stream-based call recorder that can be used as a writable stream
 * in the audio pipeline for recording caller audio
 */
export class CallRecorderStream extends Writable {
  private readonly config: CallRecorderConfig;
  private readonly logger: Logger;
  private readonly startTime: Date;
  private callDirectory?: string;
  private stereoStream?: fs.WriteStream;
  private stats: CallRecorderStats;
  private isRecording = false;
  private silenceValue!: number;
  private totalFramesWritten = 0;

  // For storing AI audio that comes from a separate stream
  private aiAudioBuffer: Buffer[] = [];
  private recordingTimer?: NodeJS.Timeout;

  constructor(config: CallRecorderConfig) {
    super({ 
      objectMode: false,
      highWaterMark: 64 * 1024 // 64KB buffer
    });
    
    this.config = config;
    this.startTime = new Date();
    this.logger = createLogger({ 
      component: 'CallRecorderStream',
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
      this.logger.debug('Starting call recording stream');
      
      // Create directory structure
      await this.createCallDirectory();
      
      // Initialize WAV file
      await this.initializeStereoRecording();
      
      // Start continuous recording timer
      this.startRecordingTimer();
      
      this.isRecording = true;
      
      this.logger.info('Call recording stream started', {
        callDirectory: this.callDirectory,
        codec: this.config.codec.name
      });
      
    } catch (error) {
      this.logger.error('Failed to start call recording stream', error);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRecording) {
      return;
    }

    try {
      this.logger.debug('Stopping call recording stream');
      
      // Stop recording timer
      if (this.recordingTimer) {
        clearTimeout(this.recordingTimer);
        this.recordingTimer = undefined;
      }
      
      // Finalize WAV file
      await this.finalizeStereoRecording();
      
      // Save metadata
      await this.saveCallMetadata();
      
      this.isRecording = false;
      
      this.logger.info('Call recording stream stopped', {
        totalFrames: this.totalFramesWritten,
        stats: this.stats
      });
      
    } catch (error) {
      this.logger.error('Error stopping call recording stream', error);
      throw error;
    }
  }

  _write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void): void {
    if (!this.isRecording) {
      callback();
      return;
    }

    try {
      // This is caller audio from the stream pipeline
      this.addCallerAudio(chunk);
      callback();
    } catch (error) {
      this.logger.error('Error writing caller audio', error);
      callback(error as Error);
    }
  }

  /**
   * Add AI audio (called from external source, not from the stream)
   */
  public addAIAudio(audioData: Buffer): void {
    if (!this.isRecording) {
      return;
    }

    this.aiAudioBuffer.push(audioData);
    this.stats.aiPackets++;
    this.stats.aiBytes += audioData.length;
  }

  private addCallerAudio(audioData: Buffer): void {
    if (!this.isRecording) {
      return;
    }

    // For now, just buffer the caller audio
    // The actual stereo mixing will happen in the recording timer
    this.stats.callerPackets++;
    this.stats.callerBytes += audioData.length;
    
    // Write to stereo stream immediately with silence for AI channel
    this.writeToStereoStream(audioData, this.createSilenceBuffer(audioData.length));
  }

  private createSilenceBuffer(length: number): Buffer {
    const silence = Buffer.alloc(length);
    silence.fill(this.silenceValue);
    return silence;
  }

  private writeToStereoStream(callerAudio: Buffer, aiAudio: Buffer): void {
    if (!this.stereoStream) {
      return;
    }

    // Create interleaved stereo audio (caller = left, AI = right)
    const stereoBuffer = this.interleaveStereoAudio(callerAudio, aiAudio);
    this.stereoStream.write(stereoBuffer);
    this.totalFramesWritten += callerAudio.length;
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

  private startRecordingTimer(): void {
    // Process AI audio buffer periodically
    this.recordingTimer = setInterval(() => {
      this.processAIAudioBuffer();
    }, 20); // 20ms interval
  }

  private processAIAudioBuffer(): void {
    if (this.aiAudioBuffer.length === 0) {
      return;
    }

    // Process buffered AI audio
    const aiChunks = this.aiAudioBuffer.splice(0);
    for (const chunk of aiChunks) {
      const silenceBuffer = this.createSilenceBuffer(chunk.length);
      this.writeToStereoStream(silenceBuffer, chunk);
    }
  }

  private async finalizeStereoRecording(): Promise<void> {
    if (!this.stereoStream) {
      return;
    }

    // Process any remaining AI audio
    this.processAIAudioBuffer();
    
    // Update WAV header with actual file size
    const filePath = (this.stereoStream as any).path;
    this.stereoStream.end();
    
    // Wait for stream to finish
    await new Promise<void>((resolve, reject) => {
      this.stereoStream!.on('finish', resolve);
      this.stereoStream!.on('error', reject);
    });
    
    // Update WAV header with correct sizes
    await this.updateWavHeader(filePath, this.totalFramesWritten * 2); // *2 for stereo
    
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