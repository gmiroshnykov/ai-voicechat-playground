// Complete type definitions for drachtio-srf
// Overrides the incomplete official types with comprehensive coverage based on source code

declare module 'drachtio-srf' {
  import { EventEmitter } from 'events';

// Request emitter interface for request method
export interface RequestEmitter extends EventEmitter {
  on(event: 'response', callback: (res: SrfResponse) => void): this;
  on(event: string, callback: (...args: any[]) => void): this;
}

// Core interfaces
export interface SrfRequest extends EventEmitter {
  method: string;
  uri: string;
  body: string;
  headers: Record<string, string | string[] | undefined>;
  source_address: string;
  source_port: number;
  get(headerName: string): string | undefined;
  getParsedHeader(headerName: string): any;
  has(headerName: string): boolean;
  on(event: 'cancel', callback: (req: SrfRequest) => void): this;
  on(event: 'update', callback: (req: SrfRequest, res: SrfResponse) => void): this;
  cancel?(options?: { headers?: Record<string, string | string[]> }): void;
  callingNumber?: string;
  callingName?: string;
  calledNumber?: string;
  // Added by drachtio-mw-registration-parser middleware
  registration?: {
    type: "unregister" | "register";
    expires: number;
    contact: Array<{ uri: string; params?: Record<string, any> }>;
    aor: string;
  };
  // Added by drachtio-mw-digest-auth middleware
  authorization?: {
    scheme: string;
    username: string;
    realm: string;
    nonce: string;
    uri: string;
    algorithm: string;
    response: string;
    qop?: string;
    nc?: string;
    cnonce?: string;
  };
}

export interface SrfResponse {
  send(code: number): void;
  send(code: number, reason: string): void;
  send(code: number, options: {
    headers?: Record<string, string | string[]>;
    body?: string;
  }): void;
  send(code: number, reason: string, options: {
    headers?: Record<string, string | string[]>;
    body?: string;
  }): void;
  get(headerName: string): string | undefined;
  headersSent: boolean;
  getParsedHeader(headerName: string): any;
  has(headerName: string): boolean;
}

export interface Dialog extends EventEmitter {
  id: string;
  sip: {
    callId: string;
    localTag: string;
    remoteTag: string;
  };
  local: {
    uri: string;
    sdp?: string;
  };
  remote: {
    uri: string;
    sdp?: string;
  };
  on(event: 'destroy', callback: () => void): this;
  on(event: 'modify', callback: (req: SrfRequest, res: SrfResponse) => void): this;
  on(event: 'ack', callback: (req?: SrfRequest) => void): this;
  on(event: 'info', callback: (req: SrfRequest, res: SrfResponse) => void): this;
  on(event: 'update', callback: (req: SrfRequest, res: SrfResponse) => void): this;
  destroy(): void;
}

// Main Srf class
export default class Srf extends EventEmitter {
  constructor(tags?: string | string[]);
  
  // Connection methods
  connect(options: { host?: string; port?: number; secret: string; }, callback?: (err: Error | null, hostport?: string) => void): this;
  listen(options: { port: number; host?: string; secret: string; }, callback?: (err: Error | null) => void): this;
  disconnect(): void;
  
  // SIP method handlers - dynamically added from sip-methods (line 1423 in srf.js)
  invite(handler: (req: SrfRequest, res: SrfResponse) => void | Promise<void>): this;
  register(handler: (req: SrfRequest, res: SrfResponse) => void | Promise<void>): this;
  options(handler: (req: SrfRequest, res: SrfResponse) => void | Promise<void>): this;
  info(handler: (req: SrfRequest, res: SrfResponse) => void | Promise<void>): this;
  message(handler: (req: SrfRequest, res: SrfResponse) => void | Promise<void>): this;
  subscribe(handler: (req: SrfRequest, res: SrfResponse) => void | Promise<void>): this;
  notify(handler: (req: SrfRequest, res: SrfResponse) => void | Promise<void>): this;
  bye(handler: (req: SrfRequest, res: SrfResponse) => void | Promise<void>): this;
  cancel(handler: (req: SrfRequest, res: SrfResponse) => void | Promise<void>): this;
  update(handler: (req: SrfRequest, res: SrfResponse) => void | Promise<void>): this;
  prack(handler: (req: SrfRequest, res: SrfResponse) => void | Promise<void>): this;
  ack(handler: (req: SrfRequest, res: SrfResponse) => void | Promise<void>): this;
  refer(handler: (req: SrfRequest, res: SrfResponse) => void | Promise<void>): this;
  publish(handler: (req: SrfRequest, res: SrfResponse) => void | Promise<void>): this;
  
  // Middleware - from delegate line 1418 in srf.js
  use(middleware: (req: SrfRequest, res: SrfResponse, next: () => void) => void): this;
  use(method: string, middleware: (req: SrfRequest, res: SrfResponse, next: () => void) => void): this;
  
  // Dialog creation methods
  createUAS(req: SrfRequest, res: SrfResponse, options: { 
    localSdp: string; 
    headers?: Record<string, string | string[]>; 
  }, callback: (err: Error | null, dialog?: Dialog) => void): this;
  createUAS(req: SrfRequest, res: SrfResponse, options: { 
    localSdp: string; 
    headers?: Record<string, string | string[]>; 
  }): Promise<Dialog>;
  
  // Request methods
  request(uri: string, options: {
    method: string;
    headers?: Record<string, string | string[]>;
    auth?: {
      username: string;
      password: string;
    };
  }): Promise<RequestEmitter>;
  
  // Event handlers
  on(event: 'connect', callback: (err: Error | null, hostport?: string) => void): this;
  on(event: 'error', callback: (err: Error) => void): this;
  on(event: string, callback: (...args: any[]) => void): this;
}

}