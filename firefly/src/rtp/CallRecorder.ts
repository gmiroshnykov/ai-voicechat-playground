import * as fs from 'fs';
import * as path from 'path';
import { createLogger, Logger } from '../utils/logger';
import { CodecInfo } from './types';
import { 
  CODEC_SILENCE_VALUES, 
  AUDIO_CONSTANTS, 
  WAV_CONSTANTS,
  BUFFER_CONSTANTS 
} from '../constants';

export interface CallRecorderConfig {
  enabled: boolean;
  recordingsPath: string;
  callId: string;
  caller: {
    phoneNumber?: string;
    sipUri: string;
  };
  diversion?: string;
  codec: CodecInfo;
}

export interface CallRecorderStats {
  callerPackets: number;
  callerBytes: number;
  aiPackets: number;
  aiBytes: number;
}

export interface CallMetadata {
  callId: string;
  startTime: string;
  endTime?: string;
  duration?: number;
  caller: {
    phoneNumber?: string;
    sipUri: string;
  };
  diversion?: string;
  codec: {
    name: string;
    sampleRate: number;
    channels: number;
  };
  stats: CallRecorderStats;
}

export class CallRecorder {
  private readonly config: CallRecorderConfig;
  private readonly logger: Logger;
  private readonly startTime: Date;
  private callDirectory?: string;
  private stereoStream?: fs.WriteStream;
  private stats: CallRecorderStats;
  private isRecording = false;
  
  // Continuous timeline recording buffers
  private callerAudioBuffer: Buffer[] = [];
  private aiAudioBuffer: Buffer[] = [];
  private silenceValue!: number; // Initialized in start()
  private totalFramesWritten = 0;
  private recordingTimer?: NodeJS.Timeout;
  
  // Transcript management
  private transcriptEntries: Array<{
    speaker: 'caller' | 'ai';
    text: string;
    timestamp: Date;
  }> = [];

  constructor(config: CallRecorderConfig) {
    this.config = config;
    this.startTime = new Date();
    this.logger = createLogger({ 
      component: 'CallRecorder',
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
      this.logger.debug('Starting call recording');
      
      // Create directory structure
      await this.createCallDirectory();
      
      // Initialize WAV files
      await this.initializeWAVFiles();
      
      this.isRecording = true;
      
      // Initialize silence value based on codec
      this.silenceValue = this.config.codec.name === 'PCMA' ? CODEC_SILENCE_VALUES.PCMA : CODEC_SILENCE_VALUES.PCMU;
      
      // Start continuous timeline recording
      this.startContinuousRecording();
      
      this.logger.info('Call recording started');
      
    } catch (error) {
      this.logger.error('Failed to start call recording', error);
      // Don't throw - recording failure shouldn't break the call
      await this.cleanup();
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRecording) {
      return;
    }

    try {
      this.logger.debug('Stopping call recording');
      
      // Stop continuous recording timer
      this.stopContinuousRecording();
      
      // Close audio streams and finalize WAV files
      await this.finalizeWAVFiles();
      
      // Write transcript file
      await this.writeTranscript();
      
      // Write metadata file
      await this.writeMetadata();
      
      this.isRecording = false;
      this.logger.info('Call recording stopped');
      
    } catch (error) {
      this.logger.error('Error stopping call recording', error);
    } finally {
      await this.cleanup();
    }
  }

  public addCallerAudio(audioBuffer: Buffer): void {
    if (!this.isRecording) {
      return;
    }

    try {
      // Append caller audio to buffer for continuous timeline processing
      this.callerAudioBuffer.push(audioBuffer);
      this.stats.callerPackets++;
      this.stats.callerBytes += audioBuffer.length;
    } catch (error) {
      this.logger.error('Error buffering caller audio', error);
    }
  }

  public addAIAudio(audioBuffer: Buffer): void {
    if (!this.isRecording) {
      return;
    }

    try {
      // Append AI audio to buffer for continuous timeline processing
      this.aiAudioBuffer.push(audioBuffer);
      this.stats.aiPackets++;
      this.stats.aiBytes += audioBuffer.length;
    } catch (error) {
      this.logger.error('Error buffering AI audio', error);
    }
  }

  public getStats(): CallRecorderStats {
    return { ...this.stats };
  }

  public addCompletedTranscript(speaker: 'caller' | 'ai', text: string, timestamp: Date): void {
    if (!this.isRecording) {
      return;
    }

    try {
      // Add transcript entry
      this.transcriptEntries.push({
        speaker,
        text: text.trim(),
        timestamp
      });

    } catch (error) {
      this.logger.error('Error adding transcript entry', error);
    }
  }

  /**
   * Start continuous 20ms timeline recording
   */
  private startContinuousRecording(): void {
    this.recordingTimer = setInterval(() => {
      this.recordTimelineFrame();
    }, BUFFER_CONSTANTS.SILENCE_PACKET_INTERVAL); // Every 20ms
    
    this.logger.debug('Started continuous timeline recording');
  }

  /**
   * Stop continuous recording
   */
  private stopContinuousRecording(): void {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = undefined;
      this.logger.debug('Stopped continuous timeline recording');
    }
  }

