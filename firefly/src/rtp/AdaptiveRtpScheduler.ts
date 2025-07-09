import { Logger } from '../utils/logger';

export interface AdaptiveRtpSchedulerConfig {
  targetBufferMs: number; // Target buffer depth in milliseconds (e.g., 60ms)
  packetIntervalMs: number; // How long each packet represents (e.g., 20ms)
  checkIntervalMs: number; // How often to check if we need to send (e.g., 5ms)
  logger: Logger;
  sessionId: string;
  
  // Callback functions
  onPacketSend: (packetNumber: number, callTimeMs: number) => boolean; // Return false to stop
  onComplete?: () => void; // Called when scheduling completes
}

export interface AdaptiveRtpSchedulerStats {
  packetsScheduled: number;
  totalDurationMs: number;
  averageBufferDepth: number;
  minBufferDepth: number;
  maxBufferDepth: number;
  bufferUnderruns: number; // Times buffer went below target
  naturalBursts: number; // Times we sent multiple packets quickly
}

interface SentPacket {
  packetNumber: number;
  sentAt: number; // Timestamp when packet was sent
  playAt: number; // Timestamp when packet should be played by receiver
}

/**
 * Adaptive RTP Scheduler with Natural Buffer Management
 * 
 * Instead of fixed timing intervals, this scheduler maintains a target buffer depth
 * at the receiver by continuously monitoring and adjusting packet sending.
 * 
 * Key benefits:
 * - Natural burst behavior when buffer is low (eliminates special "priming" cases)
 * - Automatic flow control based on actual consumption
 * - Resilient to timing variations and packet loss
 * - Self-regulating based on receiver buffer state
 */
export class AdaptiveRtpScheduler {
  private readonly config: AdaptiveRtpSchedulerConfig;
  private readonly logger: Logger;
  
  // Scheduling state
  private isRunning = false;
  private checkTimer?: NodeJS.Timeout;
  private startTime = 0;
  private packetCount = 0;
  
  // Buffer tracking
  private sentPackets: SentPacket[] = [];
  private playbackStartTime = 0; // When receiver started playing audio
  private hasPlaybackStarted = false;
  
  // Statistics
  private stats: AdaptiveRtpSchedulerStats = {
    packetsScheduled: 0,
    totalDurationMs: 0,
    averageBufferDepth: 0,
    minBufferDepth: Number.MAX_VALUE,
    maxBufferDepth: 0,
    bufferUnderruns: 0,
    naturalBursts: 0
  };
  
  private bufferDepthHistory: number[] = [];

  constructor(config: AdaptiveRtpSchedulerConfig) {
    this.config = config;
    this.logger = config.logger;
    
    this.logger.debug('Adaptive RTP scheduler initialized', {
      targetBufferMs: config.targetBufferMs,
      packetIntervalMs: config.packetIntervalMs,
      checkIntervalMs: config.checkIntervalMs,
      sessionId: config.sessionId
    });
  }

  /**
   * Start adaptive packet scheduling
   */
  public start(): void {
    if (this.isRunning) {
      return;
    }
    
    this.isRunning = true;
    this.startTime = Date.now();
    this.playbackStartTime = this.startTime + this.config.targetBufferMs;
    this.hasPlaybackStarted = false;
    
    this.logger.debug('Starting adaptive RTP scheduler', {
      sessionId: this.config.sessionId,
      targetBufferMs: this.config.targetBufferMs,
      startTime: this.startTime
    });
    
    // Start the continuous checking loop
    this.scheduleNextCheck();
  }

  /**
   * Stop adaptive packet scheduling
   */
  public stop(): void {
    if (!this.isRunning) {
      return;
    }
    
    this.isRunning = false;
    
    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
      this.checkTimer = undefined;
    }
    
    this.calculateFinalStats();
    
