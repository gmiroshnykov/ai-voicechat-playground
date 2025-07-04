export type SipProvider = "freeswitch" | "kyivstar";

export interface SipConfig {
  provider: SipProvider;
  domain: string;
  username: string;
  password: string;
  port: number;
  proxyAddress?: string;
}

export interface DrachtioConfig {
  host: string;
  port: number;
  secret: string;
  sipPort: number;
}

export interface RtpConfig {
  portMin: number;
  portMax: number;
  localIp: string;
}

export interface AppConfig {
  sip: SipConfig;
  drachtio: DrachtioConfig;
  rtp: RtpConfig;
  environment: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

export interface EnvironmentVariables {
  SIP_PROVIDER?: string;
  SIP_DOMAIN?: string;
  SIP_USERNAME?: string;
  SIP_PASSWORD?: string;
  SIP_PORT?: string;
  SIP_PROXY?: string;
  
  DRACHTIO_HOST?: string;
  DRACHTIO_PORT?: string;
  DRACHTIO_SECRET?: string;
  DRACHTIO_SIP_PORT?: string;
  
  LOCAL_IP?: string;
  RTP_PORT_MIN?: string;
  RTP_PORT_MAX?: string;
  
  NODE_ENV?: string;
  LOG_LEVEL?: string;
}