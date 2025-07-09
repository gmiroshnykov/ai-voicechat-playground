// import { pipeline } from 'stream';
// import { promisify } from 'util';
import * as dgram from 'dgram';
import { packets as rtpJsPackets, utils as rtpJsUtils } from 'rtp.js';
import { RealtimeAgent, RealtimeSession, tool } from '@openai/agents/realtime';
import { RtpSession } from './RtpSession';
import { RtcpHandler } from './RtcpHandler';
import { RtpToAudioStream, RtpToAudioStreamConfig } from './RtpToAudioStream';
import { AudioToRtpStream, AudioToRtpStreamConfig } from './AudioToRtpStream';
import { JitterBufferTransform, JitterBufferTransformConfig } from './JitterBufferTransform';
import { StereoRecorderStream } from './StereoRecorderStream';
import { ChannelRecorderStream } from './ChannelRecorderStream';
import { TempoAdjustTransform, TempoAdjustTransformConfig } from './TempoAdjustTransform';
import { createTee, createPassThrough } from './StreamUtils';
import { RtpSessionConfig, CodecType } from './types';
import { OPENAI_AGENT_INSTRUCTIONS, OPENAI_AGENT_NAME, RecordingConfig, TranscriptionConfig } from '../config/types';
import { TranscriptionManager, TranscriptEntry } from './TranscriptionManager';
import { CallRecorderConfig } from './CallRecorder';
import { RtpContinuousScheduler, RtpContinuousSchedulerConfig } from './RtpContinuousScheduler';
import { OpenAIAudioSourceManager, OpenAIAudioSourceManagerConfig } from './OpenAIAudioSourceManager';

// const pipelineAsync = promisify(pipeline);

export interface RtpBridgeSessionStreamConfig extends RtpSessionConfig {
  openaiApiKey: string;
  jitterBufferMs?: number; // Default: 40ms
  recordingConfig?: RecordingConfig;
  transcriptionConfig?: TranscriptionConfig;
  caller?: {
    phoneNumber?: string;
    diversionHeader?: string;
  };
  onHangUpRequested?: () => Promise<void>;
  aiTempoAdjustment?: {
    tempo: number; // 1.0 = normal speed, 1.2 = 20% faster
  };
}

/**
 * Stream-based RTP Bridge Session for OpenAI Realtime API integration
 * Uses Node.js streams for composable audio processing pipeline
 */
export class RtpBridgeSessionStream extends RtpSession {
  private rtcpHandler?: RtcpHandler;
  private bridgeConfig: RtpBridgeSessionStreamConfig;
  
  // OpenAI Realtime API components
  private realtimeAgent?: RealtimeAgent;
  private realtimeSession?: RealtimeSession;
  private isConnectedToOpenAI = false;
  private onHangUpRequested?: () => Promise<void>;
  
  // Stream pipeline components
  private rtpToAudioStream?: RtpToAudioStream;
  private audioToRtpStream?: AudioToRtpStream;
  private jitterBufferTransform?: JitterBufferTransform;
  private stereoRecorderStream?: StereoRecorderStream;
  private callerRecorderStream?: ChannelRecorderStream;
  private aiRecorderStream?: ChannelRecorderStream;
  private tempoAdjustTransform?: TempoAdjustTransform;
  
  // Continuous RTP streaming for outbound audio
  private continuousScheduler?: RtpContinuousScheduler;
  private openaiAudioSourceManager?: OpenAIAudioSourceManager;
  
  // AI audio processing pipeline
  private aiAudioProcessingStream?: NodeJS.WritableStream;
  
  // Transcription management
  private transcriptionManager?: TranscriptionManager;

