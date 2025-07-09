import { Writable } from 'stream';
import * as dgram from 'dgram';
import { packets as rtpJsPackets, utils as rtpJsUtils } from 'rtp.js';
import { RtpStats } from './types';
import { createLogger, Logger } from '../utils/logger';
import { CodecHandler } from './CodecHandler';

// Use the type from the imported namespace
type RtpPacket = InstanceType<typeof rtpJsPackets.RtpPacket>;

export interface AudioToRtpStreamConfig {
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
  onRtcpUpdate?: (timestamp: number) => void;
}

/**
 * Converts audio stream data to RTP packets and sends them via UDP
 * Handles RTP packet construction, sequence numbering, and timing
 */
export class AudioToRtpStream extends Writable {
  private readonly config: AudioToRtpStreamConfig;
  private readonly logger: Logger;
  private readonly codecHandler: CodecHandler;
  private readonly rtpPacket: RtpPacket;
  private stats: RtpStats;
  private samplesPerFrame: number;

  constructor(config: AudioToRtpStreamConfig) {
    super({ 
      objectMode: false, // We're receiving audio Buffer objects
      highWaterMark: 64 * 1024 // 64KB buffer
    });
    
    this.config = config;
    this.logger = createLogger({ 
      component: 'AudioToRtpStream',
      sessionId: config.sessionId,
      codec: config.codec.name
    });
    
    this.codecHandler = new CodecHandler();
    this.samplesPerFrame = this.codecHandler.getSamplesPerFrame(config.codec);
    
    this.stats = this.initializeStats();
    
    // Initialize RTP packet for sending
    this.rtpPacket = new rtpJsPackets.RtpPacket();
    this.rtpPacket.setPayloadType(config.codec.payload);
    this.rtpPacket.setSsrc(Math.floor(Math.random() * 0xFFFFFFFF));
    this.rtpPacket.setSequenceNumber(Math.floor(Math.random() * 0xFFFF));
    this.rtpPacket.setTimestamp(Math.floor(Math.random() * 0xFFFFFFFF));
    
    this.logger.debug('AudioToRtpStream initialized', {
      ssrc: this.rtpPacket.getSsrc(),
      initialSeqNum: this.rtpPacket.getSequenceNumber(),
      initialTimestamp: this.rtpPacket.getTimestamp(),
      codec: config.codec.name
    });
  }

  private initializeStats(): RtpStats {
    return {
      packetsReceived: 0,
      bytesReceived: 0,
      packetsSent: 0,
      bytesSent: 0
    };
  }

  _write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void): void {
    try {
      this.sendAudioPacket(chunk);
      callback();
    } catch (error) {
      this.logger.error('Error sending audio packet', error);
      callback(error as Error);
    }
  }

  private sendAudioPacket(payload: Buffer, marker: boolean = false): void {
    try {
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

      // Notify RTCP handler with current timestamp
      if (this.config.onRtcpUpdate) {
        this.config.onRtcpUpdate(newTimestamp);
      }

      // Serialize and send
      const rtpView = this.rtpPacket.getView();
      const rtpBuffer = rtpJsUtils.dataViewToNodeBuffer(rtpView);
      
      this.config.rtpSocket.send(
        rtpBuffer, 
        this.config.remotePort, 
        this.config.remoteAddress
      );
      
      this.updateRtpStats(rtpBuffer.length, 'sent');
      
      this.logger.trace('Sent RTP packet', {
        sequenceNumber: newSeqNum,
        timestamp: newTimestamp,
        payloadSize: payload.length,
        packetSize: rtpBuffer.length,
        marker
      });

    } catch (error) {
      this.logger.error('Error sending RTP packet', error);
      throw error;
    }
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

  // Method to send a packet with marker bit set (e.g., for last packet)
  public sendMarkedPacket(payload: Buffer): void {
    this.sendAudioPacket(payload, true);
  }

  // Method to update frame size if detected dynamically
  public updateSamplesPerFrame(samples: number): void {
    this.samplesPerFrame = samples;
    this.logger.debug('Updated samples per frame', { samples });
  }

  // Getters for debugging and monitoring
  public getStats(): Readonly<RtpStats> {
    return { ...this.stats };
  }

  public getCurrentTimestamp(): number {
    return this.rtpPacket.getTimestamp();
  }

  public getCurrentSequenceNumber(): number {
    return this.rtpPacket.getSequenceNumber();
  }

  public getSsrc(): number {
    return this.rtpPacket.getSsrc();
  }
}