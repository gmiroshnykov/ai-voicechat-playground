/**
 * Example demonstrating the new stream-based approach vs old timer-based anti-patterns
 * 
 * This shows how to replace complex timer-based packet scheduling with composable streams
 */

import { createRtpPacketScheduler } from './PacketSchedulerStream';
import { createAudioSourceStream } from './AudioSourceStream';
import { createTee } from './StreamUtils';
import { StereoRecorderStream } from './StereoRecorderStream';
import { ChannelRecorderStream } from './ChannelRecorderStream';
import { SpeedAdjustTransform } from './SpeedAdjustTransform';
import { JitterBufferTransform } from './JitterBufferTransform';
import { createLogger } from '../utils/logger';
import { CodecType } from './types';

/**
 * OLD ANTI-PATTERN: Complex timer-based scheduling with drift compensation
 */
export class OldTimerBasedApproach {
  // private _timer?: NodeJS.Timeout;
  private expectedTime = 0;
  private drift = 0;
  
  start() {
    // ANTI-PATTERN: Fighting JavaScript's timer imprecision
    setTimeout(() => {
      const actualTime = Date.now();
      this.drift = actualTime - this.expectedTime;
      const compensation = -this.drift * 0.1; // Complex math to compensate
      
      // Send packet with complex timing logic
      this.sendPacket();
      
      // Recursively schedule next packet with compensation
      this.scheduleNext(20 + compensation);
    }, 20);
  }
  
  private sendPacket() {
    // Complex packet sending logic
  }
  
  private scheduleNext(_delay: number) {
    // More complex timing calculations...
  }
}

/**
 * NEW STREAM-BASED APPROACH: Let Node.js streams handle timing naturally
 */
export class NewStreamBasedApproach {
  private logger = createLogger({ component: 'StreamExample' });
  
  async start() {
    // 1. Create packet scheduler stream (replaces complex timer logic)
    const packetScheduler = createRtpPacketScheduler({
      logger: this.logger,
      sessionId: 'example-session',
      logFrequency: 50
    });
    
    // 2. Create audio source stream (replaces time-based state machine)
    const audioSource = createAudioSourceStream({
      codec: {
        name: CodecType.PCMU,
        payload: 0,
        clockRate: 8000
      },
      logger: this.logger,
      sessionId: 'example-session',
      audioFile: 'welcome.pcmu'
    });
    
    await audioSource.initialize();
    
    // 3. Create recording streams (replaces timer-based recording)
    const stereoRecorder = new StereoRecorderStream({
      enabled: true,
      recordingsPath: './recordings',
      callId: 'example-call',
      caller: { sipUri: 'example@example.com' },
      codec: {
        name: 'PCMU',
        payload: 0,
        clockRate: 8000
      }
    });
    
    const callerRecorder = new ChannelRecorderStream(stereoRecorder, 'caller');
    const aiRecorder = new ChannelRecorderStream(stereoRecorder, 'ai');
    
    // 4. Create processing pipeline (replaces manual buffer management)
    const jitterBuffer = new JitterBufferTransform({
      bufferTimeMs: 60,
      codecInfo: {
        name: 'PCMU',
        payload: 0,
        clockRate: 8000
      },
      sessionId: 'example-session'
    });
    
    const speedAdjust = new SpeedAdjustTransform({
      speedRatio: 1.1, // 10% faster
      codecInfo: {
        name: 'PCMU',
        payload: 0,
        clockRate: 8000
      },
      sessionId: 'example-session'
    });
    
    // 5. Compose the pipeline - no timers, no complex timing logic!
    packetScheduler.start();
    await stereoRecorder.start();
    
    // Natural stream composition
    audioSource
      .pipe(jitterBuffer)
      .pipe(speedAdjust)
      .pipe(createTee([callerRecorder, aiRecorder]));
    
    // Packet scheduler drives the pipeline
    packetScheduler.on('data', (signal) => {
      // Handle packet signals naturally
      this.handlePacketSignal(signal);
    });
    
    this.logger.info('Stream-based pipeline started - no timers, no drift compensation!');
  }
  
  private handlePacketSignal(signal: any) {
    // Handle packet signals from stream
    this.logger.trace('Packet signal received', signal);
  }
}

/**
 * COMPARISON: The difference in approach
 */
export const comparison = {
  oldWay: {
    description: "Timer-based anti-pattern",
    problems: [
      "Complex drift compensation math",
      "Fighting JavaScript's nature",
      "Manual buffer management",
      "Recursive setTimeout calls",
      "Hard to test and debug"
    ],
    example: `
      // ANTI-PATTERN: Complex timer compensation
      const drift = actualTime - expectedTime;
      const compensation = -drift * 0.1;
      setTimeout(() => {
        this.sendPacket();
        this.scheduleNext(20 + compensation);
      }, 20 + compensation);
    `
  },
  
  newWay: {
    description: "Stream-based natural approach",
    benefits: [
      "No timer compensation needed",
      "Natural backpressure handling",
      "Composable pipeline",
      "Works with JavaScript's nature",
      "Easy to test and debug"
    ],
    example: `
      // STREAM-BASED: Natural composition
      audioSource
        .pipe(jitterBuffer)
        .pipe(speedAdjust)
        .pipe(recorder);
    `
  }
};

/**
 * Usage example showing the power of stream composition
 */
export function demonstrateStreamComposition() {
  const logger = createLogger({ component: 'StreamDemo' });
  
  // This is what good stream-based architecture looks like:
  // No timers, no complex timing logic, just natural stream flow
  
  /*
  audioInputStream
    .pipe(jitterBuffer)           // Handle packet reordering
    .pipe(speedAdjust)            // Adjust playback speed
    .pipe(createTee([             // Fork the stream
      callerRecorder,             // Record caller audio
      aiRecorder,                 // Record AI audio
      transcriptionStream,        // Transcribe in real-time
      openaiForwardStream         // Forward to OpenAI
    ]));
  */
  
  logger.info('Stream composition eliminates complex timing logic!');
}