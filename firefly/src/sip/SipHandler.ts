import * as sdpTransform from 'sdp-transform';
import { SrfClient, InviteRequest, InviteResponse, Dialog, CallContext, ParsedSdp, ExtractedCodecInfo } from './types';
import { RtpManager } from '../rtp/RtpManager';
import { CodecInfo } from '../rtp/types';
import { AppConfig } from '../config/types';
import { createLogger, Logger } from '../utils/logger';

export class SipHandler {
  private readonly srf: SrfClient;
  private readonly rtpManager: RtpManager;
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly activeDialogs: Map<string, Dialog>;

  constructor(srf: SrfClient, rtpManager: RtpManager, config: AppConfig) {
    this.srf = srf;
    this.rtpManager = rtpManager;
    this.config = config;
    this.logger = createLogger({ component: 'SipHandler' });
    this.activeDialogs = new Map();
    
    // Set up INVITE handler
    this.srf.invite(this.handleInvite.bind(this));
  }

  private async handleInvite(req: InviteRequest, res: InviteResponse): Promise<void> {
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

      // Extract codec information
      const codecInfo = this.extractCodecInfo(audioMedia);
      if (!codecInfo) {
        callLogger.error('No supported codec in offer');
        res.send(488, 'Not Acceptable Here');
        return;
      }

      // Get remote RTP details
      const remoteAddr = offer.connection?.ip || offer.origin.address;
      const remotePort = audioMedia.port;

      callLogger.info('Negotiated codec', {
        codec: codecInfo.name,
        payload: codecInfo.payload,
        rate: codecInfo.clockRate
      });

      // Create RTP session
      const rtpSession = await this.rtpManager.createSession({
        remoteAddress: remoteAddr,
        remotePort: remotePort,
        codec: codecInfo,
        sessionId: callContext.callId,
        sessionType: 'echo'
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

  private extractCallContext(req: InviteRequest): CallContext {
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

  private extractCodecInfo(audioMedia: any): ExtractedCodecInfo | null {
    // Look for supported codecs in order of preference
    const supportedCodecs = ['opus', 'pcmu', 'pcma', 'g722'];
    
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
      
      // Destroy RTP session
      try {
        await this.rtpManager.destroySession(context.callId);
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
    this.logger.info('Shutting down SIP handler');
    
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