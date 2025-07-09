import * as dgram from 'dgram';
import { packets as rtpJsPackets, utils as rtpJsUtils } from 'rtp.js';
import { RtpSession } from './RtpSession';
import { RtcpHandler } from './RtcpHandler';
import { CodecHandler } from './CodecHandler';
import { RtpSessionConfig, FrameSizeDetection } from './types';
import { 
  RTP_CONSTANTS,
  BUFFER_CONSTANTS 
} from '../constants';

// Use the type from the imported namespace
type RtpPacket = InstanceType<typeof rtpJsPackets.RtpPacket>;

export class RtpEchoSession extends RtpSession {
  private rtcpHandler?: RtcpHandler;
  private codecHandler: CodecHandler;
  private rtpPacket: RtpPacket;
  private frameSizeDetection: FrameSizeDetection;
  private samplesPerFrame: number;

  constructor(sessionConfig: RtpSessionConfig) {
    super(sessionConfig);
    
    this.codecHandler = new CodecHandler();
    this.samplesPerFrame = this.codecHandler.getSamplesPerFrame(sessionConfig.codec);
    
    // Initialize RTP packet for sending
    this.rtpPacket = new rtpJsPackets.RtpPacket();
    this.rtpPacket.setPayloadType(sessionConfig.codec.payload);
    this.rtpPacket.setSsrc(Math.floor(Math.random() * RTP_CONSTANTS.MAX_SSRC));
    this.rtpPacket.setSequenceNumber(Math.floor(Math.random() * RTP_CONSTANTS.MAX_SEQUENCE));
    this.rtpPacket.setTimestamp(Math.floor(Math.random() * RTP_CONSTANTS.MAX_TIMESTAMP));

    // Initialize frame size detection
    this.frameSizeDetection = {
      frameSizeConfirmed: false
    };
  }

  protected async onStart(): Promise<void> {
    // Set up RTP packet handling
    this.rtpSocket!.on('message', this.handleRtpPacket.bind(this));

    // Initialize RTCP handler
    this.rtcpHandler = new RtcpHandler({
      ssrc: this.rtpPacket.getSsrc(),
      localPort: this.config.localPort + 1,
      remotePort: this.config.remotePort + 1,
      remoteAddress: this.config.remoteAddress,
      socket: this.rtcpSocket!,
      getStats: () => this.getStats(),
      getDynamicFrameSize: () => this.frameSizeDetection.detectedSamplesPerFrame,
      isRtpActive: () => this.latchingState.rtpLatched
    });
    this.rtcpHandler.start();

    // Send initial silence packets to establish symmetric RTP
    await this.sendInitialSilence();
  }

  protected async onStop(): Promise<void> {
    if (this.rtcpHandler) {
      this.rtcpHandler.stop();
      this.rtcpHandler = undefined;
    }
  }

  private handleRtpPacket(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    // Validate source and check if active
    if (this.state !== 'active') {
      return;
    }

    if (!this.validateRtpSource(rinfo.address)) {
      this.logger.warn('Rejected RTP from untrusted source', {
        source: `${rinfo.address}:${rinfo.port}`,
        expected: this.latchingState.expectedRemoteAddress
      });
      return;
    }

    // Update statistics
    this.updateRtpStats(msg.length, 'received');

    // Perform symmetric RTP latching
    if (!this.latchingState.rtpLatched || 
        this.config.remoteAddress !== rinfo.address || 
        this.config.remotePort !== rinfo.port) {
      
      this.logger.info('RTP latching to source', {
        address: rinfo.address,
        port: rinfo.port,
        wasExpecting: `${this.config.remoteAddress}:${this.config.remotePort}`
      });

      // Update config with actual source
      this.config.remoteAddress = rinfo.address;
      this.config.remotePort = rinfo.port;
      this.latchingState.rtpLatched = true;
      this.latchingState.actualRtpEndpoint = {
        address: rinfo.address,
        port: rinfo.port
      };
    }

    // Parse and process RTP packet
    try {
      const rtpView = rtpJsUtils.nodeBufferToDataView(msg);
      if (!rtpJsPackets.isRtp(rtpView)) {
        this.logger.warn('Received non-RTP packet on RTP port');
        return;
      }

      // Parse incoming packet for frame size detection
      const incomingPacket = new rtpJsPackets.RtpPacket(rtpView);
      this.detectFrameSize(incomingPacket);

      // Echo packet back
      this.rtpSocket!.send(msg, rinfo.port, rinfo.address);
      this.updateRtpStats(msg.length, 'sent');

    } catch (error) {
      this.logger.warn('Error processing RTP packet', { error });
    }
  }

