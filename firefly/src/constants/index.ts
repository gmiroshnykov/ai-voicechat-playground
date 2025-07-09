/**
 * Audio codec silence values
 * These represent the digital silence values for different audio codecs
 */
export const CODEC_SILENCE_VALUES = {
  /** PCMU (μ-law) silence value - represents negative zero in μ-law encoding */
  PCMU: 0xFF,
  /** PCMA (A-law) silence value - represents positive zero in A-law encoding */
  PCMA: 0xD5,
  /** G.722 silence value */
  G722: 0x00,
  /** Default silence value (PCMU-style) */
  DEFAULT: 0xFF,
} as const;

/**
 * RTP protocol constants
 * These values are defined by RTP specification (RFC 3550)
 */
export const RTP_CONSTANTS = {
  /** Maximum SSRC value (32-bit unsigned integer) */
  MAX_SSRC: 0xFFFFFFFF,
  /** Maximum RTP sequence number (16-bit) */
  MAX_SEQUENCE: 0xFFFF,
  /** Maximum RTP timestamp value (32-bit unsigned integer) */
  MAX_TIMESTAMP: 0xFFFFFFFF,
  /** Sequence number wraparound mask (65536) */
  SEQUENCE_WRAPAROUND: 0x10000,
  /** Timestamp wraparound mask (2^32) */
  TIMESTAMP_WRAPAROUND: 0x100000000,
  /** RTP version bits mask */
  VERSION_MASK: 0x3,
  /** Bit shift for RTP version extraction */
  VERSION_SHIFT: 6,
  /** Half of 16-bit range for sequence number wraparound comparison */
  SEQUENCE_HALF_RANGE: 32768,
} as const;

/**
 * Audio processing constants
 * Standard values for audio frame processing and timing
 */
export const AUDIO_CONSTANTS = {
  /** Standard G.711 frame size in bytes (20ms at 8kHz) */
  G711_FRAME_SIZE: 160,
  /** Stereo frame size (G.711 frame size * 2 channels) */
  STEREO_FRAME_SIZE: 320,
  /** G.711 sample rate in Hz */
  G711_SAMPLE_RATE: 8000,
  /** OPUS sample rate in Hz */
  OPUS_SAMPLE_RATE: 48000,
  /** Default frame duration in milliseconds */
  DEFAULT_FRAME_DURATION: 20,
  /** G.711 samples per millisecond at 8kHz */
  G711_SAMPLES_PER_MS: 8,
  /** Default OPUS channel count */
  OPUS_CHANNELS: 2,
  /** Default G.711 channel count */
  G711_CHANNELS: 1,
  /** Default G.722 channel count */
  G722_CHANNELS: 1,
} as const;

/**
 * WAV file format constants
 * Standard values for WAV file headers and format codes
 */
export const WAV_CONSTANTS = {
  /** WAV header size in bytes */
  HEADER_SIZE: 44,
  /** WAV format code for A-law */
  FORMAT_ALAW: 6,
  /** WAV format code for μ-law */
  FORMAT_MULAW: 7,
  /** Number of channels for stereo WAV */
  STEREO_CHANNELS: 2,
  /** Sample rate for WAV files */
  SAMPLE_RATE: 8000,
  /** Byte rate for stereo WAV (8000 Hz * 2 channels) */
  BYTE_RATE: 16000,
  /** Block align for WAV */
  BLOCK_ALIGN: 2,
  /** Bits per sample for WAV */
  BITS_PER_SAMPLE: 8,
} as const;

/**
 * RTCP constants
 * Real-time Transport Control Protocol constants
 */
export const RTCP_CONSTANTS = {
  /** NTP epoch offset in milliseconds (from 1900-01-01 to 1970-01-01) */
  NTP_EPOCH_OFFSET: 2208988800000,
  /** Maximum NTP fraction value */
  MAX_NTP_FRACTION: 0xFFFFFFFF,
} as const;

/**
 * SIP payload type constants
 * Standard RTP payload types for different codecs
 */
export const SIP_PAYLOAD_TYPES = {
  /** PCMU payload type */
  PCMU: 0,
  /** PCMA payload type */
  PCMA: 8,
  /** G.722 payload type */
  G722: 9,
  /** G.729 payload type */
  G729: 18,
} as const;

/**
 * Buffer and timing constants
 * Various buffer sizes and timing values used throughout the system
 */
export const BUFFER_CONSTANTS = {
  /** Pre-silence duration in milliseconds */
  PRE_SILENCE_DURATION: 1000,
  /** Post-silence duration in milliseconds */
  POST_SILENCE_DURATION: 1000,
  /** Number of initial silence packets */
  INITIAL_SILENCE_PACKETS: 5,
  /** Interval between silence packets in milliseconds */
  SILENCE_PACKET_INTERVAL: 20,
  /** Recent sequence number window size */
  RECENT_SEQUENCE_WINDOW: 100,
  /** Minimum frame size for sanity check */
  MIN_FRAME_SIZE: 80,
  /** Maximum frame size for sanity check */
  MAX_FRAME_SIZE: 1920,
  /** Number of buffer priming packets */
  BUFFER_PRIMING_PACKETS: 3,
  /** Delay before hang up in milliseconds */
  HANGUP_DELAY: 200,
} as const;

/**
 * OPUS-specific constants
 * Constants for OPUS codec handling
 */
export const OPUS_CONSTANTS = {
  /** Minimal valid OPUS packet (silence frame) */
  SILENCE_FRAME: new Uint8Array([0xf8, 0xff, 0xfe]),
} as const;

/**
 * Validation constants
 * Constants for codec and parameter validation
 */
export const VALIDATION_CONSTANTS = {
  /** Maximum RTP payload type */
  MAX_PAYLOAD_TYPE: 127,
  /** Minimum channel count */
  MIN_CHANNELS: 1,
  /** Maximum channel count */
  MAX_CHANNELS: 8,
} as const;