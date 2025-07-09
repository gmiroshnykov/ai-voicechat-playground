import { Logger } from '../utils/logger';

export interface RtpPacketSchedulerConfig {
  targetInterval: number; // Target interval in ms (typically 20ms)
  logFrequency: number; // Log timing stats every N packets
  logger: Logger;
  sessionId: string;
  
  // Callback functions
  onPacketSend: (packetNumber: number) => boolean; // Returns true if packet sent, false if no more packets
  onComplete?: () => void; // Called when scheduling completes
}

export interface RtpPacketSchedulerStats {
  packetsScheduled: number;
  totalDurationMs: number;
  finalCumulativeDrift: number;
  averageDelay: number;
  minDelay: number;
  maxDelay: number;
}

/**
 * RTP Packet Scheduler with Dynamic Timing Compensation
 * 
 * This class provides precise RTP packet scheduling with drift compensation
 * to eliminate audio artifacts caused by JavaScript timer imprecision in
 * Docker containers.
 * 
 * Features:
 * - Buffer priming: Sends 2 packets immediately to fill jitter buffer
 * - Dynamic drift compensation: Adjusts timing based on actual vs expected intervals
 * - Comprehensive logging and statistics
 * - Reusable across different RTP session types
 */
export class RtpPacketScheduler {
  private readonly config: RtpPacketSchedulerConfig;
  private readonly logger: Logger;
  
  // Dynamic timing state
  private expectedPacketTime: number = 0;
  private cumulativeDrift: number = 0;
  private packetCount: number = 0;
  private startTime: number = 0;
  private isRunning: boolean = false;
  private timer?: NodeJS.Timeout;
  
  // Statistics tracking
  private delays: number[] = [];
  
  constructor(config: RtpPacketSchedulerConfig) {
    this.config = config;
    this.logger = config.logger;
  }
  
  /**
   * Start packet scheduling with buffer priming
   */
  public start(): void {
    if (this.isRunning) {
      this.logger.warn('RTP packet scheduler already running');
      return;
    }
    
    this.isRunning = true;
    this.startTime = Date.now();
    this.expectedPacketTime = this.startTime;
    this.cumulativeDrift = 0;
    this.packetCount = 0;
    this.delays = [];
    
    this.logger.debug('Starting RTP packet scheduler with dynamic timing', {
      targetInterval: this.config.targetInterval,
      sessionId: this.config.sessionId,
      startTime: this.startTime
    });
    
    // Prime the jitter buffer: send first 2 packets immediately
    this.sendBufferPrimingPackets();
    
    // Start dynamic scheduling for remaining packets
    this.scheduleNextPacket();
  }
  
  /**
   * Stop packet scheduling
   */
  public stop(): void {
    if (!this.isRunning) {
      return;
    }
    
    this.isRunning = false;
    
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    
    this.logger.debug('RTP packet scheduler stopped', {
      sessionId: this.config.sessionId,
      stats: this.getStats()
    });
  }
  
  /**
   * Get scheduling statistics
   */
  public getStats(): RtpPacketSchedulerStats {
    const totalDurationMs = this.isRunning ? Date.now() - this.startTime : 0;
    const averageDelay = this.delays.length > 0 ? this.delays.reduce((a, b) => a + b, 0) / this.delays.length : 0;
    const minDelay = this.delays.length > 0 ? Math.min(...this.delays) : 0;
    const maxDelay = this.delays.length > 0 ? Math.max(...this.delays) : 0;
    
    return {
      packetsScheduled: this.packetCount,
      totalDurationMs,
      finalCumulativeDrift: this.cumulativeDrift,
      averageDelay,
      minDelay,
      maxDelay
    };
  }
  
  /**
   * Send buffer priming packets immediately
   */
  private sendBufferPrimingPackets(): void {
    this.logger.debug('Priming jitter buffer with 2 immediate packets', {
      sessionId: this.config.sessionId
    });
    
    // Send 2 packets immediately to prime the 40ms jitter buffer
    for (let i = 0; i < 2; i++) {
      const packetSent = this.config.onPacketSend(this.packetCount + 1);
      if (packetSent) {
        this.packetCount++;
        this.expectedPacketTime += this.config.targetInterval;
        
        this.logger.debug('Sent buffer priming packet', {
          sessionId: this.config.sessionId,
          packetNumber: this.packetCount
        });
      } else {
        // No more packets to send
        this.handleCompletion();
        return;
      }
    }
  }
  
  /**
   * Schedule the next packet with dynamic timing compensation
   */
  private scheduleNextPacket(): void {
    if (!this.isRunning) {
      return;
    }
    
    // Calculate timing for next packet
    const currentTime = Date.now();
    const timeSinceExpected = currentTime - this.expectedPacketTime;
    
    // Update cumulative drift
    this.cumulativeDrift += timeSinceExpected;
    
    // Calculate dynamic delay to compensate for drift
    const baseDelay = this.config.targetInterval;
    const driftCompensation = Math.max(-10, Math.min(10, -timeSinceExpected)); // Clamp to ±10ms
    const adjustedDelay = Math.max(1, baseDelay + driftCompensation); // Never go below 1ms
    
    // Track delay for statistics
    this.delays.push(adjustedDelay);
    
    // Log timing details every N packets
    if (this.packetCount % this.config.logFrequency === 0) {
      this.logger.debug('Dynamic timing status', {
        sessionId: this.config.sessionId,
        packetCount: this.packetCount,
        currentDrift: timeSinceExpected,
        cumulativeDrift: this.cumulativeDrift,
        adjustedDelay: adjustedDelay
      });
    }
    
    // Schedule next packet with adjusted timing
    this.timer = setTimeout(() => {
      if (!this.isRunning) {
        return;
      }
      
      // Try to send the packet
      const packetSent = this.config.onPacketSend(this.packetCount + 1);
      
      if (packetSent) {
        this.packetCount++;
        
        // Update expected time for next packet
        this.expectedPacketTime += this.config.targetInterval;
        
        this.logger.debug('Sent dynamically timed packet', {
          sessionId: this.config.sessionId,
          packetNumber: this.packetCount,
          actualDelay: adjustedDelay
        });
        
        // Schedule next packet
        this.scheduleNextPacket();
      } else {
        // No more packets to send
        this.handleCompletion();
      }
    }, adjustedDelay);
  }
  
  /**
   * Handle completion of packet scheduling
   */
  private handleCompletion(): void {
    this.logger.debug('RTP packet scheduling completed', {
      sessionId: this.config.sessionId,
      stats: this.getStats()
    });
    
    this.stop();
    
    // Call completion callback if provided
    if (this.config.onComplete) {
      this.config.onComplete();
    }
  }
}