import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { CodecType } from './types';
import { CodecHandler } from './CodecHandler';

export interface AudioSourceManagerConfig {
  codec: {
    name: CodecType;
    payload: number;
    clockRate: number;
    channels?: number;
  };
  logger: Logger;
  sessionId: string;
}

/**
 * Audio Source Manager for Time-Based Audio Content
 * 
 * This class manages audio content based on call time, providing a state machine
 * that transitions between silence, audio file playback, and silence again.
 * 
 * Timeline:
 * - 0-1000ms: Silence (comfort noise)
 * - 1000ms-audioEnd: Audio file playback
 * - audioEnd-(audioEnd+1000ms): Silence (comfort noise)
 * - After audioEnd+1000ms: End call
 */
export class AudioSourceManager {
  private readonly config: AudioSourceManagerConfig;
  private readonly logger: Logger;
  private readonly codecHandler: CodecHandler;
  
  // Audio file state
  private audioFileBuffer?: Buffer;
  private audioFileChunks: Buffer[] = [];
  private audioFileIndex: number = 0;
  private audioFileDurationMs: number = 0;
  private audioFileEndTime: number = 0;
  
  // Timing constants
  private readonly PRE_SILENCE_DURATION_MS = 1000;
  private readonly POST_SILENCE_DURATION_MS = 1000;
  private readonly CHUNK_SIZE = 160; // 20ms chunks for G.711
  
  constructor(config: AudioSourceManagerConfig) {
    this.config = config;
    this.logger = config.logger;
    this.codecHandler = new CodecHandler();
  }
  
  /**
   * Initialize the audio source manager by loading the audio file
   */
  public async initialize(): Promise<void> {
    try {
      // Determine which audio file to use based on codec
      const audioFileName = this.config.codec.name === CodecType.PCMU ? 'welcome.pcmu' : 'welcome.pcma';
      const audioFilePath = path.join(__dirname, '../../audio', audioFileName);
      
      this.logger.info('Loading audio file for continuous streaming', { 
        file: audioFileName,
        codec: this.config.codec.name,
        sessionId: this.config.sessionId
      });
      
      // Load the audio file
      this.audioFileBuffer = await fs.promises.readFile(audioFilePath);
      
      // Calculate duration and chunk the audio file
      this.audioFileDurationMs = (this.audioFileBuffer.length / 8); // 8 samples per ms at 8kHz
      this.audioFileEndTime = this.PRE_SILENCE_DURATION_MS + this.audioFileDurationMs;
      
      this.chunkAudioFile();
      
      this.logger.info('Audio file loaded and chunked for continuous streaming', {
        sessionId: this.config.sessionId,
        fileSizeBytes: this.audioFileBuffer.length,
        durationMs: this.audioFileDurationMs,
        totalChunks: this.audioFileChunks.length,
        preSilenceDurationMs: this.PRE_SILENCE_DURATION_MS,
        postSilenceDurationMs: this.POST_SILENCE_DURATION_MS,
        totalCallDurationMs: this.audioFileEndTime + this.POST_SILENCE_DURATION_MS
      });
      
    } catch (error) {
      this.logger.error('Failed to load audio file for continuous streaming', error);
      throw error;
    }
  }
  
  /**
   * Get the next packet based on current call time
   * Returns null when the call should end
   */
  public getNextPacket(callTimeMs: number): Buffer | null {
    // Phase 1: Pre-silence (0-1000ms)
    if (callTimeMs < this.PRE_SILENCE_DURATION_MS) {
      return this.generateSilencePacket();
    }
    
    // Phase 2: Audio file playback (1000ms - audioEnd)
    if (callTimeMs < this.audioFileEndTime) {
      return this.getAudioFileChunk();
    }
    
    // Phase 3: Post-silence (audioEnd - audioEnd+1000ms)
    if (callTimeMs < this.audioFileEndTime + this.POST_SILENCE_DURATION_MS) {
      return this.generateSilencePacket();
    }
    
    // Phase 4: End call
    return null;
  }
  
  /**
   * Get call phase information for debugging
   */
  public getCallPhase(callTimeMs: number): { phase: string; remaining: number } {
    if (callTimeMs < this.PRE_SILENCE_DURATION_MS) {
      return { 
        phase: 'pre-silence', 
        remaining: this.PRE_SILENCE_DURATION_MS - callTimeMs 
      };
    }
    
    if (callTimeMs < this.audioFileEndTime) {
      return { 
        phase: 'audio-file', 
        remaining: this.audioFileEndTime - callTimeMs 
      };
    }
    
    if (callTimeMs < this.audioFileEndTime + this.POST_SILENCE_DURATION_MS) {
      return { 
        phase: 'post-silence', 
        remaining: (this.audioFileEndTime + this.POST_SILENCE_DURATION_MS) - callTimeMs 
      };
    }
    
    return { phase: 'end-call', remaining: 0 };
  }
  
  /**
   * Get total expected call duration
   */
  public getTotalCallDurationMs(): number {
    return this.audioFileEndTime + this.POST_SILENCE_DURATION_MS;
  }
  
  /**
   * Generate a silence packet appropriate for the codec
   */
  private generateSilencePacket(): Buffer {
    const silencePayload = this.codecHandler.createSilencePayload(this.config.codec, 20);
    return silencePayload;
  }
  
  /**
   * Get the next chunk from the audio file
   */
  private getAudioFileChunk(): Buffer {
    if (this.audioFileIndex >= this.audioFileChunks.length) {
      // Audio file has ended, return silence
      return this.generateSilencePacket();
    }
    
    const chunk = this.audioFileChunks[this.audioFileIndex];
    this.audioFileIndex++;
    
    return chunk!;
  }
  
  /**
   * Chunk the audio file into 20ms packets
   */
  private chunkAudioFile(): void {
    if (!this.audioFileBuffer) {
      throw new Error('Audio file buffer not loaded');
    }
    
    this.audioFileChunks = [];
    this.audioFileIndex = 0;
    
    let offset = 0;
    while (offset < this.audioFileBuffer.length) {
      const remainingBytes = this.audioFileBuffer.length - offset;
      const currentChunkSize = Math.min(this.CHUNK_SIZE, remainingBytes);
      
      // Extract chunk
      const chunk = this.audioFileBuffer.subarray(offset, offset + currentChunkSize);
      
      // Pad with silence if chunk is smaller than expected
      let paddedChunk = chunk;
      if (chunk.length < this.CHUNK_SIZE) {
        paddedChunk = Buffer.alloc(this.CHUNK_SIZE);
        chunk.copy(paddedChunk);
        // Fill remainder with codec-appropriate silence
        const silenceValue = this.config.codec.name === CodecType.PCMU ? 0xFF : 0xD5;
        paddedChunk.fill(silenceValue, chunk.length);
      }
      
      this.audioFileChunks.push(paddedChunk);
      offset += currentChunkSize;
    }
    
    this.logger.debug('Audio file chunked', {
      sessionId: this.config.sessionId,
      totalChunks: this.audioFileChunks.length,
      originalSizeBytes: this.audioFileBuffer.length,
      chunkSizeBytes: this.CHUNK_SIZE
    });
  }
}