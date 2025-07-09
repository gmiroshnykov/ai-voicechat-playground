#!/usr/bin/env node

import * as path from 'path';
import { runRtpTimingTest } from './streams/RtpTimingTest';

/**
 * Simple test runner for RTP timing resilience
 */
async function main() {
  console.log('🧪 Starting RTP Timing Resilience Test');
  console.log('=====================================');
  
  // Path to our test audio file (in project root)
  const audioFile = path.resolve('./test-audio/rtp-test.pcmu');
  
  console.log(`📁 Using test audio: ${audioFile}`);
  console.log(`⏰ Testing RTP timing with stream stalls...`);
  console.log('');
  
  try {
    const result = await runRtpTimingTest(audioFile);
    
    console.log('📊 Test Results:');
    console.log('================');
    console.log(`✅ Success: ${result.success}`);
    console.log(`⏱️  Total Duration: ${result.totalDurationMs}ms`);
    console.log(`📦 RTP Packets: ${result.packetTimestamps.length}`);
    console.log(`📈 Max Timing Deviation: ${result.maxIntervalDeviation.toFixed(2)}ms`);
    console.log(`📊 Avg Timing Deviation: ${result.avgIntervalDeviation.toFixed(2)}ms`);
    console.log(`🔄 Stall Events: ${result.stallEvents.length}`);
    console.log('');
    
    // Show stall events
    if (result.stallEvents.length > 0) {
      console.log('🔄 Stall Events:');
      result.stallEvents.forEach((stall, index) => {
        console.log(`  ${index + 1}. At byte ${stall.byteCount}: ${stall.durationMs}ms stall @ ${stall.timestamp}ms`);
      });
      console.log('');
    }
    
    // Show timing distribution
    console.log('📈 Timing Analysis:');
    const intervals = result.intervalDeviations;
    if (intervals.length > 0) {
      const under5ms = intervals.filter(d => d < 5).length;
      const under10ms = intervals.filter(d => d < 10).length;
      const under20ms = intervals.filter(d => d < 20).length;
      const over20ms = intervals.filter(d => d >= 20).length;
      
      console.log(`  < 5ms deviation:  ${under5ms}/${intervals.length} (${(under5ms/intervals.length*100).toFixed(1)}%)`);
      console.log(`  < 10ms deviation: ${under10ms}/${intervals.length} (${(under10ms/intervals.length*100).toFixed(1)}%)`);
      console.log(`  < 20ms deviation: ${under20ms}/${intervals.length} (${(under20ms/intervals.length*100).toFixed(1)}%)`);
      console.log(`  ≥ 20ms deviation: ${over20ms}/${intervals.length} (${(over20ms/intervals.length*100).toFixed(1)}%)`);
    }
    console.log('');
    
    // Show errors if any
    if (result.errors.length > 0) {
      console.log('❌ Errors:');
      result.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`);
      });
      console.log('');
    }
    
    // Overall assessment
    if (result.success) {
      console.log('🎉 Test PASSED: RTP timing remained stable despite stream stalls!');
    } else {
      console.log('❌ Test FAILED: RTP timing was disrupted by stream stalls');
    }
    
    process.exit(result.success ? 0 : 1);
    
  } catch (error) {
    console.error('💥 Test execution failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}