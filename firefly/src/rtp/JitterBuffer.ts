import { createLogger, Logger } from '../utils/logger';
import { CodecInfo, RtpPacketInfo } from './types';

export interface JitterBufferConfig {
  bufferTimeMs: number;
  codecInfo: CodecInfo;
  onPacketReady: (packet: RtpPacketInfo) => void;
  onPacketLost: (sequenceNumber: number) => void;
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

export class JitterBuffer {
  private readonly logger: Logger;
  private readonly config: JitterBufferConfig;
  
  // Packet storage indexed by sequence number
  private readonly packetBuffer = new Map<number, BufferedPacket>();
  
  // Sequence number tracking
  private expectedSeqNum?: number;
  
  // Duplicate detection (sliding window of recent sequence numbers)
  private readonly recentSeqNums = new Set<number>();
  private readonly RECENT_WINDOW_SIZE = 100;
  
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

  constructor(config: JitterBufferConfig) {
    this.config = config;
    this.logger = createLogger({ component: 'JitterBuffer' });
    this.bufferTimeoutMs = config.bufferTimeMs;
    
    this.logger.info('JitterBuffer initialized', {
      bufferTimeMs: config.bufferTimeMs,
      codec: config.codecInfo.name
    });
  }

  public addPacket(packet: RtpPacketInfo): void {
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
      // First packet
      this.expectedSeqNum = seqNum + 1;
      return true;
    }
    
    // Handle 16-bit sequence number wraparound
    const normalizedExpected = this.expectedSeqNum & 0xFFFF;
    return seqNum === normalizedExpected;
  }

  private processPacketImmediate(packet: RtpPacketInfo): void {
    this.updateExpectedSequence(packet.sequenceNumber);
    this.config.onPacketReady(packet);
    
    this.logger.trace('Processed packet immediately (fast path)', {
      sequenceNumber: packet.sequenceNumber
    });
  }

  private bufferPacket(packet: RtpPacketInfo): void {
    const seqNum = packet.sequenceNumber;
    const now = Date.now();
    
    // Store in buffer
    this.packetBuffer.set(seqNum, {
      packet,
      receivedAt: now,
      sequenceNumber: seqNum
    });
    
    // Update depth statistics
    this.stats.currentDepth = this.packetBuffer.size;
    if (this.stats.currentDepth > this.stats.maxDepth) {
      this.stats.maxDepth = this.stats.currentDepth;
    }
    
    this.logger.trace('Buffered packet for reordering', {
      sequenceNumber: seqNum,
      bufferDepth: this.packetBuffer.size
    });
    
    // Start buffer timeout if not already running
    if (!this.bufferTimer) {
      this.bufferTimer = setTimeout(() => {
        this.processBufferedPackets();
      }, this.bufferTimeoutMs);
    }
    
    // Try to process consecutive packets immediately
    this.tryProcessConsecutivePackets();
  }

  private tryProcessConsecutivePackets(): void {
    if (this.expectedSeqNum === undefined) return;
    
    let processed = 0;
    let currentSeqNum = this.expectedSeqNum & 0xFFFF;
    
    while (this.packetBuffer.has(currentSeqNum)) {
      const bufferedPacket = this.packetBuffer.get(currentSeqNum)!;
      this.packetBuffer.delete(currentSeqNum);
      
      this.config.onPacketReady(bufferedPacket.packet);
      this.updateExpectedSequence(currentSeqNum);
      
      processed++;
      currentSeqNum = (currentSeqNum + 1) & 0xFFFF;
    }
    
    if (processed > 0) {
      this.stats.currentDepth = this.packetBuffer.size;
      
      if (processed > 1) {
        this.stats.packetsReordered += processed - 1;
        this.logger.debug('Processed consecutive buffered packets', {
          count: processed,
          reordered: processed - 1
        });
      }
    }
  }

