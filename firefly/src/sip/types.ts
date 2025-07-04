import { CodecInfo } from '../rtp/types';

export interface SipHeaders {
  [key: string]: string | string[] | undefined;
  From?: string;
  To?: string;
  'Call-ID'?: string;
  CSeq?: string;
  Via?: string | string[];
  Contact?: string;
  'Content-Type'?: string;
  'Content-Length'?: string;
  Allow?: string;
  Supported?: string;
  'User-Agent'?: string;
  Diversion?: string;
  Expires?: string;
}

export interface SdpMediaDescription {
  type: 'audio' | 'video';
  port: number;
  protocol: string;
  payloads: string;
  rtp: Array<{
    payload: number;
    codec: string;
    rate: number;
    encoding?: string;
  }>;
  ptime?: number;
  sendrecv?: 'sendrecv' | 'sendonly' | 'recvonly' | 'inactive';
  rtcpMux?: boolean;
}

export interface ParsedSdp {
  version: number;
  origin: {
    username: string;
    sessionId: number | string;
    sessionVersion: number;
    netType: string;
    ipVer: number;
    address: string;
  };
  name: string;
  connection?: {
    version: number;
    ip: string;
  };
  timing: {
    start: number;
    stop: number;
  };
  media: SdpMediaDescription[];
}

export interface CallContext {
  callId: string;
  from: string;
  to: string;
  diversion?: string;
  dialogId?: string;
}

export interface InviteRequest {
  headers: SipHeaders;
  body: string;
  method: string;
  uri: string;
  get(header: string): string | undefined;
  getParsedHeader(header: string): any;
  source_address: string;
  source_port: number;
}

export interface InviteResponse {
  send(code: number, reason?: string, options?: ResponseOptions): void;
}

export interface ResponseOptions {
  headers?: SipHeaders;
  body?: string;
}

export interface Dialog {
  id: string;
  sip: {
    callId: string;
    localTag: string;
    remoteTag: string;
  };
  on(event: 'destroy' | 'modify' | 'ack' | 'info' | 'update', handler: (req?: any, res?: any) => void): void;
  destroy(): void;
}

export interface RequestOptions {
  uri: string;
  method: string;
  headers: SipHeaders;
  auth?: {
    username: string;
    password: string;
  };
}

export interface RegistrationOptions extends RequestOptions {
  method: 'REGISTER';
}

export interface RegistrationResponse {
  status: number;
  reason: string;
  headers: SipHeaders;
  get(header: string): string | undefined;
}

export interface SrfClient {
  connect(options: SrfConnectOptions): void;
  on(event: 'connect' | 'error', handler: (err?: Error, hostport?: string) => void): void;
  invite(handler: (req: InviteRequest, res: InviteResponse) => void | Promise<void>): void;
  request(uri: string, options: RequestOptions): Promise<RequestEmitter>;
  createUAS(req: InviteRequest, res: InviteResponse, options: UasOptions): Promise<Dialog>;
  disconnect(): void;
}

export interface SrfConnectOptions {
  host: string;
  port: number;
  secret: string;
}

export interface UasOptions {
  localSdp: string;
  headers?: SipHeaders;
}

export interface RequestEmitter {
  on(event: 'response', handler: (res: RegistrationResponse) => void): void;
}

export interface SipRegistrationState {
  isRegistered: boolean;
  lastRegistrationTime?: Date;
  nextRegistrationTime?: Date;
  registrationExpires?: number;
  failureCount: number;
}

export interface ExtractedCodecInfo extends CodecInfo {
  sdpPayload: number;
  fmtp?: string;
}