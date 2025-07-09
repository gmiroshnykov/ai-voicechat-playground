import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createAdaptiveRtpScheduler } from '../rtp/AdaptiveRtpScheduler';
import { createLogger } from '../utils/logger';

describe('AdaptiveRtpScheduler', () => {
  test('should send packets naturally to maintain buffer depth', async () => {
    const logger = createLogger({ component: 'AdaptiveRtpSchedulerTest' });
    const packets: { timestamp: number; packetNumber: number; callTimeMs: number }[] = [];
    let packetCount = 0;
    
    const scheduler = createAdaptiveRtpScheduler({
      targetBufferMs: 60, // 3 packets worth
      logger,
      sessionId: 'adaptive-test',
      onPacketSend: (packetNumber: number, callTimeMs: number) => {
        packets.push({ timestamp: Date.now(), packetNumber, callTimeMs });
        packetCount++;
        
        // Stop after 20 packets
        return packetCount < 20;
      }
    });
    
    const startTime = Date.now();
    scheduler.start();
    
    // Wait for completion
    await new Promise<void>((resolve) => {
      const checkCompletion = () => {
        if (packetCount >= 20) {
          resolve();
        } else {
          setTimeout(checkCompletion, 10);
        }
      };
      checkCompletion();
    });
    
    const endTime = Date.now();
    const totalDuration = endTime - startTime;
    const stats = scheduler.getStats();
    
    console.log(`Adaptive scheduler completed in ${totalDuration}ms`);
    console.log(`Natural bursts: ${stats.naturalBursts}`);
    console.log(`Average buffer depth: ${stats.averageBufferDepth.toFixed(2)}ms`);
    console.log(`Min/Max buffer depth: ${stats.minBufferDepth}ms / ${stats.maxBufferDepth}ms`);
    
    // Verify basic functionality
    assert.strictEqual(packets.length, 20, 'Should have sent exactly 20 packets');
    assert.strictEqual(stats.packetsScheduled, 20, 'Stats should show 20 packets scheduled');
    
    // Should have natural bursts (initial packets sent quickly)
    assert.ok(stats.naturalBursts > 0, 'Should have natural bursts when buffer is low');
    
    // Average buffer depth should be close to target
    assert.ok(stats.averageBufferDepth >= 30, 'Average buffer depth should be reasonable');
    assert.ok(stats.averageBufferDepth <= 80, 'Average buffer depth should not be excessive');
    
    // Initial packets should be sent quickly (natural priming)
    const firstThreePackets = packets.slice(0, 3);
    if (firstThreePackets.length >= 3) {
      const firstThreeSpan = firstThreePackets[2]!.timestamp - firstThreePackets[0]!.timestamp;
      assert.ok(firstThreeSpan < 50, `First 3 packets should be sent quickly, took ${firstThreeSpan}ms`);
    }
    
    // Later packets should be more spaced out than initial burst
    const laterPackets = packets.slice(10, 15);
    if (laterPackets.length >= 5) {
      const laterSpan = laterPackets[4]!.timestamp - laterPackets[0]!.timestamp;
      assert.ok(laterSpan > 20, `Later packets should be more spaced than initial burst, took ${laterSpan}ms`);
    }
  });
  
  test('should handle processing delays gracefully', async () => {
    const logger = createLogger({ component: 'AdaptiveRtpSchedulerTest' });
    const packets: { timestamp: number; packetNumber: number }[] = [];
    let packetCount = 0;
    
    const scheduler = createAdaptiveRtpScheduler({
      targetBufferMs: 60,
      logger,
      sessionId: 'delay-test',
      onPacketSend: (packetNumber: number, _callTimeMs: number) => {
        packets.push({ timestamp: Date.now(), packetNumber });
        packetCount++;
        
        // Simulate processing delay on packet 10
        if (packetNumber === 10) {
          const start = Date.now();
          while (Date.now() - start < 100) {
            // Busy wait for 100ms
          }
        }
        
        return packetCount < 15;
      }
    });
    
    const startTime = Date.now();
    scheduler.start();
    
    // Wait for completion
    await new Promise<void>((resolve) => {
      const checkCompletion = () => {
        if (packetCount >= 15) {
          resolve();
        } else {
          setTimeout(checkCompletion, 10);
        }
      };
      checkCompletion();
    });
    
    const endTime = Date.now();
    const totalDuration = endTime - startTime;
    const stats = scheduler.getStats();
    
    console.log(`Delay test completed in ${totalDuration}ms`);
    console.log(`Buffer underruns: ${stats.bufferUnderruns}`);
    
    // Should handle the delay gracefully
    assert.strictEqual(packets.length, 15, 'Should have sent exactly 15 packets');
    assert.ok(totalDuration >= 100, 'Should account for the processing delay');
    
    // Should maintain reasonable buffer depth despite delay
    assert.ok(stats.averageBufferDepth >= 20, 'Should maintain reasonable buffer depth');
  });
  
  test('should stop cleanly when callback returns false', async () => {
    const logger = createLogger({ component: 'AdaptiveRtpSchedulerTest' });
    let packetCount = 0;
    let completionCalled = false;
    
    const scheduler = createAdaptiveRtpScheduler({
      targetBufferMs: 60,
      logger,
      sessionId: 'stop-test',
      onPacketSend: (_packetNumber: number, _callTimeMs: number) => {
        packetCount++;
        return packetCount < 5; // Stop after 5 packets
      },
      onComplete: () => {
        completionCalled = true;
      }
    });
    
    const startTime = Date.now();
    scheduler.start();
    
    // Wait for completion
    await new Promise<void>((resolve) => {
      const checkCompletion = () => {
        if (packetCount >= 5) {
          // Give it a bit more time to call onComplete
          setTimeout(resolve, 50);
        } else {
          setTimeout(checkCompletion, 10);
        }
      };
      checkCompletion();
    });
    
    const endTime = Date.now();
    const totalDuration = endTime - startTime;
    const stats = scheduler.getStats();
    
    console.log(`Stop test completed in ${totalDuration}ms`);
    
    // Should stop at exactly 5 packets
    assert.strictEqual(packetCount, 5, 'Should stop at exactly 5 packets');
    assert.strictEqual(stats.packetsScheduled, 5, 'Stats should show 5 packets scheduled');
    assert.ok(completionCalled, 'Should call onComplete callback');
    
    // Should complete quickly (no extended scheduling)
    assert.ok(totalDuration < 200, `Should complete quickly, took ${totalDuration}ms`);
  });
  
  test('should maintain consistent buffer depth over time', async () => {
    const logger = createLogger({ component: 'AdaptiveRtpSchedulerTest' });
    const bufferStates: any[] = [];
    let packetCount = 0;
    
    const scheduler = createAdaptiveRtpScheduler({
      targetBufferMs: 60,
      logger,
      sessionId: 'consistency-test',
      onPacketSend: (packetNumber: number, _callTimeMs: number) => {
        packetCount++;
        
        // Sample buffer state every 10th packet
        if (packetNumber % 10 === 0) {
          bufferStates.push({
            packetNumber,
            bufferState: scheduler.getBufferState(),
            timestamp: Date.now()
          });
        }
        
        return packetCount < 50;
      }
    });
    
    scheduler.start();
    
    // Wait for completion
    await new Promise<void>((resolve) => {
      const checkCompletion = () => {
        if (packetCount >= 50) {
          resolve();
        } else {
          setTimeout(checkCompletion, 10);
        }
      };
      checkCompletion();
    });
    
    const stats = scheduler.getStats();
    
    console.log(`Consistency test completed`);
    console.log(`Buffer depth range: ${stats.minBufferDepth}ms - ${stats.maxBufferDepth}ms`);
    
    // Should maintain buffer depth within reasonable bounds
    assert.ok(stats.minBufferDepth >= 0, 'Min buffer depth should be non-negative');
    assert.ok(stats.maxBufferDepth <= 100, 'Max buffer depth should not be excessive');
    
    // Should have consistent behavior over time
    const lastStates = bufferStates.slice(-3);
    if (lastStates.length > 0) {
      const avgDepth = lastStates.reduce((sum, state) => sum + state.bufferState.currentBufferDepth, 0) / lastStates.length;
      assert.ok(avgDepth >= 20, `Average buffer depth should be reasonable: ${avgDepth}ms`);
      assert.ok(avgDepth <= 80, `Average buffer depth should not be excessive: ${avgDepth}ms`);
    }
  });
});