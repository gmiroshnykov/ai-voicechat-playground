import { Transform } from 'stream';
import { spawn, ChildProcess } from 'child_process';
import { createLogger, Logger } from '../utils/logger';
import { CodecInfo } from './types';

export interface TempoAdjustTransformConfig {
  tempo: number; // 1.0 = normal speed, 1.2 = 20% faster, 0.8 = 20% slower
  codecInfo: CodecInfo;
  sessionId: string;
}

/**
 * Transform stream that adjusts audio tempo using FFmpeg
 * Uses the atempo filter to change tempo without changing pitch
 * 
 * IMPORTANT: This should only be used with buffered audio streams,
 * NOT with real-time audio as it introduces processing latency.
 * Perfect for buffered audio or AI responses that come in bursts.
 */
export class TempoAdjustTransform extends Transform {
  private readonly config: TempoAdjustTransformConfig;
  private readonly logger: Logger;
  private ffmpegProcess?: ChildProcess;
  private isDestroyed = false;
  private killTimeout?: NodeJS.Timeout;

  constructor(config: TempoAdjustTransformConfig) {
    super({ 
      objectMode: false,
      highWaterMark: 64 * 1024 // 64KB buffer
    });
    
    this.config = config;
    this.logger = createLogger({ 
      component: 'TempoAdjustTransform',
      sessionId: config.sessionId
    });
    
    this.logger.debug('TempoAdjustTransform initialized', {
      tempo: config.tempo,
      codec: config.codecInfo.name
    });
  }

  _transform(chunk: Buffer, _encoding: string, callback: (error?: Error | null, data?: any) => void): void {
    if (this.isDestroyed) {
      callback();
      return;
    }

    try {
      // Initialize FFmpeg process on first chunk
      if (!this.ffmpegProcess) {
        this.initializeFFmpeg();
      }

      // Write chunk to FFmpeg stdin
      if (this.ffmpegProcess && this.ffmpegProcess.stdin && !this.ffmpegProcess.stdin.destroyed) {
        this.ffmpegProcess.stdin.write(chunk);
      } else {
        // Pass through unchanged if FFmpeg not available
        this.push(chunk);
      }

      callback();
    } catch (error) {
      this.logger.error('Error in tempo adjust transform', error);
      callback(error as Error);
    }
  }

  _flush(callback: (error?: Error | null) => void): void {
    if (this.ffmpegProcess && this.ffmpegProcess.stdin && !this.ffmpegProcess.stdin.destroyed) {
      // Wait for FFmpeg to finish processing after closing stdin
      this.ffmpegProcess.on('exit', () => {
        callback();
      });
      this.ffmpegProcess.stdin.end();
    } else {
      callback();
    }
  }

  private initializeFFmpeg(): void {
    if (this.isDestroyed) {
      return;
    }

    const sampleRate = this.config.codecInfo.clockRate;
    const channels = this.config.codecInfo.channels || 1;
    
    // Determine input format based on codec
    const inputFormat = this.getInputFormat();
    
    // FFmpeg command to adjust tempo
    const ffmpegArgs = [
      '-f', inputFormat,
      '-ar', sampleRate.toString(),
      '-ac', channels.toString(),
      '-i', 'pipe:0', // Input from stdin
      '-filter:a', `atempo=${this.config.tempo}`, // Tempo adjustment
      '-f', inputFormat,
      '-ar', sampleRate.toString(),
      '-ac', channels.toString(),
      'pipe:1' // Output to stdout
    ];

    this.logger.debug('Starting FFmpeg process', {
      args: ffmpegArgs,
      tempo: this.config.tempo
    });

    this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Handle FFmpeg stdout (processed audio)
    this.ffmpegProcess.stdout!.on('data', (data: Buffer) => {
      if (!this.isDestroyed) {
        this.push(data);
      }
    });

    // Handle FFmpeg stderr (logs)
    this.ffmpegProcess.stderr!.on('data', (data: Buffer) => {
      this.logger.trace('FFmpeg stderr', { 
        output: data.toString().trim() 
      });
    });

    // Handle FFmpeg process exit
    this.ffmpegProcess.on('exit', (code, signal) => {
      this.logger.debug('FFmpeg process exited', { code, signal });
      this.ffmpegProcess = undefined;
    });

    // Handle FFmpeg process errors
    this.ffmpegProcess.on('error', (error) => {
      this.logger.error('FFmpeg process error', error);
      this.emit('error', error);
    });

    // Handle stdin errors
    this.ffmpegProcess.stdin!.on('error', (error) => {
      if (!this.isDestroyed) {
        this.logger.error('FFmpeg stdin error', error);
      }
    });
  }

  private getInputFormat(): string {
    // Map codec types to FFmpeg input formats
    switch (this.config.codecInfo.name.toUpperCase()) {
      case 'PCMU':
        return 'mulaw';
      case 'PCMA':
        return 'alaw';
      default:
        this.logger.warn('Unknown codec for FFmpeg, using mulaw', {
          codec: this.config.codecInfo.name
        });
        return 'mulaw';
    }
  }

  public destroy(error?: Error): this {
    if (this.isDestroyed) {
      return this;
    }

    this.isDestroyed = true;
    
    // Clear any pending kill timeout
    if (this.killTimeout) {
      clearTimeout(this.killTimeout);
      this.killTimeout = undefined;
    }
    
    if (this.ffmpegProcess) {
      this.logger.debug('Terminating FFmpeg process');
      
      // Close stdin gracefully
      if (this.ffmpegProcess.stdin && !this.ffmpegProcess.stdin.destroyed) {
        this.ffmpegProcess.stdin.end();
      }
      
      // Kill the process after a short timeout, but don't keep event loop alive
      this.killTimeout = setTimeout(() => {
        if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
          this.ffmpegProcess.kill('SIGTERM');
        }
      }, 100);
      
      // Don't keep the event loop alive for this timeout
      this.killTimeout.unref();
    }

    return super.destroy(error);
  }

  public static isAvailable(): boolean {
    // Check if FFmpeg is available (basic check)
    try {
      spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
      return true;
    } catch (error) {
      return false;
    }
  }
}