  private processBufferedPackets(): void {
    this.bufferTimer = undefined;
    
    if (this.packetBuffer.size === 0) return;
    
    const now = Date.now();
    const packetsToProcess: BufferedPacket[] = [];
    const packetsToKeep: BufferedPacket[] = [];
    
    // Separate packets that have timed out vs those that are still fresh
    for (const bufferedPacket of this.packetBuffer.values()) {
      const age = now - bufferedPacket.receivedAt;
      if (age >= this.bufferTimeoutMs) {
        packetsToProcess.push(bufferedPacket);
      } else {
        packetsToKeep.push(bufferedPacket);
      }
    }
    
    // Clear buffer and re-add packets to keep
    this.packetBuffer.clear();
    packetsToKeep.forEach(bp => {
      this.packetBuffer.set(bp.sequenceNumber, bp);
    });
    
    // Process timed-out packets in sequence order
    packetsToProcess.sort((a, b) => {
      // Handle wraparound by comparing in 16-bit space
      const seqA = a.sequenceNumber & 0xFFFF;
      const seqB = b.sequenceNumber & 0xFFFF;
      
      // Simple comparison in 16-bit space
      const diff = (seqB - seqA) & 0xFFFF;
      return diff > 32768 ? -1 : (diff === 0 ? 0 : 1);
    });
    
    // Detect and report lost packets
    this.detectLostPackets(packetsToProcess);
    
    // Forward all processed packets
    for (const bufferedPacket of packetsToProcess) {
      this.config.onPacketReady(bufferedPacket.packet);
      this.updateExpectedSequence(bufferedPacket.sequenceNumber);
    }
    
    this.stats.currentDepth = this.packetBuffer.size;
    
    if (packetsToProcess.length > 0) {
      this.logger.debug('Processed buffered packets after timeout', {
        processedCount: packetsToProcess.length,
        remainingInBuffer: this.packetBuffer.size
      });
    }
    
    // Restart timer if packets remain
    if (this.packetBuffer.size > 0) {
      this.bufferTimer = setTimeout(() => {
        this.processBufferedPackets();
      }, this.bufferTimeoutMs);
    }
  }

  private detectLostPackets(processedPackets: BufferedPacket[]): void {
    if (this.expectedSeqNum === undefined || processedPackets.length === 0) return;
    
    // Sort processed packets to detect gaps
    const sortedSeqNums = processedPackets
      .map(p => p.sequenceNumber & 0xFFFF)
      .sort((a, b) => {
        const diff = (b - a) & 0xFFFF;
        return diff > 32768 ? -1 : (diff === 0 ? 0 : 1);
      });
    
    let currentExpected = this.expectedSeqNum & 0xFFFF;
    
    for (const receivedSeqNum of sortedSeqNums) {
      // Check for gaps between expected and received
      while (currentExpected !== receivedSeqNum) {
        this.stats.packetsLost++;
        this.config.onPacketLost(currentExpected);
        
        this.logger.debug('Detected lost packet', {
          sequenceNumber: currentExpected,
          nextReceived: receivedSeqNum
        });
        
        currentExpected = (currentExpected + 1) & 0xFFFF;
      }
      
      // Move past this received packet
      currentExpected = (currentExpected + 1) & 0xFFFF;
    }
  }

  private updateExpectedSequence(processedSeqNum: number): void {
    this.expectedSeqNum = (processedSeqNum + 1) & 0xFFFF;
  }

  public getStats(): JitterBufferStats {
    return { ...this.stats };
  }

  public reset(): void {
    // Clear all buffers and timers
    if (this.bufferTimer) {
      clearTimeout(this.bufferTimer);
      this.bufferTimer = undefined;
    }
    
    this.packetBuffer.clear();
    this.recentSeqNums.clear();
    
    // Reset sequence tracking
    this.expectedSeqNum = undefined;
    
    // Reset stats
    this.stats = {
      packetsReceived: 0,
      packetsReordered: 0,
      packetsLost: 0,
      packetsDuplicate: 0,
      currentDepth: 0,
      maxDepth: 0
    };
    
    this.logger.info('JitterBuffer reset');
  }

  public flush(): void {
    // Immediately process all remaining packets in buffer, regardless of timeout
    if (this.packetBuffer.size === 0) {
      return;
    }

    this.logger.info('Flushing jitter buffer', { 
      remainingPackets: this.packetBuffer.size 
    });

    // Stop any pending timer
    if (this.bufferTimer) {
      clearTimeout(this.bufferTimer);
      this.bufferTimer = undefined;
    }

    // Get all buffered packets and sort by sequence number
    const allPackets = Array.from(this.packetBuffer.values());
    allPackets.sort((a, b) => {
      // Handle wraparound by comparing in 16-bit space
      const seqA = a.sequenceNumber & 0xFFFF;
      const seqB = b.sequenceNumber & 0xFFFF;
      
      const diff = (seqB - seqA) & 0xFFFF;
      return diff > 32768 ? -1 : (diff === 0 ? 0 : 1);
    });

    // Process all packets
    for (const bufferedPacket of allPackets) {
      this.config.onPacketReady(bufferedPacket.packet);
      this.updateExpectedSequence(bufferedPacket.sequenceNumber);
    }

    // Clear the buffer
    this.packetBuffer.clear();
    this.stats.currentDepth = 0;

    this.logger.info('Jitter buffer flushed', { 
      flushedPackets: allPackets.length 
    });
  }

  public destroy(): void {
    this.reset();
    this.logger.info('JitterBuffer destroyed');
  }
}