  private detectFrameSize(packet: RtpPacket): void {
    const timestamp = packet.getTimestamp();
    const seqNum = packet.getSequenceNumber();
    const payloadLength = packet.getPayload().byteLength;

    if (this.frameSizeDetection.lastReceivedTimestamp !== undefined && 
        this.frameSizeDetection.lastReceivedSeqNum !== undefined) {
      
      const seqDiff = (seqNum - this.frameSizeDetection.lastReceivedSeqNum + RTP_CONSTANTS.SEQUENCE_WRAPAROUND) & RTP_CONSTANTS.MAX_SEQUENCE;
      
      if (seqDiff === 1) {
        // Consecutive packet - calculate timestamp increment
        const timestampDiff = (timestamp - this.frameSizeDetection.lastReceivedTimestamp + RTP_CONSTANTS.TIMESTAMP_WRAPAROUND) & RTP_CONSTANTS.MAX_TIMESTAMP;
        
        // Sanity check: frame size should be reasonable
        if (timestampDiff > BUFFER_CONSTANTS.MIN_FRAME_SIZE && timestampDiff < BUFFER_CONSTANTS.MAX_FRAME_SIZE) {
          this.frameSizeDetection.detectedSamplesPerFrame = timestampDiff;

          // Try to confirm with payload size
          const payloadSamples = this.codecHandler.calculateSamplesFromPayload(
            this.config.codec, 
            payloadLength
          );
          
          if (payloadSamples !== null && 
              payloadSamples === timestampDiff && 
              !this.frameSizeDetection.frameSizeConfirmed) {
            
            this.logger.info('Dynamic frame size confirmed', {
              samples: timestampDiff,
              payloadBytes: payloadLength,
              codec: this.config.codec.name
            });
            this.frameSizeDetection.frameSizeConfirmed = true;
          }
        }
      }
    }

    this.frameSizeDetection.lastReceivedTimestamp = timestamp;
    this.frameSizeDetection.lastReceivedSeqNum = seqNum;
  }

  private async sendInitialSilence(): Promise<void> {
    const silencePayload = this.codecHandler.createSilencePayload(this.config.codec);
    const totalPackets = BUFFER_CONSTANTS.INITIAL_SILENCE_PACKETS;

    this.logger.debug('Sending initial silence packets', {
      count: totalPackets,
      codec: this.config.codec.name
    });

    // Send packets with 20ms intervals
    for (let i = 0; i < totalPackets; i++) {
      this.sendRtpPacket(silencePayload, i === 0); // Marker bit on first packet
      await new Promise(resolve => setTimeout(resolve, BUFFER_CONSTANTS.SILENCE_PACKET_INTERVAL));
    }
  }

  private sendRtpPacket(payload: Buffer, marker: boolean = false): void {
    // Update RTP packet fields
    this.rtpPacket.setMarker(marker);
    this.rtpPacket.setPayload(rtpJsUtils.nodeBufferToDataView(payload));

    // Use detected frame size if available
    const samplesPerFrame = this.frameSizeDetection.detectedSamplesPerFrame || this.samplesPerFrame;

    // Verify payload size if possible
    const payloadSamples = this.codecHandler.calculateSamplesFromPayload(
      this.config.codec, 
      payload.length
    );
    if (payloadSamples !== null && 
        this.frameSizeDetection.detectedSamplesPerFrame &&
        payloadSamples !== this.frameSizeDetection.detectedSamplesPerFrame) {
      
      this.logger.warn('Frame size mismatch', {
        payloadSuggests: payloadSamples,
        detected: this.frameSizeDetection.detectedSamplesPerFrame
      });
    }

    // Update timestamp and sequence number
    const currentTimestamp = this.rtpPacket.getTimestamp();
    const newTimestamp = (currentTimestamp + samplesPerFrame) & RTP_CONSTANTS.MAX_TIMESTAMP;
    this.rtpPacket.setTimestamp(newTimestamp);

    const currentSeqNum = this.rtpPacket.getSequenceNumber();
    const newSeqNum = (currentSeqNum + 1) & RTP_CONSTANTS.MAX_SEQUENCE;
    this.rtpPacket.setSequenceNumber(newSeqNum);

    // Update RTCP handler with current timestamp
    if (this.rtcpHandler) {
      this.rtcpHandler.updateTimestamp(newTimestamp);
    }

    // Serialize and send
    const rtpView = this.rtpPacket.getView();
    const rtpBuffer = rtpJsUtils.dataViewToNodeBuffer(rtpView);
    
    this.rtpSocket!.send(rtpBuffer, this.config.remotePort, this.config.remoteAddress);
    this.updateRtpStats(rtpBuffer.length, 'sent');
  }

  public getFrameSizeInfo(): FrameSizeDetection {
    return { ...this.frameSizeDetection };
  }
}