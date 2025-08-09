import { packets as rtpJsPackets, utils as rtpJsUtils } from 'rtp.js';
import { RtpSession } from './RtpSession';
import { RtpSessionConfig, CodecType } from './types';
import { AdaptiveRtpScheduler, createAdaptiveRtpScheduler } from './AdaptiveRtpScheduler';
import { TempoAdjustTransform, TempoAdjustTransformConfig } from './TempoAdjustTransform';
import { AudioFileStream, AudioFileStreamConfig } from './AudioFileStream';
import { AudioPacketizer, AudioPacketizerConfig, AudioPacket } from './AudioPacketizer';

export interface RtpWelcomeSessionConfig extends RtpSessionConfig {
  onHangUpRequested?: () => Promise<void>;
  tempoAdjustment?: {
    tempo: number; // 1.0 = normal speed, 1.2 = 20% faster
  };
}

// Use the type from the imported namespace
type RtpPacket = InstanceType<typeof rtpJsPackets.RtpPacket>;

export class RtpWelcomeSession extends RtpSession {
  private rtpPacket: RtpPacket;
  private welcomeConfig: RtpWelcomeSessionConfig;
  private adaptiveScheduler?: AdaptiveRtpScheduler;
  private tempoAdjustTransform?: TempoAdjustTransform;
  
  // Stream-based components
  private audioFileStream?: AudioFileStream;
  private audioPacketizer?: AudioPacketizer;
  private audioPacketQueue: AudioPacket[] = [];

  constructor(sessionConfig: RtpWelcomeSessionConfig) {
    super(sessionConfig);
    this.welcomeConfig = sessionConfig;
    
    
    // Initialize RTP packet for sending
    this.rtpPacket = new rtpJsPackets.RtpPacket();
    this.rtpPacket.setPayloadType(sessionConfig.codec.payload);
    this.rtpPacket.setSsrc(Math.floor(Math.random() * 0xFFFFFFFF));
    this.rtpPacket.setSequenceNumber(Math.floor(Math.random() * 0xFFFF));
    this.rtpPacket.setTimestamp(Math.floor(Math.random() * 0xFFFFFFFF));
  }

  protected async onStart(): Promise<void> {
    // Set up RTP packet handling
    this.rtpSocket!.on('message', this.handleRtpPacket.bind(this));

    // Always use stream-based approach
    await this.initializeStreamBasedAudio();
  }

  protected async onStop(): Promise<void> {
    // Stop adaptive scheduler
    if (this.adaptiveScheduler) {
      this.adaptiveScheduler.stop();
      this.adaptiveScheduler = undefined;
    }
    
    // Clean up stream components
    if (this.audioFileStream) {
      this.audioFileStream.destroy();
      this.audioFileStream = undefined;
    }
    
    if (this.audioPacketizer) {
      this.audioPacketizer.destroy();
      this.audioPacketizer = undefined;
    }
    
    // Destroy tempo adjustment transform
    if (this.tempoAdjustTransform) {
      this.tempoAdjustTransform.destroy();
      this.tempoAdjustTransform = undefined;
    }
    
    // Clear packet queue
    this.audioPacketQueue = [];
  }

  private async initializeTempoAdjustment(): Promise<void> {
    const tempo = this.welcomeConfig.tempoAdjustment?.tempo;
    if (!tempo || tempo === 1.0) {
      return; // No adjustment needed
    }

    const tempoAdjustConfig: TempoAdjustTransformConfig = {
      tempo: tempo,
      codecInfo: this.config.codec,
      sessionId: this.config.sessionId || 'test-audio-session'
    };
    
    this.tempoAdjustTransform = new TempoAdjustTransform(tempoAdjustConfig);
    
    this.logger.info('Test audio tempo adjustment transform initialized', {
      tempo: tempo,
      codec: this.config.codec.name
    });
  }

  private async initializeStreamBasedAudio(): Promise<void> {
    try {
      // Initialize audio file stream
      const audioFileConfig: AudioFileStreamConfig = {
        codec: {
          name: this.config.codec.name as CodecType,
          payload: this.config.codec.payload,
          clockRate: this.config.codec.clockRate,
          channels: this.config.codec.channels
        },
        logger: this.logger,
        sessionId: this.config.sessionId || 'test-audio-session'
      };
      
      this.audioFileStream = new AudioFileStream(audioFileConfig);
      await this.audioFileStream.initialize();
      
      // Initialize audio packetizer
      const packetizerConfig: AudioPacketizerConfig = {
        codec: audioFileConfig.codec,
        logger: this.logger,
        sessionId: this.config.sessionId || 'test-audio-session'
      };
      
      this.audioPacketizer = new AudioPacketizer(packetizerConfig);
      
      // Initialize tempo adjustment if configured
      await this.initializeTempoAdjustment();
      
      // Set up the stream pipeline
      await this.setupStreamPipeline();
      
      this.logger.info('Stream-based audio initialized', {
        hasTempoAdjustment: !!this.tempoAdjustTransform,
        tempo: this.welcomeConfig.tempoAdjustment?.tempo
      });
      
    } catch (error) {
      this.logger.error('Failed to initialize stream-based audio', error);
      throw error;
    }
  }

