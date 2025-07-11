import { WriteStream } from 'fs';
import { Logger } from '../utils/logger';

/**
 * Utility functions for WAV file operations
 * Shared between recording streams to avoid code duplication
 */

export interface WavHeaderConfig {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
}

/**
 * Create a WAV header buffer for PCM audio
 */
export function createWavHeader(config: WavHeaderConfig): Buffer {
  const { channels, sampleRate, bitsPerSample } = config;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  // WAV header structure (44 bytes)
  const header = Buffer.alloc(44);
  
  // RIFF header
  header.write('RIFF', 0);
  header.writeUInt32LE(0, 4); // File size - 8 (will be updated later)
  header.write('WAVE', 8);
  
  // fmt chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22); // Number of channels
  header.writeUInt32LE(sampleRate, 24); // Sample rate
  header.writeUInt32LE(byteRate, 28); // Byte rate
  header.writeUInt16LE(blockAlign, 32); // Block align
  header.writeUInt16LE(bitsPerSample, 34); // Bits per sample
  
  // data chunk
  header.write('data', 36);
  header.writeUInt32LE(0, 40); // Data size (will be updated later)
  
  return header;
}

/**
 * Write WAV header to stream and mark it as written
 */
export function writeWavHeaderToStream(
  stream: WriteStream,
  config: WavHeaderConfig,
  logger?: Logger
): void {
  const header = createWavHeader(config);
  stream.write(header);
  
  if (logger) {
    logger.debug('WAV header written', {
      channels: config.channels,
      sampleRate: config.sampleRate,
      bitsPerSample: config.bitsPerSample
    });
  }
}

/**
 * Update WAV header with final file and data sizes
 */
export async function finalizeWavHeader(
  filePath: string,
  audioDataSize: number,
  logger?: Logger
): Promise<void> {
  if (audioDataSize === 0) return;

  try {
    const fs = await import('fs');
    const fileHandle = await fs.promises.open(filePath, 'r+');
    
    try {
      // Update file size (total file size - 8) at offset 4
      const fileSizeBuffer = Buffer.alloc(4);
      fileSizeBuffer.writeUInt32LE(audioDataSize + 36, 0); // 44 - 8 = 36
      await fileHandle.write(fileSizeBuffer, 0, 4, 4);
      
      // Update data chunk size at offset 40
      const dataSizeBuffer = Buffer.alloc(4);
      dataSizeBuffer.writeUInt32LE(audioDataSize, 0);
      await fileHandle.write(dataSizeBuffer, 0, 4, 40);
      
      if (logger) {
        logger.debug('WAV header finalized', {
          filePath,
          totalFileSize: audioDataSize + 44,
          audioDataSize
        });
      }
    } finally {
      await fileHandle.close();
    }
  } catch (error) {
    if (logger) {
      logger.error('Failed to finalize WAV header', {
        filePath,
        error
      });
    }
    throw error;
  }
}

/**
 * WAV format constants
 */
export const WAV_CONSTANTS = {
  HEADER_SIZE: 44,
  PCM_FORMAT: 1,
  RIFF_CHUNK_SIZE_OFFSET: 4,
  DATA_CHUNK_SIZE_OFFSET: 40
} as const;