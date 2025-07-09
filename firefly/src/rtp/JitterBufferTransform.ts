import { Transform } from 'stream';
import { createLogger, Logger } from '../utils/logger';
import { CodecInfo, RtpPacketInfo } from './types';
import { CodecHandler } from './CodecHandler';
import { 
  BUFFER_CONSTANTS 
} from '../constants';

export interface JitterBufferTransformConfig {
  bufferTimeMs: number;
  codecInfo: CodecInfo;
  sessionId: string;
  onPacketLost?: (sequenceNumber: number) => void;
}

export interface JitterBufferStats {
  packetsReceived: number;
  packetsReordered: number;
  packetsLost: number;
  packetsDuplicate: number;
  currentDepth: number;
  maxDepth: number;
}

interface BufferedPacket {
  packet: RtpPacketInfo;
  receivedAt: number;
  sequenceNumber: number;
}

/**
 * Transform stream that handles RTP packet reordering and loss recovery
 * Takes RtpPacketInfo objects and outputs ordered audio Buffer objects
 */
export class JitterBufferTransform extends Transform {
  private readonly config: JitterBufferTransformConfig;
  private readonly logger: Logger;
  private readonly codecHandler: CodecHandler;
  
  // Packet storage indexed by sequence number
  private readonly packetBuffer = new Map<number, BufferedPacket>();
  
  // Sequence number tracking
  private expectedSeqNum?: number;
  
  // Duplicate detection (sliding window of recent sequence numbers)
  private readonly recentSeqNums = new Set<number>();
  private readonly RECENT_WINDOW_SIZE = BUFFER_CONSTANTS.RECENT_SEQUENCE_WINDOW;
  
  // Buffer timing
  private bufferTimer?: NodeJS.Timeout;
  private readonly bufferTimeoutMs: number;
  
  // Statistics
  private stats: JitterBufferStats = {
    packetsReceived: 0,
    packetsReordered: 0,
    packetsLost: 0,
    packetsDuplicate: 0,
    currentDepth: 0,
    maxDepth: 0
  };

  constructor(config: JitterBufferTransformConfig) {
    super({ 
      objectMode: true, // Input: RtpPacketInfo, Output: Buffer
      highWaterMark: 32 // Buffer up to 32 packets
    });
    
    this.config = config;
    this.logger = createLogger({ 
      component: 'JitterBufferTransform',
      sessionId: config.sessionId
    });
    this.codecHandler = new CodecHandler();
    this.bufferTimeoutMs = config.bufferTimeMs;
    
    this.logger.debug('JitterBufferTransform initialized', {
      bufferTimeMs: config.bufferTimeMs,
      codec: config.codecInfo.name
    });
  }

  _transform(chunk: any, _encoding: string, callback: (error?: Error | null, data?: any) => void): void {
    try {
      const packet = chunk as RtpPacketInfo;
      this.addPacket(packet);
      callback();
    } catch (error) {
      this.logger.error('Error processing packet in jitter buffer', error);
      callback(error as Error);
    }
  }

  _flush(callback: (error?: Error | null) => void): void {
    // Flush any remaining packets when stream ends
    this.flush();
    callback();
  }

  private addPacket(packet: RtpPacketInfo): void {
    const seqNum = packet.sequenceNumber;
    
    this.stats.packetsReceived++;
    
    // Check for duplicates
    if (this.recentSeqNums.has(seqNum)) {
      this.stats.packetsDuplicate++;
      this.logger.debug('Discarding duplicate packet', { sequenceNumber: seqNum });
      return;
    }
    
    // Add to recent sequence numbers (with sliding window)
    this.recentSeqNums.add(seqNum);
    if (this.recentSeqNums.size > this.RECENT_WINDOW_SIZE) {
      // Remove oldest entries (this is approximate since Set doesn't guarantee order)
      const entries = Array.from(this.recentSeqNums);
      entries.slice(0, entries.length - this.RECENT_WINDOW_SIZE).forEach(old => {
        this.recentSeqNums.delete(old);
      });
    }
    
    // Fast path: if this is the next expected packet and buffer is empty
    if (this.isNextExpectedPacket(seqNum) && this.packetBuffer.size === 0) {
      this.processPacketImmediate(packet);
      return;
    }
    
    // Buffer the packet for reordering
    this.bufferPacket(packet);
  }

  private isNextExpectedPacket(seqNum: number): boolean {
    if (this.expectedSeqNum === undefined) {
      return true; // First packet
    }
    
    const expected = (this.expectedSeqNum + 1) & 0xFFFF;
    return seqNum === expected;
  }

  private processPacketImmediate(packet: RtpPacketInfo): void {
    // Fast path: process immediately without buffering
    this.expectedSeqNum = packet.sequenceNumber;
    this.outputPacket(packet);
  }

