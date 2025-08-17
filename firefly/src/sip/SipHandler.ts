import * as sdpTransform from 'sdp-transform';
import Srf, { SrfRequest, SrfResponse, Dialog } from 'drachtio-srf';
import { CallContext, ParsedSdp, ExtractedCodecInfo } from './types';
import { RtpManager } from '../rtp/RtpManager';
import { CodecInfo } from '../rtp/types';
import { AppConfig, SessionType } from '../config/types';
import { createLogger, Logger } from '../utils/logger';
import { RouteResolver } from './routing';
import { DrachtioWelcomeHandler } from './DrachtioWelcomeHandler';
import { DrachtioEchoHandler } from './DrachtioEchoHandler';
import { setTimeout as delay } from 'timers/promises';

export class SipHandler {
  private readonly srf: Srf;
  private readonly rtpManager: RtpManager;
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly activeDialogs: Map<string, Dialog>;
  private readonly routeResolver: RouteResolver;
  private readonly drachtioWelcomeHandler: DrachtioWelcomeHandler;
  private readonly drachtioEchoHandler: DrachtioEchoHandler;

  constructor(srf: Srf, rtpManager: RtpManager, config: AppConfig) {
    this.srf = srf;
    this.rtpManager = rtpManager;
    this.config = config;
    this.logger = createLogger({ component: 'SipHandler' });
    this.activeDialogs = new Map();
    this.routeResolver = new RouteResolver(config.routing.defaultRoute);
    this.drachtioWelcomeHandler = new DrachtioWelcomeHandler(this.srf, this.config);
    this.drachtioEchoHandler = new DrachtioEchoHandler(this.srf, this.config);

    // Set up INVITE handler
    this.srf.invite(this.handleInvite.bind(this));
  }