  constructor(sessionConfig: RtpBridgeSessionStreamConfig) {
    super(sessionConfig);
    this.bridgeConfig = sessionConfig;
    this.onHangUpRequested = sessionConfig.onHangUpRequested;
    
    // Verify we're using a G.711 codec for OpenAI compatibility
    if (this.bridgeConfig.codec.name !== CodecType.PCMA && this.bridgeConfig.codec.name !== CodecType.PCMU) {
      this.logger.error('Unsupported codec for OpenAI bridge. Only G.711 A-law (PCMA) and μ-law (PCMU) are supported', {
        codec: this.bridgeConfig.codec.name
      });
      throw new Error(`Unsupported codec for OpenAI bridge: ${this.bridgeConfig.codec.name}`);
    }
  }

  protected async onStart(): Promise<void> {
    // Initialize RTCP handler
    this.rtcpHandler = new RtcpHandler({
      ssrc: Math.floor(Math.random() * 0xFFFFFFFF),
      localPort: this.config.localPort + 1,
      remotePort: this.config.remotePort + 1,
      remoteAddress: this.config.remoteAddress,
      socket: this.rtcpSocket!,
      getStats: () => this.getStats(),
      getDynamicFrameSize: () => this.rtpToAudioStream?.getDetectedSamplesPerFrame(),
      isRtpActive: () => this.rtpToAudioStream?.getLatchingState().rtpLatched || false
    });
    this.rtcpHandler.start();

    // Initialize call recording first if enabled
    if (this.bridgeConfig.recordingConfig?.enabled) {
      await this.initializeCallRecording();
    }

    // Initialize transcription manager
    if (this.bridgeConfig.transcriptionConfig?.enabled) {
      await this.initializeTranscriptionManager();
    }

    // Initialize AI tempo adjustment transform if enabled
    await this.initializeTempoAdjustment();
    
    // Initialize OpenAI audio source manager for outbound audio
    await this.initializeOpenAIAudioSourceManager();
    
    // Set up AI audio processing pipeline
    await this.setupAIAudioProcessingPipeline();
    
    // Start continuous RTP streaming for outbound audio
    this.startContinuousRtpStream();

    // Set up the stream pipeline for inbound audio processing
    await this.setupStreamPipeline();

    // Set up direct RTP packet handling for incoming audio (like working sessions)
    this.rtpSocket!.on('message', this.handleIncomingRtp.bind(this));

    // Initialize OpenAI Realtime connection (this takes time)
    try {
      await this.initializeOpenAIConnection();
    } catch (error) {
      // If OpenAI connection fails, stop the continuous RTP stream to prevent resource leaks
      this.logger.error('Failed to connect to OpenAI, stopping session', error);
      await this.onStop();
      throw error;
    }
  }

  protected async onStop(): Promise<void> {
    // Stop continuous scheduler
    if (this.continuousScheduler) {
      this.continuousScheduler.stop();
      this.continuousScheduler = undefined;
    }
    
    // Clean up AI audio processing pipeline
    if (this.aiAudioProcessingStream) {
      if (this.aiAudioProcessingStream !== this.tempoAdjustTransform) {
        // It's a direct writable stream, destroy it
        (this.aiAudioProcessingStream as any).destroy?.();
      }
      this.aiAudioProcessingStream = undefined;
    }
    
    // Clean up OpenAI audio source manager
    if (this.openaiAudioSourceManager) {
      this.openaiAudioSourceManager.endCall();
      this.openaiAudioSourceManager = undefined;
    }
    
    // Stop RTCP handler
    if (this.rtcpHandler) {
      this.rtcpHandler.stop();
      this.rtcpHandler = undefined;
    }
    
    // Destroy stream components
    if (this.tempoAdjustTransform) {
      this.tempoAdjustTransform.destroy();
      this.tempoAdjustTransform = undefined;
    }
    
    if (this.jitterBufferTransform) {
      this.jitterBufferTransform.destroy();
      this.jitterBufferTransform = undefined;
    }
    
    if (this.stereoRecorderStream) {
      await this.stereoRecorderStream.stop();
      this.stereoRecorderStream = undefined;
    }
    
    if (this.callerRecorderStream) {
      this.callerRecorderStream.destroy();
      this.callerRecorderStream = undefined;
    }
    
    if (this.aiRecorderStream) {
      this.aiRecorderStream.destroy();
      this.aiRecorderStream = undefined;
    }
    
    if (this.rtpToAudioStream) {
      this.rtpToAudioStream.destroy();
      this.rtpToAudioStream = undefined;
    }
    
    if (this.audioToRtpStream) {
      this.audioToRtpStream.destroy();
      this.audioToRtpStream = undefined;
    }
    
    // Clean up transcription manager
    if (this.transcriptionManager) {
      this.transcriptionManager.clear();
      this.transcriptionManager = undefined;
    }

    // Disconnect from OpenAI
    await this.disconnectFromOpenAI();
  }