  private bufferPacket(packet: RtpPacketInfo): void {
    const seqNum = packet.sequenceNumber;
    
    // Check if we already have this packet
    if (this.packetBuffer.has(seqNum)) {
      this.stats.packetsDuplicate++;
      this.logger.debug('Discarding duplicate buffered packet', { sequenceNumber: seqNum });
      return;
    }
    
    // Add to buffer
    this.packetBuffer.set(seqNum, {
      packet,
      receivedAt: Date.now(),
      sequenceNumber: seqNum
    });
    
    // Update stats
    this.stats.currentDepth = this.packetBuffer.size;
    if (this.stats.currentDepth > this.stats.maxDepth) {
      this.stats.maxDepth = this.stats.currentDepth;
    }
    
    // Start buffer timer if not already running
    if (!this.bufferTimer) {
      this.bufferTimer = setTimeout(() => {
        this.processBufferedPackets();
      }, this.bufferTimeoutMs);
    }
    
    // Try to process packets immediately if we have consecutive ones
    this.tryProcessConsecutivePackets();
  }

  private tryProcessConsecutivePackets(): void {
    while (this.packetBuffer.size > 0) {
      const nextSeqNum = this.expectedSeqNum === undefined ? 
        this.findOldestPacket() : 
        (this.expectedSeqNum + 1) & 0xFFFF;
      
      const bufferedPacket = this.packetBuffer.get(nextSeqNum);
      if (!bufferedPacket) {
        break; // No consecutive packet available
      }
      
      // Remove from buffer and process
      this.packetBuffer.delete(nextSeqNum);
      this.stats.currentDepth = this.packetBuffer.size;
      
      if (this.expectedSeqNum !== undefined && nextSeqNum !== ((this.expectedSeqNum + 1) & 0xFFFF)) {
        this.stats.packetsReordered++;
      }
      
      this.expectedSeqNum = nextSeqNum;
      this.outputPacket(bufferedPacket.packet);
    }
  }

  private findOldestPacket(): number {
    let oldest = Number.MAX_SAFE_INTEGER;
    let oldestSeqNum = 0;
    
    for (const [seqNum, bufferedPacket] of this.packetBuffer) {
      if (bufferedPacket.receivedAt < oldest) {
        oldest = bufferedPacket.receivedAt;
        oldestSeqNum = seqNum;
      }
    }
    
    return oldestSeqNum;
  }

  private processBufferedPackets(): void {
    this.bufferTimer = undefined;
    
    // Process packets in order, handling gaps
    while (this.packetBuffer.size > 0) {
      const nextSeqNum = this.expectedSeqNum === undefined ? 
        this.findOldestPacket() : 
        (this.expectedSeqNum + 1) & 0xFFFF;
      
      const bufferedPacket = this.packetBuffer.get(nextSeqNum);
      if (bufferedPacket) {
        // Found the next packet
        this.packetBuffer.delete(nextSeqNum);
        this.stats.currentDepth = this.packetBuffer.size;
        
        if (this.expectedSeqNum !== undefined && nextSeqNum !== ((this.expectedSeqNum + 1) & 0xFFFF)) {
          this.stats.packetsReordered++;
        }
        
        this.expectedSeqNum = nextSeqNum;
        this.outputPacket(bufferedPacket.packet);
      } else {
        // Missing packet - handle packet loss
        if (this.expectedSeqNum !== undefined) {
          this.handlePacketLoss(nextSeqNum);
        }
        this.expectedSeqNum = nextSeqNum;
      }
    }
  }

  private handlePacketLoss(sequenceNumber: number): void {
    this.stats.packetsLost++;
    this.logger.debug('Detected packet loss', { sequenceNumber });
    
    // Generate comfort noise for the lost packet
    const silencePayload = this.codecHandler.createSilencePayload(this.config.codecInfo, 20);
    
    // Notify about packet loss
    if (this.config.onPacketLost) {
      this.config.onPacketLost(sequenceNumber);
    }
    
    // Output silence for the lost packet
    this.push(silencePayload);
  }

  private outputPacket(packet: RtpPacketInfo): void {
    // Push the audio payload to the stream
    this.push(packet.payload);
    
    this.logger.trace('Output packet from jitter buffer', {
      sequenceNumber: packet.sequenceNumber,
      timestamp: packet.timestamp,
      payloadSize: packet.payload.length
    });
  }

  public flush(): void {
    if (this.bufferTimer) {
      clearTimeout(this.bufferTimer);
      this.bufferTimer = undefined;
    }
    
    // Process any remaining buffered packets
    this.processBufferedPackets();
  }

  public getStats(): Readonly<JitterBufferStats> {
    return { ...this.stats };
  }

  public destroy(error?: Error): this {
    this.flush();
    return super.destroy(error);
  }
}