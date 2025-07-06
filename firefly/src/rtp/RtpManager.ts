import { RtpSession } from './RtpSession';
import { RtpEchoSession } from './RtpEchoSession';
import { RtpBridgeSession, RtpBridgeSessionConfig } from './RtpBridgeSession';
import { RtpSessionConfig, CodecInfo } from './types';
import { RtpConfig, OpenAIConfig, RecordingConfig, TranscriptionConfig } from '../config/types';
import { createLogger, Logger } from '../utils/logger';
import { RtpPortAllocationError, RtpSessionError } from '../utils/errors';

export interface CreateSessionOptions {
  remoteAddress: string;
  remotePort: number;
  codec: CodecInfo;
  sessionId: string;
  sessionType?: 'echo' | 'bridge';
  // OpenAI bridge specific options
  openaiConfig?: OpenAIConfig;
  recordingConfig?: RecordingConfig;
  transcriptionConfig?: TranscriptionConfig;
  caller?: {
    phoneNumber?: string;
    diversionHeader?: string;
  };
  onHangUpRequested?: () => Promise<void>;
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
    this.logger.debug('Creating RTP session', {
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
        case 'bridge':
          if (!options.openaiConfig || !options.openaiConfig.enabled) {
            throw new RtpSessionError('Bridge session requires OpenAI configuration', { 
              sessionId: options.sessionId 
            });
          }
          if (!options.openaiConfig.apiKey) {
            throw new RtpSessionError('Bridge session requires OpenAI API key', { 
              sessionId: options.sessionId 
            });
          }
          
          const bridgeConfig: RtpBridgeSessionConfig = {
            ...sessionConfig,
            openaiApiKey: options.openaiConfig.apiKey,
            jitterBufferMs: this.rtpConfig.jitterBufferMs,
            recordingConfig: options.recordingConfig,
            transcriptionConfig: options.transcriptionConfig,
            caller: options.caller,
            onHangUpRequested: options.onHangUpRequested
          };
          session = new RtpBridgeSession(bridgeConfig);
          break;
          
        case 'echo':
        default:
          session = new RtpEchoSession(sessionConfig);
          break;
      }

      // Start the session
      await session.start();

      // Track the session
      this.sessions.set(options.sessionId, session);

      this.logger.debug('RTP session created successfully', {
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

    this.logger.debug('Destroying RTP session', { sessionId });

    try {
      // Stop the session
      await session.stop();

      // Release the port
      const config = session.getConfig();
      this.releasePort(config.localPort);

      // Remove from tracking
      this.sessions.delete(sessionId);

      this.logger.debug('RTP session destroyed', { 
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

  public flushSessionJitterBuffer(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && 'flushJitterBuffer' in session) {
      this.logger.debug('Flushing jitter buffer for session', { sessionId });
      (session as any).flushJitterBuffer();
    }
  }

  public getAllSessions(): Map<string, RtpSession> {
    return new Map(this.sessions);
  }

  public async shutdown(): Promise<void> {
    this.logger.debug('Shutting down RTP manager', { 
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
    
    this.logger.debug('RTP manager shutdown complete');
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