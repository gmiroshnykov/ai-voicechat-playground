import { Readable } from 'stream';
import * as dgram from 'dgram';
import { packets as rtpJsPackets, utils as rtpJsUtils } from 'rtp.js';
import { RtpPacketInfo, RtpStats, RtpLatchingState, FrameSizeDetection } from './types';
import { createLogger, Logger } from '../utils/logger';
import { CodecHandler } from './CodecHandler';

// Use the type from the imported namespace
type RtpPacket = InstanceType<typeof rtpJsPackets.RtpPacket>;

export interface RtpToAudioStreamConfig {
  rtpSocket: dgram.Socket;
  remoteAddress: string;
  remotePort: number;
  codec: {
    name: string;
    payload: number;
    clockRate: number;
    channels?: number;
  };
  sessionId: string;
  onStatsUpdate?: (stats: RtpStats) => void;
}

/**
 * Converts incoming RTP packets from UDP socket to an audio stream
 * Handles RTP latching, packet validation, and audio payload extraction
 */
export class RtpToAudioStream extends Readable {
  private readonly config: RtpToAudioStreamConfig;
  private readonly logger: Logger;
  private readonly codecHandler: CodecHandler;
  private stats: RtpStats;
  private latchingState: RtpLatchingState;
  private frameSizeDetection: FrameSizeDetection;
  private samplesPerFrame: number;

  constructor(config: RtpToAudioStreamConfig) {
    super({ 
      objectMode: true, // We're pushing RTP packet info objects
      highWaterMark: 64 // 64 objects buffer
    });
    
    this.config = config;
    this.logger = createLogger({ 
      component: 'RtpToAudioStream',
      sessionId: config.sessionId,
      codec: config.codec.name
    });
    
    this.codecHandler = new CodecHandler();
    this.samplesPerFrame = this.codecHandler.getSamplesPerFrame(config.codec);
    
    this.stats = this.initializeStats();
    this.latchingState = this.initializeLatchingState();
    this.frameSizeDetection = this.initializeFrameSizeDetection();
    
    // Set up RTP packet handling
    this.setupRtpHandling();
  }

  private initializeStats(): RtpStats {
    return {
      packetsReceived: 0,
      bytesReceived: 0,
      packetsSent: 0,
      bytesSent: 0
    };
  }

  private initializeLatchingState(): RtpLatchingState {
    return {
      rtpLatched: false,
      rtcpLatched: false,
      expectedRemoteAddress: this.config.remoteAddress
    };
  }

  private initializeFrameSizeDetection(): FrameSizeDetection {
    return {
      frameSizeConfirmed: false
    };
  }

  private setupRtpHandling(): void {
    this.config.rtpSocket.on('message', (msg: Buffer, rinfo: dgram.RemoteInfo) => {
      this.handleRtpPacket(msg, rinfo);
    });
  }

