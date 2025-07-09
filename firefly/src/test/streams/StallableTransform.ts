import { Transform, TransformCallback } from 'stream';

export interface StallEvent {
  atByteCount: number;
  durationMs: number;
}

export interface StallableTransformOptions {
  logStalls?: boolean;
  name?: string;
}

/**
 * Generic stallable stream that can inject delays at specific byte counts
 * 
 * This transform stream allows you to simulate processing delays, network stalls,
 * or any other kind of interruption in a stream pipeline. It's useful for testing
 * how systems handle stream backpressure and timing resilience.
 */
export class StallableTransform extends Transform {
  private stalls: StallEvent[] = [];
  private bytesProcessed = 0;
  private isStalled = false;
  private options: StallableTransformOptions;
  
  constructor(options: StallableTransformOptions = {}) {
    super({ objectMode: false });
    this.options = {
      logStalls: false,
      name: 'StallableTransform',
      ...options
    };
  }
  
  /**
   * Schedule a stall to occur when the stream has processed a specific number of bytes
   */
  scheduleStall(atByteCount: number, durationMs: number): void {
    this.stalls.push({ atByteCount, durationMs });
    // Keep stalls sorted by byte count for efficient processing
    this.stalls.sort((a, b) => a.atByteCount - b.atByteCount);
  }
  
  /**
   * Schedule multiple stalls at once
   */
  scheduleStalls(stalls: StallEvent[]): void {
    stalls.forEach(stall => this.scheduleStall(stall.atByteCount, stall.durationMs));
  }
  
  /**
   * Clear all scheduled stalls
   */
  clearStalls(): void {
    this.stalls = [];
  }
  
  /**
   * Get current processing statistics
   */
  getStats() {
    return {
      bytesProcessed: this.bytesProcessed,
      pendingStalls: this.stalls.length,
      isCurrentlyStalled: this.isStalled
    };
  }
  
  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.bytesProcessed += chunk.length;
    
    // Check if we should stall at this byte count
    const nextStall = this.stalls[0];
    if (nextStall && this.bytesProcessed >= nextStall.atByteCount && !this.isStalled) {
      this.isStalled = true;
      this.stalls.shift(); // Remove this stall from the queue
      
      if (this.options.logStalls) {
        console.log(`[${this.options.name}] Stalling for ${nextStall.durationMs}ms at byte ${this.bytesProcessed}`);
      }
      
      // Emit a stall event for external monitoring
      this.emit('stall', {
        byteCount: this.bytesProcessed,
        durationMs: nextStall.durationMs
      });
      
      // Delay the callback to simulate the stall
      setTimeout(() => {
        this.isStalled = false;
        
        if (this.options.logStalls) {
          console.log(`[${this.options.name}] Resuming after stall at byte ${this.bytesProcessed}`);
        }
        
        this.emit('resume', {
          byteCount: this.bytesProcessed
        });
        
        callback(null, chunk);
      }, nextStall.durationMs);
    } else {
      // Normal processing - no stall
      callback(null, chunk);
    }
  }
  
  _flush(callback: TransformCallback): void {
    // Emit final stats before stream ends
    this.emit('stats', this.getStats());
    callback();
  }
}

/**
 * Utility function to create a stallable transform with pre-configured stalls
 */
export function createStallableTransform(stalls: StallEvent[], options?: StallableTransformOptions): StallableTransform {
  const transform = new StallableTransform(options);
  transform.scheduleStalls(stalls);
  return transform;
}