  /**
   * Record one frame (20ms) from the continuous timeline
   */
  private recordTimelineFrame(): void {
    if (!this.isRecording || !this.stereoStream) {
      return;
    }

    try {
      const frameSize = AUDIO_CONSTANTS.G711_FRAME_SIZE; // 160 bytes = 20ms at 8kHz
      
      // Consume caller audio from buffer (or use silence)
      const callerFrame = this.consumeAudioFromBuffer(this.callerAudioBuffer, frameSize);
      
      // Consume AI audio from buffer (or use silence)
      const aiFrame = this.consumeAudioFromBuffer(this.aiAudioBuffer, frameSize);
      
      // Write stereo frame
      this.writeTimelineFrame(callerFrame, aiFrame);
    } catch (error) {
      this.logger.error('Error in timeline recording frame', error);
      // Don't throw - recording errors shouldn't break the call
    }
  }

  /**
   * Efficiently consume exactly frameSize bytes from buffer, or return silence
   */
  private consumeAudioFromBuffer(buffer: Buffer[], frameSize: number): Buffer {
    if (buffer.length === 0) {
      // No audio available - return silence
      return Buffer.alloc(frameSize, this.silenceValue);
    }

    let totalAvailable = 0;
    
    // Calculate total available bytes without concatenating
    for (const buf of buffer) {
      totalAvailable += buf.length;
      if (totalAvailable >= frameSize) break;
    }

    if (totalAvailable >= frameSize) {
      // We have enough audio - extract exactly frameSize bytes
      const frame = Buffer.alloc(frameSize);
      let frameOffset = 0;
      
      while (frameOffset < frameSize && buffer.length > 0) {
        const currentBuffer = buffer[0]!;
        const needed = frameSize - frameOffset;
        const available = currentBuffer.length;
        
        if (available <= needed) {
          // Use entire buffer
          currentBuffer.copy(frame, frameOffset);
          frameOffset += available;
          buffer.shift(); // Remove consumed buffer
        } else {
          // Use part of buffer
          currentBuffer.subarray(0, needed).copy(frame, frameOffset);
          frameOffset += needed;
          // Keep remainder in buffer
          buffer[0] = currentBuffer.subarray(needed);
        }
      }
      
      return frame;
    } else {
      // Not enough audio - use what we have and pad with silence
      const paddedFrame = Buffer.alloc(frameSize, this.silenceValue);
      let offset = 0;
      
      while (buffer.length > 0 && offset < frameSize) {
        const currentBuffer = buffer.shift()!;
        const available = Math.min(currentBuffer.length, frameSize - offset);
        currentBuffer.subarray(0, available).copy(paddedFrame, offset);
        offset += available;
      }
      
      return paddedFrame;
    }
  }

