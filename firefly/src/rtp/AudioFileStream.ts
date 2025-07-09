import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { CodecType } from './types';
import { AUDIO_CONSTANTS, BUFFER_CONSTANTS } from '../constants';

export interface AudioFileStreamConfig {
  codec: {
    name: CodecType;
    payload: number;
    clockRate: number;
    channels?: number;
  };
  logger: Logger;
  sessionId: string;
  chunkSize?: number; // Default: 20ms chunks
}

/**
 * Readable stream that provides audio data from files in a time-based manner
 * 
 * Timeline:
 * - 0-1000ms: Silence (comfort noise)
 * - 1000ms-audioEnd: Audio file playback
 * - audioEnd-(audioEnd+1000ms): Silence (comfort noise)
 * - After audioEnd+1000ms: End stream
 */
export class AudioFileStream extends Readable {
  private readonly config: AudioFileStreamConfig;
  private readonly logger: Logger;
  private readonly chunkSize: number;
  
  // Audio file state
  private audioFileBuffer?: Buffer;
  private audioFileDurationMs: number = 0;
  private audioFileEndTime: number = 0;
  
  // Streaming state
  private currentTimeMs: number = 0;
  private audioFileIndex: number = 0;
  private isCompleted: boolean = false;
  
  // Timing constants
  private readonly PRE_SILENCE_DURATION_MS = BUFFER_CONSTANTS.PRE_SILENCE_DURATION;
  private readonly POST_SILENCE_DURATION_MS = BUFFER_CONSTANTS.POST_SILENCE_DURATION;
  private readonly CHUNK_INTERVAL_MS = 20; // 20ms per chunk

  constructor(config: AudioFileStreamConfig) {
    super({ objectMode: false });
    
    this.config = config;
    this.logger = config.logger;
    this.chunkSize = config.chunkSize || AUDIO_CONSTANTS.G711_FRAME_SIZE;
  }

  public async initialize(): Promise<void> {
    try {
      // Determine which audio file to use based on codec
      const audioFileName = this.config.codec.name === CodecType.PCMU ? 'welcome.pcmu' : 'welcome.pcma';
      // Use absolute path from project root to work in both src and dist
      const projectRoot = path.resolve(__dirname, '../..');
      const audioFilePath = path.join(projectRoot, 'audio', audioFileName);
      
      this.logger.debug('Loading audio file for stream processing', { 
        file: audioFileName,
        codec: this.config.codec.name,
        sessionId: this.config.sessionId
      });
      
      // Load the audio file
      this.audioFileBuffer = await fs.promises.readFile(audioFilePath);
      
      // Calculate duration
      this.audioFileDurationMs = (this.audioFileBuffer.length / AUDIO_CONSTANTS.G711_SAMPLES_PER_MS);
      this.audioFileEndTime = this.PRE_SILENCE_DURATION_MS + this.audioFileDurationMs;
      
      this.logger.debug('Audio file loaded for streaming', {
        totalBytes: this.audioFileBuffer.length,
        durationMs: this.audioFileDurationMs,
        totalCallDurationMs: this.audioFileEndTime + this.POST_SILENCE_DURATION_MS
      });
      
    } catch (error) {
      this.logger.error('Failed to initialize audio file stream', error);
      throw error;
    }
  }

  public getTotalDurationMs(): number {
    return this.audioFileEndTime + this.POST_SILENCE_DURATION_MS;
  }

  public getCurrentPhase(): { phase: string; remaining: number } {
    if (this.currentTimeMs < this.PRE_SILENCE_DURATION_MS) {
      return { 
        phase: 'pre-silence', 
        remaining: this.PRE_SILENCE_DURATION_MS - this.currentTimeMs 
      };
    } else if (this.currentTimeMs < this.audioFileEndTime) {
      return { 
        phase: 'audio-playback', 
        remaining: this.audioFileEndTime - this.currentTimeMs 
      };
    } else if (this.currentTimeMs < this.audioFileEndTime + this.POST_SILENCE_DURATION_MS) {
      return { 
        phase: 'post-silence', 
        remaining: (this.audioFileEndTime + this.POST_SILENCE_DURATION_MS) - this.currentTimeMs 
      };
    } else {
      return { phase: 'completed', remaining: 0 };
    }
  }

  _read(): void {
    if (this.isCompleted) {
      this.push(null); // End stream
      return;
    }

    if (!this.audioFileBuffer) {
      this.emit('error', new Error('Audio file not initialized'));
      return;
    }

    const chunk = this.getNextChunk();
    if (chunk) {
      this.push(chunk);
      this.currentTimeMs += this.CHUNK_INTERVAL_MS;
    } else {
      this.isCompleted = true;
      this.push(null); // End stream
    }
  }

  private getNextChunk(): Buffer | null {
    const phase = this.getCurrentPhase();
    
    switch (phase.phase) {
      case 'pre-silence':
      case 'post-silence':
        return this.getSilenceChunk();
      
      case 'audio-playback':
        return this.getAudioChunk();
      
      case 'completed':
        return null;
      
      default:
        return null;
    }
  }

  private getSilenceChunk(): Buffer {
    // Generate silence appropriate for the codec
    const silenceValue = this.config.codec.name === CodecType.PCMU ? 0xFF : 0x55;
    return Buffer.alloc(this.chunkSize, silenceValue);
  }

  private getAudioChunk(): Buffer {
    if (!this.audioFileBuffer) {
      return this.getSilenceChunk();
    }

    const startByte = this.audioFileIndex;
    const endByte = Math.min(startByte + this.chunkSize, this.audioFileBuffer.length);
    
    if (startByte >= this.audioFileBuffer.length) {
      return this.getSilenceChunk();
    }

    const chunk = this.audioFileBuffer.subarray(startByte, endByte);
    this.audioFileIndex = endByte;

    // Pad with silence if chunk is too short
    if (chunk.length < this.chunkSize) {
      const silenceValue = this.config.codec.name === CodecType.PCMU ? 0xFF : 0x55;
      const paddedChunk = Buffer.alloc(this.chunkSize, silenceValue);
      chunk.copy(paddedChunk, 0);
      return paddedChunk;
    }

    return chunk;
  }
}