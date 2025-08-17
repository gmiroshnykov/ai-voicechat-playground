import { Server as HttpServer } from 'http';
import { createLogger, Logger } from '../utils/logger';
import { AudioStreamConnection } from './AudioStreamConnection';

interface WebSocketServer {
  on(event: 'connection', callback: (ws: any, req: any) => void): void;
  close(callback?: () => void): void;
}

export interface AudioStreamServerConfig {
  port?: number; // Optional - if not provided, OS will assign random port
  host?: string;
  callId: string;
}

/**
 * WebSocket server for a single call's audio streaming.
 * Each call gets its own isolated server instance on a dynamic port.
 */
export class AudioStreamServer {
  private readonly logger: Logger;
  private server?: HttpServer;
  private wss?: WebSocketServer;
  private actualPort?: number;
  private connection?: AudioStreamConnection;
  private readonly callId: string;
  private connectionPromise?: Promise<void>;
  private connectionResolve?: () => void;

  constructor(private readonly config: AudioStreamServerConfig) {
    this.callId = config.callId;
    this.logger = createLogger({ component: 'AudioStreamServer', callId: this.callId });
  }

  /**
   * Start the WebSocket server
   */
  async start(): Promise<void> {
    try {
      // Import WebSocket dynamically to avoid errors if not installed yet
      const WebSocket = await import('ws');

      this.server = new HttpServer();
      this.wss = new WebSocket.WebSocketServer({
        server: this.server,
        path: '/audio'
      });

      this.setupWebSocketHandling();

      // Set up promise to wait for WebSocket connection
      this.connectionPromise = new Promise<void>((resolve) => {
        this.connectionResolve = resolve;
      });

      await new Promise<void>((resolve, reject) => {
        this.server!.listen(this.config.port || 0, this.config.host || 'localhost', (error?: Error) => {
          if (error) {
            reject(error);
          } else {
            // Get the actual port assigned by the OS
            const address = this.server!.address();
            this.actualPort = typeof address === 'object' && address ? address.port : this.config.port || 0;

            this.logger.info('Audio stream server started', {
              port: this.actualPort,
              host: this.config.host || 'localhost'
            });
            resolve();
          }
        });
      });

    } catch (error) {
      this.logger.error('Failed to start audio stream server', { error });
      throw error;
    }
  }

  /**
   * Stop the WebSocket server
   */
  async stop(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.logger.info('Stopping audio stream server');

      // Close connection if active
      if (this.connection) {
        this.connection.close();
        this.connection = undefined;
      }

      // Close WebSocket server
      if (this.wss) {
        this.wss.close(() => {
          this.logger.debug('WebSocket server closed');

          // Close HTTP server
          if (this.server) {
            this.server.close(() => {
              this.logger.info('Audio stream server stopped');
              resolve();
            });
          } else {
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Setup WebSocket connection handling
   */
  private setupWebSocketHandling(): void {
    if (!this.wss) {
      throw new Error('WebSocket server not initialized');
    }

    // Handle single WebSocket connection from FreeSWITCH
    this.wss.on('connection', (ws: any, req: any) => {
      this.logger.info('WebSocket connection from FreeSWITCH', {
        url: req.url,
        userAgent: req.headers['user-agent'],
        remoteAddress: req.socket.remoteAddress,
        callId: this.callId
      });

      // Only allow one connection per server instance
      if (this.connection) {
        this.logger.warn('Rejecting additional WebSocket connection - only one allowed per call');
        ws.close();
        return;
      }

      // Create and store the connection
      this.connection = new AudioStreamConnection(ws, this.logger);

      // Resolve the connection promise
      if (this.connectionResolve) {
        this.connectionResolve();
      }
    });
  }

  /**
   * Wait for WebSocket connection to be established
   */
  async waitForConnection(): Promise<void> {
    if (this.connection) {
      return; // Already connected
    }

    if (!this.connectionPromise) {
      throw new Error('Audio server not started');
    }

    await this.connectionPromise;
  }

  /**
   * Start streaming silence for the specified duration
   */
  async startSilenceStream(durationMs: number): Promise<void> {
    await this.waitForConnection();

    this.logger.info('Starting silence stream', { durationMs });
    await this.connection!.streamSilence(durationMs);
  }

  /**
   * Start streaming audio to the connected client
   */
  async startAudioStream(audioFilePath: string): Promise<void> {
    await this.waitForConnection();

    this.logger.info('Starting audio stream', { audioFilePath });
    await this.connection!.streamAudio(audioFilePath);
  }

  /**
   * Start echo mode - echoes all received audio back to FreeSWITCH
   */
  async startEchoStream(): Promise<void> {
    await this.waitForConnection();

    this.logger.info('Starting echo stream');
    await this.connection!.startEchoMode();
  }

  /**
   * Check if FreeSWITCH is connected
   */
  isConnected(): boolean {
    return !!this.connection;
  }

  /**
   * Get the actual port the server is listening on
   */
  getPort(): number | undefined {
    return this.actualPort;
  }

  /**
   * Get server status
   */
  getStatus(): { running: boolean; port?: number; connected: boolean; callId: string } {
    return {
      running: !!this.server?.listening,
      port: this.actualPort,
      connected: this.isConnected(),
      callId: this.callId
    };
  }
}