  private async setupStreamPipeline(): Promise<void> {
    this.logger.debug('Setting up stream-based audio pipeline');

    // Create RTP to audio stream
    const rtpToAudioConfig: RtpToAudioStreamConfig = {
      rtpSocket: this.rtpSocket!,
      remoteAddress: this.config.remoteAddress,
      remotePort: this.config.remotePort,
      codec: this.config.codec,
      sessionId: this.config.sessionId || 'stream-bridge-session',
      onStatsUpdate: (stats) => {
        // Update our stats
        this.stats.packetsReceived = stats.packetsReceived;
        this.stats.bytesReceived = stats.bytesReceived;
      }
    };
    this.rtpToAudioStream = new RtpToAudioStream(rtpToAudioConfig);

    // Create jitter buffer transform
    const jitterBufferConfig: JitterBufferTransformConfig = {
      bufferTimeMs: this.bridgeConfig.jitterBufferMs ?? 60,
      codecInfo: this.config.codec,
      sessionId: this.config.sessionId || 'stream-bridge-session',
      onPacketLost: (sequenceNumber) => {
        this.logger.debug('Jitter buffer detected packet loss', { sequenceNumber });
      }
    };
    this.jitterBufferTransform = new JitterBufferTransform(jitterBufferConfig);

    // Create audio to RTP stream for processed audio
    const audioToRtpConfig: AudioToRtpStreamConfig = {
      rtpSocket: this.rtpSocket!,
      remoteAddress: this.config.remoteAddress,
      remotePort: this.config.remotePort,
      codec: this.config.codec,
      sessionId: this.config.sessionId || 'stream-bridge-session',
      onStatsUpdate: (stats) => {
        // Update our stats
        this.stats.packetsSent = stats.packetsSent;
        this.stats.bytesSent = stats.bytesSent;
      },
      onRtcpUpdate: (timestamp) => {
        if (this.rtcpHandler) {
          this.rtcpHandler.updateTimestamp(timestamp);
        }
      }
    };
    this.audioToRtpStream = new AudioToRtpStream(audioToRtpConfig);


    // Set up the pipeline
    await this.connectStreamPipeline();
  }

  private async connectStreamPipeline(): Promise<void> {
    if (!this.rtpToAudioStream || !this.jitterBufferTransform) {
      throw new Error('Stream components not initialized');
    }

    // Create the main processing pipeline
    let currentStream: NodeJS.ReadWriteStream = this.rtpToAudioStream
      .pipe(this.jitterBufferTransform); // RtpPacketInfo -> Buffer


    // Fork for caller recording if enabled
    if (this.callerRecorderStream) {
      const tee = createTee([this.callerRecorderStream]);
      currentStream = currentStream.pipe(tee);
    }

    // Fork for OpenAI processing
    const openaiStream = createPassThrough();
    const finalTee = createTee([openaiStream]);
    currentStream.pipe(finalTee);

    // Handle OpenAI stream
    openaiStream.on('data', (audioBuffer: Buffer) => {
      this.forwardToOpenAI(audioBuffer);
    });

    this.logger.debug('Stream pipeline connected successfully', {
      hasRecording: !!this.callerRecorderStream,
      jitterBufferMs: this.bridgeConfig.jitterBufferMs ?? 60
    });
  }

