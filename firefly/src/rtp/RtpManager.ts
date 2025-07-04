import { RtpSession } from './RtpSession';
import { RtpEchoSession } from './RtpEchoSession';
import { RtpSessionConfig, CodecInfo } from './types';
import { RtpConfig } from '../config/types';
import { createLogger, Logger } from '../utils/logger';
import { RtpPortAllocationError, RtpSessionError } from '../utils/errors';

export interface CreateSessionOptions {
  remoteAddress: string;
  remotePort: number;
  codec: CodecInfo;
  sessionId: string;
  sessionType?: 'echo' | 'bridge'; // For future OpenAI bridge support
}

export class RtpManager {
  private readonly rtpConfig: RtpConfig;
  private readonly logger: Logger;
  private readonly sessions: Map<string, RtpSession>;
  private nextAvailablePort: number;
  private readonly usedPorts: Set<number>;

  constructor(rtpConfig: RtpConfig) {
    this.rtpConfig = rtpConfig;
    this.logger = createLogger({ component: 'RtpManager' });
    this.sessions = new Map();
    this.usedPorts = new Set();
    this.nextAvailablePort = rtpConfig.portMin;
  }

  public async createSession(options: CreateSessionOptions): Promise<RtpSession> {
    this.logger.info('Creating RTP session', {
      sessionId: options.sessionId,
      remoteEndpoint: `${options.remoteAddress}:${options.remotePort}`,
      codec: options.codec.name,
      type: options.sessionType || 'echo'
    });

    // Check if session already exists
    if (this.sessions.has(options.sessionId)) {
      throw new RtpSessionError('Session already exists', { sessionId: options.sessionId });
    }

    // Allocate RTP port
    const localPort = this.allocatePort();
    
    try {
      const sessionConfig: RtpSessionConfig = {
        localPort,
        remotePort: options.remotePort,
        remoteAddress: options.remoteAddress,
        codec: options.codec,
        sessionId: options.sessionId
      };

      // Create appropriate session type
      let session: RtpSession;
      switch (options.sessionType) {
        case 'echo':
        default:
          session = new RtpEchoSession(sessionConfig);
          break;
        // Future: case 'bridge': session = new RtpBridgeSession(sessionConfig);
      }

      // Start the session
      await session.start();

      // Track the session
      this.sessions.set(options.sessionId, session);

      this.logger.info('RTP session created successfully', {
        sessionId: options.sessionId,
        localPort
      });

      return session;
    } catch (error) {
      // Release port on failure
      this.releasePort(localPort);
      throw error;
    }
  }

  public async destroySession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.logger.warn('Attempted to destroy non-existent session', { sessionId });
      return;
    }

    this.logger.info('Destroying RTP session', { sessionId });

    try {
      // Stop the session
      await session.stop();

      // Release the port
      const config = session.getConfig();
      this.releasePort(config.localPort);

      // Remove from tracking
      this.sessions.delete(sessionId);

      this.logger.info('RTP session destroyed', { 
        sessionId,
        stats: session.getStats()
      });
    } catch (error) {
      this.logger.error('Error destroying session', error, { sessionId });
      // Still remove from tracking even if stop failed
      this.sessions.delete(sessionId);
      throw error;
    }
  }

  public getSession(sessionId: string): RtpSession | undefined {
    return this.sessions.get(sessionId);
  }

  public getAllSessions(): Map<string, RtpSession> {
    return new Map(this.sessions);
  }

  public async shutdown(): Promise<void> {
    this.logger.info('Shutting down RTP manager', { 
      activeSessions: this.sessions.size 
    });

    const shutdownPromises: Promise<void>[] = [];
    
    // Stop all sessions
    for (const [sessionId, session] of this.sessions) {
      shutdownPromises.push(
        session.stop()
          .catch(error => {
            this.logger.error('Error stopping session during shutdown', error, { sessionId });
          })
      );
    }

    await Promise.all(shutdownPromises);
    
    // Clear all tracking
    this.sessions.clear();
    this.usedPorts.clear();
    
    this.logger.info('RTP manager shutdown complete');
  }

  private allocatePort(): number {
    // Find next available port
    let attempts = 0;
    const maxAttempts = (this.rtpConfig.portMax - this.rtpConfig.portMin) / 2;

    while (attempts < maxAttempts) {
      if (!this.usedPorts.has(this.nextAvailablePort) && 
          !this.usedPorts.has(this.nextAvailablePort + 1)) { // Check RTCP port too
        
        const allocatedPort = this.nextAvailablePort;
        this.usedPorts.add(allocatedPort);
        this.usedPorts.add(allocatedPort + 1); // Reserve RTCP port

        // Move to next even port
        this.nextAvailablePort += 2;
        if (this.nextAvailablePort > this.rtpConfig.portMax) {
          this.nextAvailablePort = this.rtpConfig.portMin;
        }

        this.logger.debug('Allocated RTP port', { 
          rtpPort: allocatedPort,
          rtcpPort: allocatedPort + 1
        });

        return allocatedPort;
      }

      this.nextAvailablePort += 2;
      if (this.nextAvailablePort > this.rtpConfig.portMax) {
        this.nextAvailablePort = this.rtpConfig.portMin;
      }
      attempts++;
    }

    throw new RtpPortAllocationError('No available RTP ports', {
      portMin: this.rtpConfig.portMin,
      portMax: this.rtpConfig.portMax,
      usedPorts: this.usedPorts.size
    });
  }

  private releasePort(port: number): void {
    this.usedPorts.delete(port);
    this.usedPorts.delete(port + 1); // Release RTCP port too
    
    this.logger.debug('Released RTP port', { 
      rtpPort: port,
      rtcpPort: port + 1
    });
  }

  public getPortUsage(): { used: number; total: number; percentage: number } {
    const totalPorts = Math.floor((this.rtpConfig.portMax - this.rtpConfig.portMin) / 2);
    const usedPorts = this.usedPorts.size / 2; // Each session uses 2 ports
    const percentage = (usedPorts / totalPorts) * 100;

    return {
      used: usedPorts,
      total: totalPorts,
      percentage: Math.round(percentage)
    };
  }
}