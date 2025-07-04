// Type definitions for external libraries without TypeScript support

declare module 'drachtio-srf' {
  import { EventEmitter } from 'events';

  export interface ConnectOptions {
    host: string;
    port: number;
    secret: string;
  }

  export interface RequestOptions {
    method: string;
    headers: Record<string, string | string[] | undefined>;
    auth?: {
      username: string;
      password: string;
    };
  }

  export interface Request {
    method: string;
    uri: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
    get(header: string): string | undefined;
    getParsedHeader(header: string): any;
    source_address: string;
    source_port: number;
  }

  export interface Response {
    send(code: number, reason?: string, options?: any): void;
  }

  export interface Dialog {
    id: string;
    sip: {
      callId: string;
      localTag: string;
      remoteTag: string;
    };
    on(event: string, handler: (...args: any[]) => void): void;
    destroy(): void;
  }

  export interface UasOptions {
    localSdp: string;
    headers?: Record<string, string | string[] | undefined>;
  }

  export interface RequestEmitter extends EventEmitter {
    on(event: 'response', handler: (res: any) => void): void;
  }

  class Srf extends EventEmitter {
    connect(options: ConnectOptions): void;
    on(event: 'connect', handler: (err: Error | null, hostport: string) => void): void;
    on(event: 'error', handler: (err: Error) => void): void;
    invite(handler: (req: Request, res: Response) => void | Promise<void>): void;
    request(uri: string, options: RequestOptions): Promise<RequestEmitter>;
    createUAS(req: Request, res: Response, options: UasOptions): Promise<Dialog>;
    disconnect(): void;
  }

  export = Srf;
}

