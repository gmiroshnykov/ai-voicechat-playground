import { AppConfig } from '../config/types';
import { createLogger, Logger } from '../utils/logger';
import Mrf, { MediaServer, Endpoint } from 'drachtio-fsmrf';
import Srf from 'drachtio-srf';
import { SrfRequest, SrfResponse, Dialog } from 'drachtio-srf';
import { AudioStreamServer } from '../audio/AudioStreamServer';
import { OpenAIBridgeConnection } from '../audio/OpenAIBridgeConnection';
import { CallContext } from './types';

export class DrachtioOpenAIHandler {
  private readonly mrf: Mrf;
  private readonly logger: Logger;
  private readonly config: AppConfig;
  private mediaServer?: MediaServer;

  constructor(srf: Srf, config: AppConfig) {
    this.config = config;
    this.logger = createLogger({ component: 'DrachtioOpenAIHandler' });
    this.mrf = new Mrf(srf);
  }

  public async initialize(): Promise<void> {
    this.logger.info('Connecting to FreeSWITCH media server for OpenAI chat');
    this.mediaServer = await this.mrf.connect(this.config.mediaServer);
    this.logger.info('Connected to FreeSWITCH media server for OpenAI chat');
  }

  public async handleChatCall(req: SrfRequest, res: SrfResponse, callContext: CallContext): Promise<void> {
    const callLogger = this.logger.child({ callId: callContext.callId });

    try {
      callLogger.info('Handling chat call with drachtio-fsmrf and OpenAI');

      if (!this.mediaServer) {
        throw new Error('Media server not initialized');
      }

      // Connect the caller to the media server
      const { endpoint, dialog } = await this.mediaServer.connectCaller(req, res);

      callLogger.info('Chat call connected to media server', {
        dialogId: dialog.id,
        endpointUuid: endpoint.uuid
      });

      // Set up dialog termination handling
      dialog.on('destroy', () => {
        callLogger.info('Chat call ended - cleaning up endpoint');
        if (endpoint) {
          endpoint.destroy();
        }
      });

      // Start the OpenAI audio bridge
      await this.startOpenAIBridge(endpoint, dialog, callContext, callLogger);

      callLogger.info('Chat call completed');

    } catch (error) {
      callLogger.error('Error handling chat call with drachtio-fsmrf', error);
      if (res.headersSent) {
        return; // Response already sent
      }
      res.send(500, 'Internal Server Error');
    }
  }