  private async initializeCallRecording(): Promise<void> {
    if (!this.bridgeConfig.recordingConfig?.enabled) {
      return;
    }

    const callRecorderConfig: CallRecorderConfig = {
      enabled: true,
      recordingsPath: this.bridgeConfig.recordingConfig.recordingsPath,
      callId: this.config.sessionId || 'stream-bridge-session',
      caller: {
        phoneNumber: this.bridgeConfig.caller?.phoneNumber,
        sipUri: this.bridgeConfig.caller?.phoneNumber || 'unknown@unknown'
      },
      diversion: this.bridgeConfig.caller?.diversionHeader,
      codec: this.config.codec
    };

    // Create stereo recorder and channel-specific streams
    this.stereoRecorderStream = new StereoRecorderStream(callRecorderConfig);
    await this.stereoRecorderStream.start();
    
    // Create channel-specific recorder streams
    this.callerRecorderStream = new ChannelRecorderStream(this.stereoRecorderStream, 'caller');
    this.aiRecorderStream = new ChannelRecorderStream(this.stereoRecorderStream, 'ai');
  }

  private async initializeTranscriptionManager(): Promise<void> {
    if (!this.bridgeConfig.transcriptionConfig?.enabled) {
      return;
    }

    this.transcriptionManager = new TranscriptionManager({
      transcriptionConfig: this.bridgeConfig.transcriptionConfig!,
      callId: this.config.sessionId || 'stream-bridge-session',
      onTranscriptReceived: (_entry: TranscriptEntry) => {
        // Handle transcript updates if needed
      }
    });
  }

  private async initializeTempoAdjustment(): Promise<void> {
    const tempo = this.bridgeConfig.aiTempoAdjustment?.tempo;
    if (!tempo || tempo === 1.0) {
      return; // No adjustment needed
    }

    const tempoAdjustConfig: TempoAdjustTransformConfig = {
      tempo: tempo,
      codecInfo: this.config.codec,
      sessionId: this.config.sessionId || 'stream-bridge-session'
    };
    
    this.tempoAdjustTransform = new TempoAdjustTransform(tempoAdjustConfig);
    
    this.logger.debug('AI tempo adjustment transform initialized', {
      tempo: tempo,
      codec: this.config.codec.name
    });
  }

  private async setupAIAudioProcessingPipeline(): Promise<void> {
    if (!this.openaiAudioSourceManager) {
      throw new Error('OpenAI audio source manager must be initialized first');
    }

    // Create a writable stream that feeds processed audio to the OpenAI audio source manager
    const { Writable } = await import('stream');
    
    if (this.tempoAdjustTransform) {
      // Pipeline: Input -> TempoAdjustTransform -> OpenAI Audio Source Manager
      this.aiAudioProcessingStream = this.tempoAdjustTransform;
      
      // Connect tempo adjustment output to OpenAI audio source manager
      this.tempoAdjustTransform.on('data', (processedAudio: Buffer) => {
        if (this.openaiAudioSourceManager) {
          this.openaiAudioSourceManager.addOpenAIAudio(processedAudio);
        }
      });
      
      this.logger.debug('AI audio processing pipeline set up with tempo adjustment', {
        tempo: this.bridgeConfig.aiTempoAdjustment?.tempo
      });
    } else {
      // Direct pipeline: Input -> OpenAI Audio Source Manager
      this.aiAudioProcessingStream = new Writable({
        write: (chunk: Buffer, _encoding, callback) => {
          if (this.openaiAudioSourceManager) {
            this.openaiAudioSourceManager.addOpenAIAudio(chunk);
          }
          callback();
        }
      });
      
      this.logger.debug('AI audio processing pipeline set up without tempo adjustment');
    }
  }