  /**
   * Write a timeline frame (caller + AI audio)
   */
  private writeTimelineFrame(callerFrame: Buffer, aiFrame: Buffer): void {
    const frameSize = AUDIO_CONSTANTS.G711_FRAME_SIZE;
    
    // Interleave stereo audio (caller left, AI right)
    const stereoFrame = Buffer.alloc(AUDIO_CONSTANTS.STEREO_FRAME_SIZE);
    for (let i = 0; i < frameSize; i++) {
      stereoFrame[i * 2] = callerFrame[i]!;     // Left channel (caller)
      stereoFrame[i * 2 + 1] = aiFrame[i]!;    // Right channel (AI)
    }

    this.stereoStream!.write(stereoFrame);
    this.totalFramesWritten++;
  }



  private async createCallDirectory(): Promise<void> {
    // Create date directory (YYYY-MM-DD)
    const dateStr = this.startTime.toISOString().split('T')[0]!;
    const dateDirectory = path.join(this.config.recordingsPath, dateStr);
    
    // Create call directory with timestamp and caller number
    const timestamp = this.startTime.getTime();
    const callerNumber = this.config.caller.phoneNumber || 'unknown';
    const callDirName = `call-${timestamp}-${callerNumber}`;
    this.callDirectory = path.join(dateDirectory, callDirName);
    
    // Ensure directories exist
    await fs.promises.mkdir(this.callDirectory, { recursive: true });
    
    this.logger.debug('Created call recording directory', {
      directory: this.callDirectory
    });
  }

  private async initializeWAVFiles(): Promise<void> {
    if (!this.callDirectory) {
      throw new Error('Call directory not created');
    }

    const stereoFile = path.join(this.callDirectory, 'conversation.wav');

    // Create stereo WAV file stream with header
    this.stereoStream = fs.createWriteStream(stereoFile);

    // Write WAV header for stereo G.711 audio
    const wavHeader = this.createStereoWAVHeader();
    this.stereoStream.write(wavHeader);

    this.logger.debug('Initialized stereo WAV file', {
      stereoFile,
      codec: this.config.codec.name,
      channels: 2
    });
  }

  private createStereoWAVHeader(): Buffer {
    // WAV header for stereo G.711 PCMA/PCMU (standard 44-byte header)
    const header = Buffer.alloc(WAV_CONSTANTS.HEADER_SIZE);
    
    // RIFF header
    header.write('RIFF', 0);
    header.writeUInt32LE(0, 4); // File size - 8 (placeholder)
    header.write('WAVE', 8);
    
    // Format chunk (16 bytes for standard format chunk)
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Format chunk size (16 for standard PCM)
    
    // Audio format: 6 = A-law, 7 = μ-law
    const formatCode = this.config.codec.name === 'PCMA' ? WAV_CONSTANTS.FORMAT_ALAW : WAV_CONSTANTS.FORMAT_MULAW;
    header.writeUInt16LE(formatCode, 20);
    
    header.writeUInt16LE(WAV_CONSTANTS.STEREO_CHANNELS, 22); // Channels (stereo)
    header.writeUInt32LE(WAV_CONSTANTS.SAMPLE_RATE, 24); // Sample rate
    header.writeUInt32LE(WAV_CONSTANTS.BYTE_RATE, 28); // Byte rate (8000 Hz * 2 channels * 8 bits / 8)
    header.writeUInt16LE(WAV_CONSTANTS.BLOCK_ALIGN, 32); // Block align (2 bytes per sample frame)
    header.writeUInt16LE(WAV_CONSTANTS.BITS_PER_SAMPLE, 34); // Bits per sample
    
    // Data chunk header
    header.write('data', 36);
    header.writeUInt32LE(0, 40); // Data size (placeholder)
    
    return header;
  }

  private async finalizeWAVFiles(): Promise<void> {
    if (this.stereoStream) {
      // Calculate total stereo data size based on frames written
      const frameSize = AUDIO_CONSTANTS.G711_FRAME_SIZE; // mono frame size
      const totalDataSize = this.totalFramesWritten * frameSize * WAV_CONSTANTS.STEREO_CHANNELS; // stereo
      
      this.logger.debug('Finalizing WAV file', {
        totalFramesWritten: this.totalFramesWritten,
        totalDataSize,
        durationSeconds: (this.totalFramesWritten * 20) / 1000
      });
      
      await this.finalizeWAVFile(this.stereoStream, totalDataSize);
      this.stereoStream = undefined;
    }
  }