  private async startOpenAIBridge(endpoint: Endpoint, dialog: Dialog, callContext: CallContext, logger: Logger): Promise<void> {
    const callId = endpoint.uuid;
    let audioServer: AudioStreamServer | undefined;
    let bridgeConnection: OpenAIBridgeConnection | undefined;
    
    logger.info('Starting per-call WebSocket audio bridge to OpenAI', { callId });

    try {
      // Start recording if enabled
      if (this.config.recording?.enabled) {
        await this.startRecording(endpoint, callContext.callId, logger);
      }

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

      logger.info('Per-call OpenAI audio server started', { port, callId });

      // Use POD_IP for direct pod communication, fallback to localhost for development
      const podIp = process.env.POD_IP || 'localhost';
      const wsUrl = `ws://${podIp}:${port}/audio`;
      
      logger.info('Starting bidirectional audio fork for OpenAI chat', { wsUrl, callId });
      
      // Use direct FreeSWITCH API to start audio fork with bidirectional audio at 24kHz for OpenAI
      // Syntax: uuid_audio_fork <uuid> start <wss-url> <mono|mixed|stereo> <samplerate> [bugname] [metadata] [bidirectionalAudio_enabled] [bidirectionalAudio_stream_enabled] [bidirectionalAudio_stream_samplerate]
      const forkCommand = `uuid_audio_fork ${endpoint.uuid} start ${wsUrl} mono 24000 chat_audio_fork {} true true 24000`;
      logger.info('Sending bidirectional audio fork command', { forkCommand });
      
      await endpoint.api(forkCommand);
      logger.info('Bidirectional audio fork started successfully via direct API');

      // Wait for FreeSWITCH to establish WebSocket connection
      logger.info('Waiting for FreeSWITCH WebSocket connection');
      await audioServer.waitForConnection();
      logger.info('FreeSWITCH WebSocket connection established');
      
      // Create OpenAI bridge connection
      const connection = audioServer.getConnection();
      if (!connection) {
        throw new Error('No WebSocket connection available');
      }

      // Default to PCMU - FreeSWITCH handles actual codec negotiation
      const codec = 'PCMU';
      
      bridgeConnection = new OpenAIBridgeConnection(connection.getWebSocket(), {
        openaiApiKey: this.config.openai.apiKey,
        codec,
        callId: callContext.callId,
        caller: {
          phoneNumber: this.extractPhoneNumber(callContext.from),
          diversionHeader: callContext.diversion
        },
        transcription: this.config.transcription,
        onHangUpRequested: async () => {
          logger.info('OpenAI requested hang up - terminating call');
          try {
            // Destroy the dialog to end the call
            // This will trigger the dialog destroy handler which cleans up the endpoint
            dialog.destroy();
            logger.info('Call terminated successfully by AI request');
          } catch (error) {
            logger.error('Error terminating call on AI hang-up request', error);
          }
        }
      });

      // Initialize OpenAI connection
      await bridgeConnection.initialize();
      
      // Start the bridge - this will block until call ends
      logger.info('Starting OpenAI audio bridge');
      await bridgeConnection.startBridge();

      // Bridge has ended (call hung up)
      logger.info('OpenAI audio bridge completed');

    } catch (error) {
      logger.error('Error in per-call WebSocket OpenAI bridge', { error, callId });
    } finally {
      try {
        // Stop recording if it was started
        if (this.config.recording?.enabled && endpoint.connected) {
          await this.stopRecording(endpoint, logger);
        }
      } catch (recordingError) {
        logger.error('Error stopping recording', { error: recordingError, callId });
      }

      try {
        // Disconnect from OpenAI
        if (bridgeConnection) {
          await bridgeConnection.disconnect();
        }
      } catch (openaiError) {
        logger.error('Error disconnecting from OpenAI', { error: openaiError, callId });
      }

      try {
        // Only stop the audio fork if the endpoint is still connected
        if (endpoint.connected) {
          await endpoint.api(`uuid_audio_fork ${endpoint.uuid} stop`);
          logger.debug('OpenAI audio fork stopped via direct API');
        } else {
          logger.debug('Endpoint already disconnected, skipping audio fork stop');
        }
      } catch (stopError) {
        logger.error('Error stopping OpenAI audio fork', { 
          error: stopError, 
          callId
        });
      }

      // Clean up the per-call server
      if (audioServer) {
        try {
          await audioServer.stop();
          logger.debug('Per-call OpenAI audio server stopped', { callId });
        } catch (stopError) {
          logger.error('Error stopping per-call OpenAI audio server', { 
            error: stopError, 
            callId 
          });
        }
      }
    }
  }

  private async startRecording(endpoint: Endpoint, callId: string, logger: Logger): Promise<void> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const recordingPath = `/app/recordings/call_${callId}_${timestamp}.wav`;
      
      // Enable stereo recording (separate channels for inbound/outbound)
      await endpoint.api(`uuid_setvar ${endpoint.uuid} RECORD_STEREO true`);
      logger.debug('Set RECORD_STEREO variable');
      
      // Start recording
      await endpoint.api(`uuid_record ${endpoint.uuid} start ${recordingPath}`);
      
      logger.info('Started FreeSWITCH native recording', { 
        callId, 
        path: recordingPath,
        stereo: true 
      });
    } catch (error) {
      logger.error('Failed to start recording', { error, callId });
      // Don't throw - recording failure shouldn't stop the call
    }
  }

  private async stopRecording(endpoint: Endpoint, logger: Logger): Promise<void> {
    try {
      await endpoint.api(`uuid_record ${endpoint.uuid} stop`);
      logger.debug('Stopped FreeSWITCH native recording');
    } catch (error) {
      logger.error('Failed to stop recording', { error });
      // Don't throw - this is cleanup
    }
  }

  private extractPhoneNumber(fromHeader: string): string | undefined {
    // Extract phone number from SIP From header
    // Format: "Display Name" <sip:+1234567890@domain> or sip:+1234567890@domain
    const sipMatch = fromHeader.match(/sip:([^@]+)@/);
    if (sipMatch && sipMatch[1]) {
      const userPart = sipMatch[1];
      // Remove any non-digit characters except + for international numbers
      const cleanNumber = userPart.replace(/[^\d+]/g, '');
      return cleanNumber || undefined;
    }
    return undefined;
  }

  public async shutdown(): Promise<void> {
    this.logger.debug('Shutting down DrachtioOpenAIHandler');
    this.mediaServer = undefined;
  }
}