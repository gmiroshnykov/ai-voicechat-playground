import { AppConfig } from '../config/types';
import { createLogger, Logger } from '../utils/logger';
import Mrf, { MediaServer, Endpoint } from 'drachtio-fsmrf';
import Srf from 'drachtio-srf';
import { SrfRequest, SrfResponse } from 'drachtio-srf';
import { AudioStreamServer } from '../audio/AudioStreamServer';
import { CallHandler } from './interfaces';
import { CallContext } from './types';

export class DrachtioEchoHandler implements CallHandler {
  private readonly mrf: Mrf;
  private readonly logger: Logger;
  private readonly config: AppConfig;
  private mediaServer?: MediaServer;

  constructor(srf: Srf, config: AppConfig) {
    this.config = config;
    this.logger = createLogger({ component: 'DrachtioEchoHandler' });
    this.mrf = new Mrf(srf);
  }

  public async initialize(): Promise<void> {
    this.logger.info('Connecting to FreeSWITCH media server for echo');
    this.mediaServer = await this.mrf.connect(this.config.mediaServer);
    this.logger.info('Connected to FreeSWITCH media server for echo');
  }

  public async handleCall(req: SrfRequest, res: SrfResponse, callContext: CallContext): Promise<void> {
    const callLogger = this.logger.child({ callId: callContext.callId });

    try {
      callLogger.info('Handling echo call with drachtio-fsmrf');

      if (!this.mediaServer) {
        throw new Error('Media server not initialized');
      }

      // Connect the caller to the media server
      const { endpoint, dialog } = await this.mediaServer.connectCaller(req, res);

      callLogger.info('Echo call connected to media server', {
        dialogId: dialog.id,
        endpointUuid: endpoint.uuid
      });

      // Set up dialog termination handling
      dialog.on('destroy', () => {
        callLogger.info('Echo call ended - cleaning up endpoint');
        if (endpoint) {
          endpoint.destroy();
        }
      });

      // Start the echo audio loop
      await this.startEchoAudio(endpoint, callLogger);

      callLogger.info('Echo call completed');

    } catch (error) {
      callLogger.error('Error handling echo call with drachtio-fsmrf', error);
      if (res.headersSent) {
        return; // Response already sent
      }
      res.send(500, 'Internal Server Error');
    }
  }

  private async startEchoAudio(endpoint: Endpoint, logger: Logger): Promise<void> {
    const callId = endpoint.uuid;
    let audioServer: AudioStreamServer | undefined;
    
    logger.info('Starting per-call WebSocket audio echo', { callId });

    try {
      // Create dedicated WebSocket server for this call
      audioServer = new AudioStreamServer({
        host: '0.0.0.0',
        port: 0, // Let OS assign random port
        callId
      });

      // Start the server and get the assigned port
      await audioServer.start();
      const port = audioServer.getPort();
      
      if (!port) {
        throw new Error('Failed to get assigned port from audio server');
      }

      logger.info('Per-call echo audio server started', { port, callId });

      // Use POD_IP for direct pod communication, fallback to localhost for development
      const podIp = process.env.POD_IP || 'localhost';
      const wsUrl = `ws://${podIp}:${port}/audio`;
      
      logger.info('Starting bidirectional audio fork for echo', { wsUrl, callId });
      
      // Use direct FreeSWITCH API to start audio fork with bidirectional audio
      // Syntax: uuid_audio_fork <uuid> start <wss-url> <mono|mixed|stereo> <samplerate> [bugname] [metadata] [bidirectionalAudio_enabled] [bidirectionalAudio_stream_enabled] [bidirectionalAudio_stream_samplerate]
      const forkCommand = `uuid_audio_fork ${endpoint.uuid} start ${wsUrl} mono 8000 echo_audio_fork {} true true 8000`;
      logger.info('Sending bidirectional audio fork command', { forkCommand });
      
      await endpoint.api(forkCommand);
      logger.info('Bidirectional audio fork started successfully via direct API');

      // Wait for FreeSWITCH to establish WebSocket connection
      logger.info('Waiting for FreeSWITCH WebSocket connection');
      await audioServer.waitForConnection();
      logger.info('FreeSWITCH WebSocket connection established');
      
      // Start echo mode - this will block until the call ends
      logger.info('Starting echo audio loop');
      await audioServer.startEchoStream();

      // Echo loop has ended (call hung up)
      logger.info('Echo audio loop completed');

    } catch (error) {
      logger.error('Error in per-call WebSocket audio echo', { error, callId });
    } finally {
      try {
        // Only stop the audio fork if the endpoint is still connected
        if (endpoint.connected) {
          await endpoint.api(`uuid_audio_fork ${endpoint.uuid} stop`);
          logger.debug('Echo audio fork stopped via direct API');
        } else {
          logger.debug('Endpoint already disconnected, skipping audio fork stop');
        }
      } catch (stopError) {
        logger.error('Error stopping echo audio fork', { 
          error: stopError, 
          callId
        });
      }

      // Clean up the per-call server
      if (audioServer) {
        try {
          await audioServer.stop();
          logger.debug('Per-call echo audio server stopped', { callId });
        } catch (stopError) {
          logger.error('Error stopping per-call echo audio server', { 
            error: stopError, 
            callId 
          });
        }
      }
    }
  }

  public async shutdown(): Promise<void> {
    this.logger.debug('Shutting down DrachtioEchoHandler');
    this.mediaServer = undefined;
  }
}