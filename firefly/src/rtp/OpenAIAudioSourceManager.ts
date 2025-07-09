import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { CodecType } from './types';
import { CodecHandler } from './CodecHandler';
import { 
  CODEC_SILENCE_VALUES, 
  AUDIO_CONSTANTS 
} from '../constants';

export interface OpenAIAudioSourceManagerConfig {
  codec: {
    name: CodecType;
    payload: number;
    clockRate: number;
    channels?: number;
  };
  logger: Logger;
  sessionId: string;
  recordingsPath?: string; // Path to save raw OpenAI audio
  callDirectory?: string; // Call-specific directory (same as conversation.wav)
}

/**
 * OpenAI Audio Source Manager for Continuous RTP Streaming
 * 
 * This class manages audio content for OpenAI bridge sessions, providing a continuous
 * stream of packets that defaults to silence and switches to OpenAI audio when available.
 * 
 * Features:
 * - Continuous silence packets by default
 * - Queues OpenAI audio chunks as they arrive
 * - Thread-safe audio chunk management
 * - No predetermined call duration - runs until manually stopped
 */
export class OpenAIAudioSourceManager {
  private readonly config: OpenAIAudioSourceManagerConfig;
  private readonly logger: Logger;
  private readonly codecHandler: CodecHandler;
  
  // Continuous audio buffer and chunk queue for OpenAI responses
  private audioBuffer: Buffer = Buffer.alloc(0);
  private audioQueue: Buffer[] = [];
  private isCallActive: boolean = true;
  
  // Raw OpenAI audio recording
  private rawAudioFile?: fs.WriteStream;
  private rawAudioPath?: string;
  
  // Timing constants
  private readonly CHUNK_SIZE = AUDIO_CONSTANTS.G711_FRAME_SIZE; // 20ms chunks for G.711
  
  constructor(config: OpenAIAudioSourceManagerConfig) {
    this.config = config;
    this.logger = config.logger;
    this.codecHandler = new CodecHandler();
  }
  
  /**
   * Initialize the audio source manager
   */
  public async initialize(): Promise<void> {
    this.logger.info('Initializing OpenAI audio source manager for continuous streaming', { 
      codec: this.config.codec.name,
      sessionId: this.config.sessionId
    });
    
    this.audioBuffer = Buffer.alloc(0);
    this.audioQueue = [];
    this.isCallActive = true;
    
    // Initialize raw OpenAI audio recording if path is provided
    if (this.config.recordingsPath) {
      await this.initializeRawAudioRecording();
    }
  }
  
  /**
   * Get the next packet for continuous streaming
   * Returns silence by default, or OpenAI audio if available
   * Returns null when the call should end
   */
  public getNextPacket(callTimeMs: number): { packet: Buffer; isAudioDataAvailable: boolean } | null {
    if (!this.isCallActive) {
      return null;
    }
    
    // Check if we have OpenAI audio in the queue
    const audioChunk = this.audioQueue.shift();
    if (audioChunk) {
      this.logger.trace('Returning OpenAI audio chunk', {
        sessionId: this.config.sessionId,
        callTimeMs,
        queueRemaining: this.audioQueue.length
      });
      return { packet: audioChunk, isAudioDataAvailable: true };
    }
    
    // No OpenAI audio available, return silence
    return { packet: this.generateSilencePacket(), isAudioDataAvailable: false };
  }
  
  /**
   * Add OpenAI audio to the continuous buffer
   * This is called when OpenAI sends audio delta events
   */
  public addOpenAIAudio(audioBuffer: Buffer): void {
    // Save raw OpenAI audio immediately before any processing
    if (this.rawAudioFile && audioBuffer.length > 0) {
      this.rawAudioFile.write(audioBuffer);
      this.logger.trace('Wrote raw OpenAI audio to file', {
        sessionId: this.config.sessionId,
        bytesWritten: audioBuffer.length
      });
    }
    
    // Append to continuous buffer
    this.audioBuffer = Buffer.concat([this.audioBuffer, audioBuffer]);
    
    // Extract complete 160-byte packets
    this.extractCompletePackets();
    
    this.logger.trace('Added OpenAI audio to continuous buffer', {
      sessionId: this.config.sessionId,
      bytesAdded: audioBuffer.length,
      totalBufferSize: this.audioBuffer.length,
      packetsExtracted: this.audioQueue.length
    });
  }
  
