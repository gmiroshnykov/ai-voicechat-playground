import { RealtimeAgent, RealtimeSession, tool } from '@openai/agents/realtime';
import { EventEmitter } from 'events';
import { createLogger, Logger } from '../utils/logger';
import { OPENAI_AGENT_INSTRUCTIONS, OPENAI_AGENT_NAME, TranscriptionConfig } from '../config/types';
import { TranscriptionManager } from './TranscriptionManager';
import type WebSocket from 'ws';

export interface OpenAIBridgeConfig {
  openaiApiKey: string;
  codec: 'PCMA' | 'PCMU';
  callId: string;
  caller?: {
    phoneNumber?: string;
    diversionHeader?: string;
  };
  transcription: TranscriptionConfig;
  onHangUpRequested?: () => Promise<void>;
}

/**
 * Bridges WebSocket audio between FreeSWITCH and OpenAI Realtime API
 * Handles G.711 8kHz audio passthrough without resampling
 */
export class OpenAIBridgeConnection extends EventEmitter {
  private readonly ws: WebSocket;
  private readonly config: OpenAIBridgeConfig;
  private readonly logger: Logger;
  private readonly transcriptionManager: TranscriptionManager;

  private realtimeAgent?: RealtimeAgent;
  private realtimeSession?: RealtimeSession;
  private isConnectedToOpenAI = false;

