import { CodecInfo, CodecType } from './types';

/**
 * Utility functions for audio codec conversion
 * Shared between recording streams to avoid code duplication
 */

/**
 * Get the bits per sample for a given codec when converted to PCM
 */
export function getBitsPerSample(codecName: string): number {
  // All codecs are converted to 16-bit PCM for WAV output
  switch (codecName) {
    case CodecType.PCMU:
    case CodecType.PCMA:
      return 16; // G.711 converted to 16-bit PCM
    case CodecType.G722:
      return 16; // G.722 uses 16 bits per sample
    case CodecType.OPUS:
      return 16; // OPUS typically decoded to 16 bits
    default:
      return 16; // Default to 16 bits
  }
}

/**
 * Convert codec-specific audio data to PCM for WAV recording
 */
export function convertAudioData(audioBuffer: Buffer, codec: CodecInfo): Buffer {
  switch (codec.name) {
    case CodecType.PCMU:
      return convertPCMUToPCM(audioBuffer);
    case CodecType.PCMA:
      return convertPCMAToPCM(audioBuffer);
    case CodecType.G722:
    case CodecType.OPUS:
      // For G.722 and OPUS, assume they're already decoded to PCM
      return audioBuffer;
    default:
      return audioBuffer;
  }
}

/**
 * Convert G.711 μ-law encoded buffer to 16-bit PCM
 */
export function convertPCMUToPCM(pcmuBuffer: Buffer): Buffer {
  const pcmBuffer = Buffer.alloc(pcmuBuffer.length * 2);
  for (let i = 0; i < pcmuBuffer.length; i++) {
    const byte = pcmuBuffer[i];
    if (byte !== undefined) {
      const sample = ulaw2linear(byte);
      pcmBuffer.writeInt16LE(sample, i * 2);
    }
  }
  return pcmBuffer;
}

/**
 * Convert G.711 A-law encoded buffer to 16-bit PCM
 */
export function convertPCMAToPCM(pcmaBuffer: Buffer): Buffer {
  const pcmBuffer = Buffer.alloc(pcmaBuffer.length * 2);
  for (let i = 0; i < pcmaBuffer.length; i++) {
    const byte = pcmaBuffer[i];
    if (byte !== undefined) {
      const sample = alaw2linear(byte);
      pcmBuffer.writeInt16LE(sample, i * 2);
    }
  }
  return pcmBuffer;
}

/**
 * Convert single μ-law sample to linear PCM sample
 */
export function ulaw2linear(ulaw: number): number {
  // G.711 μ-law to linear PCM conversion
  const BIAS = 0x84;
  const CLIP = 8159;
  
  ulaw = ~ulaw;
  const sign = (ulaw & 0x80) ? -1 : 1;
  const exponent = (ulaw >> 4) & 0x07;
  const mantissa = ulaw & 0x0F;
  
  let sample = mantissa * 2 + 33;
  sample = sample << (exponent + 2);
  sample -= BIAS;
  
  return sign * Math.min(sample, CLIP);
}

/**
 * Convert single A-law sample to linear PCM sample
 */
export function alaw2linear(alaw: number): number {
  // G.711 A-law to linear PCM conversion
  // First invert even bits (A-law uses XOR with 0x55)
  alaw ^= 0x55;
  
  const sign = (alaw & 0x80) ? -1 : 1;
  const exponent = (alaw >> 4) & 0x07;
  const mantissa = alaw & 0x0F;
  
  let sample = mantissa * 2 + 1;
  if (exponent > 0) {
    sample += 32;
    sample = sample << (exponent - 1);
  }
  
  return sign * sample * 8; // Better scaling for 16-bit PCM range
}