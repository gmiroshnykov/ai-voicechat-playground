import * as sdpTransform from 'sdp-transform';
import Srf, { SrfRequest, SrfResponse } from 'drachtio-srf';
import { CallContext, ParsedSdp } from './types';
import { AppConfig } from '../config/types';
import { createLogger, Logger } from '../utils/logger';
import { RouteResolver } from './routing';
import { DrachtioWelcomeHandler } from './DrachtioWelcomeHandler';
import { DrachtioEchoHandler } from './DrachtioEchoHandler';
import { DrachtioOpenAIHandler } from './DrachtioOpenAIHandler';
import { setTimeout as delay } from 'timers/promises';

export class SipHandler {
  private readonly srf: Srf;
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly routeResolver: RouteResolver;
  private readonly drachtioWelcomeHandler: DrachtioWelcomeHandler;
  private readonly drachtioEchoHandler: DrachtioEchoHandler;
  private readonly drachtioOpenAIHandler: DrachtioOpenAIHandler;

  constructor(srf: Srf, config: AppConfig) {
    this.srf = srf;
    this.config = config;
    this.logger = createLogger({ component: 'SipHandler' });
    this.routeResolver = new RouteResolver(config.routing.defaultRoute);
    this.drachtioWelcomeHandler = new DrachtioWelcomeHandler(this.srf, this.config);
    this.drachtioEchoHandler = new DrachtioEchoHandler(this.srf, this.config);
    this.drachtioOpenAIHandler = new DrachtioOpenAIHandler(this.srf, this.config);

    // Set up INVITE handler
    this.srf.invite(this.handleInvite.bind(this));
  }

  public async initialize(): Promise<void> {
    try {
      await this.drachtioWelcomeHandler.initialize();
      await this.drachtioEchoHandler.initialize();
      await this.drachtioOpenAIHandler.initialize();
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
      // Parse offered SDP
      const offer = sdpTransform.parse(req.body) as ParsedSdp;

      const audioMedia = offer.media.find(m => m.type === 'audio');

      if (!audioMedia) {
        callLogger.error('No audio media in offer');
        res.send(488, 'Not Acceptable Here');
        return;
      }

      // Log offered codecs
      const offeredCodecs = audioMedia.rtp?.map(rtp => `${rtp.codec}/${rtp.rate}`) || [];
      callLogger.info('Codecs offered', { codecs: offeredCodecs });

      // Resolve route based on called party (To header)
      const route = this.routeResolver.extractRoute(callContext.to);
      const sessionType = this.routeResolver.resolveSessionType(route);
      const routeDescription = this.routeResolver.getRouteDescription(route);

      callLogger.info('Route resolved', {
        route,
        sessionType,
        description: routeDescription
      });

      // Handle welcome route with drachtio-fsmrf (with ring delay)
      if (sessionType === 'welcome') {
        callLogger.info('Routing welcome call to drachtio-fsmrf handler');

        // Send 180 Ringing to make the phone ring
        callLogger.info('Sending 180 Ringing response');
        res.send(180, 'Ringing');

        // Let the phone ring before answering for more natural interaction
        callLogger.info('Letting phone ring before answering', { delayMs: this.config.routing.ringDelayMs });
        await delay(this.config.routing.ringDelayMs);

        await this.drachtioWelcomeHandler.handleWelcomeCall(req, res, callContext.callId);
        return;
      }

      // Handle echo route with drachtio-fsmrf (with ring delay)
      if (sessionType === 'echo') {
        callLogger.info('Routing echo call to drachtio-fsmrf handler');

        // Send 180 Ringing to make the phone ring
        callLogger.info('Sending 180 Ringing response');
        res.send(180, 'Ringing');

        // Let the phone ring before answering for more natural interaction
        callLogger.info('Letting phone ring before answering', { delayMs: this.config.routing.ringDelayMs });
        await delay(this.config.routing.ringDelayMs);

        await this.drachtioEchoHandler.handleEchoCall(req, res, callContext.callId);
        return;
      }

      // Handle chat route with drachtio-fsmrf (with ring delay)
      if (sessionType === 'chat') {
        callLogger.info('Routing chat call to drachtio-fsmrf handler');

        // Check if OpenAI is enabled
        if (!this.config.openai.enabled) {
          callLogger.error('Chat route requires OpenAI but it is not enabled');
          res.send(503, 'Service Unavailable');
          return;
        }

        // FreeSWITCH handles codec negotiation internally

        // Send 180 Ringing to make the phone ring
        callLogger.info('Sending 180 Ringing response');
        res.send(180, 'Ringing');

        // Let the phone ring before answering for more natural interaction
        callLogger.info('Letting phone ring before answering', { delayMs: this.config.routing.ringDelayMs });
        await delay(this.config.routing.ringDelayMs);

        try {
          await this.drachtioOpenAIHandler.handleChatCall(req, res, callContext);
          return;
        } catch (error) {
          callLogger.error('Error in FreeSWITCH chat handler', error);
          res.send(500, 'Internal Server Error');
          return;
        }
      }

      // If we reach here, no FreeSWITCH handler was matched
      callLogger.error('Unsupported route - only welcome, echo, and chat routes are supported', {
        route,
        sessionType,
        description: routeDescription
      });
      res.send(503, 'Service Unavailable');

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

    // Shutdown drachtio handlers
    await this.drachtioWelcomeHandler.shutdown();
    await this.drachtioEchoHandler.shutdown();
    await this.drachtioOpenAIHandler.shutdown();
  }
}