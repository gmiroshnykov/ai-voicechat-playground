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
  /** Default sample rate (same as G.711) */
  SAMPLE_RATE: 8000,
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