  private handleRtpPacket(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    // Validate source address
    if (!this.validateRtpSource(rinfo.address)) {
      this.logger.warn('Received RTP packet from invalid source', {
        sourceAddress: rinfo.address,
        sourcePort: rinfo.port,
        expectedAddress: this.config.remoteAddress
      });
      return;
    }

    // Update statistics
    this.updateRtpStats(msg.length, 'received');

    // Perform symmetric RTP latching
    if (!this.latchingState.rtpLatched || 
        this.config.remoteAddress !== rinfo.address || 
        this.config.remotePort !== rinfo.port) {
      
      this.logger.debug('RTP latching to source', {
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
      
      // Check if it's a valid RTP packet - be more permissive for interoperability
      if (!rtpJsPackets.isRtp(rtpView)) {
        // Log details for debugging but continue if packet looks like RTP
        const firstByte = msg.length > 0 ? msg[0]! : 0;
        const rtpVersion = (firstByte >> 6) & 0x3;
        
        this.logger.debug('RTP validation failed, checking manually', {
          packetLength: msg.length,
          firstByte: firstByte?.toString(16) || '0',
          rtpVersion,
          expectedVersion: 2
        });
        
        // Accept packets that have reasonable length (be permissive with version for interoperability)
        if (msg.length < 12) {
          this.logger.warn('Received too short packet on RTP port', {
            packetLength: msg.length,
            rtpVersion
          });
          return;
        }
        
        // Log version mismatches but continue processing
        if (rtpVersion !== 2) {
          this.logger.debug('RTP version mismatch, continuing anyway', {
            rtpVersion,
            expectedVersion: 2
          });
        }
        
        this.logger.debug('Accepting packet despite RTP.js validation failure');
      }

      // Parse incoming packet
      const incomingPacket = new rtpJsPackets.RtpPacket(rtpView);
      this.detectFrameSize(incomingPacket);

      // Extract G.711 payload
      const payloadView = incomingPacket.getPayload();
      const payloadBuffer = Buffer.from(
        payloadView.buffer,
        payloadView.byteOffset,
        payloadView.byteLength
      );

      // Create packet info and push to stream
      const packetInfo: RtpPacketInfo = {
        sequenceNumber: incomingPacket.getSequenceNumber(),
        timestamp: incomingPacket.getTimestamp(),
        ssrc: incomingPacket.getSsrc(),
        marker: incomingPacket.getMarker(),
        payloadType: incomingPacket.getPayloadType(),
        payload: payloadBuffer
      };

      // Push packet info to stream (consumers will handle jitter buffering)
      this.push(packetInfo);

    } catch (error) {
      this.logger.warn('Error processing RTP packet', { error });
    }
  }

  private validateRtpSource(sourceAddr: string): boolean {
    // Always allow first packet to enable RTP latching
    if (!this.latchingState.rtpLatched) {
      return true;
    }

    // After latching, allow packets from any private/public address
    // This is necessary for NAT traversal scenarios where the actual
    // source address differs from what was advertised in SDP
    
    // Block only obviously invalid addresses
    if (sourceAddr === '0.0.0.0' || sourceAddr === '255.255.255.255') {
      return false;
    }

    // For production use, you might want additional validation here
    // but for now, be permissive to handle NAT scenarios
    return true;
  }

  private updateRtpStats(packetSize: number, direction: 'sent' | 'received'): void {
    const now = Date.now();
    
    if (direction === 'received') {
      this.stats.packetsReceived++;
      this.stats.bytesReceived += packetSize;
    } else {
      this.stats.packetsSent++;
      this.stats.bytesSent += packetSize;
    }

    if (!this.stats.firstPacketTime) {
      this.stats.firstPacketTime = now;
    }
    this.stats.lastPacketTime = now;

    // Notify stats update
    if (this.config.onStatsUpdate) {
      this.config.onStatsUpdate(this.stats);
    }
  }

  private detectFrameSize(packet: RtpPacket): void {
    const timestamp = packet.getTimestamp();
    const seqNum = packet.getSequenceNumber();
    const payloadLength = packet.getPayload().byteLength;

    if (this.frameSizeDetection.lastReceivedTimestamp !== undefined && 
        this.frameSizeDetection.lastReceivedSeqNum !== undefined) {
      
      const seqDiff = (seqNum - this.frameSizeDetection.lastReceivedSeqNum + 0x10000) & 0xFFFF;
      
      if (seqDiff === 1) {
        // Consecutive packet - calculate timestamp increment
        const timestampDiff = (timestamp - this.frameSizeDetection.lastReceivedTimestamp + 0x100000000) & 0xFFFFFFFF;
        
        // Sanity check: frame size should be reasonable
        if (timestampDiff > 80 && timestampDiff < 1920) {
          this.frameSizeDetection.detectedSamplesPerFrame = timestampDiff;

          // Try to confirm with payload size
          const payloadSamples = this.codecHandler.calculateSamplesFromPayload(
            this.config.codec, 
            payloadLength
          );
          
          if (payloadSamples !== null && 
              payloadSamples === timestampDiff && 
              !this.frameSizeDetection.frameSizeConfirmed) {
            
            this.logger.trace('Dynamic frame size confirmed', {
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

  // Stream implementation
  _read(): void {
    // Nothing to do here - we push when RTP packets arrive
  }

  // Getters for debugging and monitoring
  public getStats(): Readonly<RtpStats> {
    return { ...this.stats };
  }

  public getLatchingState(): Readonly<RtpLatchingState> {
    return { ...this.latchingState };
  }

  public getFrameSizeInfo(): Readonly<FrameSizeDetection> {
    return { ...this.frameSizeDetection };
  }

  public getDetectedSamplesPerFrame(): number {
    return this.frameSizeDetection.detectedSamplesPerFrame || this.samplesPerFrame;
  }
}