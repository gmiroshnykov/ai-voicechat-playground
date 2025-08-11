declare module 'drachtio-modesl' {
  import { EventEmitter } from 'events';
  
  export class Connection extends EventEmitter {
    constructor(host: string, port: number, auth: string, callback?: () => void);
    getInfo(): {
      getHeader(name: string): string | undefined;
    };
    subscribe(events: string): void;
    filter(header: string, value: string): void;
    filterDelete(header: string, value?: string): void;
    api(command: string, callback: (res: any) => void): void;
    execute(app: string, arg?: string, callback?: (res: any) => void): void;
    disconnect(): void;
    removeAllListeners(): void;
    on(event: string, callback: (...args: any[]) => void): this;
    get socket(): { remoteAddress: string };
  }
  
  export class Server extends EventEmitter {
    constructor(options: { server: any; myevents: boolean }, callback: () => void);
    on(event: 'connection::ready' | 'connection::close', callback: (conn: Connection) => void): this;
    close(): void;
  }
}

declare module 'drachtio-fsmrf' {
  import { EventEmitter } from 'events';
  import Srf, { SrfRequest, SrfResponse, Dialog } from 'drachtio-srf';
  import { Connection } from 'drachtio-modesl';

  // Core Options Interfaces
  export interface ConnectOptions {
    address: string;
    port?: number;
    secret?: string;
    listenPort?: number;
    listenAddress?: string;
    advertisedAddress?: string;
    advertisedPort?: number;
    profile?: string;
  }

  export interface CreateOptions {
    debugDir?: string;
    sendonly?: boolean;
    customEvents?: string[];
  }

  export interface EndpointOptions {
    remoteSdp?: string;
    codecs?: string | string[];
    headers?: Record<string, string | string[]>;
    family?: 4 | 6 | 'ipv4' | 'ipv6';
    is3pcc?: boolean;
    customEvents?: string[];
  }

  export interface ConferenceOptions {
    name?: string;
    profile?: string;
    endConferenceOnExit?: boolean;
    enterSound?: string | boolean;
    exitSound?: string | boolean;
    maxMembers?: number;
    startConferenceOnEnter?: boolean;
    waitSound?: string | boolean;
    flags?: string[];
  }

  export interface RecordingOptions {
    path: string;
    format?: 'wav' | 'mp3' | 'flac';
    sampleRate?: number;
    channels?: number;
    mix?: boolean;
    terminators?: string;
    maxDuration?: number;
    playBeep?: boolean;
    bridgedMedia?: boolean;
  }

  export interface PlaybackOptions {
    earlyMedia?: boolean;
    terminators?: string;
    seekOffset?: number;
    fadein?: boolean;
    fadeout?: boolean;
    loops?: number;
  }

  export interface GatherOptions {
    min?: number;
    max?: number;
    tries?: number;
    timeout?: number;
    terminators?: string;
    regexp?: string;
    digitTimeout?: number;
    interDigitTimeout?: number;
    invalidFile?: string;
    prompt?: string;
  }

  export interface TtsOptions {
    voice?: string;
    engine?: string;
    rate?: number;
    gender?: 'male' | 'female';
    sayAs?: 'number' | 'date' | 'currency' | 'time' | 'spell';
  }

  // Event and Result Interfaces
  export interface ExecuteEvent {
    getHeader(name: string): string | undefined;
    getBody(): string;
    serialize(format?: 'plain' | 'json' | 'xml'): string;
    addHeader(name: string, value: string): void;
    delHeader(name: string): void;
  }

  export interface ConferenceEvent extends ExecuteEvent {
    'Conference-Name': string;
    'Member-ID': string;
    'Conference-Size': string;
    Action: string;
  }

  export interface DtmfEvent extends ExecuteEvent {
    'DTMF-Digit': string;
    'DTMF-Duration': string;
    'DTMF-Source': string;
  }

  export interface NetworkConnection {
    mediaIp?: string;
    mediaPort?: number;
    sdp?: string;
  }

  export interface SipInfo {
    callId?: string;
    localTag?: string;
    remoteTag?: string;
  }

  export interface ConferenceInfo {
    name?: string;
    memberId?: number;
  }

  export interface MediaCapabilities {
    ipv4?: {
      udp?: { address?: string };
      dtls?: { address?: string };
    };
    ipv6?: {
      udp?: { address?: string };
      dtls?: { address?: string };
    };
  }

  // Core Classes
  export class Endpoint extends EventEmitter {
    uuid: string;
    secure: boolean;
    local: NetworkConnection;
    remote: NetworkConnection;
    sip: SipInfo;
    conf: ConferenceInfo;
    connected: boolean;
    muted: boolean;
    dtmfType?: string;
    