  /**
   * Get call phase information for debugging
   */
  public getCallPhase(_callTimeMs: number): { phase: string; remaining: number; queueLength: number } {
    if (!this.isCallActive) {
      return { phase: 'call-ended', remaining: 0, queueLength: 0 };
    }
    
    const hasAudio = this.audioQueue.length > 0;
    return { 
      phase: hasAudio ? 'openai-audio' : 'silence', 
      remaining: -1, // Continuous - no predetermined end
      queueLength: this.audioQueue.length
    };
  }
  
  /**
   * End the call - process any remaining audio in buffer
   */
  public endCall(): void {
    // Process any remaining audio in the buffer
    if (this.audioBuffer.length > 0) {
      const paddedChunk = Buffer.alloc(this.CHUNK_SIZE);
      this.audioBuffer.copy(paddedChunk);
      // Fill remainder with codec-appropriate silence
      const silenceValue = this.config.codec.name === CodecType.PCMU ? CODEC_SILENCE_VALUES.PCMU : CODEC_SILENCE_VALUES.PCMA;
      paddedChunk.fill(silenceValue, this.audioBuffer.length);
      this.audioQueue.push(paddedChunk);
      
      this.logger.trace('Processed final partial audio chunk', {
        sessionId: this.config.sessionId,
        originalSize: this.audioBuffer.length,
        paddedSize: this.CHUNK_SIZE
      });
    }
    
    this.isCallActive = false;
    
    // Close raw audio file
    if (this.rawAudioFile) {
      this.rawAudioFile.end();
      this.rawAudioFile = undefined;
      this.logger.info('Closed raw OpenAI audio file', {
        sessionId: this.config.sessionId,
        filePath: this.rawAudioPath
      });
    }
    
    this.logger.info('OpenAI audio source manager: call ended', {
      sessionId: this.config.sessionId,
      remainingQueueLength: this.audioQueue.length
    });
  }
  
  /**
   * Check if call is still active
   */
  public isActive(): boolean {
    return this.isCallActive;
  }
  
  /**
   * Get current queue status for monitoring
   */
  public getQueueStatus(): { length: number; isActive: boolean } {
    return {
      length: this.audioQueue.length,
      isActive: this.isCallActive
    };
  }
  
  /**
   * Generate a silence packet appropriate for the codec
   */
  private generateSilencePacket(): Buffer {
    const silencePayload = this.codecHandler.createSilencePayload(this.config.codec, AUDIO_CONSTANTS.DEFAULT_FRAME_DURATION);
    return silencePayload;
  }
  
  /**
   * Extract complete 160-byte packets from the continuous buffer
   */
  private extractCompletePackets(): void {
    while (this.audioBuffer.length >= this.CHUNK_SIZE) {
      // Extract exactly 160 bytes
      const packet = this.audioBuffer.subarray(0, this.CHUNK_SIZE);
      this.audioQueue.push(Buffer.from(packet));
      
      // Remove the extracted packet from the buffer
      this.audioBuffer = this.audioBuffer.subarray(this.CHUNK_SIZE);
    }
  }
  
  /**
   * Initialize raw OpenAI audio recording
   */
  private async initializeRawAudioRecording(): Promise<void> {
    if (!this.config.recordingsPath || !this.config.callDirectory) {
      return;
    }
    
    try {
      // Use the same directory as conversation.wav
      const callDir = this.config.callDirectory;
      
      // Create raw audio file path in the same directory
      this.rawAudioPath = path.join(callDir, 'openai-raw.g711');
      
      // Create write stream for raw G.711 audio
      this.rawAudioFile = fs.createWriteStream(this.rawAudioPath);
      
      this.logger.info('Initialized raw OpenAI audio recording', {
        sessionId: this.config.sessionId,
        filePath: this.rawAudioPath,
        codec: this.config.codec.name
      });
      
    } catch (error) {
      this.logger.error('Failed to initialize raw OpenAI audio recording', error);
      throw error;
    }
  }
}