    this.logger.debug('Adaptive RTP scheduler stopped', {
      sessionId: this.config.sessionId,
      stats: this.stats
    });
  }

  /**
   * Schedule the next buffer check
   */
  private scheduleNextCheck(): void {
    if (!this.isRunning) {
      return;
    }
    
    this.checkTimer = setTimeout(() => {
      this.checkAndSendPackets();
      this.scheduleNextCheck();
    }, this.config.checkIntervalMs);
  }

  /**
   * Check buffer depth and send packets if needed
   */
  private checkAndSendPackets(): void {
    const now = Date.now();
    const callTimeMs = now - this.startTime;
    
    // Update playback state
    if (!this.hasPlaybackStarted && now >= this.playbackStartTime) {
      this.hasPlaybackStarted = true;
      this.logger.debug('Receiver playback started', {
        sessionId: this.config.sessionId,
        playbackStartTime: this.playbackStartTime
      });
    }
    
    // Clean up consumed packets
    this.removeConsumedPackets(now);
    
    // Calculate current buffer depth
    const currentBufferDepth = this.calculateBufferDepth();
    
    // Update statistics
    this.updateBufferStats(currentBufferDepth);
    
    // Send packets if buffer is below target
    let packetsSentThisCheck = 0;
    while (currentBufferDepth + (packetsSentThisCheck * this.config.packetIntervalMs) < this.config.targetBufferMs) {
      const shouldContinue = this.sendPacket(callTimeMs);
      if (!shouldContinue) {
        this.handleCompletion();
        return;
      }
      packetsSentThisCheck++;
    }
    
    // Track natural bursts
    if (packetsSentThisCheck > 1) {
      this.stats.naturalBursts++;
      this.logger.trace('Natural burst sending', {
        sessionId: this.config.sessionId,
        packetsSent: packetsSentThisCheck,
        bufferDepth: currentBufferDepth,
        targetBuffer: this.config.targetBufferMs
      });
    }
  }

  /**
   * Remove packets that should have been consumed by the receiver
   */
  private removeConsumedPackets(now: number): void {
    if (!this.hasPlaybackStarted) {
      return; // Receiver hasn't started playing yet
    }
    
    // Remove packets that should have been played
    const beforeCount = this.sentPackets.length;
    this.sentPackets = this.sentPackets.filter(packet => packet.playAt > now);
    
    if (this.sentPackets.length < beforeCount) {
      this.logger.trace('Consumed packets removed', {
        sessionId: this.config.sessionId,
        consumed: beforeCount - this.sentPackets.length,
        remaining: this.sentPackets.length
      });
    }
  }

  /**
   * Calculate current buffer depth in milliseconds
   */
  private calculateBufferDepth(): number {
    return this.sentPackets.length * this.config.packetIntervalMs;
  }

  /**
   * Send a single packet
   */
  private sendPacket(callTimeMs: number): boolean {
    const now = Date.now();
    this.packetCount++;
    
    // Calculate when this packet should be played (audio timeline, not send time)
    const playAt = this.playbackStartTime + ((this.packetCount - 1) * this.config.packetIntervalMs);
    
    // Track the sent packet
    this.sentPackets.push({
      packetNumber: this.packetCount,
      sentAt: now,
      playAt
    });
    
    // Call the packet send callback
    const shouldContinue = this.config.onPacketSend(this.packetCount, callTimeMs);
    
    this.logger.trace('Sent adaptive packet', {
      sessionId: this.config.sessionId,
      packetNumber: this.packetCount,
      bufferDepth: this.calculateBufferDepth(),
      playAt
    });
    
    return shouldContinue;
  }

  /**
   * Update buffer depth statistics
   */
  private updateBufferStats(currentBufferDepth: number): void {
    this.bufferDepthHistory.push(currentBufferDepth);
    
    if (currentBufferDepth < this.stats.minBufferDepth) {
      this.stats.minBufferDepth = currentBufferDepth;
    }
    
    if (currentBufferDepth > this.stats.maxBufferDepth) {
      this.stats.maxBufferDepth = currentBufferDepth;
    }
    
    // Track buffer underruns
    if (currentBufferDepth < this.config.targetBufferMs * 0.5) {
      this.stats.bufferUnderruns++;
    }
  }

  /**
   * Handle completion of packet scheduling
   */
  private handleCompletion(): void {
    this.logger.debug('Adaptive packet scheduling completed', {
      sessionId: this.config.sessionId,
      totalPackets: this.packetCount
    });
    
    this.stop();
    
    if (this.config.onComplete) {
      this.config.onComplete();
    }
  }

  /**
   * Calculate final statistics
   */
  private calculateFinalStats(): void {
    this.stats.packetsScheduled = this.packetCount;
    this.stats.totalDurationMs = Date.now() - this.startTime;
    
    if (this.bufferDepthHistory.length > 0) {
      this.stats.averageBufferDepth = this.bufferDepthHistory.reduce((sum, depth) => sum + depth, 0) / this.bufferDepthHistory.length;
    }
    
    if (this.stats.minBufferDepth === Number.MAX_VALUE) {
      this.stats.minBufferDepth = 0;
    }
  }

  /**
   * Get current statistics
   */
  public getStats(): AdaptiveRtpSchedulerStats {
    this.calculateFinalStats();
    return { ...this.stats };
  }

  /**
   * Get current buffer state (for debugging)
   */
  public getBufferState() {
    return {
      currentBufferDepth: this.calculateBufferDepth(),
      targetBufferDepth: this.config.targetBufferMs,
      sentPacketsCount: this.sentPackets.length,
      hasPlaybackStarted: this.hasPlaybackStarted,
      packetCount: this.packetCount
    };
  }
}

/**
 * Utility function to create an adaptive RTP scheduler with typical settings
 */
export function createAdaptiveRtpScheduler(config: Omit<AdaptiveRtpSchedulerConfig, 'packetIntervalMs' | 'checkIntervalMs'>) {
  return new AdaptiveRtpScheduler({
    ...config,
    packetIntervalMs: 20, // Standard RTP interval
    checkIntervalMs: 5    // Check every 5ms for responsive flow control
  });
}