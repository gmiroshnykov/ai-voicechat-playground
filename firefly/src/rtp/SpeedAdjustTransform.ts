import { Transform } from 'stream';
import { spawn, ChildProcess } from 'child_process';
import { createLogger, Logger } from '../utils/logger';
import { CodecInfo } from './types';

export interface SpeedAdjustTransformConfig {
  speedRatio: number; // 1.0 = normal speed, 1.1 = 10% faster, 0.9 = 10% slower
  codecInfo: CodecInfo;
  sessionId: string;
}

/**
 * Transform stream that adjusts audio playback speed using FFmpeg
 * Uses the atempo filter to change tempo without changing pitch
 */
export class SpeedAdjustTransform extends Transform {
  private readonly config: SpeedAdjustTransformConfig;
  private readonly logger: Logger;
  private ffmpegProcess?: ChildProcess;
  private isDestroyed = false;

  constructor(config: SpeedAdjustTransformConfig) {
    super({ 
      objectMode: false,
      highWaterMark: 64 * 1024 // 64KB buffer
    });
    
    this.config = config;
    this.logger = createLogger({ 
      component: 'SpeedAdjustTransform',
      sessionId: config.sessionId
    });
    
    this.logger.debug('SpeedAdjustTransform initialized', {
      speedRatio: config.speedRatio,
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
      }

      callback();
    } catch (error) {
      this.logger.error('Error in speed adjust transform', error);
      callback(error as Error);
    }
  }

  _flush(callback: (error?: Error | null) => void): void {
    if (this.ffmpegProcess && this.ffmpegProcess.stdin && !this.ffmpegProcess.stdin.destroyed) {
      this.ffmpegProcess.stdin.end();
    }
    callback();
  }

  private initializeFFmpeg(): void {
    if (this.isDestroyed) {
      return;
    }

    const sampleRate = this.config.codecInfo.clockRate;
    const channels = this.config.codecInfo.channels || 1;
    
    // Determine input format based on codec
    const inputFormat = this.getInputFormat();
    
    // FFmpeg command to adjust speed
    const ffmpegArgs = [
      '-f', inputFormat,
      '-ar', sampleRate.toString(),
      '-ac', channels.toString(),
      '-i', 'pipe:0', // Input from stdin
      '-filter:a', `atempo=${this.config.speedRatio}`, // Speed adjustment
      '-f', inputFormat,
      '-ar', sampleRate.toString(),
      '-ac', channels.toString(),
      'pipe:1' // Output to stdout
    ];

    this.logger.debug('Starting FFmpeg process', {
      args: ffmpegArgs,
      speedRatio: this.config.speedRatio
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
    
    if (this.ffmpegProcess) {
      this.logger.debug('Terminating FFmpeg process');
      
      // Close stdin gracefully
      if (this.ffmpegProcess.stdin && !this.ffmpegProcess.stdin.destroyed) {
        this.ffmpegProcess.stdin.end();
      }
      
      // Kill the process after a timeout
      setTimeout(() => {
        if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
          this.ffmpegProcess.kill('SIGTERM');
        }
      }, 1000);
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