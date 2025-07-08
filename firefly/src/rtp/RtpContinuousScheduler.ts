import { Logger } from '../utils/logger';

export interface RtpContinuousSchedulerConfig {
  targetInterval: number; // Target interval in ms (typically 20ms)
  logFrequency: number; // Log timing stats every N packets
  logger: Logger;
  sessionId: string;
  
  // Callback functions
  onPacketSend: (packetNumber: number, callTimeMs: number) => boolean; // Returns true to continue, false to stop
  onComplete?: () => void; // Called when scheduling completes
}

export interface RtpContinuousSchedulerStats {
  packetsScheduled: number;
  totalDurationMs: number;
  finalCumulativeDrift: number;
  averageDelay: number;
  minDelay: number;
  maxDelay: number;
}

/**
 * RTP Continuous Scheduler with Dynamic Timing Compensation
 * 
 * This class provides continuous RTP packet scheduling for the entire call duration,
 * sending a packet every 20ms regardless of audio content availability. This ensures
 * proper jitter buffer behavior and eliminates audio artifacts.
 * 
 * Features:
 * - Continuous packet stream for entire call duration
 * - Buffer priming: Sends 2 packets immediately to fill jitter buffer
 * - Dynamic drift compensation: Adjusts timing based on actual vs expected intervals
 * - Time-based audio source management
 * - Comprehensive logging and statistics
 */
export class RtpContinuousScheduler {
  private readonly config: RtpContinuousSchedulerConfig;
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
  
  constructor(config: RtpContinuousSchedulerConfig) {
    this.config = config;
    this.logger = config.logger;
  }
  
  /**
   * Start continuous packet scheduling with buffer priming
   */
  public start(): void {
    if (this.isRunning) {
      this.logger.warn('RTP continuous scheduler already running');
      return;
    }
    
    this.isRunning = true;
    this.startTime = Date.now();
    this.expectedPacketTime = this.startTime;
    this.cumulativeDrift = 0;
    this.packetCount = 0;
    this.delays = [];
    
    this.logger.info('Starting RTP continuous scheduler with simple setInterval', {
      targetInterval: this.config.targetInterval,
      sessionId: this.config.sessionId,
      startTime: this.startTime
    });
    
    // Prime the jitter buffer: send first 2 packets immediately
    this.sendBufferPrimingPackets();
    
    // Start simple timeout scheduling
    this.scheduleNextPacket();
  }
  
  /**
   * Stop continuous packet scheduling
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
    
    this.logger.info('RTP continuous scheduler stopped', {
      sessionId: this.config.sessionId,
      stats: this.getStats()
    });
  }
  
  /**
   * Get scheduling statistics
   */
  public getStats(): RtpContinuousSchedulerStats {
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
    this.logger.debug('Priming jitter buffer with 3 immediate packets', {
      sessionId: this.config.sessionId
    });
    
    // Send 3 packets immediately to prime the 60ms jitter buffer  
    for (let i = 0; i < 3; i++) {
      const callTimeMs = Date.now() - this.startTime;
      const shouldContinue = this.config.onPacketSend(this.packetCount + 1, callTimeMs);
      
      if (shouldContinue) {
        this.packetCount++;
        this.expectedPacketTime += this.config.targetInterval;
        
        this.logger.debug('Sent buffer priming packet', {
          sessionId: this.config.sessionId,
          packetNumber: this.packetCount,
          callTimeMs
        });
      } else {
        // Call ended during priming
        this.handleCompletion();
        return;
      }
    }
  }
  
  /**
   * Schedule the next packet with absolute time-based pacing
   */
  private scheduleNextPacket(): void {
    if (!this.isRunning) {
      return;
    }
    
    // Calculate the absolute time when the next packet should be sent
    const nextPacketAbsoluteTime = this.startTime + (this.packetCount * this.config.targetInterval);
    const now = Date.now();
    const delay = Math.max(0, nextPacketAbsoluteTime - now);
    
    this.timer = setTimeout(() => {
      if (!this.isRunning) {
        return;
      }
      
      // Calculate call time for this packet
      const callTimeMs = Date.now() - this.startTime;
      
      // Try to send the packet
      const shouldContinue = this.config.onPacketSend(this.packetCount + 1, callTimeMs);
      
      if (shouldContinue) {
        this.packetCount++;
        
        // Log status every N packets
        if (this.packetCount % this.config.logFrequency === 0) {
          const actualDelay = Date.now() - nextPacketAbsoluteTime;
          this.logger.debug('Absolute time-based RTP pacing status', {
            sessionId: this.config.sessionId,
            packetCount: this.packetCount,
            callTimeMs,
            targetInterval: this.config.targetInterval,
            scheduledDelay: delay,
            actualDelay: actualDelay
          });
        }
        
        this.logger.trace('Sent absolute-timed packet', {
          sessionId: this.config.sessionId,
          packetNumber: this.packetCount,
          callTimeMs,
          scheduledDelay: delay
        });
        
        // Schedule next packet
        this.scheduleNextPacket();
      } else {
        // Call ended or should stop
        this.handleCompletion();
      }
    }, delay);
  }
  

  /**
   * Handle completion of continuous scheduling
   */
  private handleCompletion(): void {
    this.logger.info('RTP continuous scheduling completed', {
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