import * as sdpTransform from 'sdp-transform';
import Srf, { SrfRequest, SrfResponse } from 'drachtio-srf';
import { CallContext, ParsedSdp } from './types';
import { AppConfig, SessionType } from '../config/types';
import { createLogger, Logger } from '../utils/logger';
import { CallRouterService } from './CallRouterService';
import { CallHandler } from './interfaces';
import { DrachtioWelcomeHandler } from './DrachtioWelcomeHandler';
import { DrachtioEchoHandler } from './DrachtioEchoHandler';
import { DrachtioOpenAIHandler } from './DrachtioOpenAIHandler';

export class SipHandler {
  private readonly srf: Srf;
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly callRouter: CallRouterService;
  private readonly handlers: Map<SessionType, CallHandler>;

  constructor(srf: Srf, config: AppConfig) {
    this.srf = srf;
    this.config = config;
    this.logger = createLogger({ component: 'SipHandler' });
    
    // Initialize handlers
    this.handlers = new Map<SessionType, CallHandler>();
    this.handlers.set('welcome', new DrachtioWelcomeHandler(this.srf, this.config));
    this.handlers.set('echo', new DrachtioEchoHandler(this.srf, this.config));
    this.handlers.set('chat', new DrachtioOpenAIHandler(this.srf, this.config));
    
    // Initialize call router
    this.callRouter = new CallRouterService(this.config, this.handlers);

    // Set up INVITE handler
    this.srf.invite(this.handleInvite.bind(this));
  }

  public async initialize(): Promise<void> {
    try {
      // Initialize all handlers
      for (const handler of this.handlers.values()) {
        await handler.initialize();
      }
      this.logger.info('SipHandler initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize SipHandler', error);
      throw error;
    }
  }

  private async handleInvite(req: SrfRequest, res: SrfResponse): Promise<void> {
    const callContext = this.extractCallContext(req);
    const callLogger = this.logger.child({ callId: callContext.callId });

    callLogger.info('Incoming call', {
      from: callContext.from,
      to: callContext.to,
      diversion: callContext.diversion
    });

    try {
      // Parse offered SDP to validate audio capability
      const offer = sdpTransform.parse(req.body) as ParsedSdp;
      const audioMedia = offer.media.find(m => m.type === 'audio');

      if (!audioMedia) {
        callLogger.error('No audio media in offer');
        res.send(488, 'Not Acceptable Here');
        return;
      }

      // Log offered codecs for diagnostics
      const offeredCodecs = audioMedia.rtp?.map(rtp => `${rtp.codec}/${rtp.rate}`) || [];
      callLogger.info('Codecs offered', { codecs: offeredCodecs });

      // Delegate to call router
      await this.callRouter.routeCall(req, res, callContext);

    } catch (error) {
      callLogger.error('Error handling INVITE', error);
      if (!res.send) {
        // Response already sent
        return;
      }
      res.send(500, 'Internal Server Error');
    }
  }

  private extractCallContext(req: SrfRequest): CallContext {
    const callId = req.get('Call-ID') || `unknown-${Date.now()}`;
    const from = req.get('From') || 'unknown';
    const to = req.get('To') || 'unknown';
    const diversion = req.get('Diversion');

    return {
      callId,
      from: this.extractSipUri(from),
      to: this.extractSipUri(to),
      diversion: diversion ? this.extractSipUri(diversion) : undefined
    };
  }

  private extractSipUri(header: string): string {
    // Extract SIP URI from header like: "Display Name" <sip:user@domain>;tag=123
    const match = header.match(/<(sip:[^>]+)>/) || header.match(/(sip:[^\s;]+)/);
    return match?.[1] ?? header;
  }


  public async shutdown(): Promise<void> {
    this.logger.debug('Shutting down SIP handler');

    // Shutdown all handlers
    for (const handler of this.handlers.values()) {
      await handler.shutdown();
    }
  }
}