  private async finalizeWAVFile(stream: fs.WriteStream, dataSize: number): Promise<void> {
    return new Promise((resolve, reject) => {
      stream.end(async () => {
        try {
          // Update WAV header with actual file sizes
          const filePath = stream.path as string;
          const fd = await fs.promises.open(filePath, 'r+');
          
          // Update file size in RIFF header (total file size - 8)
          const fileSize = WAV_CONSTANTS.HEADER_SIZE + dataSize - 8;
          await fd.write(Buffer.from([
            fileSize & 0xff,
            (fileSize >> 8) & 0xff,
            (fileSize >> 16) & 0xff,
            (fileSize >> 24) & 0xff
          ]), 0, 4, 4);
          
          // Update data chunk size
          await fd.write(Buffer.from([
            dataSize & 0xff,
            (dataSize >> 8) & 0xff,
            (dataSize >> 16) & 0xff,
            (dataSize >> 24) & 0xff
          ]), 0, 4, 40);
          
          await fd.close();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private async writeTranscript(): Promise<void> {
    if (!this.callDirectory || this.transcriptEntries.length === 0) {
      return;
    }

    try {
      const transcriptFile = path.join(this.callDirectory, 'conversation.txt');
      const lines: string[] = [];

      // Header
      lines.push(`Call Transcript - ${this.startTime.toISOString().split('T')[0]}`);
      lines.push(`Call ID: ${this.config.callId}`);
      lines.push(`Caller: ${this.config.caller.phoneNumber || 'Unknown'}`);
      if (this.config.diversion) {
        lines.push(`Diversion: ${this.config.diversion}`);
      }
      lines.push('');

      // Transcript entries
      for (const entry of this.transcriptEntries) {
        const timeStr = entry.timestamp.toLocaleTimeString('en-GB', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });

        const speaker = entry.speaker === 'caller' ? 'CALLER' : 'AI';
        lines.push(`[${timeStr}] ${speaker}: ${entry.text}`);
      }

      await fs.promises.writeFile(transcriptFile, lines.join('\n') + '\n');

      this.logger.debug('Wrote transcript file', { 
        transcriptFile,
        entriesCount: this.transcriptEntries.length
      });
    } catch (error) {
      this.logger.error('Error writing transcript file', error);
    }
  }

  private async writeMetadata(): Promise<void> {
    if (!this.callDirectory) {
      return;
    }

    const endTime = new Date();
    const duration = Math.round((endTime.getTime() - this.startTime.getTime()) / 1000);

    const metadata: CallMetadata = {
      callId: this.config.callId,
      startTime: this.startTime.toISOString(),
      endTime: endTime.toISOString(),
      duration,
      caller: this.config.caller,
      diversion: this.config.diversion,
      codec: {
        name: this.config.codec.name,
        sampleRate: this.config.codec.clockRate,
        channels: 2
      },
      stats: this.stats
    };

    const metadataFile = path.join(this.callDirectory, 'metadata.json');
    await fs.promises.writeFile(metadataFile, JSON.stringify(metadata, null, 2));

    this.logger.debug('Wrote call metadata', { metadataFile });
  }

  /**
   * Get the call directory path (where conversation.wav is saved)
   */
  public getCallDirectory(): string | undefined {
    return this.callDirectory;
  }

  private async cleanup(): Promise<void> {
    try {
      // Stop recording timer
      this.stopContinuousRecording();
      
      // Clear audio buffers
      this.callerAudioBuffer = [];
      this.aiAudioBuffer = [];
      
      // Clear transcript entries
      this.transcriptEntries = [];
      
      if (this.stereoStream && !this.stereoStream.destroyed) {
        this.stereoStream.destroy();
      }
    } catch (error) {
      this.logger.error('Error during cleanup', error);
    }
  }
}