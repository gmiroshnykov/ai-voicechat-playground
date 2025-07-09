import { test, describe } from 'node:test';
import assert from 'node:assert';
import { RtpContinuousScheduler, RtpContinuousSchedulerConfig } from '../rtp/RtpContinuousScheduler';
import { createLogger } from '../utils/logger';

describe('RTP Timing', () => {
  test('should maintain 20ms intervals despite callback delays', async () => {
    const logger = createLogger({ component: 'RtpTimingTest' });
    const packets: { timestamp: number; callTimeMs: number }[] = [];
    let packetCount = 0;
    
    const config: RtpContinuousSchedulerConfig = {
      targetInterval: 20,
      logFrequency: 1000, // Don't spam logs
      logger,
      sessionId: 'timing-test',
      onPacketSend: (packetNumber: number, _callTimeMs: number) => {
        const timestamp = Date.now();
        packets.push({ timestamp, callTimeMs: _callTimeMs });
        packetCount++;
        
        // Simulate processing delay on specific packets
        if (packetNumber === 10) {
          // Block for 50ms to simulate slow processing
          const start = Date.now();
          while (Date.now() - start < 50) {
            // Busy wait
          }
        } else if (packetNumber === 25) {
          // Block for 100ms to simulate even slower processing
          const start = Date.now();
          while (Date.now() - start < 100) {
            // Busy wait
          }
        }
        
        // Stop after 50 packets
        return packetCount < 50;
      }
    };
    
    const scheduler = new RtpContinuousScheduler(config);
    const startTime = Date.now();
    
    scheduler.start();
    
    // Wait for completion
    await new Promise<void>((resolve) => {
      const checkCompletion = () => {
        if (packetCount >= 50) {
          scheduler.stop();
          resolve();
        } else {
          setTimeout(checkCompletion, 10);
        }
      };
      checkCompletion();
    });
    
    const endTime = Date.now();
    const totalDuration = endTime - startTime;
    
    // Analyze timing
    assert.strictEqual(packets.length, 50, 'Should have sent exactly 50 packets');
    
    // Calculate intervals between packets
    const intervals: number[] = [];
    for (let i = 1; i < packets.length; i++) {
      const interval = packets[i]!.timestamp - packets[i - 1]!.timestamp;
      intervals.push(interval);
    }
    
    // Check interval statistics
    const avgInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    const maxInterval = Math.max(...intervals);
    const minInterval = Math.min(...intervals);
    
    console.log(`Test completed in ${totalDuration}ms`);
    console.log(`Average interval: ${avgInterval.toFixed(2)}ms (target: 20ms)`);
    console.log(`Min interval: ${minInterval}ms, Max interval: ${maxInterval}ms`);
    
    // Verify timing expectations
    assert.ok(avgInterval >= 18 && avgInterval <= 22, 
      `Average interval ${avgInterval.toFixed(2)}ms should be close to 20ms`);
    
    // Most intervals should be close to 20ms (allowing OS timing variance)
    const goodIntervals = intervals.filter(interval => interval >= 10 && interval <= 30).length;
    const goodPercentage = (goodIntervals / intervals.length) * 100;
    
    console.log(`${goodIntervals}/${intervals.length} intervals (${goodPercentage.toFixed(1)}%) within 10-30ms range`);
    
    assert.ok(goodPercentage >= 70, 
      `At least 70% of intervals should be within 10-30ms range, got ${goodPercentage.toFixed(1)}%`);
    
    // Verify that processing delays didn't break overall timing
    const expectedDuration = 50 * 20; // 50 packets * 20ms = 1000ms
    assert.ok(totalDuration >= expectedDuration - 100, 
      `Total duration ${totalDuration}ms should be at least ${expectedDuration - 100}ms`);
    
    assert.ok(totalDuration <= expectedDuration + 500, 
      `Total duration ${totalDuration}ms should not exceed ${expectedDuration + 500}ms`);
  });
  
  test('should handle extreme processing delays gracefully', async () => {
    const logger = createLogger({ component: 'RtpTimingTest' });
    const packets: { timestamp: number; packetNumber: number }[] = [];
    let packetCount = 0;
    
    const config: RtpContinuousSchedulerConfig = {
      targetInterval: 20,
      logFrequency: 1000,
      logger,
      sessionId: 'extreme-delay-test',
      onPacketSend: (packetNumber: number, _callTimeMs: number) => {
        packets.push({ timestamp: Date.now(), packetNumber });
        packetCount++;
        
        // Simulate extreme delay on packet 5
        if (packetNumber === 5) {
          const start = Date.now();
          while (Date.now() - start < 200) {
            // 200ms processing delay
          }
        }
        
        // Stop after 20 packets
        return packetCount < 20;
      }
    };
    
    const scheduler = new RtpContinuousScheduler(config);
    const startTime = Date.now();
    
    scheduler.start();
    
    // Wait for completion
    await new Promise<void>((resolve) => {
      const checkCompletion = () => {
        if (packetCount >= 20) {
          scheduler.stop();
          resolve();
        } else {
          setTimeout(checkCompletion, 10);
        }
      };
      checkCompletion();
    });
    
    const endTime = Date.now();
    
    // Find the packet that had the extreme delay
    const delayedPacket = packets.find(p => p.packetNumber === 5);
    const nextPacket = packets.find(p => p.packetNumber === 6);
    
    assert.ok(delayedPacket, 'Should find the delayed packet');
    assert.ok(nextPacket, 'Should find the packet after delay');
    
    if (delayedPacket && nextPacket) {
      const intervalAfterDelay = nextPacket.timestamp - delayedPacket.timestamp;
      
      console.log(`Interval after 200ms processing delay: ${intervalAfterDelay}ms`);
      
      // The next packet should still be scheduled at the right time
      // It might be slightly delayed due to the processing, but should recover quickly
      assert.ok(intervalAfterDelay >= 200, 
        `Interval after delay should be at least 200ms (processing time), got ${intervalAfterDelay}ms`);
      
      assert.ok(intervalAfterDelay <= 250, 
        `Interval after delay should recover quickly, got ${intervalAfterDelay}ms`);
    }
    
    // Overall timing should still be reasonable
    const totalDuration = endTime - startTime;
    const expectedMinDuration = 20 * 20; // 20 packets * 20ms = 400ms
    
    console.log(`Total test duration: ${totalDuration}ms (expected around ${expectedMinDuration}ms)`);
    
    // Should be reasonably close to expected duration (allowing for timer efficiency)
    assert.ok(totalDuration >= expectedMinDuration - 50, 
      `Total duration should be close to expected, got ${totalDuration}ms (expected at least ${expectedMinDuration - 50}ms)`);
    
    // Should account for the processing delay but be reasonably efficient  
    assert.ok(totalDuration <= expectedMinDuration + 300, 
      `Total duration should not be excessively long, got ${totalDuration}ms (expected at most ${expectedMinDuration + 300}ms)`);
  });
  
  test('should stop immediately when callback returns false', async () => {
    const logger = createLogger({ component: 'RtpTimingTest' });
    let packetCount = 0;
    
    const config: RtpContinuousSchedulerConfig = {
      targetInterval: 20,
      logFrequency: 1000,
      logger,
      sessionId: 'stop-test',
      onPacketSend: (_packetNumber: number, _callTimeMs: number) => {
        packetCount++;
        
        // Stop after 10 packets
        return packetCount < 10;
      },
      onComplete: () => {
        // This should be called when stopping
      }
    };
    
    const scheduler = new RtpContinuousScheduler(config);
    const startTime = Date.now();
    
    scheduler.start();
    
    // Wait for completion
    await new Promise<void>((resolve) => {
      const checkCompletion = () => {
        if (packetCount >= 10) {
          // Give it a bit more time to ensure it actually stopped
          setTimeout(resolve, 100);
        } else {
          setTimeout(checkCompletion, 10);
        }
      };
      checkCompletion();
    });
    
    const endTime = Date.now();
    const finalPacketCount = packetCount;
    
    // Should have stopped at exactly 10 packets
    assert.strictEqual(finalPacketCount, 10, 'Should stop at exactly 10 packets');
    
    // Should have taken roughly 200ms (10 packets * 20ms)
    const totalDuration = endTime - startTime;
    assert.ok(totalDuration >= 180 && totalDuration <= 300, 
      `Duration should be around 200ms, got ${totalDuration}ms`);
  });
});