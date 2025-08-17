export type SipOutboundProvider = "kyivstar" | "disabled";

export interface SipOutboundConfig {
  provider: SipOutboundProvider;
  domain: string;
  username: string;
  password: string;
  port: number;
  proxyAddress?: string;
}

export interface SipInboundConfig {
  enabled: boolean;
  port: number;
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
  jitterBufferMs: number;
}

export interface OpenAIConfig {
  apiKey: string;
  enabled: boolean;
}

export interface TranscriptionConfig {
  enabled: boolean;
  model: string;
  displayToConsole: boolean;
}

export interface TestAudioConfig {
  tempoAdjustment?: {
    tempo: number; // 1.0 = normal speed, 1.2 = 20% faster, 0.8 = 20% slower
  };
}

export interface AIAudioConfig {
  tempoAdjustment?: {
    tempo: number; // 1.0 = normal speed, 1.2 = 20% faster, 0.8 = 20% slower
  };
}

export interface RecordingConfig {
  enabled: boolean;
  format: 'wav' | 'raw';
  directory: string;
  channelMode: 'mono' | 'stereo' | 'both';
  includeMetadata?: boolean;
  filenamePrefix?: string;
}

export type SessionType = 'echo' | 'chat' | 'welcome';

export interface RoutingConfig {
  defaultRoute: SessionType;
}

export interface MediaServerConfig {
  address: string;
  port: number;
  secret: string;
  enabled: boolean;
}

export const OPENAI_AGENT_NAME = 'Firefly Assistant';

export const OPENAI_AGENT_INSTRUCTIONS = `You are a helpful voice assistant connected via telephone. Start the conversation in Ukrainian, but switch to English if the caller requests it or speaks English to you.

Keep responses conversational and brief since this is a phone call. You can hang up the call when the conversation is complete by using the hang_up_call tool.

Begin by greeting the caller in Ukrainian and asking how you can help them.`;

export interface AppConfig {
  sipOutbound: SipOutboundConfig;
  sipInbound: SipInboundConfig;
  drachtio: DrachtioConfig;
  rtp: RtpConfig;
  openai: OpenAIConfig;
  transcription: TranscriptionConfig;
  testAudio: TestAudioConfig;
  aiAudio: AIAudioConfig;
  recording: RecordingConfig;
  routing: RoutingConfig;
  mediaServer: MediaServerConfig;
  environment: string;
  logLevel: "trace" | "debug" | "info" | "warn" | "error";
}

export interface EnvironmentVariables {
  SIP_OUTBOUND_PROVIDER?: string;
  SIP_OUTBOUND_DOMAIN?: string;
  SIP_OUTBOUND_USERNAME?: string;
  SIP_OUTBOUND_PASSWORD?: string;
  SIP_OUTBOUND_PORT?: string;
  SIP_OUTBOUND_PROXY?: string;
  
  SIP_INBOUND_ENABLED?: string;
  SIP_INBOUND_PORT?: string;
  
  DRACHTIO_HOST?: string;
  DRACHTIO_PORT?: string;
  DRACHTIO_SECRET?: string;
  DRACHTIO_SIP_PORT?: string;
  
  LOCAL_IP?: string;
  RTP_PORT_MIN?: string;
  RTP_PORT_MAX?: string;
  JITTER_BUFFER_MS?: string;
  
  OPENAI_API_KEY?: string;
  OPENAI_ENABLED?: string;
  OPENAI_AGENT_NAME?: string;
  OPENAI_AGENT_INSTRUCTIONS?: string;
  
  
  TRANSCRIPTION_ENABLED?: string;
  TRANSCRIPTION_MODEL?: string;
  TRANSCRIPTION_DISPLAY_TO_CONSOLE?: string;
  
  TEST_AUDIO_TEMPO?: string;
  AI_AUDIO_TEMPO?: string;
  
  RECORDING_ENABLED?: string;
  RECORDING_FORMAT?: string;
  RECORDING_DIRECTORY?: string;
  RECORDING_CHANNEL_MODE?: string;
  RECORDING_INCLUDE_METADATA?: string;
  RECORDING_FILENAME_PREFIX?: string;
  
  DEFAULT_ROUTE?: string;
  
  MEDIA_SERVER_ADDRESS?: string;
  MEDIA_SERVER_PORT?: string;
  MEDIA_SERVER_SECRET?: string;
  MEDIA_SERVER_ENABLED?: string;
  
  
  NODE_ENV?: string;
  LOG_LEVEL?: string;
}