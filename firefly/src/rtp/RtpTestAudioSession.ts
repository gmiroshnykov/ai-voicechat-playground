import { packets as rtpJsPackets, utils as rtpJsUtils } from 'rtp.js';
import { RtpSession } from './RtpSession';
import { RtpSessionConfig, CodecType } from './types';
import { CodecHandler } from './CodecHandler';
import { RtpContinuousScheduler, RtpContinuousSchedulerConfig } from './RtpContinuousScheduler';
import { AudioSourceManager, AudioSourceManagerConfig } from './AudioSourceManager';

export interface RtpTestAudioSessionConfig extends RtpSessionConfig {
  onHangUpRequested?: () => Promise<void>;
}

// Use the type from the imported namespace
type RtpPacket = InstanceType<typeof rtpJsPackets.RtpPacket>;

export class RtpTestAudioSession extends RtpSession {
  private codecHandler: CodecHandler;
  private rtpPacket: RtpPacket;
  private samplesPerFrame: number;
  private testConfig: RtpTestAudioSessionConfig;
  private continuousScheduler?: RtpContinuousScheduler;
  private audioSourceManager?: AudioSourceManager;

  constructor(sessionConfig: RtpTestAudioSessionConfig) {
    super(sessionConfig);
    this.testConfig = sessionConfig;
    
    this.codecHandler = new CodecHandler();
    this.samplesPerFrame = this.codecHandler.getSamplesPerFrame(sessionConfig.codec);
    
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

    // Initialize audio source manager
    await this.initializeAudioSourceManager();
    
    // Start continuous RTP streaming
    this.startContinuousRtpStream();
  }

  protected async onStop(): Promise<void> {
    // Stop continuous scheduler
    if (this.continuousScheduler) {
      this.continuousScheduler.stop();
      this.continuousScheduler = undefined;
    }
    
    // Clean up audio source manager
    this.audioSourceManager = undefined;
  }

  private async initializeAudioSourceManager(): Promise<void> {
    try {
      const audioSourceConfig: AudioSourceManagerConfig = {
        codec: {
          name: this.config.codec.name as CodecType,
          payload: this.config.codec.payload,
          clockRate: this.config.codec.clockRate,
          channels: this.config.codec.channels
        },
        logger: this.logger,
        sessionId: this.config.sessionId || 'test-audio-session'
      };
      
      this.audioSourceManager = new AudioSourceManager(audioSourceConfig);
      await this.audioSourceManager.initialize();
      
    } catch (error) {
      this.logger.error('Failed to initialize audio source manager', error);
      throw error;
    }
  }

  private startContinuousRtpStream(): void {
    if (!this.audioSourceManager) {
      this.logger.error('Audio source manager not initialized');
      return;
    }
    
    const totalDurationMs = this.audioSourceManager.getTotalCallDurationMs();
    
    this.logger.info('Starting continuous RTP stream for test audio', {
      totalDurationMs,
      totalDurationSeconds: totalDurationMs / 1000
    });
    
    // Create and configure continuous scheduler
    const schedulerConfig: RtpContinuousSchedulerConfig = {
      targetInterval: 20, // 20ms target interval
      logFrequency: 50, // Log every 50 packets
      logger: this.logger,
      sessionId: this.config.sessionId || 'test-audio-session',
      onPacketSend: (packetNumber: number, callTimeMs: number) => {
        // Get the next packet from audio source manager
        const packet = this.audioSourceManager!.getNextPacket(callTimeMs);
        
        if (packet) {
          // Send the packet (either silence or audio)
          this.sendAudioPacket(packet);
          
          // Log phase information every 50 packets
          if (packetNumber % 50 === 0) {
            const phase = this.audioSourceManager!.getCallPhase(callTimeMs);
            this.logger.debug('Continuous RTP stream status', {
              packetNumber,
              callTimeMs,
              phase: phase.phase,
              remainingMs: phase.remaining
            });
          }
          
          return true; // Continue sending
        } else {
          // Call should end
          this.logger.info('Audio source manager signaled end of call');
          return false; // Stop sending
        }
      },
      onComplete: async () => {
        this.logger.info('Continuous RTP stream completed - hanging up');
        
        // Hang up the call
        if (this.testConfig.onHangUpRequested) {
          try {
            await this.testConfig.onHangUpRequested();
          } catch (error) {
            this.logger.error('Error hanging up call after continuous stream completion', error);
          }
        }
      }
    };
    
    this.continuousScheduler = new RtpContinuousScheduler(schedulerConfig);
    this.continuousScheduler.start();
  }

  private sendAudioPacket(payload: Buffer, marker: boolean = false): void {
    // Update RTP packet fields
    this.rtpPacket.setMarker(marker);
    this.rtpPacket.setPayload(rtpJsUtils.nodeBufferToDataView(payload));

    // Update timestamp and sequence number
    const currentTimestamp = this.rtpPacket.getTimestamp();
    const newTimestamp = (currentTimestamp + this.samplesPerFrame) & 0xFFFFFFFF;
    this.rtpPacket.setTimestamp(newTimestamp);

    const currentSeqNum = this.rtpPacket.getSequenceNumber();
    const newSeqNum = (currentSeqNum + 1) & 0xFFFF;
    this.rtpPacket.setSequenceNumber(newSeqNum);

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