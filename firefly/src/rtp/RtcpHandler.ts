import * as dgram from 'dgram';
import { packets as rtpJsPackets, utils as rtpJsUtils } from 'rtp.js';
import { RtpStats, RtpEndpoint } from './types';
import { createLogger, Logger } from '../utils/logger';


export interface RtcpHandlerConfig {
  ssrc: number;
  localPort: number;
  remotePort: number;
  remoteAddress: string;
  socket: dgram.Socket;
  getStats?: () => RtpStats;
  getDynamicFrameSize?: () => number | undefined;
  isRtpActive?: () => boolean;
}

export class RtcpHandler {
  private readonly config: RtcpHandlerConfig;
  private readonly logger: Logger;
  private reportInterval?: NodeJS.Timeout;
  private isLatched: boolean = false;
  private remoteEndpoint?: RtpEndpoint;
  private currentTimestamp: number = 0;

  constructor(config: RtcpHandlerConfig) {
    this.config = config;
    this.logger = createLogger({ 
      component: 'RtcpHandler',
      ssrc: config.ssrc
    });
  }

  public start(): void {
    this.logger.debug('Starting RTCP handler', {
      localPort: this.config.localPort,
      expectedRemote: `${this.config.remoteAddress}:${this.config.remotePort}`
    });

    // Set up RTCP packet handling
    this.config.socket.on('message', this.handleIncomingRtcp.bind(this));

    // Start sending periodic RTCP reports (every 5 seconds)
    this.reportInterval = setInterval(() => {
      const stats = this.config.getStats?.();
      this.sendSenderReport(stats);
    }, 5000);
  }

  public stop(): void {
    if (this.reportInterval) {
      clearInterval(this.reportInterval);
      this.reportInterval = undefined;
    }
    this.logger.debug('RTCP handler stopped');
  }

  public updateTimestamp(timestamp: number): void {
    this.currentTimestamp = timestamp;
  }

  private handleIncomingRtcp(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    try {
      const rtcpView = rtpJsUtils.nodeBufferToDataView(msg);
      
      if (!rtpJsPackets.isRtcp(rtcpView)) {
        this.logger.warn('Received non-RTCP packet on RTCP port', {
          packetSize: msg.length,
          firstBytes: msg.slice(0, 4).toString('hex')
        });
        return;
      }

      // Implement symmetric RTCP latching
      if (!this.isLatched) {
        this.logger.info('RTCP latching to remote endpoint', {
          address: rinfo.address,
          port: rinfo.port,
          expected: `${this.config.remoteAddress}:${this.config.remotePort}`
        });
        this.isLatched = true;
      }

      // Always update to actual source (symmetric RTCP)
      this.remoteEndpoint = {
        address: rinfo.address,
        port: rinfo.port
      };

      // Try to parse RTCP packet - it might be a single packet or compound
      try {
        const compound = new rtpJsPackets.CompoundPacket(rtcpView);
        const packets = compound.getPackets();
        
        this.logger.debug('Received RTCP packet(s)', {
          from: `${rinfo.address}:${rinfo.port}`,
          packetCount: packets.length,
          types: packets.map(p => this.getPacketTypeName(p as any))
        });

        // Process individual RTCP packets if needed
        for (const packet of packets) {
          this.processRtcpPacket(packet as any);
        }
      } catch (parseError) {
        // Fall back to simple logging like JS version
        this.logger.debug('Received RTCP packet (unparsed)', {
          from: `${rinfo.address}:${rinfo.port}`,
          size: msg.length,
          // Log first few bytes to help debug format
          firstBytes: msg.slice(0, 4).toString('hex')
        });
      }
    } catch (error) {
      this.logger.error('Error handling RTCP packet', error);
    }
  }


