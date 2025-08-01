import { EventEmitter } from 'events';
import * as dgram from 'dgram';
import { RtpSessionConfig, RtpSessionState, RtpStats, RtpLatchingState } from './types';
import { createLogger, Logger } from '../utils/logger';
import { RtpSessionError } from '../utils/errors';

export abstract class RtpSession extends EventEmitter {
  protected readonly config: RtpSessionConfig;
  protected readonly logger: Logger;
  protected state: RtpSessionState;
  protected rtpSocket?: dgram.Socket;
  protected rtcpSocket?: dgram.Socket;
  protected stats: RtpStats;
  protected latchingState: RtpLatchingState;

  constructor(config: RtpSessionConfig) {
    super();
    this.config = config;
    this.logger = createLogger({ 
      component: 'RtpSession',
      sessionId: config.sessionId,
      codec: config.codec.name
    });
    this.state = RtpSessionState.INITIALIZING;
    this.stats = this.initializeStats();
    this.latchingState = this.initializeLatchingState();
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

  public getState(): RtpSessionState {
    return this.state;
  }

  public getStats(): Readonly<RtpStats> {
    return { ...this.stats };
  }

  public getConfig(): Readonly<RtpSessionConfig> {
    return { ...this.config };
  }

  public async start(): Promise<void> {
    if (this.state !== RtpSessionState.INITIALIZING) {
      throw new RtpSessionError('Session already started', { state: this.state });
    }

    try {
      this.logger.debug('Starting RTP session', {
        localPort: this.config.localPort,
        remoteEndpoint: `${this.config.remoteAddress}:${this.config.remotePort}`
      });

      await this.createSockets();
      await this.onStart();
      
      this.state = RtpSessionState.ACTIVE;
      this.emit('started');
      
      this.logger.debug('RTP session started successfully');
    } catch (error) {
      this.state = RtpSessionState.STOPPED;
      throw new RtpSessionError('Failed to start RTP session', { error });
    }
  }

  public async stop(): Promise<void> {
    if (this.state === RtpSessionState.STOPPED || this.state === RtpSessionState.STOPPING) {
      return;
    }

    this.logger.debug('Stopping RTP session');
    this.state = RtpSessionState.STOPPING;

    try {
      await this.onStop();
      this.closeSockets();
      
      this.state = RtpSessionState.STOPPED;
      this.emit('stopped');
      
      this.logger.debug('RTP session stopped', { stats: this.stats });
    } catch (error) {
      this.logger.error('Error stopping RTP session', error);
      this.state = RtpSessionState.STOPPED;
      throw new RtpSessionError('Failed to stop RTP session', { error });
    }
  }

  protected async createSockets(): Promise<void> {
    // Create RTP socket
    this.rtpSocket = dgram.createSocket('udp4');
    
    // Create RTCP socket on RTP port + 1
    this.rtcpSocket = dgram.createSocket('udp4');
    const rtcpPort = this.config.localPort + 1;

    // Bind sockets
    await new Promise<void>((resolve, reject) => {
      this.rtpSocket!.bind(this.config.localPort, () => {
        this.logger.debug('RTP socket bound', { port: this.config.localPort });
        resolve();
      });
      this.rtpSocket!.on('error', reject);
    });

    await new Promise<void>((resolve, reject) => {
      this.rtcpSocket!.bind(rtcpPort, () => {
        this.logger.debug('RTCP socket bound', { port: rtcpPort });
        resolve();
      });
      this.rtcpSocket!.on('error', reject);
    });
  }

  protected closeSockets(): void {
    if (this.rtpSocket) {
      this.rtpSocket.close();
      this.rtpSocket = undefined;
    }
    
    if (this.rtcpSocket) {
      this.rtcpSocket.close();
      this.rtcpSocket = undefined;
    }
  }

  protected validateRtpSource(sourceAddr: string): boolean {
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

  protected updateRtpStats(packetSize: number, direction: 'sent' | 'received'): void {
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
  }

  // Abstract methods to be implemented by subclasses
  protected abstract onStart(): Promise<void>;
  protected abstract onStop(): Promise<void>;
}