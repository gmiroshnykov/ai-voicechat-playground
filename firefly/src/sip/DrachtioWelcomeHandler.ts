import { AppConfig } from '../config/types';
import { createLogger, Logger } from '../utils/logger';
import Mrf, { MediaServer, Endpoint } from 'drachtio-fsmrf';
import Srf from 'drachtio-srf';
import { SrfRequest, SrfResponse } from 'drachtio-srf';
import { AudioStreamServer } from '../audio/AudioStreamServer';
import { CallHandler } from './interfaces';
import { CallContext } from './types';
import path from 'path';

// Type augmentation for drachtio-fsmrf Endpoint to include audio fork methods
declare module 'drachtio-fsmrf' {
  interface Endpoint {
    forkAudioStart(options: {
      wsUrl: string;
      mixType?: 'mono' | 'mixed' | 'stereo';
      sampling?: string;
      bugname?: string;
      metadata?: any;
      bidirectionalAudio?: {
        enabled?: string;
        streaming?: string;
        sampleRate?: string;
      };
    }): Promise<void>;
    
    forkAudioStop(bugname?: string, metadata?: any): Promise<void>;
    
    forkAudioSendText(bugname?: string, metadata?: any): Promise<void>;
    
    api(command: string, ...args: string[]): Promise<any>;
  }
}

export class DrachtioWelcomeHandler implements CallHandler {
  private readonly mrf: Mrf;
  private readonly logger: Logger;
  private readonly config: AppConfig;
  private mediaServer?: MediaServer;

  constructor(srf: Srf, config: AppConfig) {
    this.config = config;
    this.logger = createLogger({ component: 'DrachtioWelcomeHandler' });
    this.mrf = new Mrf(srf);
  }

  public async initialize(): Promise<void> {
    this.logger.info('Connecting to FreeSWITCH media server');
    this.mediaServer = await this.mrf.connect(this.config.mediaServer);
    this.logger.info('Connected to FreeSWITCH media server');
  }

  public async handleCall(req: SrfRequest, res: SrfResponse, callContext: CallContext): Promise<void> {
    const callLogger = this.logger.child({ callId: callContext.callId });

    try {
      callLogger.info('Handling welcome call with drachtio-fsmrf');

      if (!this.mediaServer) {
        throw new Error('Media server not initialized');
      }

      // Connect the caller to the media server
      const { endpoint, dialog } = await this.mediaServer.connectCaller(req, res);

      callLogger.info('Call connected to media server', {
        dialogId: dialog.id,
        endpointUuid: endpoint.uuid
      });

      // Set up dialog termination handling
      dialog.on('destroy', () => {
        callLogger.info('Call ended - cleaning up endpoint');
        if (endpoint) {
          endpoint.destroy();
        }
      });

      // Play the welcome audio file
      await this.playWelcomeAudio(endpoint, callLogger);

      // Hang up the call after playing audio
      callLogger.info('Welcome audio completed - hanging up');
      dialog.destroy();

    } catch (error) {
      callLogger.error('Error handling welcome call with drachtio-fsmrf', error);
      if (res.headersSent) {
        return; // Response already sent
      }
      res.send(500, 'Internal Server Error');
    }
  }

  private async playWelcomeAudio(endpoint: Endpoint, logger: Logger): Promise<void> {
    const callId = endpoint.uuid;
    let audioServer: AudioStreamServer | undefined;
    
    logger.info('Starting per-call WebSocket audio streaming', { callId });

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

      logger.info('Per-call audio server started', { port, callId });

      // Audio operations will handle their own timing through self-contained blocking

      // Use POD_IP for direct pod communication, fallback to localhost for development
      const podIp = process.env.POD_IP || 'localhost';
      const wsUrl = `ws://${podIp}:${port}/audio`;
      
      logger.info('Starting audio fork', { wsUrl, callId });
      
      // Use direct FreeSWITCH API to start audio fork with bidirectional audio
      // Syntax: uuid_audio_fork <uuid> start <wss-url> <mono|mixed|stereo> <samplerate> [bugname] [metadata] [bidirectionalAudio_enabled] [bidirectionalAudio_stream_enabled] [bidirectionalAudio_stream_samplerate]
      const forkCommand = `uuid_audio_fork ${endpoint.uuid} start ${wsUrl} mono 8000 welcome_audio_fork {} true true 8000`;
      logger.info('Sending direct audio fork command', { forkCommand });
      
      await endpoint.api(forkCommand);
      logger.info('Audio fork started successfully via direct API');

      // Wait for FreeSWITCH to establish WebSocket connection
      logger.info('Waiting for FreeSWITCH WebSocket connection');
      await audioServer.waitForConnection();
      logger.info('FreeSWITCH WebSocket connection established');
      
      // Start streaming audio once connected  
      const audioFilePath = path.resolve(__dirname, '../../audio/welcome.pcm');
      logger.info('Starting audio stream with 1 second silence buffer', { audioFilePath, callId });
      
      // Send 1 second of silence first to ensure audio path is fully established
      logger.info('Sending 1 second of silence to establish audio path');
      await audioServer.startSilenceStream(1000); // 1 second of silence
      
      logger.info('Starting welcome audio file playback');
      await audioServer.startAudioStream(audioFilePath);

      // Audio operations are now complete (each function blocks for its full duration)
      logger.info('All audio operations completed');

    } catch (error) {
      logger.error('Error in per-call WebSocket audio streaming', { error, callId });
    } finally {
      try {
        // Only stop the audio fork if the endpoint is still connected
        if (endpoint.connected) {
          await endpoint.api(`uuid_audio_fork ${endpoint.uuid} stop`);
          logger.debug('Audio fork stopped via direct API');
        } else {
          logger.debug('Endpoint already disconnected, skipping audio fork stop');
        }
      } catch (stopError) {
        logger.error('Error stopping audio fork', { 
          error: stopError, 
          callId
        });
      }

      // Clean up the per-call server
      if (audioServer) {
        try {
          await audioServer.stop();
          logger.debug('Per-call audio server stopped', { callId });
        } catch (stopError) {
          logger.error('Error stopping per-call audio server', { 
            error: stopError, 
            callId 
          });
        }
      }
    }
  }


  public async shutdown(): Promise<void> {
    this.logger.debug('Shutting down DrachtioWelcomeHandler');
    this.mediaServer = undefined;
  }
}