    constructor(conn: Connection, dialog: Dialog, ms: MediaServer, opts?: EndpointOptions);
    
    // Core lifecycle methods
    destroy(): void;
    
    // Media control methods - callback versions
    execute(app: string, callback: (err: Error | null, evt?: ExecuteEvent) => void): void;
    execute(app: string, arg: string, callback: (err: Error | null, evt?: ExecuteEvent) => void): void;
    
    // Media control methods - promise versions  
    execute(app: string): Promise<ExecuteEvent>;
    execute(app: string, arg: string): Promise<ExecuteEvent>;
    
    // Convenience methods - callback versions
    play(file: string | string[], options?: PlaybackOptions, callback?: (err: Error | null, evt?: ExecuteEvent) => void): void;
    say(text: string, options?: TtsOptions, callback?: (err: Error | null, evt?: ExecuteEvent) => void): void;
    record(options: RecordingOptions, callback?: (err: Error | null, evt?: ExecuteEvent) => void): void;
    gather(options?: GatherOptions, callback?: (err: Error | null, results?: any) => void): void;
    bridge(other: Endpoint | string, callback?: (err: Error | null) => void): void;
    unbridge(other?: Endpoint | string, callback?: (err: Error | null) => void): void;
    park(callback?: (err: Error | null) => void): void;
    hangup(cause?: string, callback?: (err: Error | null) => void): void;
    
    // Convenience methods - promise versions
    play(file: string | string[], options?: PlaybackOptions): Promise<ExecuteEvent>;
    say(text: string, options?: TtsOptions): Promise<ExecuteEvent>;
    record(options: RecordingOptions): Promise<ExecuteEvent>;
    gather(options?: GatherOptions): Promise<any>;
    bridge(other: Endpoint | string): Promise<void>;
    unbridge(other?: Endpoint | string): Promise<void>;
    park(): Promise<void>;
    hangup(cause?: string): Promise<void>;
    
    // Conference methods - callback versions
    join(conference: Conference | string, options?: ConferenceOptions, callback?: (err: Error | null, evt?: ExecuteEvent) => void): void;
    leave(callback?: (err: Error | null) => void): void;
    
    // Conference methods - promise versions
    join(conference: Conference | string, options?: ConferenceOptions): Promise<ExecuteEvent>;
    leave(): Promise<void>;
    
    // Audio control methods - callback versions
    mute(callback?: (err: Error | null) => void): void;
    unmute(callback?: (err: Error | null) => void): void;
    setVolume(level: number, callback?: (err: Error | null) => void): void;
    
    // Audio control methods - promise versions  
    mute(): Promise<void>;
    unmute(): Promise<void>;
    setVolume(level: number): Promise<void>;
    
    // Parameter methods - callback versions
    set(param: string | Record<string, any>, value?: any, callback?: (err: Error | null, evt?: ExecuteEvent) => void): void;
    export(param: string | Record<string, any>, value?: any, callback?: (err: Error | null, evt?: ExecuteEvent) => void): void;
    
    // Parameter methods - promise versions
    set(param: string | Record<string, any>, value?: any): Promise<ExecuteEvent>;
    export(param: string | Record<string, any>, value?: any): Promise<ExecuteEvent>;
    
    // ESL connection methods
    filter(header: string, value: string): void;
    filterDelete(header: string, value?: string): void;
    
    // Utility methods
    resetCustomEventListeners(): void;
    
    // Properties
    get mediaserver(): MediaServer;
    get srf(): Srf;
    get conn(): Connection;
    get dialog(): Dialog;
    
    // Event handlers
    on(event: 'destroy', callback: () => void): this;
    on(event: 'hangup', callback: (evt: ExecuteEvent) => void): this;
    on(event: 'dtmf', callback: (evt: DtmfEvent) => void): this;
    on(event: 'playback-start', callback: (evt: ExecuteEvent) => void): this;
    on(event: 'playback-stop', callback: (evt: ExecuteEvent) => void): this;
    on(event: 'tone-detect', callback: (evt: ExecuteEvent) => void): this;
    on(event: string, callback: (...args: any[]) => void): this;
  }

  export class Conference extends EventEmitter {
    name: string;
    profile: string;
    memberId?: number;
    
    constructor(mediaserver: MediaServer, name: string, opts?: ConferenceOptions);
    
    // Core lifecycle
    destroy(callback?: (err: Error | null) => void): void;
    destroy(): Promise<void>;
    
    // Member management - callback versions
    getMember(memberId: number, callback: (err: Error | null, member?: any) => void): void;
    getMembers(callback: (err: Error | null, members?: any[]) => void): void;
    kick(memberId: number, callback?: (err: Error | null) => void): void;
    
