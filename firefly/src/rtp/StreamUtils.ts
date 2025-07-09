import { PassThrough, Writable } from 'stream';

/**
 * Creates a "tee" stream that duplicates input to multiple outputs
 * Useful for forking audio streams for recording while continuing main processing
 */
export class TeeStream extends PassThrough {
  private readonly outputs: Writable[] = [];

  constructor(options?: any) {
    super(options);
  }

  /**
   * Add an output stream that will receive a copy of all data
   */
  addOutput(output: Writable): void {
    this.outputs.push(output);
    
    // Handle output stream errors
    output.on('error', (error) => {
      console.error('TeeStream output error:', error);
    });
  }

  /**
   * Remove an output stream
   */
  removeOutput(output: Writable): void {
    const index = this.outputs.indexOf(output);
    if (index > -1) {
      this.outputs.splice(index, 1);
    }
  }

  _write(chunk: any, _encoding: string, callback: (error?: Error | null) => void): void {
    // Write to all outputs
    let pendingWrites = this.outputs.length;
    let hasError = false;

    if (pendingWrites === 0) {
      // No outputs, just pass through
      return super._write(chunk, _encoding as BufferEncoding, callback);
    }

    const onOutputComplete = (error?: Error | null) => {
      if (error && !hasError) {
        hasError = true;
        callback(error);
        return;
      }
      
      pendingWrites--;
      if (pendingWrites === 0 && !hasError) {
        // All outputs written, now write to main stream
        super._write(chunk, _encoding as BufferEncoding, callback);
      }
    };

    // Write to all outputs
    this.outputs.forEach(output => {
      output.write(chunk, onOutputComplete);
    });
  }
}

/**
 * Utility function to create a tee stream with multiple outputs
 */
export function createTee(outputs: Writable[]): TeeStream {
  const tee = new TeeStream({ objectMode: false });
  outputs.forEach(output => tee.addOutput(output));
  return tee;
}

/**
 * Utility function to create a simple passthrough stream
 */
export function createPassThrough(options?: any): PassThrough {
  return new PassThrough(options);
}