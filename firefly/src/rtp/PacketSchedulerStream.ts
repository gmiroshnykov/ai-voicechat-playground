import { Readable } from 'stream';
import { Logger } from '../utils/logger';

export interface PacketSchedulerStreamConfig {
  targetIntervalMs: number; // Target interval (typically 20ms)
  logFrequency: number; // Log every N packets
  logger: Logger;
  sessionId: string;
}

/**
 * Stream-based packet scheduler that naturally handles timing without fighting JavaScript
 * 
 * Instead of complex timer compensation, this uses Node.js streams' natural backpressure
 * handling and lets the JavaScript event loop manage timing naturally.
 * 
 * Philosophy: Work WITH JavaScript's event loop, not against it
 */
export class PacketSchedulerStream extends Readable {
  private readonly config: PacketSchedulerStreamConfig;
  private readonly logger: Logger;
  private packetCount = 0;
  private startTime = 0;
  private isActive = false;
  private scheduleTimer?: NodeJS.Timeout;

  constructor(config: PacketSchedulerStreamConfig) {
    super({
      objectMode: true, // We emit packet numbers/signals
      highWaterMark: 5 // Small buffer - don't get ahead of timing
    });
    
    this.config = config;
    this.logger = config.logger;
    this.startTime = Date.now();
  }

  /**
   * Start the packet scheduling stream
   */
  public start(): void {
    if (this.isActive) {
      return;
    }
    
    this.isActive = true;
    this.startTime = Date.now();
    
    this.logger.debug('Starting stream-based packet scheduler', {
      sessionId: this.config.sessionId,
      targetIntervalMs: this.config.targetIntervalMs
    });
    
    // Prime the pump with initial packets
    this.scheduleNext();
  }

  /**
   * Stop the packet scheduling stream
   */
  public stop(): void {
    if (!this.isActive) {
      return;
    }
    
    this.isActive = false;
    
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = undefined;
    }
    
    this.logger.debug('Stopped stream-based packet scheduler', {
      sessionId: this.config.sessionId,
      totalPackets: this.packetCount,
      durationMs: Date.now() - this.startTime
    });
    
    // End the stream
    this.push(null);
  }

  /**
   * Stream implementation - called when consumer is ready for more data
   */
  _read(): void {
    if (!this.isActive) {
      this.push(null);
      return;
    }
    
    // Don't push if we're already scheduled
    if (this.scheduleTimer) {
      return;
    }
    
    this.scheduleNext();
  }

  /**
   * Schedule the next packet using simple setTimeout
   * No complex drift compensation - let the event loop handle it naturally
   */
  private scheduleNext(): void {
    if (!this.isActive) {
      return;
    }
    
    this.scheduleTimer = setTimeout(() => {
      this.scheduleTimer = undefined;
      
      if (!this.isActive) {
        return;
      }
      
      this.packetCount++;
      const callTimeMs = Date.now() - this.startTime;
      
      // Log periodic stats
      if (this.packetCount % this.config.logFrequency === 0) {
        this.logger.debug('Stream-based packet scheduler stats', {
          sessionId: this.config.sessionId,
          packetCount: this.packetCount,
          callTimeMs,
          targetIntervalMs: this.config.targetIntervalMs
        });
      }
      
      // Emit packet signal - let consumer handle the actual packet creation
      const packetSignal = {
        packetNumber: this.packetCount,
        callTimeMs
      };
      
      // Push to stream - this naturally handles backpressure
      if (!this.push(packetSignal)) {
        // Stream is full - backpressure will call _read when ready
        this.logger.trace('Stream backpressure - pausing scheduler', {
          sessionId: this.config.sessionId,
          packetCount: this.packetCount
        });
      }
      
    }, this.config.targetIntervalMs);
  }

  /**
   * Get current statistics
   */
  public getStats() {
    return {
      packetCount: this.packetCount,
      durationMs: Date.now() - this.startTime,
      isActive: this.isActive
    };
  }
}

/**
 * Utility function to create a packet scheduler stream with typical RTP settings
 */
export function createRtpPacketScheduler(config: Omit<PacketSchedulerStreamConfig, 'targetIntervalMs'>) {
  return new PacketSchedulerStream({
    ...config,
    targetIntervalMs: 20 // Standard RTP interval
  });
}