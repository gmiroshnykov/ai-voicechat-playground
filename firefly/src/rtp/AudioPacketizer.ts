import { Transform } from 'stream';
import { Logger } from '../utils/logger';
import { CodecType } from './types';
import { AUDIO_CONSTANTS } from '../constants';

export interface AudioPacketizerConfig {
  codec: {
    name: CodecType;
    payload: number;
    clockRate: number;
    channels?: number;
  };
  logger: Logger;
  sessionId: string;
  packetSize?: number; // Default: 20ms packets
}

export interface AudioPacket {
  payload: Buffer;
  timestamp: number;
  sequenceNumber: number;
  isLast: boolean;
}

/**
 * Transform stream that converts raw audio data into timestamped audio packets
 * suitable for RTP transmission
 */
export class AudioPacketizer extends Transform {
  private readonly config: AudioPacketizerConfig;
  private readonly logger: Logger;
  private readonly packetSize: number;
  private readonly samplesPerPacket: number;
  
  private sequenceNumber: number = 0;
  private timestamp: number = 0;
  private buffer: Buffer = Buffer.alloc(0);

  constructor(config: AudioPacketizerConfig) {
    super({ 
      objectMode: true, // Output audio packets as objects
      highWaterMark: 16 // Buffer up to 16 packets
    });
    
    this.config = config;
    this.logger = config.logger;
    this.packetSize = config.packetSize || AUDIO_CONSTANTS.G711_FRAME_SIZE;
    
    // Calculate samples per packet based on codec
    this.samplesPerPacket = this.packetSize; // For G.711, 1 byte = 1 sample
    
    this.logger.debug('AudioPacketizer initialized', {
      codec: config.codec.name,
      packetSize: this.packetSize,
      samplesPerPacket: this.samplesPerPacket
    });
  }

  _transform(chunk: Buffer, _encoding: string, callback: (error?: Error | null, data?: any) => void): void {
    try {
      // Add new data to buffer
      this.buffer = Buffer.concat([this.buffer, chunk]);
      
      // Extract complete packets
      while (this.buffer.length >= this.packetSize) {
        const packetData = this.buffer.subarray(0, this.packetSize);
        this.buffer = this.buffer.subarray(this.packetSize);
        
        const packet: AudioPacket = {
          payload: packetData,
          timestamp: this.timestamp,
          sequenceNumber: this.sequenceNumber,
          isLast: false
        };
        
        this.push(packet);
        
        // Update counters
        this.sequenceNumber = (this.sequenceNumber + 1) & 0xFFFF;
        this.timestamp = (this.timestamp + this.samplesPerPacket) & 0xFFFFFFFF;
      }
      
      callback();
    } catch (error) {
      this.logger.error('Error in audio packetizer', error);
      callback(error as Error);
    }
  }

  _flush(callback: (error?: Error | null) => void): void {
    try {
      // Handle any remaining data
      if (this.buffer.length > 0) {
        // Pad with silence if needed
        const silenceValue = this.config.codec.name === CodecType.PCMU ? 0xFF : 0x55;
        const paddedBuffer = Buffer.alloc(this.packetSize, silenceValue);
        this.buffer.copy(paddedBuffer, 0);
        
        const packet: AudioPacket = {
          payload: paddedBuffer,
          timestamp: this.timestamp,
          sequenceNumber: this.sequenceNumber,
          isLast: true
        };
        
        this.push(packet);
        this.logger.debug('Final audio packet sent', {
          sequenceNumber: this.sequenceNumber,
          timestamp: this.timestamp
        });
      }
      
      callback();
    } catch (error) {
      this.logger.error('Error flushing audio packetizer', error);
      callback(error as Error);
    }
  }

  public getStats() {
    return {
      packetsGenerated: this.sequenceNumber,
      currentTimestamp: this.timestamp,
      bufferSize: this.buffer.length
    };
  }
}