    // Member management - promise versions
    getMember(memberId: number): Promise<any>;
    getMembers(): Promise<any[]>;
    kick(memberId: number): Promise<void>;
    
    // Audio control - callback versions  
    mute(memberId: number, callback?: (err: Error | null) => void): void;
    unmute(memberId: number, callback?: (err: Error | null) => void): void;
    muteMember(memberId: number, callback?: (err: Error | null) => void): void;
    unmuteMember(memberId: number, callback?: (err: Error | null) => void): void;
    deaf(memberId: number, callback?: (err: Error | null) => void): void;
    undeaf(memberId: number, callback?: (err: Error | null) => void): void;
    
    // Audio control - promise versions
    mute(memberId: number): Promise<void>;
    unmute(memberId: number): Promise<void>;
    muteMember(memberId: number): Promise<void>;
    unmuteMember(memberId: number): Promise<void>;
    deaf(memberId: number): Promise<void>;
    undeaf(memberId: number): Promise<void>;
    
    // Conference-wide audio - callback versions
    play(file: string | string[], options?: PlaybackOptions, callback?: (err: Error | null) => void): void;
    say(text: string, options?: TtsOptions, callback?: (err: Error | null) => void): void;
    record(options: RecordingOptions, callback?: (err: Error | null) => void): void;
    
    // Conference-wide audio - promise versions
    play(file: string | string[], options?: PlaybackOptions): Promise<void>;
    say(text: string, options?: TtsOptions): Promise<void>;
    record(options: RecordingOptions): Promise<void>;
    
    // Properties
    get mediaserver(): MediaServer;
    get srf(): Srf;
    get conn(): Connection;
    
    // Event handlers
    on(event: 'join', callback: (evt: ConferenceEvent) => void): this;
    on(event: 'leave', callback: (evt: ConferenceEvent) => void): this;
    on(event: 'start-talking', callback: (evt: ConferenceEvent) => void): this;
    on(event: 'stop-talking', callback: (evt: ConferenceEvent) => void): this;
    on(event: 'destroy', callback: () => void): this;
    on(event: string, callback: (...args: any[]) => void): this;
  }

  export class MediaServer extends EventEmitter {
    maxSessions: number;
    currentSessions: number;
    cps: number;
    sip: MediaCapabilities;
    listenAddress: string;
    listenPort: number;
    advertisedAddress: string;
    advertisedPort: number;
    
    constructor(conn: Connection, mrf: Mrf, listenAddress: string, listenPort: number, 
                advertisedAddress?: string, advertisedPort?: number, profile?: string);
    
    // Connection management
    disconnect(): void;
    destroy(): void;
    
    // Capability checking
    hasCapability(capability: string | string[]): boolean;
    
    // Endpoint creation - callback versions
    createEndpoint(options?: EndpointOptions, callback?: (err: Error | null, endpoint?: Endpoint) => void): void;
    connectCaller(req: SrfRequest, res: SrfResponse, callback: (err: Error | null, result?: { endpoint: Endpoint; dialog: Dialog }) => void): void;
    connectCaller(req: SrfRequest, res: SrfResponse, options: EndpointOptions, callback: (err: Error | null, result?: { endpoint: Endpoint; dialog: Dialog }) => void): void;
    
    // Endpoint creation - promise versions
    createEndpoint(options?: EndpointOptions): Promise<Endpoint>;
    connectCaller(req: SrfRequest, res: SrfResponse, options?: EndpointOptions): Promise<{ endpoint: Endpoint; dialog: Dialog }>;
    
    // Conference creation - callback versions
    createConference(name: string, options?: ConferenceOptions, callback?: (err: Error | null, conference?: Conference) => void): void;
    
    // Conference creation - promise versions
    createConference(name: string, options?: ConferenceOptions): Promise<Conference>;
    
    // Properties and getters
    get address(): string;
    get conn(): Connection;
    get srf(): Srf;
    
    // Event handlers
    on(event: 'connect', callback: () => void): this;
    on(event: 'ready', callback: () => void): this;
    on(event: 'error', callback: (err: Error) => void): this;
    on(event: 'end', callback: () => void): this;
    on(event: string, callback: (...args: any[]) => void): this;
  }

  class Mrf extends EventEmitter {
    srf: Srf;
    debugDir?: string;
    debugSendonly?: boolean;
    localAddresses: string[];
    customEvents: string[];
    
    constructor(srf: Srf, options?: CreateOptions);
    
    // Connection methods - callback version
    connect(options: ConnectOptions, callback: (err: Error | null, mediaServer?: MediaServer) => void): void;
    
    // Connection methods - promise version
    connect(options: ConnectOptions): Promise<MediaServer>;
    
    // Utility methods
    static get utils(): {
      parseBodyText(body: string): Record<string, any>;
    };
  }

  export default Mrf;
}