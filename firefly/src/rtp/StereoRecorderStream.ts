import { Writable } from 'stream';
import { createWriteStream, WriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { CodecInfo, TimestampedAudioChunk } from './types';
import { Logger } from '../utils/logger';
import { getBitsPerSample, convertAudioData } from './AudioCodecUtils';
import { writeWavHeaderToStream, finalizeWavHeader, WavHeaderConfig } from './WavFileUtils';

export interface StereoRecorderStreamConfig {
  filePath: string;
  codec: CodecInfo;
  sessionId: string;
  jitterBufferDelayMs?: number; // Jitter buffer delay to compensate for inbound (default: 60ms)
  maxTimingDriftMs?: number; // Maximum allowed wall clock drift before dropping chunks (default: 200ms)
  logger?: Logger;
}


interface TimestampedChunk {
  chunk: TimestampedAudioChunk;
  alignedWallClockTime: number; // Wall clock time adjusted for pipeline delays
}

interface StereoTimeSlot {
  leftChunk?: TimestampedChunk;
  rightChunk?: TimestampedChunk;
}

export class StereoRecorderStream extends Writable {
  private readonly config: StereoRecorderStreamConfig;
  private readonly logger: Logger;
  private fileStream?: WriteStream;
  private wavHeaderWritten = false;
  private bytesWritten = 0;
  private sampleRate: number;
  private bitsPerSample: number;
  
  // Wall clock time-based stereo mixing with shared timeline
  private readonly jitterBufferDelayMs: number;
  private readonly maxTimingDriftMs: number;
  private timeSlots: Map<number, StereoTimeSlot> = new Map();
  private isClosing = false;
  private nextExpectedWallClockTime?: number;
  private callStartTime?: number;
  private lastInboundPacketTime?: number;
  private readonly burstWindowMs: number = 100; // 100ms window for detecting packet bursts

  constructor(config: StereoRecorderStreamConfig) {
    super({ objectMode: true }); // Accept TimestampedAudioChunk objects
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
    
    // Initialize wall clock time-based mixing parameters
    this.jitterBufferDelayMs = config.jitterBufferDelayMs ?? 60; // Default to 60ms jitter buffer delay
    this.maxTimingDriftMs = config.maxTimingDriftMs ?? 200; // Default to 200ms
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
    
    // Process time slots in chronological order
    while (this.canMixNextChunk()) {
      const nextTimeSlot = this.getNextMixableTimeSlot();
      if (nextTimeSlot === undefined) break;
      
      const slot = this.timeSlots.get(nextTimeSlot)!;
      const leftChunk = slot.leftChunk;
      const rightChunk = slot.rightChunk;
      
      let leftAudio: Buffer;
      let rightAudio: Buffer;
      
      if (leftChunk && rightChunk) {
        // Both channels have audio for this time slot
        leftAudio = convertAudioData(leftChunk.chunk.audio, this.config.codec);
        rightAudio = convertAudioData(rightChunk.chunk.audio, this.config.codec);
        this.logger.trace('Mixing both channels', { 
          timeSlot: nextTimeSlot,
          sessionId: this.config.sessionId 
        });
      } else if (leftChunk) {
        // Only left channel has audio, pad right with silence
        leftAudio = convertAudioData(leftChunk.chunk.audio, this.config.codec);
        rightAudio = Buffer.alloc(leftAudio.length); // Silence
        this.logger.trace('Mixing with silence on right channel', { 
          timeSlot: nextTimeSlot,
          sessionId: this.config.sessionId 
        });
      } else if (rightChunk) {
        // Only right channel has audio, pad left with silence
        leftAudio = Buffer.alloc(convertAudioData(rightChunk.chunk.audio, this.config.codec).length); // Silence
        rightAudio = convertAudioData(rightChunk.chunk.audio, this.config.codec);
        this.logger.trace('Mixing with silence on left channel', { 
          timeSlot: nextTimeSlot,
          sessionId: this.config.sessionId 
        });
      } else {
        // Neither channel has audio (shouldn't happen due to canMixNextChunk check)
        break;
      }
      
      // Ensure both audio buffers are the same length
      const minLength = Math.min(leftAudio.length, rightAudio.length);
      if (minLength > 0) {
        const stereoChunk = this.mixToStereo(
          leftAudio.subarray(0, minLength),
          rightAudio.subarray(0, minLength)
        );
        this.fileStream.write(stereoChunk);
        this.bytesWritten += stereoChunk.length;
      }
      
      // Remove processed time slot
      this.timeSlots.delete(nextTimeSlot);
      
      // Update expected time for next chunk (20ms intervals)
      this.nextExpectedWallClockTime = nextTimeSlot + 20;
    }
  }
  
  private canMixNextChunk(): boolean {
    if (this.timeSlots.size === 0) return false;
    
    // If we're closing, process remaining chunks immediately
    if (this.isClosing) return true;
    
    // Wait for synchronization: only process when we have multiple slots buffered
    // or when we have both channels for the earliest slot
    const sortedSlots = Array.from(this.timeSlots.entries()).sort(([a], [b]) => a - b);
    const earliestSlot = sortedSlots[0];
    
    if (!earliestSlot) return false;
    
    const [earliestTime, slot] = earliestSlot;
    
    // Process immediately if we have both channels for the earliest slot
    if (slot.leftChunk && slot.rightChunk) {
      return true;
    }
    
    // Or process if we have multiple slots buffered (indicates the missing channel isn't coming)
    if (this.timeSlots.size >= 3) {
      return true;
    }
    
    // Or process if this slot is significantly behind our expected progression
    if (this.nextExpectedWallClockTime && earliestTime < this.nextExpectedWallClockTime - 40) {
      return true;
    }
    
    return false;
  }
  
  private getNextMixableTimeSlot(): number | undefined {
    // Simply return the earliest time slot that's ready to process
    const sortedSlots = Array.from(this.timeSlots.entries()).sort(([a], [b]) => a - b);
    return sortedSlots[0]?.[0];
  }
  
  private assignTimeSlot(chunk: TimestampedAudioChunk, alignedWallClockTime: number): number {
    if (!this.callStartTime) {
      this.callStartTime = alignedWallClockTime;
    }
    
    const relativeTime = alignedWallClockTime - this.callStartTime;
    const baseTimeSlot = Math.floor(relativeTime / 20) * 20;
    
    if (chunk.direction === 'outbound') {
      // Outbound packets use exact timing (continuous stream)
      return baseTimeSlot;
    }
    
    // Inbound packet handling with burst detection
    const isPartOfBurst = this.lastInboundPacketTime !== undefined && 
                          (alignedWallClockTime - this.lastInboundPacketTime) <= this.burstWindowMs;
    
    if (isPartOfBurst) {
      // Part of a burst - find next available left slot
      let timeSlot = baseTimeSlot;
      const maxBurstTime = baseTimeSlot + this.burstWindowMs;
      
      while (timeSlot < maxBurstTime && this.timeSlots.get(timeSlot)?.leftChunk) {
        timeSlot += 20; // Move to next 20ms slot
      }
      
      // If we've exceeded the burst window, use base time (might overwrite)
      const assignedSlot = timeSlot < maxBurstTime ? timeSlot : baseTimeSlot;
      
      this.logger.trace('Assigned slot for burst packet', {
        baseTimeSlot,
        assignedSlot,
        burstDetected: true,
        slotsSearched: (assignedSlot - baseTimeSlot) / 20,
        sessionId: this.config.sessionId
      });
      
      return assignedSlot;
    } else {
      // Not part of a burst - use wall clock time (reset after silence)
      this.logger.trace('Assigned slot for non-burst packet', {
        baseTimeSlot,
        assignedSlot: baseTimeSlot,
        burstDetected: false,
        gapFromLastPacket: this.lastInboundPacketTime ? alignedWallClockTime - this.lastInboundPacketTime : 'N/A',
        sessionId: this.config.sessionId
      });
      
      return baseTimeSlot;
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

  async _write(chunk: TimestampedAudioChunk, _encoding: BufferEncoding, callback: (error?: Error | null) => void): Promise<void> {
    try {
      if (!this.fileStream) {
        await this.createFileStream();
      }
      
      if (!this.wavHeaderWritten) {
        this.writeWavHeader();
      }
      
      // Use raw wall clock time - ignore jitter buffer delays (assume ~0ms for good networks)
      const alignedWallClockTime = chunk.wallClockTime;
      
      // Assign time slot using burst detection logic  
      const assignedTimeSlot = this.assignTimeSlot(chunk, alignedWallClockTime);
      
      // Check for excessive timing drift (chunks arriving too late)
      if (this.nextExpectedWallClockTime !== undefined) {
        const drift = Math.abs(assignedTimeSlot - this.nextExpectedWallClockTime);
        if (drift > this.maxTimingDriftMs) {
          this.logger.warn('Excessive timing drift detected, dropping chunk', {
            direction: chunk.direction,
            wallClockTime: chunk.wallClockTime,
            alignedWallClockTime,
            assignedTimeSlot,
            expectedTime: this.nextExpectedWallClockTime,
            driftMs: drift,
            maxDriftMs: this.maxTimingDriftMs,
            sessionId: this.config.sessionId
          });
          callback();
          return;
        }
      }
      
      // Store timestamped chunk in appropriate channel
      const timestampedChunk: TimestampedChunk = {
        chunk,
        alignedWallClockTime: assignedTimeSlot
      };
      
      if (chunk.direction === 'inbound') {
        // Update tracking for burst detection
        this.lastInboundPacketTime = alignedWallClockTime;
        
        // Get or create time slot
        const slot = this.timeSlots.get(assignedTimeSlot) || {};
        slot.leftChunk = timestampedChunk;
        this.timeSlots.set(assignedTimeSlot, slot);
        
        this.logger.trace('Stored inbound chunk', {
          wallClockTime: chunk.wallClockTime,
          alignedWallClockTime,
          assignedTimeSlot,
          sessionId: this.config.sessionId
        });
      } else if (chunk.direction === 'outbound') {
        // Get or create time slot
        const slot = this.timeSlots.get(assignedTimeSlot) || {};
        slot.rightChunk = timestampedChunk;
        this.timeSlots.set(assignedTimeSlot, slot);
        
        this.logger.trace('Stored outbound chunk', {
          wallClockTime: chunk.wallClockTime,
          alignedWallClockTime,
          assignedTimeSlot,
          sessionId: this.config.sessionId
        });
      } else {
        this.logger.warn('Unknown direction in stereo recorder', { 
          direction: chunk.direction, 
          sessionId: this.config.sessionId 
        });
        callback();
        return;
      }
      
      // Try to mix and write after storing the chunk
      this.tryMixAndWrite();
      
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
    // Process any remaining time slots
    this.logger.debug('Flushing remaining audio chunks', {
      timeSlots: this.timeSlots.size,
      sessionId: this.config.sessionId
    });
    
    // Force mix all remaining time slots, even with missing pairs
    this.tryMixAndWrite();
    
    // Clear any remaining time slots
    this.timeSlots.clear();
  }


  public writeTimestampedAudio(chunk: TimestampedAudioChunk): void {
    if (!this.isClosing) {
      this.write(chunk);
    }
  }

  public getStats() {
    // Count time slots with left and right chunks
    let leftChunks = 0;
    let rightChunks = 0;
    let bothChannels = 0;
    
    for (const slot of this.timeSlots.values()) {
      if (slot.leftChunk && slot.rightChunk) {
        bothChannels++;
        leftChunks++;
        rightChunks++;
      } else if (slot.leftChunk) {
        leftChunks++;
      } else if (slot.rightChunk) {
        rightChunks++;
      }
    }
    
    return {
      filePath: this.config.filePath,
      bytesWritten: this.bytesWritten,
      wavHeaderWritten: this.wavHeaderWritten,
      sampleRate: this.sampleRate,
      bitsPerSample: this.bitsPerSample,
      timeSlots: this.timeSlots.size,
      leftChunks,
      rightChunks,
      bothChannels,
      nextExpectedWallClockTime: this.nextExpectedWallClockTime,
      jitterBufferDelayMs: this.jitterBufferDelayMs,
      maxTimingDriftMs: this.maxTimingDriftMs,
      callStartTime: this.callStartTime,
      lastInboundPacketTime: this.lastInboundPacketTime,
      burstWindowMs: this.burstWindowMs
    };
  }
}