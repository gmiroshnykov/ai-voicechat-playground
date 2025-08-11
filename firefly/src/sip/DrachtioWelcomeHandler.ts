import { AppConfig } from '../config/types';
import { createLogger, Logger } from '../utils/logger';
import Mrf, { MediaServer, Endpoint } from 'drachtio-fsmrf';
import Srf from 'drachtio-srf';
import { SrfRequest, SrfResponse } from 'drachtio-srf';

export class DrachtioWelcomeHandler {
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

  public async handleWelcomeCall(req: SrfRequest, res: SrfResponse, callId: string): Promise<void> {
    const callLogger = this.logger.child({ callId });

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
    logger.info('Playing welcome tone');
    await endpoint.execute('playback', 'tone_stream://%(2000,4000,440,480)');
    logger.info('Welcome tone playback completed');
  }

  public async shutdown(): Promise<void> {
    this.logger.debug('Shutting down DrachtioWelcomeHandler');
    this.mediaServer = undefined;
  }
}