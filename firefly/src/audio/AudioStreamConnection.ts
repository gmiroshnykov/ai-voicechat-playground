import { readFileSync } from 'fs';
import { Logger } from '../utils/logger';
import type WebSocket from 'ws';

/**
 * Handles a single WebSocket connection from FreeSWITCH for audio streaming.
 * Manages the lifecycle of streaming audio data for one call.
 */
export class AudioStreamConnection {
  private static readonly FRAME_SIZE = 160; // 20ms @ 8kHz
  private static readonly FRAME_DURATION_MS = 20;

  constructor(
    private readonly ws: WebSocket,
    private readonly logger: Logger
  ) {
    this.setupWebSocketEvents();
  }

  private setupWebSocketEvents(): void {
    this.ws.on('close', () => {
      this.logger.debug('WebSocket connection closed');
    });

    this.ws.on('error', (error: Error) => {
      this.logger.error('WebSocket error', { error });
    });
  }

  /**
   * Stream silence for specified duration to FreeSWITCH via WebSocket
   * This function blocks for the full silence duration
   */
  async streamSilence(durationMs: number): Promise<void> {
    this.logger.info('Starting silence stream', { durationMs });

    // Calculate number of frames for the duration (20ms per frame)
    const frameCount = Math.ceil(durationMs / AudioStreamConnection.FRAME_DURATION_MS);

    // Create a silence frame (320 bytes of zeros for 160 samples * 2 bytes)
    const silenceFrame = Buffer.alloc(AudioStreamConnection.FRAME_SIZE * 2);

    this.logger.debug('Streaming silence frames', {
      durationMs,
      frameCount,
      frameSize: AudioStreamConnection.FRAME_SIZE
    });

    // Track time spent sending silence frames
    const sendingStartTime = Date.now();

    for (let i = 0; i < frameCount; i++) {
      if (this.ws.readyState !== 1) { // Not open
        this.logger.warn('WebSocket closed during silence streaming');
        break;
      }

      // Send silence frame (all zeros)
      this.ws.send(silenceFrame);

      // Let FreeSWITCH handle pacing - send frames faster and let it buffer
      await this.sleep(5); // Small delay to prevent overwhelming WebSocket
    }

    const sendingEndTime = Date.now();
    const sendingDurationMs = sendingEndTime - sendingStartTime;
    const remainingPlaybackMs = Math.max(0, durationMs - sendingDurationMs);

    this.logger.debug('Silence frame sending completed, waiting for playback to finish', {
      sendingDurationMs,
      remainingPlaybackMs,
      totalDurationMs: durationMs
    });

    // Wait for the remaining playback duration
    if (remainingPlaybackMs > 0) {
      await this.sleep(remainingPlaybackMs);
    }

    this.logger.info('Silence stream completed');
  }

  /**
   * Stream audio file to FreeSWITCH via WebSocket
   */
  async streamAudio(audioFilePath: string): Promise<void> {
    this.logger.info('Starting audio stream', { audioFilePath });

    // Load and convert audio file
    const pcmData = await this.loadAndConvertAudio(audioFilePath);

    // Calculate actual playback duration (8kHz, 16-bit, mono)
    const durationMs = (pcmData.length / (8000 * 2)) * 1000;
    this.logger.debug('Calculated audio duration', {
      totalBytes: pcmData.length,
      durationMs: Math.round(durationMs)
    });

    // Track time spent sending frames
    const sendingStartTime = Date.now();

    // Split into frames and stream
    await this.streamPCMData(pcmData);

    const sendingEndTime = Date.now();
    const sendingDurationMs = sendingEndTime - sendingStartTime;
    const remainingPlaybackMs = Math.max(0, durationMs - sendingDurationMs);

    this.logger.info('Frame sending completed, waiting for playback to finish', {
      sendingDurationMs,
      remainingPlaybackMs,
      totalDurationMs: Math.round(durationMs)
    });

    // Wait for the remaining playback duration
    if (remainingPlaybackMs > 0) {
      await this.sleep(remainingPlaybackMs);
    }

    this.logger.info('Audio streaming completed');
  }

  /**
   * Load pre-converted PCM audio file (8kHz, 16-bit, mono)
   */
  private async loadAndConvertAudio(audioFilePath: string): Promise<Buffer> {
    this.logger.debug('Loading PCM audio file', { audioFilePath });

    if (!audioFilePath.endsWith('.pcm')) {
      throw new Error(`Only .pcm files supported. Got: ${audioFilePath}`);
    }

    return readFileSync(audioFilePath);
  }



  /**
   * Stream PCM data as frames to FreeSWITCH mod_audio_fork
   * mod_audio_fork expects L16 format (Linear 16-bit PCM, signed, little-endian)
   */
  private async streamPCMData(pcmData: Buffer): Promise<void> {
    const frameCount = Math.ceil(pcmData.length / (AudioStreamConnection.FRAME_SIZE * 2));

    this.logger.debug('Streaming L16 PCM frames to mod_audio_fork', {
      totalBytes: pcmData.length,
      frameCount,
      frameSize: AudioStreamConnection.FRAME_SIZE,
      format: 'L16 (Linear 16-bit PCM, signed, little-endian)'
    });

    for (let i = 0; i < frameCount; i++) {
      if (this.ws.readyState !== 1) { // Not open
        this.logger.warn('WebSocket closed during streaming');
        break;
      }

      const start = i * AudioStreamConnection.FRAME_SIZE * 2;
      const end = Math.min(start + (AudioStreamConnection.FRAME_SIZE * 2), pcmData.length);
      const frame = pcmData.subarray(start, end);

      // Send L16 PCM data - mod_audio_fork expects exactly 320 bytes (160 samples * 2 bytes)
      // The PCM data should already be in the correct L16 format (signed 16-bit little-endian)
      if (frame.length < AudioStreamConnection.FRAME_SIZE * 2) {
        const paddedFrame = Buffer.alloc(AudioStreamConnection.FRAME_SIZE * 2);
        frame.copy(paddedFrame);
        // Fill remaining bytes with silence (zeros)
        paddedFrame.fill(0, frame.length);
        this.ws.send(paddedFrame);
      } else {
        this.ws.send(frame);
      }

      // Let FreeSWITCH handle pacing - send frames faster and let it buffer
      // Use a smaller delay to prevent overwhelming the WebSocket while letting FreeSWITCH pace
      await this.sleep(5); // Small delay to prevent overwhelming WebSocket
    }

    this.logger.debug('Finished streaming all L16 PCM frames');
  }

  /**
   * Close the WebSocket connection
   */
  close(): void {
    try {
      if (this.ws.readyState === 1) { // Open
        this.ws.close();
      }
    } catch (error) {
      this.logger.error('Error closing WebSocket', { error });
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}