  private async initializeOpenAIAudioSourceManager(): Promise<void> {
    try {
      const audioSourceConfig: OpenAIAudioSourceManagerConfig = {
        codec: {
          name: this.config.codec.name as CodecType,
          payload: this.config.codec.payload,
          clockRate: this.config.codec.clockRate,
          channels: this.config.codec.channels
        },
        logger: this.logger,
        sessionId: this.config.sessionId || 'stream-bridge-session',
        recordingsPath: this.bridgeConfig.recordingConfig?.recordingsPath,
        callDirectory: this.stereoRecorderStream?.getCallDirectory()
      };
      
      this.openaiAudioSourceManager = new OpenAIAudioSourceManager(audioSourceConfig);
      await this.openaiAudioSourceManager.initialize();
      
    } catch (error) {
      this.logger.error('Failed to initialize OpenAI audio source manager', error);
      throw error;
    }
  }

  private startContinuousRtpStream(): void {
    if (!this.openaiAudioSourceManager) {
      this.logger.error('OpenAI audio source manager not initialized');
      return;
    }
    
    this.logger.debug('Starting continuous RTP stream for OpenAI bridge');
    
    // Create and configure continuous scheduler
    const schedulerConfig: RtpContinuousSchedulerConfig = {
      targetInterval: 20, // 20ms target interval
      logFrequency: 100, // Log every 100 packets
      logger: this.logger,
      sessionId: this.config.sessionId || 'stream-bridge-session',
      onPacketSend: (_packetNumber: number, callTimeMs: number) => {
        // Get the next packet from OpenAI audio source manager
        const result = this.openaiAudioSourceManager!.getNextPacket(callTimeMs);
        
        if (result) {
          // Send the packet via the stream pipeline
          this.sendAudioPacket(result.packet, result.isAudioDataAvailable);
          return true; // Continue scheduling
        } else {
          // End of call
          this.logger.info('OpenAI audio source manager signaled end of call');
          if (this.onHangUpRequested) {
            this.onHangUpRequested().catch(error => {
              this.logger.error('Error handling hang up request', error);
            });
          }
          return false; // Stop scheduling
        }
      }
    };
    
    this.continuousScheduler = new RtpContinuousScheduler(schedulerConfig);
    this.continuousScheduler.start();
  }

  private sendAudioPacket(payload: Buffer, isAudioDataAvailable: boolean = false): void {
    // Add AI audio to recording if this is OpenAI audio
    if (this.aiRecorderStream && isAudioDataAvailable) {
      this.aiRecorderStream.write(payload);
    }

    // Send via the audio to RTP stream
    if (this.audioToRtpStream) {
      this.audioToRtpStream.write(payload);
    }
  }

