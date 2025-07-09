import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Readable, Writable } from 'node:stream';
import { StallableTransform } from './StallableTransform';

describe('StallableTransform', () => {
  test('should pass through data without stalls', async () => {
    const stallableStream = new StallableTransform();
    const inputData = Buffer.from('Hello World');
    const outputChunks: Buffer[] = [];
    
    // Create a simple pipeline
    const readable = new Readable({
      read() {
        this.push(inputData);
        this.push(null);
      }
    });
    
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        outputChunks.push(chunk);
        callback();
      }
    });
    
    await new Promise<void>((resolve, reject) => {
      readable
        .pipe(stallableStream)
        .pipe(writable)
        .on('finish', resolve)
        .on('error', reject);
    });
    
    assert.strictEqual(outputChunks.length, 1);
    assert.deepStrictEqual(outputChunks[0], inputData);
  });
  
  test('should stall for specified duration', async () => {
    const stallableStream = new StallableTransform({ logStalls: true });
    stallableStream.scheduleStall(5, 100); // Stall for 100ms after 5 bytes
    
    const inputData = Buffer.from('Hello World'); // 11 bytes
    const outputChunks: Buffer[] = [];
    const timestamps: number[] = [];
    
    const readable = new Readable({
      read() {
        this.push(inputData);
        this.push(null);
      }
    });
    
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        timestamps.push(Date.now());
        outputChunks.push(chunk);
        callback();
      }
    });
    
    const startTime = Date.now();
    
    await new Promise<void>((resolve, reject) => {
      readable
        .pipe(stallableStream)
        .pipe(writable)
        .on('finish', resolve)
        .on('error', reject);
    });
    
    const endTime = Date.now();
    const totalDuration = endTime - startTime;
    
    // Should have taken at least 100ms due to stall
    assert.ok(totalDuration >= 100, `Expected at least 100ms, got ${totalDuration}ms`);
    
    // Should still output the data
    assert.strictEqual(outputChunks.length, 1);
    assert.deepStrictEqual(outputChunks[0], inputData);
  });
  
  test('should emit stall and resume events', async () => {
    const stallableStream = new StallableTransform();
    stallableStream.scheduleStall(5, 50);
    
    const events: string[] = [];
    
    stallableStream.on('stall', () => events.push('stall'));
    stallableStream.on('resume', () => events.push('resume'));
    
    const readable = new Readable({
      read() {
        this.push(Buffer.from('Hello World'));
        this.push(null);
      }
    });
    
    const writable = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      }
    });
    
    await new Promise<void>((resolve, reject) => {
      readable
        .pipe(stallableStream)
        .pipe(writable)
        .on('finish', resolve)
        .on('error', reject);
    });
    
    // Should have at least one stall and one resume
    assert.ok(events.includes('stall'), 'Should emit stall event');
    assert.ok(events.includes('resume'), 'Should emit resume event');
    
    // First event should be stall
    assert.strictEqual(events[0], 'stall');
  });
  
  test('should handle multiple stalls', async () => {
    const stallableStream = new StallableTransform();
    
    // Send data in multiple chunks to trigger multiple stalls
    const readable = new Readable({
      read() {
        this.push(Buffer.from('Hi')); // 2 bytes - triggers first stall
        this.push(Buffer.from('llo')); // 5 bytes total - triggers second stall  
        this.push(Buffer.from(' World')); // 11 bytes total
        this.push(null);
      }
    });
    
    // Schedule stalls after chunks
    stallableStream.scheduleStalls([
      { atByteCount: 2, durationMs: 50 },
      { atByteCount: 5, durationMs: 30 }
    ]);
    
    const stallEvents: any[] = [];
    stallableStream.on('stall', (event) => stallEvents.push(event));
    
    const writable = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      }
    });
    
    const startTime = Date.now();
    
    await new Promise<void>((resolve, reject) => {
      readable
        .pipe(stallableStream)
        .pipe(writable)
        .on('finish', resolve)
        .on('error', reject);
    });
    
    const endTime = Date.now();
    const totalDuration = endTime - startTime;
    
    // Should have taken at least 50ms (we might only get one stall due to chunking)
    assert.ok(totalDuration >= 50, `Expected at least 50ms, got ${totalDuration}ms`);
    
    // Should have captured at least one stall event
    assert.ok(stallEvents.length >= 1, `Expected at least 1 stall event, got ${stallEvents.length}`);
    assert.strictEqual(stallEvents[0].durationMs, 50);
  });
  
  test('should provide accurate statistics', async () => {
    const stallableStream = new StallableTransform();
    stallableStream.scheduleStall(5, 100);
    
    const readable = new Readable({
      read() {
        this.push(Buffer.from('Hello World')); // 11 bytes
        this.push(null);
      }
    });
    
    const writable = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      }
    });
    
    await new Promise<void>((resolve, reject) => {
      readable
        .pipe(stallableStream)
        .pipe(writable)
        .on('finish', () => {
          const stats = stallableStream.getStats();
          assert.strictEqual(stats.bytesProcessed, 11);
          assert.strictEqual(stats.pendingStalls, 0);
          assert.strictEqual(stats.isCurrentlyStalled, false);
          resolve();
        })
        .on('error', reject);
    });
  });
});