  constructor(ws: WebSocket, config: OpenAIBridgeConfig) {
    super();
    this.ws = ws;
    this.config = config;
    this.logger = createLogger({
      component: 'OpenAIBridgeConnection',
      callId: config.callId
    });
    this.transcriptionManager = new TranscriptionManager({
      transcriptionConfig: config.transcription,
      callId: config.callId
    });
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing OpenAI bridge connection');

    // Create hang-up tool
    const hangUpTool = tool({
      name: 'hang_up_call',
      description: 'Ends the current phone call. Use this when the conversation is complete or the caller asks to hang up.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Brief reason for hanging up (e.g., "conversation complete", "caller requested")',
          },
        },
        required: ['reason'],
        additionalProperties: false,
      },
      execute: async (input: any) => {
        const { reason } = input as { reason: string };
        this.logger.info('AI requested to hang up call', { reason });

        if (this.config.onHangUpRequested) {
          try {
            await this.config.onHangUpRequested();
            return { success: true, message: 'Call ended successfully' };
          } catch (error) {
            this.logger.error('Error hanging up call', error instanceof Error ? error : new Error(String(error)));
            return { success: false, message: 'Failed to end call' };
          }
        }

        return { success: true, message: 'Hang up requested' };
      },
    });

    // Build context information
    let contextInfo = '';
    if (this.config.caller?.phoneNumber) {
      contextInfo += `\n\nThe caller's phone number is: ${this.config.caller.phoneNumber}`;
    }
    if (this.config.caller?.diversionHeader) {
      contextInfo += `\nCall was forwarded from: ${this.config.caller.diversionHeader}`;
    }

    // Create RealtimeAgent with tools
    this.realtimeAgent = new RealtimeAgent({
      name: OPENAI_AGENT_NAME,
      instructions: OPENAI_AGENT_INSTRUCTIONS + contextInfo,
      tools: [hangUpTool],
      voice: 'alloy'
    });

    // Configure session for PCM16 audio format
    // FreeSWITCH uuid_audio_fork sends L16 PCM audio at 24kHz, not G.711
    const audioFormat = 'pcm16';

    this.logger.info('Creating OpenAI Realtime session', { audioFormat });

    this.realtimeSession = new RealtimeSession(this.realtimeAgent, {
      model: 'gpt-4o-realtime-preview-2025-06-03',
      transport: 'websocket',
      config: {
        inputAudioFormat: audioFormat,
        outputAudioFormat: audioFormat,
        inputAudioTranscription: { model: this.config.transcription.model }
      }
    });

    // Set up event handlers
    this.setupOpenAIEventHandlers();

    // Connect to OpenAI
    this.logger.info('Connecting to OpenAI Realtime API');
    await this.realtimeSession.connect({
      apiKey: this.config.openaiApiKey
    });

    this.isConnectedToOpenAI = true;
    this.logger.info('Connected to OpenAI Realtime API successfully');

    // Send initial conversation item to make AI greet the caller first
    this.realtimeSession.transport.sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: 'Привіт! Будь ласка, привітайся українською мовою та запитай як ти можеш допомогти.'
        }]
      }
    });

    // Create initial response to make AI speak
    this.realtimeSession.transport.sendEvent({
      type: 'response.create'
    });
  }

  async startBridge(): Promise<void> {
    this.logger.info('Starting bidirectional OpenAI audio bridge');

    // FreeSWITCH → OpenAI: Forward incoming audio
    this.ws.on('message', (data: Buffer) => {
      if (this.isConnectedToOpenAI && this.realtimeSession) {
        try {
          const base64Audio = data.toString('base64');
          this.realtimeSession.transport.sendEvent({
            type: 'input_audio_buffer.append',
            audio: base64Audio
          });
        } catch (error) {
          this.logger.error('Error forwarding audio to OpenAI', error);
        }
      }
    });

    // Handle WebSocket close from FreeSWITCH
    this.ws.on('close', () => {
      this.logger.info('FreeSWITCH WebSocket closed, ending bridge');
      this.emit('end');
    });

    this.ws.on('error', (error: Error) => {
      this.logger.error('FreeSWITCH WebSocket error', { error });
      this.emit('error', error);
    });

    // Return promise that resolves when bridge ends
    return new Promise((resolve) => {
      this.on('end', resolve);
    });
  }

  private setupOpenAIEventHandlers(): void {
    if (!this.realtimeSession) return;

    // Handle various events from OpenAI Realtime API
    this.realtimeSession.on('transport_event', (event: any) => {
      if (event.type === 'response.audio.delta') {
        this.handleOpenAIAudio(event);
      } else if (event.type === 'response.text.delta') {
        this.handleOpenAITextDelta(event);
      } else if (event.type === 'response.text.done') {
        this.handleOpenAITextDone();
      } else if (event.type === 'input_audio_buffer.speech_started') {
        this.handleSpeechStarted();
      } else if (event.type === 'input_audio_buffer.speech_stopped') {
        this.handleSpeechStopped();
      } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
        this.handleInputAudioTranscriptionCompleted(event);
      } else if (event.type === 'conversation.item.input_audio_transcription.delta') {
        this.handleInputAudioTranscriptionDelta(event);
      } else if (event.type === 'response.audio_transcript.done') {
        this.handleAIAudioTranscriptDone(event);
      } else if (event.type === 'error') {
        if (event.error) {
          this.logger.error('OpenAI transport error', event.error);
        } else {
          this.logger.error('OpenAI transport error', null, {
            event
          });
        }
      }
    });

    this.realtimeSession.on('error', (error) => {
      if ((error as any)?.error?.error?.code === 'response_cancel_not_active') {
        this.logger.debug('Ignoring session cancellation error during cleanup');
        return;
      }
      this.logger.error('OpenAI session error', error);
    });

    this.logger.debug('OpenAI event handlers setup complete');
  }

  private handleOpenAIAudio(event: any): void {
    if (!event.delta || this.ws.readyState !== 1) {
      return;
    }

    try {
      // Convert base64 audio back to raw G.711 bytes
      const audioBuffer = Buffer.from(event.delta, 'base64');

      // Send to FreeSWITCH via WebSocket
      this.ws.send(audioBuffer);

      // Log occasionally to confirm audio flow
      if (Math.random() < 0.001) { // ~0.1% of frames
        this.logger.debug('Forwarded OpenAI audio to FreeSWITCH', {
          frameSize: audioBuffer.length,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      this.logger.error('Error forwarding OpenAI audio to FreeSWITCH', { error });
    }
  }

  private currentAIResponse = '';

  private handleOpenAITextDelta(event: any): void {
    if (event.delta) {
      this.currentAIResponse += event.delta;
    }
  }

  private handleOpenAITextDone(): void {
    if (this.currentAIResponse.trim()) {
      this.transcriptionManager.addCompletedTranscript('ai', this.currentAIResponse);
      this.currentAIResponse = '';
    }
  }

  private handleSpeechStarted(): void {
    this.logger.debug('User speech started');
  }

  private handleSpeechStopped(): void {
    this.logger.debug('User speech stopped');
    // Note: The actual transcription will come via input_audio_transcription events
  }

  private handleInputAudioTranscriptionCompleted(event: any): void {
    if (event.transcript && event.transcript.trim()) {
      this.transcriptionManager.addCompletedTranscript('caller', event.transcript);
    }
  }

  private handleInputAudioTranscriptionDelta(event: any): void {
    // For now, we only handle completed transcriptions
    // Could add real-time partial transcription display later if needed
    if (event.delta) {
      this.logger.debug('Received transcription delta:', event.delta);
    }
  }

  private handleAIAudioTranscriptDone(event: any): void {
    if (event.transcript && event.transcript.trim() && event.transcript !== '\n') {
      this.transcriptionManager.addCompletedTranscript('ai', event.transcript);
    }
  }

  /**
   * Get the transcription manager for this session
   */
  getTranscriptionManager(): TranscriptionManager {
    return this.transcriptionManager;
  }

  async disconnect(): Promise<void> {
    if (!this.isConnectedToOpenAI || !this.realtimeSession) {
      return;
    }

    this.logger.info('Disconnecting from OpenAI');

    try {
      // Cancel any ongoing response
      this.realtimeSession.transport.sendEvent({
        type: 'response.cancel'
      });

      this.realtimeSession.close();
      this.isConnectedToOpenAI = false;

      // Log final transcription stats
      const stats = this.transcriptionManager.getStats();
      this.logger.info('Session transcription stats', stats);

      this.logger.info('Disconnected from OpenAI successfully');
    } catch (error) {
      this.logger.error('Error disconnecting from OpenAI', error);
    }
  }
}