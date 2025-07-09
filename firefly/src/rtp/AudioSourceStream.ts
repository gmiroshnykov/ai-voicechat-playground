import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { CodecType } from './types';
import { CodecHandler } from './CodecHandler';
import { 
  CODEC_SILENCE_VALUES, 
  AUDIO_CONSTANTS,
  BUFFER_CONSTANTS 
} from '../constants';

export interface AudioSourceStreamConfig {
  codec: {
    name: CodecType;
    payload: number;
    clockRate: number;
    channels?: number;
  };
  logger: Logger;
  sessionId: string;
  audioFile?: string; // Optional audio file to play
}

/**
 * Stream-based audio source that naturally emits audio sequence
 * 
 * Instead of time-based conditionals, this stream naturally emits:
 * 1. Pre-silence chunks
 * 2. Audio file chunks (if provided)
 * 3. Post-silence chunks
 * 4. End of stream
 * 
 * Philosophy: Let the stream naturally control timing and sequence
 */
export class AudioSourceStream extends Readable {
  private readonly config: AudioSourceStreamConfig;
  private readonly logger: Logger;
  private readonly codecHandler: CodecHandler;
  
  // Audio sequence state
  private currentPhase: 'pre-silence' | 'audio-file' | 'post-silence' | 'complete' = 'pre-silence';
  private audioFileBuffer?: Buffer;
  private audioFileChunks: Buffer[] = [];
  private audioFileIndex = 0;
  
  // Timing constants
  private readonly PRE_SILENCE_DURATION_MS = BUFFER_CONSTANTS.PRE_SILENCE_DURATION;
  private readonly POST_SILENCE_DURATION_MS = BUFFER_CONSTANTS.POST_SILENCE_DURATION;
  private readonly CHUNK_SIZE = AUDIO_CONSTANTS.G711_FRAME_SIZE; // 20ms chunks
  private readonly CHUNK_INTERVAL_MS = AUDIO_CONSTANTS.DEFAULT_FRAME_DURATION; // 20ms
  
  // Silence generation
  private silencePacketsEmitted = 0;
  private maxPreSilencePackets = 0;
  private maxPostSilencePackets = 0;

  constructor(config: AudioSourceStreamConfig) {
    super({
      objectMode: false, // We emit audio Buffer objects
      highWaterMark: 16 * 1024 // 16KB buffer
    });
    
    this.config = config;
    this.logger = config.logger;
    this.codecHandler = new CodecHandler();
    
    // Calculate silence packet counts
    this.maxPreSilencePackets = Math.floor(this.PRE_SILENCE_DURATION_MS / this.CHUNK_INTERVAL_MS);
    this.maxPostSilencePackets = Math.floor(this.POST_SILENCE_DURATION_MS / this.CHUNK_INTERVAL_MS);
  }

  /**
   * Initialize the audio source stream
   */
  public async initialize(): Promise<void> {
    this.logger.info('Initializing stream-based audio source', {
      sessionId: this.config.sessionId,
      codec: this.config.codec.name,
      hasAudioFile: !!this.config.audioFile
    });
    
    if (this.config.audioFile) {
      await this.loadAudioFile();
    }
  }

  /**
   * Stream implementation - emit next audio chunk
   */
  _read(): void {
    try {
      const chunk = this.getNextChunk();
      
      if (chunk) {
        this.push(chunk);
      } else {
        // End of stream
        this.logger.info('Audio source stream complete', {
          sessionId: this.config.sessionId,
          phase: this.currentPhase
        });
        this.push(null);
      }
    } catch (error) {
      this.logger.error('Error reading from audio source stream', error);
      this.emit('error', error);
    }
  }

  /**
   * Get the next audio chunk based on current phase
   */
  private getNextChunk(): Buffer | null {
    switch (this.currentPhase) {
      case 'pre-silence':
        return this.getPreSilenceChunk();
      
      case 'audio-file':
        return this.getAudioFileChunk();
      
      case 'post-silence':
        return this.getPostSilenceChunk();
      
      case 'complete':
        return null;
      
      default:
        return null;
    }
  }

  /**
   * Get pre-silence chunk and advance phase when complete
   */
  private getPreSilenceChunk(): Buffer | null {
    if (this.silencePacketsEmitted >= this.maxPreSilencePackets) {
      // Move to next phase
      this.currentPhase = this.audioFileChunks.length > 0 ? 'audio-file' : 'post-silence';
      this.silencePacketsEmitted = 0;
      
      this.logger.debug('Audio source stream phase transition', {
        sessionId: this.config.sessionId,
        from: 'pre-silence',
        to: this.currentPhase
      });
      
      return this.getNextChunk();
    }
    
    this.silencePacketsEmitted++;
    return this.generateSilencePacket();
  }