  public sendSenderReport(stats?: RtpStats): void {
    // Check if RTP is active before sending RTCP
    if (this.config.isRtpActive && !this.config.isRtpActive()) {
      this.logger.debug('Skipping RTCP SR - RTP not active yet');
      return;
    }

    try {
      const sr = this.createSenderReport(stats);
      const compound = new rtpJsPackets.CompoundPacket();
      compound.setPackets([sr]);

      const rtcpView = compound.getView();
      const rtcpBuffer = rtpJsUtils.dataViewToNodeBuffer(rtcpView);

      // Use latched endpoint if available, otherwise default to RTP port + 1
      const targetAddress = this.remoteEndpoint?.address || this.config.remoteAddress;
      const targetPort = this.remoteEndpoint?.port || this.config.remotePort;

      this.config.socket.send(rtcpBuffer, targetPort, targetAddress);

      const latchStatus = this.isLatched ? 'latched' : 'default (RTP+1)';
      const dynamicFrameSize = this.config.getDynamicFrameSize?.();
      
      const logData: any = {
        to: `${targetAddress}:${targetPort}`,
        status: latchStatus,
        packets: sr.getPacketCount(),
        bytes: sr.getOctetCount()
      };
      
      if (dynamicFrameSize !== undefined) {
        logData.dynamicFrameSize = `${dynamicFrameSize} samples`;
      }
      
      this.logger.debug('Sent RTCP Sender Report', logData);
    } catch (error) {
      this.logger.error('Failed to send RTCP Sender Report', error);
    }
  }

  private createSenderReport(stats?: RtpStats): rtpJsPackets.SenderReportPacket {
    const sr = new rtpJsPackets.SenderReportPacket();
    sr.setSsrc(this.config.ssrc);

    // Set NTP timestamp
    const { ntpSeconds, ntpFraction } = this.getCurrentNtpTime();
    sr.setNtpSeconds(ntpSeconds);
    sr.setNtpFraction(ntpFraction);

    // Set RTP timestamp
    sr.setRtpTimestamp(this.currentTimestamp);

    // Set packet and byte counts
    if (stats) {
      sr.setPacketCount(stats.packetsSent);
      sr.setOctetCount(stats.bytesSent);
    } else {
      sr.setPacketCount(0);
      sr.setOctetCount(0);
    }

    return sr;
  }

  private getCurrentNtpTime(): { ntpSeconds: number; ntpFraction: number } {
    const now = Date.now();
    const ntpMs = now + 2208988800000; // Convert to NTP epoch (1900-01-01)
    const ntpSeconds = Math.floor(ntpMs / 1000);
    const ntpFraction = Math.floor((ntpMs % 1000) * 0xFFFFFFFF / 1000);
    
    return { ntpSeconds, ntpFraction };
  }

  public getRemoteEndpoint(): RtpEndpoint | undefined {
    return this.remoteEndpoint;
  }

  public isRtcpLatched(): boolean {
    return this.isLatched;
  }

  private getPacketTypeName(packet: any): string {
    if (packet instanceof rtpJsPackets.SenderReportPacket) return 'SR';
    if (packet instanceof rtpJsPackets.ReceiverReportPacket) return 'RR';
    if (packet instanceof rtpJsPackets.SdesPacket) return 'SDES';
    if (packet instanceof rtpJsPackets.ByePacket) return 'BYE';
    return 'Unknown';
  }

  private processRtcpPacket(packet: any): void {
    // Type checking for different RTCP packet types
    if (packet instanceof rtpJsPackets.ReceiverReportPacket) {
      this.logger.debug('Received Receiver Report', { ssrc: packet.getSsrc() });
    } else if (packet instanceof rtpJsPackets.SenderReportPacket) {
      this.logger.debug('Received Sender Report', { 
        ssrc: packet.getSsrc(),
        packetCount: packet.getPacketCount(),
        octetCount: packet.getOctetCount()
      });
    } else if (packet instanceof rtpJsPackets.SdesPacket) {
      this.logger.debug('Received Source Description');
    } else if (packet instanceof rtpJsPackets.ByePacket) {
      this.logger.info('Received BYE packet - remote endpoint leaving');
    }
  }
}