  private async setupStreamPipeline(): Promise<void> {
    if (!this.audioFileStream || !this.audioPacketizer) {
      throw new Error('Audio stream components not initialized');
    }

    // Set up the pipeline: AudioFileStream -> [TempoAdjustTransform] -> AudioPacketizer
    let currentStream: NodeJS.ReadableStream = this.audioFileStream;
    
    if (this.tempoAdjustTransform) {
      // Pipeline: AudioFileStream -> TempoAdjustTransform -> AudioPacketizer
      currentStream = currentStream.pipe(this.tempoAdjustTransform);
      this.logger.info('Stream pipeline set up with tempo adjustment', {
        tempo: this.welcomeConfig.tempoAdjustment?.tempo
      });
    } else {
      this.logger.info('Stream pipeline set up without tempo adjustment');
    }

    // Connect to packetizer
    currentStream.pipe(this.audioPacketizer);
    
    // Handle packetized audio
    this.audioPacketizer.on('data', (packet: AudioPacket) => {
      this.audioPacketQueue.push(packet);
    });
    
    this.audioPacketizer.on('end', () => {
      this.logger.debug('Audio packetizer stream ended');
    });
    
    this.audioPacketizer.on('error', (error) => {
      this.logger.error('Audio packetizer error', error);
    });
    
    // Start the RTP scheduler
    this.startStreamBasedRtpScheduler();
    
    // Start the stream flowing
    this.audioFileStream.resume();
    
    // Also trigger an initial read to ensure stream starts
    process.nextTick(() => {
      if (this.audioFileStream) {
        this.audioFileStream.read(0);
      }
    });
  }

  private startStreamBasedRtpScheduler(): void {
    if (!this.audioFileStream) {
      this.logger.error('Audio file stream not initialized');
      return;
    }
    
    const totalDurationMs = this.audioFileStream.getTotalDurationMs();
    
    this.logger.debug('Starting stream-based RTP scheduler', {
      totalDurationMs,
      totalDurationSeconds: totalDurationMs / 1000,
      hasTempoAdjustment: !!this.tempoAdjustTransform
    });

    // Use adaptive buffer-depth scheduler
    this.adaptiveScheduler = createAdaptiveRtpScheduler({
      targetBufferMs: 60, // 60ms target buffer depth
      logger: this.logger,
      sessionId: this.config.sessionId || 'test-audio-session',
      onPacketSend: (packetNumber: number, callTimeMs: number) => {
        // Get the next packet from the queue
        const packet = this.audioPacketQueue.shift();
        
        if (packet) {
          // Send the packet
          this.sendStreamPacket(packet);
          
          // Log status every 50 packets
          if (packetNumber % 50 === 0) {
            const phase = this.audioFileStream!.getCurrentPhase();
            this.logger.debug('Stream-based RTP scheduler status', {
              packetNumber,
              callTimeMs,
              phase: phase.phase,
              remainingMs: phase.remaining,
              queueLength: this.audioPacketQueue.length,
              bufferState: this.adaptiveScheduler!.getBufferState()
            });
          }
          
          return true; // Continue sending
        } else {
          // No more packets - check if stream is done
          if (callTimeMs >= totalDurationMs) {
            this.logger.debug('Stream-based RTP scheduler completed - all packets sent');
            return false; // Stop sending
          } else {
            // Still waiting for more packets from the stream
            return true; // Continue sending (scheduler will handle backpressure)
          }
        }
      },
      onComplete: async () => {
        this.logger.debug('Stream-based RTP scheduler completed - hanging up');
        
        // Hang up the call
        if (this.welcomeConfig.onHangUpRequested) {
          try {
            await this.welcomeConfig.onHangUpRequested();
          } catch (error) {
            this.logger.error('Error hanging up call after stream completion', error);
          }
        }
      }
    });
    
    this.adaptiveScheduler.start();
  }


  private sendStreamPacket(packet: AudioPacket): void {
    // Update RTP packet fields with stream packet data
    this.rtpPacket.setMarker(packet.isLast);
    this.rtpPacket.setPayload(rtpJsUtils.nodeBufferToDataView(packet.payload));
    this.rtpPacket.setTimestamp(packet.timestamp);
    this.rtpPacket.setSequenceNumber(packet.sequenceNumber);

    // Serialize and send
    const rtpView = this.rtpPacket.getView();
    const rtpBuffer = rtpJsUtils.dataViewToNodeBuffer(rtpView);
    
    this.rtpSocket!.send(rtpBuffer, this.config.remotePort, this.config.remoteAddress);
    this.updateRtpStats(rtpBuffer.length, 'sent');
  }

  private handleRtpPacket(msg: Buffer): void {
    // For test audio session, we don't need to process incoming RTP
    // Just update stats
    this.updateRtpStats(msg.length, 'received');
  }
}