  /**
   * Get audio file chunk and advance phase when complete
   */
  private getAudioFileChunk(): Buffer | null {
    if (this.audioFileIndex >= this.audioFileChunks.length) {
      // Move to post-silence phase
      this.currentPhase = 'post-silence';
      this.silencePacketsEmitted = 0;
      
      this.logger.debug('Audio source stream phase transition', {
        sessionId: this.config.sessionId,
        from: 'audio-file',
        to: 'post-silence'
      });
      
      return this.getNextChunk();
    }
    
    const chunk = this.audioFileChunks[this.audioFileIndex]!;
    this.audioFileIndex++;
    return chunk;
  }

  /**
   * Get post-silence chunk and complete when done
   */
  private getPostSilenceChunk(): Buffer | null {
    if (this.silencePacketsEmitted >= this.maxPostSilencePackets) {
      // Complete the stream
      this.currentPhase = 'complete';
      
      this.logger.debug('Audio source stream phase transition', {
        sessionId: this.config.sessionId,
        from: 'post-silence',
        to: 'complete'
      });
      
      return null;
    }
    
    this.silencePacketsEmitted++;
    return this.generateSilencePacket();
  }

  /**
   * Generate a silence packet for the current codec
   */
  private generateSilencePacket(): Buffer {
    return this.codecHandler.createSilencePayload(this.config.codec, this.CHUNK_INTERVAL_MS);
  }

  /**
   * Load and chunk the audio file
   */
  private async loadAudioFile(): Promise<void> {
    if (!this.config.audioFile) {
      return;
    }
    
    try {
      // Determine audio file path
      const audioFileName = this.config.codec.name === CodecType.PCMU ? 'welcome.pcmu' : 'welcome.pcma';
      const audioFilePath = path.join(__dirname, '../../audio', audioFileName);
      
      this.logger.debug('Loading audio file for stream', {
        sessionId: this.config.sessionId,
        file: audioFileName,
        codec: this.config.codec.name
      });
      
      // Load the audio file
      this.audioFileBuffer = await fs.promises.readFile(audioFilePath);
      
      // Chunk the audio file
      this.chunkAudioFile();
      
      this.logger.info('Audio file loaded for stream', {
        sessionId: this.config.sessionId,
        fileSizeBytes: this.audioFileBuffer.length,
        totalChunks: this.audioFileChunks.length
      });
      
    } catch (error) {
      this.logger.error('Failed to load audio file for stream', error);
      // Continue without audio file - will just play silence
    }
  }

  /**
   * Chunk the audio file into frame-sized pieces
   */
  private chunkAudioFile(): void {
    if (!this.audioFileBuffer) {
      return;
    }
    
    this.audioFileChunks = [];
    
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
        const silenceValue = this.config.codec.name === CodecType.PCMU ? 
          CODEC_SILENCE_VALUES.PCMU : CODEC_SILENCE_VALUES.PCMA;
        paddedChunk.fill(silenceValue, chunk.length);
      }
      
      this.audioFileChunks.push(paddedChunk);
      offset += currentChunkSize;
    }
  }

  /**
   * Get current phase information
   */
  public getCurrentPhase(): { phase: string; progress: number } {
    let progress = 0;
    
    switch (this.currentPhase) {
      case 'pre-silence':
        progress = this.silencePacketsEmitted / this.maxPreSilencePackets;
        break;
      case 'audio-file':
        progress = this.audioFileIndex / this.audioFileChunks.length;
        break;
      case 'post-silence':
        progress = this.silencePacketsEmitted / this.maxPostSilencePackets;
        break;
      case 'complete':
        progress = 1.0;
        break;
    }
    
    return {
      phase: this.currentPhase,
      progress: Math.min(1.0, progress)
    };
  }

  /**
   * Get total expected duration
   */
  public getTotalDurationMs(): number {
    const audioFileDuration = this.audioFileChunks.length * this.CHUNK_INTERVAL_MS;
    return this.PRE_SILENCE_DURATION_MS + audioFileDuration + this.POST_SILENCE_DURATION_MS;
  }
}

/**
 * Utility function to create an audio source stream with typical settings
 */
export function createAudioSourceStream(config: AudioSourceStreamConfig) {
  return new AudioSourceStream(config);
}