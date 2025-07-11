export interface CodecInfo {
  name: string;
  payload: number;
  clockRate: number;
  channels?: number;
  encodingName?: string;
}

export enum CodecType {
  OPUS = 'OPUS',
  PCMU = 'PCMU',
  PCMA = 'PCMA',
  G722 = 'G722'
}

export interface RtpPacketInfo {
  sequenceNumber: number;
  timestamp: number;
  ssrc: number;
  marker: boolean;
  payloadType: number;
  payload: Buffer;
}

export interface RtpStats {
  packetsReceived: number;
  bytesReceived: number;
  packetsSent: number;
  bytesSent: number;
  firstPacketTime?: number;
  lastPacketTime?: number;
  jitter?: number;
  packetsLost?: number;
}

export interface RtcpSenderInfo {
  ntpTimestamp: bigint;
  rtpTimestamp: number;
  packetCount: number;
  octetCount: number;
}

export enum RtpSessionState {
  INITIALIZING = 'initializing',
  ACTIVE = 'active',
  STOPPING = 'stopping',
  STOPPED = 'stopped'
}

export interface RtpSessionConfig {
  localPort: number;
  remotePort: number;
  remoteAddress: string;
  codec: CodecInfo;
  sessionId?: string;
}

export interface RtpEndpoint {
  address: string;
  port: number;
}

export interface RtpLatchingState {
  rtpLatched: boolean;
  rtcpLatched: boolean;
  expectedRemoteAddress: string;
  actualRtpEndpoint?: RtpEndpoint;
  actualRtcpEndpoint?: RtpEndpoint;
}

export interface FrameSizeDetection {
  detectedSamplesPerFrame?: number;
  lastReceivedTimestamp?: number;
  lastReceivedSeqNum?: number;
  frameSizeConfirmed: boolean;
}

export interface RecordingConfig {
  enabled: boolean;
  format: 'wav' | 'raw';
  directory: string;
  channelMode: 'mono' | 'stereo' | 'both';
  includeMetadata?: boolean;
  filenamePrefix?: string;
}

export interface TimestampedAudioChunk {
  audio: Buffer;
  rtpTimestamp: number;
  wallClockTime: number;
  direction: 'inbound' | 'outbound';
  sequenceNumber?: number;
}