  private async initializeOpenAIConnection(): Promise<void> {
    try {
      // Create agent with call context and tools
      const callerInfo = this.bridgeConfig.caller;
      const contextInfo = callerInfo ? `\nCaller: ${callerInfo.phoneNumber || 'Unknown'}${callerInfo.diversionHeader ? `\nDiverted from: ${callerInfo.diversionHeader}` : ''}` : '';
      
      // Create hang up tool
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
          
          if (this.onHangUpRequested) {
            try {
              await this.onHangUpRequested();
              return { success: true, message: 'Call ended successfully' };
            } catch (error) {
              this.logger.error('Error hanging up call', error);
              return { success: false, message: 'Failed to end call' };
            }
          }
          
          return { success: true, message: 'Hang up requested' };
        },
      });

      this.realtimeAgent = new RealtimeAgent({
        name: OPENAI_AGENT_NAME,
        instructions: OPENAI_AGENT_INSTRUCTIONS + contextInfo,
        tools: [hangUpTool],
        voice: 'alloy'
      });

      const audioFormat = this.config.codec.name === CodecType.PCMA ? 'g711_alaw' : 'g711_ulaw';
      
      // Configure transcription if enabled
      const sessionConfig: any = {
        inputAudioFormat: audioFormat,
        outputAudioFormat: audioFormat
      };
      
      if (this.bridgeConfig.transcriptionConfig?.enabled) {
        sessionConfig.inputAudioTranscription = {
          model: this.bridgeConfig.transcriptionConfig.model,
        };
      }
      
      this.realtimeSession = new RealtimeSession(this.realtimeAgent, {
        model: 'gpt-4o-realtime-preview-2025-06-03',
        transport: 'websocket',
        config: sessionConfig
      });

      // Set up event handlers
      this.setupOpenAIEventHandlers();

      // Connect to OpenAI
      await this.realtimeSession.connect({ 
        apiKey: this.bridgeConfig.openaiApiKey
      });
      
      this.isConnectedToOpenAI = true;
      this.logger.info('Connected to OpenAI Realtime API');

      // Send initial conversation item
      this.realtimeSession!.transport.sendEvent({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Привіт! Будь ласка, привітайся українською мовою та запитай як ти можеш допомогти.'
            }
          ]
        }
      });
      
      this.realtimeSession!.transport.sendEvent({
        type: 'response.create'
      });

    } catch (error) {
      this.logger.error('Failed to connect to OpenAI Realtime API', error);
      throw error;
    }
  }

  private setupOpenAIEventHandlers(): void {
    if (!this.realtimeSession) return;

    this.realtimeSession.on('transport_event', (event: any) => {
      if (event.type === 'response.audio.delta') {
        this.handleOpenAIAudio(event);
      } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
        this.handleCallerTranscript(event);
      } else if (event.type === 'response.audio_transcript.done') {
        this.handleAITranscriptDone(event);
      } else if (event.type === 'error') {
        if (event.error?.code === 'response_cancel_not_active') {
          this.logger.debug('Ignoring response cancellation error during cleanup');
          return;
        }
        this.logger.error('OpenAI transport error', event.error);
      }
    });

    this.realtimeSession.on('error', (error) => {
      if ((error as any)?.error?.error?.code === 'response_cancel_not_active') {
        this.logger.debug('Ignoring session cancellation error during cleanup');
        return;
      }
      this.logger.error('OpenAI session error', error);
    });
  }

  private handleOpenAIAudio(event: any): void {
    try {
      if (event.delta && this.aiAudioProcessingStream) {
        const audioBuffer = Buffer.from(event.delta, 'base64');
        // Send audio through the processing pipeline (with or without speed adjustment)
        this.aiAudioProcessingStream.write(audioBuffer);
      }
    } catch (error) {
      this.logger.error('Error handling OpenAI audio', error);
    }
  }

  private handleCallerTranscript(event: any): void {
    if (!this.transcriptionManager) return;

    try {
      const transcript = event.transcript;
      if (transcript && transcript.trim()) {
        this.transcriptionManager.addCompletedTranscript('caller', transcript);
      }
    } catch (error) {
      this.logger.error('Error handling caller transcript', error);
    }
  }

  private handleAITranscriptDone(event: any): void {
    if (!this.transcriptionManager) return;

    try {
      const transcript = event.transcript;
      if (transcript && transcript.trim() && transcript !== '\n') {
        this.transcriptionManager.addCompletedTranscript('ai', transcript);
      }
    } catch (error) {
      this.logger.error('Error handling AI transcript done', error);
    }
  }

  private handleIncomingRtp(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    // Validate source and check if active
    if (this.state !== 'active') {
      return;
    }

    if (!this.validateRtpSource(rinfo.address)) {
      this.logger.warn('Rejected RTP from untrusted source', {
        source: `${rinfo.address}:${rinfo.port}`,
        expected: this.latchingState.expectedRemoteAddress
      });
      return;
    }

    // Update statistics
    this.updateRtpStats(msg.length, 'received');

    // Perform symmetric RTP latching
    if (!this.latchingState.rtpLatched || 
        this.config.remoteAddress !== rinfo.address || 
        this.config.remotePort !== rinfo.port) {
      
      this.logger.trace('RTP latching to source', {
        address: rinfo.address,
        port: rinfo.port,
        wasExpecting: `${this.config.remoteAddress}:${this.config.remotePort}`
      });

      // Update config with actual source
      this.config.remoteAddress = rinfo.address;
      this.config.remotePort = rinfo.port;
      this.latchingState.rtpLatched = true;
      this.latchingState.actualRtpEndpoint = {
        address: rinfo.address,
        port: rinfo.port
      };
    }

    // Parse and process RTP packet
    try {
      const rtpView = rtpJsUtils.nodeBufferToDataView(msg);
      
      // Check if it's a valid RTP packet - be more permissive for interoperability
      if (!rtpJsPackets.isRtp(rtpView)) {
        // Log details for debugging but continue if packet looks like RTP
        const firstByte = msg.length > 0 ? msg[0]! : 0;
        const rtpVersion = (firstByte >> 6) & 0x3;
        
        this.logger.debug('RTP validation failed, checking manually', {
          packetLength: msg.length,
          firstByte: firstByte?.toString(16) || '0',
          rtpVersion,
          expectedVersion: 2
        });
        
        // Accept packets that have reasonable length (be permissive with version)
        if (msg.length < 12) {
          this.logger.warn('Received too short packet on RTP port', {
            packetLength: msg.length,
            rtpVersion
          });
          return;
        }
        
        // Log version mismatches but continue processing
        if (rtpVersion !== 2) {
          this.logger.debug('RTP version mismatch, continuing anyway', {
            rtpVersion,
            expectedVersion: 2
          });
        }
      }

      // Parse incoming packet
      const incomingPacket = new rtpJsPackets.RtpPacket(rtpView);
      
      // Extract G.711 payload
      const payloadView = incomingPacket.getPayload();
      const payloadBuffer = rtpJsUtils.dataViewToNodeBuffer(payloadView);

      // Forward directly to OpenAI if connected
      if (this.isConnectedToOpenAI && this.realtimeSession) {
        this.forwardToOpenAI(payloadBuffer);
      }

    } catch (error) {
      this.logger.warn('Error processing RTP packet', { error });
    }
  }

  private forwardToOpenAI(audioBuffer: Buffer): void {
    if (!this.isConnectedToOpenAI || !this.realtimeSession) {
      return;
    }

    try {
      const base64Audio = audioBuffer.toString('base64');
      this.realtimeSession.transport.sendEvent({
        type: 'input_audio_buffer.append',
        audio: base64Audio
      });
    } catch (error) {
      this.logger.error('Error forwarding audio to OpenAI', error);
    }
  }

  private async disconnectFromOpenAI(): Promise<void> {
    if (!this.isConnectedToOpenAI || !this.realtimeSession) {
      return;
    }

    try {
      this.logger.debug('Disconnecting from OpenAI Realtime API');
      
      // Cancel any ongoing response
      this.realtimeSession.transport.sendEvent({
        type: 'response.cancel'
      });
      
      await this.realtimeSession.close();
      this.isConnectedToOpenAI = false;
      
      this.logger.info('Disconnected from OpenAI Realtime API');
    } catch (error) {
      this.logger.error('Error disconnecting from OpenAI', error);
    }
  }

  // Public methods for monitoring
  public getJitterBufferStats() {
    return this.jitterBufferTransform?.getStats() ?? null;
  }

  public getStreamStats() {
    return {
      rtpInput: this.rtpToAudioStream?.getStats(),
      rtpOutput: this.audioToRtpStream?.getStats(),
      jitterBuffer: this.jitterBufferTransform?.getStats(),
      stereoRecorder: this.stereoRecorderStream?.getStats()
    };
  }

  public flushJitterBuffer(): void {
    if (this.jitterBufferTransform) {
      this.jitterBufferTransform.flush();
    }
  }
}