  public async initialize(): Promise<void> {
    try {
      await this.drachtioWelcomeHandler.initialize();
      await this.drachtioEchoHandler.initialize();
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

        // Let the phone ring for 3 seconds before answering
        callLogger.info('Letting phone ring for 3 seconds');
        await delay(3000);

        await this.drachtioWelcomeHandler.handleWelcomeCall(req, res, callContext.callId);
        return;
      }

      // Handle echo route with drachtio-fsmrf (with ring delay)
      if (sessionType === 'echo') {
        callLogger.info('Routing echo call to drachtio-fsmrf handler');

        // Send 180 Ringing to make the phone ring
        callLogger.info('Sending 180 Ringing response');
        res.send(180, 'Ringing');

        // Let the phone ring for 3 seconds before answering
        callLogger.info('Letting phone ring for 3 seconds');
        await delay(3000);

        await this.drachtioEchoHandler.handleEchoCall(req, res, callContext.callId);
        return;
      }

      // Check if route requires OpenAI but it's not configured
      if (this.routeResolver.requiresOpenAI(route) && !this.config.openai.enabled) {
        callLogger.error('Route requires OpenAI but it is not enabled', {
          route,
          sessionType,
          openaiEnabled: this.config.openai.enabled
        });
        res.send(503, 'Service Unavailable');
        return;
      }

      // Extract codec information based on session type
      const codecInfo = this.extractCodecInfo(audioMedia, sessionType);
      if (!codecInfo) {
        const supportedCodecs = (sessionType === 'chat') ? 'PCMA, PCMU' : 'OPUS, PCMU, PCMA, G722';
        callLogger.error('No supported codec in offer', {
          sessionType,
          supportedCodecs,
          offered: offeredCodecs
        });
        res.send(488, 'Not Acceptable Here');
        return;
      }

      callLogger.info('Codec negotiated', {
        codec: `${codecInfo.name}/${codecInfo.clockRate}`,
        sessionType
      });

      // Get remote RTP details
      const remoteAddr = offer.connection?.ip || offer.origin.address;
      const remotePort = audioMedia.port;

      // Create RTP session
      const rtpSession = await this.rtpManager.createSession({
        remoteAddress: remoteAddr,
        remotePort: remotePort,
        codec: codecInfo,
        sessionId: callContext.callId,
        sessionType,
        openaiConfig: this.config.openai,
        transcriptionConfig: this.config.transcription,
        recordingConfig: this.config.recording,
        testAudioConfig: this.config.testAudio,
        streamConfig: {
          aiTempoAdjustment: this.config.aiAudio.tempoAdjustment
        },
        caller: {
          phoneNumber: this.extractPhoneNumber(callContext.from),
          diversionHeader: callContext.diversion
        },
        onHangUpRequested: async () => {
          // First, flush any remaining packets from jitter buffer to ensure all caller audio is captured
          try {
            callLogger.debug('Flushing jitter buffer before hangup');
            this.rtpManager.flushSessionJitterBuffer(callContext.callId);
          } catch (error) {
            callLogger.error('Error flushing jitter buffer during hangup', error);
          }

          // Give time for the flushed audio to be processed
          // This ensures the complete conversation including final caller words is captured
          await delay(500);

          // Then stop the RTP session to close OpenAI connection
          try {
            await this.rtpManager.destroySession(callContext.callId);
            callLogger.debug('RTP session destroyed after AI hang up request');
          } catch (error) {
            callLogger.error('Error destroying RTP session during hang up', error);
          }

          // Finally destroy the dialog to end the call
          if (callContext.dialogId) {
            const dialog = this.activeDialogs.get(callContext.dialogId);
            if (dialog) {
              dialog.destroy();
              return;
            }
          }

          // Fallback: log that we couldn't find the dialog
          callLogger.warn('Could not find dialog to hang up call', {
            dialogId: callContext.dialogId
          });
        }
      });

      const sessionConfig = rtpSession.getConfig();

      // Build answer SDP
      const answerSdp = this.buildAnswerSdp(sessionConfig.localPort, codecInfo);

      // Create UAS dialog
      const dialog = await this.srf.createUAS(req, res, {
        localSdp: answerSdp,
        headers: {
          'Contact': `<sip:firefly@${this.config.rtp.localIp}:${this.config.drachtio.sipPort}>`,
          'Allow': 'INVITE, ACK, BYE, CANCEL, OPTIONS, MESSAGE, INFO, UPDATE',
          'Supported': 'timer'
        }
      });

      callLogger.info('Call established', {
        dialogId: dialog.id,
        localPort: sessionConfig.localPort
      });

      // Store dialog
      this.activeDialogs.set(dialog.id, dialog);
      callContext.dialogId = dialog.id;

      // Set up dialog event handlers
      this.setupDialogHandlers(dialog, callContext, callLogger);

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

  private extractPhoneNumber(sipUri: string): string {
    // Extract phone number from SIP URI like: sip:+380123456789@domain or sip:123456789@domain
    const match = sipUri.match(/sip:([^@]+)@/);
    return match?.[1] ?? 'unknown';
  }

  private extractCodecInfo(audioMedia: any, sessionType: SessionType): ExtractedCodecInfo | null {
    // Different codec support based on session type
    const supportedCodecs = (sessionType === 'chat')
      ? ['pcma', 'pcmu']  // OpenAI only supports G.711 A-law and μ-law
      : ['opus', 'pcmu', 'pcma', 'g722'];  // Echo mode supports all codecs

    // Standard payload type mappings (RFC 3551)
    const standardPayloads: { [key: number]: { codec: string, rate: number } } = {
      0: { codec: 'pcmu', rate: 8000 },     // G.711 μ-law
      8: { codec: 'pcma', rate: 8000 },     // G.711 A-law
      18: { codec: 'g729', rate: 8000 },    // G.729
      9: { codec: 'g722', rate: 8000 }      // G.722
    };

    // Check standard payload types first
    const allPayloads = audioMedia.payloads?.split(' ').map((p: string) => parseInt(p, 10)) || [];
    for (const payload of allPayloads) {
      if (standardPayloads[payload]) {
        const { codec, rate } = standardPayloads[payload];

        if (supportedCodecs.includes(codec)) {
          const codecInfo: ExtractedCodecInfo = {
            name: codec.toUpperCase(),
            payload: payload,
            clockRate: rate,
            sdpPayload: payload
          } as ExtractedCodecInfo;

          return codecInfo;
        }
      }
    }

    // Check dynamic payload types from RTP map
    for (const rtpInfo of audioMedia.rtp) {
      const codecName = rtpInfo.codec.toLowerCase();

      if (supportedCodecs.includes(codecName)) {
        const codecInfo: ExtractedCodecInfo = {
          name: codecName.toUpperCase(),
          payload: rtpInfo.payload,
          clockRate: rtpInfo.rate,
          sdpPayload: rtpInfo.payload
        } as ExtractedCodecInfo;

        // Handle codec-specific parameters
        if (codecName === 'opus' && rtpInfo.encoding) {
          codecInfo.channels = parseInt(rtpInfo.encoding, 10);
        }

        return codecInfo;
      }
    }

    return null;
  }

  private buildAnswerSdp(localPort: number, codec: CodecInfo): string {
    const answer = {
      version: 0,
      origin: {
        username: '-',
        sessionId: Date.now(),
        sessionVersion: 0,
        netType: 'IN',
        ipVer: 4,
        address: this.config.rtp.localIp
      },
      name: 'firefly',
      connection: {
        version: 4,
        ip: this.config.rtp.localIp
      },
      timing: { start: 0, stop: 0 },
      media: [{
        rtp: [{
          payload: codec.payload,
          codec: codec.name,
          rate: codec.clockRate,
          ...(codec.channels ? { encoding: codec.channels.toString() } : {})
        }],
        type: 'audio' as const,
        port: localPort,
        protocol: 'RTP/AVP',
        payloads: codec.payload.toString(),
        ptime: 20,
        sendrecv: 'sendrecv' as const
      }]
    };

    return sdpTransform.write(answer as any);
  }

  private setupDialogHandlers(dialog: Dialog, context: CallContext, logger: Logger): void {
    // Handle session refresh
    dialog.on('update', (_req, res) => {
      logger.debug('Received UPDATE request');
      res.send(200);
    });

    // Handle INFO requests
    dialog.on('info', (_req, res) => {
      logger.debug('Received INFO request');
      res.send(200);
    });

    // Handle re-INVITE
    dialog.on('modify', (req, res) => {
      logger.info('Received re-INVITE');
      // For now, just accept with same SDP
      // TODO: Handle SDP changes
      res.send(200, {
        body: req.body,
        headers: {
          'Content-Type': 'application/sdp'
        }
      });
    });

    // Log when dialog is fully established
    dialog.on('ack', () => {
      logger.debug('Dialog fully established - ACK received');
    });

    // Handle call termination
    dialog.on('destroy', async () => {
      logger.info('Call ended');

      // Destroy RTP session (if not already destroyed by hang up callback)
      try {
        const session = this.rtpManager.getSession(context.callId);
        if (session) {
          await this.rtpManager.destroySession(context.callId);
          logger.debug('RTP session destroyed on dialog destroy');
        }
      } catch (error) {
        logger.error('Error destroying RTP session', error);
      }

      // Remove from active dialogs
      if (context.dialogId) {
        this.activeDialogs.delete(context.dialogId);
      }
    });
  }

  public async shutdown(): Promise<void> {
    this.logger.debug('Shutting down SIP handler');

    // Shutdown drachtio handlers
    await this.drachtioWelcomeHandler.shutdown();
    await this.drachtioEchoHandler.shutdown();

    // Terminate all active dialogs
    for (const [dialogId, dialog] of this.activeDialogs) {
      try {
        dialog.destroy();
      } catch (error) {
        this.logger.error('Error destroying dialog', error, { dialogId });
      }
    }

    this.activeDialogs.clear();
  }

  public getActiveCallCount(): number {
    return this.activeDialogs.size;
  }
}