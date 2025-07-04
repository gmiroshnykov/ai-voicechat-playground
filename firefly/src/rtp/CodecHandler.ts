import { CodecInfo, CodecType } from './types';
import { CodecError } from '../utils/errors';
import { createLogger, Logger } from '../utils/logger';

export class CodecHandler {
  private readonly logger: Logger;

  constructor() {
    this.logger = createLogger({ component: 'CodecHandler' });
  }

  public getSamplesPerFrame(codec: CodecInfo, frameDurationMs: number = 20): number {
    const codecName = codec.name.toUpperCase();
    
    switch (codecName) {
      case CodecType.OPUS:
        // OPUS at 48kHz
        return Math.floor(48000 * frameDurationMs / 1000);
      
      case CodecType.PCMU:
      case CodecType.PCMA:
        // G.711 at 8kHz
        return Math.floor(8000 * frameDurationMs / 1000);
      
      case CodecType.G722:
        // G.722 at 16kHz (but RTP clock rate is 8kHz)
        return Math.floor(8000 * frameDurationMs / 1000);
      
      default:
        // Generic calculation based on clock rate
        return Math.floor(codec.clockRate * frameDurationMs / 1000);
    }
  }

  public calculateSamplesFromPayload(codec: CodecInfo, payloadLength: number): number | null {
    const codecName = codec.name.toUpperCase();
    
    switch (codecName) {
      case CodecType.OPUS:
        // OPUS has variable bitrate, can't determine from payload alone
        return null;
      
      case CodecType.PCMU:
      case CodecType.PCMA:
        // G.711: 1 byte per sample
        return payloadLength;
      
      case CodecType.G722:
        // G.722: 1 byte per sample (even though it's 16kHz audio)
        return payloadLength;
      
      default:
        // Unknown codec, can't determine
        return null;
    }
  }

  public createSilencePayload(codec: CodecInfo, durationMs: number = 20): Buffer {
    const codecName = codec.name.toUpperCase();
    
    switch (codecName) {
      case CodecType.OPUS:
        // OPUS silence frame (minimal valid OPUS packet)
        return Buffer.from([0xf8, 0xff, 0xfe]);
      
      case CodecType.PCMU: {
        // PCMU silence: 0xFF (negative zero in μ-law)
        const samples = this.getSamplesPerFrame(codec, durationMs);
        return Buffer.alloc(samples, 0xFF);
      }
      
      case CodecType.PCMA: {
        // PCMA silence: 0xD5 (positive zero in A-law)
        const samples = this.getSamplesPerFrame(codec, durationMs);
        return Buffer.alloc(samples, 0xD5);
      }
      
      case CodecType.G722: {
        // G.722 silence
        const samples = this.getSamplesPerFrame(codec, durationMs);
        return Buffer.alloc(samples, 0x00);
      }
      
      default: {
        // Default to PCMU-style silence
        const samples = this.getSamplesPerFrame(codec, durationMs);
        this.logger.warn('Unknown codec, using default silence', { codec: codecName, samples });
        return Buffer.alloc(samples, 0xFF);
      }
    }
  }

  public isKnownCodec(codecName: string): boolean {
    const normalized = codecName.toUpperCase();
    return Object.values(CodecType).includes(normalized as CodecType);
  }

  public normalizeCodecInfo(codec: CodecInfo): CodecInfo {
    const normalized: CodecInfo = {
      ...codec,
      name: codec.name.toUpperCase()
    };

    // Add default values for known codecs
    switch (normalized.name) {
      case CodecType.OPUS:
        if (!normalized.channels) {
          normalized.channels = 2;
        }
        if (!normalized.encodingName) {
          normalized.encodingName = normalized.channels.toString();
        }
        break;
      
      case CodecType.PCMU:
      case CodecType.PCMA:
        if (!normalized.channels) {
          normalized.channels = 1;
        }
        break;
      
      case CodecType.G722:
        if (!normalized.channels) {
          normalized.channels = 1;
        }
        break;
    }

    return normalized;
  }

  public validateCodec(codec: CodecInfo): void {
    if (!codec.name) {
      throw new CodecError('Codec name is required');
    }

    if (codec.payload < 0 || codec.payload > 127) {
      throw new CodecError('Invalid payload type', { payload: codec.payload });
    }

    if (codec.clockRate <= 0) {
      throw new CodecError('Invalid clock rate', { clockRate: codec.clockRate });
    }

    if (codec.channels !== undefined && (codec.channels < 1 || codec.channels > 8)) {
      throw new CodecError('Invalid channel count', { channels: codec.channels });
    }
  }

  public getCodecDescription(codec: CodecInfo): string {
    const channels = codec.channels ? `${codec.channels}ch` : '';
    const rate = `${codec.clockRate / 1000}kHz`;
    return `${codec.name} (PT:${codec.payload}, ${rate}${channels ? ', ' + channels : ''})`;
  }
}