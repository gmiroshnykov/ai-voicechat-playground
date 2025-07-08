#!/usr/bin/env node

/**
 * Timer Precision Test
 * 
 * This test measures the precision of JavaScript's setInterval() function
 * to understand timing variations that cause audio artifacts in RTP streaming.
 * 
 * Expected: 20ms intervals for RTP packet scheduling
 * Reality: Variable timing due to JavaScript event loop and container scheduling
 */

const TEST_DURATION_MS = 10000; // 10 seconds
const EXPECTED_INTERVAL_MS = 20; // 20ms intervals (same as RTP pacing)
const EXPECTED_TOTAL_CALLS = Math.floor(TEST_DURATION_MS / EXPECTED_INTERVAL_MS);

class TimerPrecisionTest {
  constructor() {
    this.startTime = null;
    this.lastCallTime = null;
    this.intervals = [];
    this.callCount = 0;
    this.timer = null;
  }

  start() {
    console.log('Starting timer precision test...');
    console.log(`Expected interval: ${EXPECTED_INTERVAL_MS}ms`);
    console.log(`Test duration: ${TEST_DURATION_MS}ms`);
    console.log(`Expected total calls: ${EXPECTED_TOTAL_CALLS}`);
    console.log('');

    this.startTime = Date.now();
    this.lastCallTime = this.startTime;

    this.timer = setInterval(() => {
      this.onTimerTick();
    }, EXPECTED_INTERVAL_MS);

    // Stop test after specified duration
    setTimeout(() => {
      this.stop();
    }, TEST_DURATION_MS);
  }

  onTimerTick() {
    const currentTime = Date.now();
    const intervalSinceLastCall = currentTime - this.lastCallTime;
    
    this.intervals.push(intervalSinceLastCall);
    this.callCount++;
    
    // Log every 100th call to show progress
    if (this.callCount % 100 === 0) {
      console.log(`Call #${this.callCount}: ${intervalSinceLastCall}ms (drift: ${intervalSinceLastCall - EXPECTED_INTERVAL_MS}ms)`);
    }
    
    this.lastCallTime = currentTime;
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    const endTime = Date.now();
    const totalDuration = endTime - this.startTime;
    
    console.log('');
    console.log('=== Timer Precision Test Results ===');
    console.log(`Actual test duration: ${totalDuration}ms`);
    console.log(`Total timer calls: ${this.callCount}`);
    console.log(`Expected calls: ${EXPECTED_TOTAL_CALLS}`);
    console.log(`Call frequency: ${(this.callCount / totalDuration * 1000).toFixed(2)} calls/second`);
    console.log('');

    this.analyzeIntervals();
  }

  analyzeIntervals() {
    if (this.intervals.length === 0) {
      console.log('No intervals recorded!');
      return;
    }

    // Calculate statistics
    const sum = this.intervals.reduce((a, b) => a + b, 0);
    const avg = sum / this.intervals.length;
    const min = Math.min(...this.intervals);
    const max = Math.max(...this.intervals);
    
    // Calculate variance and standard deviation
    const variance = this.intervals.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / this.intervals.length;
    const stdDev = Math.sqrt(variance);
    
    // Calculate drift from expected
    const drifts = this.intervals.map(interval => interval - EXPECTED_INTERVAL_MS);
    const avgDrift = drifts.reduce((a, b) => a + b, 0) / drifts.length;
    const maxPositiveDrift = Math.max(...drifts);
    const maxNegativeDrift = Math.min(...drifts);
    
    console.log('=== Interval Statistics ===');
    console.log(`Average interval: ${avg.toFixed(2)}ms`);
    console.log(`Min interval: ${min}ms`);
    console.log(`Max interval: ${max}ms`);
    console.log(`Standard deviation: ${stdDev.toFixed(2)}ms`);
    console.log(`Range: ${max - min}ms`);
    console.log('');
    
    console.log('=== Drift Analysis ===');
    console.log(`Average drift: ${avgDrift.toFixed(2)}ms`);
    console.log(`Max positive drift: +${maxPositiveDrift}ms`);
    console.log(`Max negative drift: ${maxNegativeDrift}ms`);
    console.log(`Drift range: ${maxPositiveDrift - maxNegativeDrift}ms`);
    console.log('');
    
    // Distribution analysis
    this.analyzeDistribution();
  }

  analyzeDistribution() {
    console.log('=== Distribution Analysis ===');
    
    // Count intervals by buckets
    const buckets = {};
    this.intervals.forEach(interval => {
      const bucket = Math.floor(interval);
      buckets[bucket] = (buckets[bucket] || 0) + 1;
    });
    
    // Sort buckets and show distribution
    const sortedBuckets = Object.entries(buckets)
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .slice(0, 15); // Show first 15 buckets
    
    console.log('Interval distribution (ms : count):');
    sortedBuckets.forEach(([ms, count]) => {
      const percentage = (count / this.intervals.length * 100).toFixed(1);
      const bar = '█'.repeat(Math.floor(percentage / 2));
      console.log(`${ms.padStart(3)}ms: ${count.toString().padStart(4)} (${percentage.padStart(5)}%) ${bar}`);
    });
    
    console.log('');
    
    // Precision analysis
    const preciseIntervals = this.intervals.filter(i => i === EXPECTED_INTERVAL_MS).length;
    const closeIntervals = this.intervals.filter(i => Math.abs(i - EXPECTED_INTERVAL_MS) <= 1).length;
    const problematicIntervals = this.intervals.filter(i => Math.abs(i - EXPECTED_INTERVAL_MS) > 5).length;
    
    console.log('=== Precision Summary ===');
    console.log(`Exact 20ms intervals: ${preciseIntervals} (${(preciseIntervals/this.intervals.length*100).toFixed(1)}%)`);
    console.log(`Within ±1ms: ${closeIntervals} (${(closeIntervals/this.intervals.length*100).toFixed(1)}%)`);
    console.log(`More than ±5ms off: ${problematicIntervals} (${(problematicIntervals/this.intervals.length*100).toFixed(1)}%)`);
    
    if (problematicIntervals > 0) {
      console.log('');
      console.log('⚠️  TIMING ISSUES DETECTED');
      console.log('Large timing variations will cause audio artifacts in RTP streaming.');
      console.log('Consider using a jitter buffer or alternative timing mechanism.');
    }
  }
}

// Run the test
const test = new TimerPrecisionTest();
test.start();