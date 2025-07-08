import * as dgram from 'dgram';
import { packets as rtpJsPackets, utils as rtpJsUtils } from 'rtp.js';
import { RealtimeAgent, RealtimeSession, tool } from '@openai/agents/realtime';
import { RtpSession } from './RtpSession';
import { RtcpHandler } from './RtcpHandler';
import { CodecHandler } from './CodecHandler';
import { JitterBuffer } from './JitterBuffer';
import { CallRecorder, CallRecorderConfig } from './CallRecorder';
import { RtpSessionConfig, FrameSizeDetection, CodecType, RtpPacketInfo } from './types';
import { OPENAI_AGENT_INSTRUCTIONS, OPENAI_AGENT_NAME, RecordingConfig, TranscriptionConfig } from '../config/types';
import { TranscriptionManager, TranscriptEntry } from './TranscriptionManager';
import { RtpContinuousScheduler, RtpContinuousSchedulerConfig } from './RtpContinuousScheduler';
import { OpenAIAudioSourceManager, OpenAIAudioSourceManagerConfig } from './OpenAIAudioSourceManager';

// Use the type from the imported namespace
type RtpPacket = InstanceType<typeof rtpJsPackets.RtpPacket>;

export interface RtpBridgeSessionConfig extends RtpSessionConfig {
  openaiApiKey: string;
  jitterBufferMs?: number; // Default: 40ms
  recordingConfig?: RecordingConfig;
  transcriptionConfig?: TranscriptionConfig;
  caller?: {
    phoneNumber?: string;
    diversionHeader?: string;
  };
  onHangUpRequested?: () => Promise<void>;
}

export class RtpBridgeSession extends RtpSession {
  private rtcpHandler?: RtcpHandler;
  private codecHandler: CodecHandler;
  private rtpPacket: RtpPacket;
  private frameSizeDetection: FrameSizeDetection;
  private samplesPerFrame: number;
  
  // OpenAI Realtime API components
  private realtimeAgent?: RealtimeAgent;
  private realtimeSession?: RealtimeSession;
  private bridgeConfig: RtpBridgeSessionConfig;
  
  // Audio buffering and connection state
  private isConnectedToOpenAI = false;
  
  // Callback for hanging up the call
  private onHangUpRequested?: () => Promise<void>;
  
  // Continuous RTP streaming
  private continuousScheduler?: RtpContinuousScheduler;
  private openaiAudioSourceManager?: OpenAIAudioSourceManager;
  
  // Jitter buffer for packet reordering and loss handling
  private jitterBuffer?: JitterBuffer;
  
  // Call recording
  private callRecorder?: CallRecorder;
  
  // Transcription management
  private transcriptionManager?: TranscriptionManager;

  constructor(sessionConfig: RtpBridgeSessionConfig) {
    super(sessionConfig);
    this.bridgeConfig = sessionConfig;
    this.onHangUpRequested = sessionConfig.onHangUpRequested;
    
    this.codecHandler = new CodecHandler();
    this.samplesPerFrame = this.codecHandler.getSamplesPerFrame(sessionConfig.codec);
    
    // Initialize RTP packet for sending
    this.rtpPacket = new rtpJsPackets.RtpPacket();
    this.rtpPacket.setPayloadType(sessionConfig.codec.payload);
    this.rtpPacket.setSsrc(Math.floor(Math.random() * 0xFFFFFFFF));
    this.rtpPacket.setSequenceNumber(Math.floor(Math.random() * 0xFFFF));
    this.rtpPacket.setTimestamp(Math.floor(Math.random() * 0xFFFFFFFF));

    // Initialize frame size detection
    this.frameSizeDetection = {
      frameSizeConfirmed: false
    };
    
    // Verify we're using a G.711 codec for OpenAI compatibility
    if (this.bridgeConfig.codec.name !== CodecType.PCMA && this.bridgeConfig.codec.name !== CodecType.PCMU) {
      this.logger.error('Unsupported codec for OpenAI bridge. Only G.711 A-law (PCMA) and μ-law (PCMU) are supported', {
        codec: this.bridgeConfig.codec.name
      });
      throw new Error(`Unsupported codec for OpenAI bridge: ${this.bridgeConfig.codec.name}`);
    }
    
    // Initialize jitter buffer
    const jitterBufferMs = this.bridgeConfig.jitterBufferMs ?? 60; // Default 60ms (3 packets)
    this.jitterBuffer = new JitterBuffer({
      bufferTimeMs: jitterBufferMs,
      codecInfo: this.bridgeConfig.codec,
      onPacketReady: (packet: RtpPacketInfo) => {
        this.processCleanAudio(packet);
      },
      onPacketLost: (sequenceNumber: number) => {
        this.handlePacketLoss(sequenceNumber);
      }
    });
    
    // Initialize call recorder if recording is enabled
    if (this.bridgeConfig.recordingConfig?.enabled) {
      const callerSipUri = this.bridgeConfig.caller?.diversionHeader || 
                          `sip:${this.bridgeConfig.caller?.phoneNumber || 'unknown'}@unknown`;
      
      const recorderConfig: CallRecorderConfig = {
        enabled: true,
        recordingsPath: this.bridgeConfig.recordingConfig!.recordingsPath,
        callId: sessionConfig.sessionId || `call-${Date.now()}`,
        caller: {
          phoneNumber: this.bridgeConfig.caller?.phoneNumber,
          sipUri: callerSipUri
        },
        diversion: this.bridgeConfig.caller?.diversionHeader,
        codec: this.bridgeConfig.codec
      };
      
      this.callRecorder = new CallRecorder(recorderConfig);
    }
    
    // Initialize transcription manager if transcription is enabled
    if (this.bridgeConfig.transcriptionConfig?.enabled) {
      this.transcriptionManager = new TranscriptionManager({
        transcriptionConfig: this.bridgeConfig.transcriptionConfig,
        callId: sessionConfig.sessionId || `call-${Date.now()}`,
        onTranscriptReceived: (entry: TranscriptEntry) => {
          // Forward transcripts to call recorder if recording is enabled
          if (this.callRecorder) {
            this.callRecorder.addCompletedTranscript(entry.speaker, entry.text, entry.timestamp);
          }
        }
      });
    }
  }

  protected async onStart(): Promise<void> {
    // Set up RTP packet handling
    this.rtpSocket!.on('message', this.handleRtpPacket.bind(this));

    // Initialize RTCP handler
    this.rtcpHandler = new RtcpHandler({
      ssrc: this.rtpPacket.getSsrc(),
      localPort: this.config.localPort + 1,
      remotePort: this.config.remotePort + 1,
      remoteAddress: this.config.remoteAddress,
      socket: this.rtcpSocket!,
      getStats: () => this.getStats(),
      getDynamicFrameSize: () => this.frameSizeDetection.detectedSamplesPerFrame,
      isRtpActive: () => this.latchingState.rtpLatched
    });
    this.rtcpHandler.start();

    // Initialize call recording first if enabled (to get the call directory)
    if (this.bridgeConfig.recordingConfig?.enabled) {
      await this.callRecorder!.start();
    }

    // Initialize OpenAI audio source manager
    await this.initializeOpenAIAudioSourceManager();
    
    // Start continuous RTP streaming immediately
    this.startContinuousRtpStream();

    // Initialize OpenAI Realtime connection (this takes time)
    await this.initializeOpenAIConnection();
  }

  protected async onStop(): Promise<void> {
    // Stop continuous scheduler
    if (this.continuousScheduler) {
      this.continuousScheduler.stop();
      this.continuousScheduler = undefined;
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
    
    // Stop jitter buffer
    if (this.jitterBuffer) {
      this.jitterBuffer.destroy();
      this.jitterBuffer = undefined;
    }
    
    // Stop call recording
    if (this.callRecorder) {
      await this.callRecorder.stop();
      this.callRecorder = undefined;
    }
    
    // Clean up transcription manager
    if (this.transcriptionManager) {
      this.transcriptionManager.clear();
      this.transcriptionManager = undefined;
    }

    // Disconnect from OpenAI
    await this.disconnectFromOpenAI();
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
          
          // Call the hang up callback if provided
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
        tools: [hangUpTool]
      });

      // Create session with WebSocket transport and G.711 configuration
      const audioFormat = this.bridgeConfig.codec.name === CodecType.PCMU ? 'g711_ulaw' : 'g711_alaw';
      
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
      this.logger.debug('Connected to OpenAI Realtime API', {
        agent: OPENAI_AGENT_NAME,
        codec: this.bridgeConfig.codec.name === CodecType.PCMU ? 'G.711 μ-law' : 'G.711 A-law',
        audioFormat
      });
      
      // Send a greeting message to start the conversation in Ukrainian
      this.logger.debug('Sending initial conversation message to OpenAI');
      this.realtimeSession.transport.sendEvent({
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
      
      this.realtimeSession.transport.sendEvent({
        type: 'response.create'
      });

    } catch (error) {
      this.logger.error('Failed to connect to OpenAI Realtime API', error);
      throw error;
    }
  }


  private setupOpenAIEventHandlers(): void {
    if (!this.realtimeSession) return;

    // Use transport layer events for audio and transcripts
    this.realtimeSession.on('transport_event', (event: any) => {
      if (event.type === 'response.audio.delta') {
        this.logger.debug('Received OpenAI audio delta event');
        this.handleOpenAIAudio(event);
      } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
        // Handle completed user (caller) transcript
        this.handleCallerTranscript(event);
      } else if (event.type === 'response.audio_transcript.done') {
        // Handle completed AI transcript
        this.handleAITranscriptDone(event);
      } else if (event.type === 'session.updated') {
        this.logger.debug('Session updated', {
          inputFormat: event.session?.input_audio_format,
          outputFormat: event.session?.output_audio_format
        });
      } else if (event.type === 'error') {
        const errorDetails = {
          message: event.error?.message || 'Unknown error',
          type: event.error?.type || 'unknown',
          code: event.error?.code || 'unknown',
          eventType: event.type,
          fullError: event.error,
          rawEvent: event
        };
        
        // Check if this is a benign cancellation error during cleanup
        if (event.error?.code === 'response_cancel_not_active') {
          this.logger.debug('Ignoring response cancellation error during cleanup', errorDetails);
          return;
        }
        
        // Log with proper error serialization
        this.logger.error('OpenAI transport error', event.error, errorDetails);
        
        // Also log the raw error as string for debugging
        this.logger.debug('Raw OpenAI error details', {
          errorString: String(event.error),
          eventString: String(event)
        });
      } else {
        // Log all other events at trace level only
        this.logger.trace('OpenAI transport event', {
          eventType: event.type
        });
      }
    });


    // Handle errors
    this.realtimeSession.on('error', (error) => {
      const errorDetails = {
        message: (error as any)?.message || 'Unknown error',
        stack: (error as any)?.stack,
        name: (error as any)?.name,
        type: typeof error,
        fullError: error,
        rawError: String(error)
      };
      
      // Check if this is a benign cancellation error during cleanup
      if ((error as any)?.error?.error?.code === 'response_cancel_not_active') {
        this.logger.debug('Ignoring session cancellation error during cleanup', errorDetails);
        return;
      }
      
      this.logger.error('OpenAI session error', error, errorDetails);
      
      // Also log the raw error as string for debugging
      this.logger.debug('Raw OpenAI session error details', {
        errorString: String(error),
        errorConstructor: error?.constructor?.name
      });
    });

    // Note: connection events will be handled via the session lifecycle
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
        sessionId: this.config.sessionId || 'bridge-session',
        recordingsPath: this.bridgeConfig.recordingConfig?.recordingsPath,
        callDirectory: this.callRecorder?.getCallDirectory()
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
    
    this.logger.info('Starting continuous RTP stream for OpenAI bridge');
    
    // Create and configure continuous scheduler
    const schedulerConfig: RtpContinuousSchedulerConfig = {
      targetInterval: 20, // 20ms target interval
      logFrequency: 100, // Log every 100 packets
      logger: this.logger,
      sessionId: this.config.sessionId || 'bridge-session',
      onPacketSend: (packetNumber: number, callTimeMs: number) => {
        // Get the next packet from OpenAI audio source manager
        const result = this.openaiAudioSourceManager!.getNextPacket(callTimeMs);
        
        if (result) {
          // Send the packet (either silence or OpenAI audio) with proper recording
          this.sendAudioPacket(result.packet, result.isOpenAIAudio);
          
          // Log phase information every 100 packets
          if (packetNumber % 100 === 0) {
            const phase = this.openaiAudioSourceManager!.getCallPhase(callTimeMs);
            this.logger.trace('Continuous RTP stream status', {
              packetNumber,
              callTimeMs,
              phase: phase.phase,
              queueLength: phase.queueLength,
              isOpenAIAudio: result.isOpenAIAudio
            });
          }
          
          return true; // Continue sending
        } else {
          // Call should end
          this.logger.info('OpenAI audio source manager signaled end of call');
          return false; // Stop sending
        }
      },
      onComplete: async () => {
        this.logger.info('Continuous RTP stream completed - call ended by audio source manager');
      }
    };
    
    this.continuousScheduler = new RtpContinuousScheduler(schedulerConfig);
    this.continuousScheduler.start();
  }

  private async disconnectFromOpenAI(): Promise<void> {
    if (this.realtimeSession) {
      try {
        this.logger.debug('Closing OpenAI Realtime session');
        await this.realtimeSession.close();
      } catch (error) {
        this.logger.error('Error closing OpenAI session', error);
      }
      this.realtimeSession = undefined;
    }
    
    this.realtimeAgent = undefined;
    this.isConnectedToOpenAI = false;
    this.logger.debug('OpenAI connection closed');
  }

  private handleRtpPacket(msg: Buffer, rinfo: dgram.RemoteInfo): void {
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
      
      this.logger.debug('RTP latching to source', {
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
        
        // Accept packets that at least have RTP version 2 and reasonable length
        if (msg.length < 12 || rtpVersion !== 2) {
          this.logger.warn('Received non-RTP packet on RTP port', {
            packetLength: msg.length,
            rtpVersion
          });
          return;
        }
        
        this.logger.debug('Accepting packet despite RTP.js validation failure');
      }

      // Parse incoming packet
      const incomingPacket = new rtpJsPackets.RtpPacket(rtpView);
      this.detectFrameSize(incomingPacket);

      // Extract G.711 payload and create RtpPacketInfo
      const payloadView = incomingPacket.getPayload();
      const payloadBuffer = Buffer.from(
        payloadView.buffer,
        payloadView.byteOffset,
        payloadView.byteLength
      );

      // Note: Caller audio recording moved to post-jitter-buffer processing 
      // to ensure we record the same clean audio that OpenAI receives

      // Create packet info for jitter buffer
      const packetInfo: RtpPacketInfo = {
        sequenceNumber: incomingPacket.getSequenceNumber(),
        timestamp: incomingPacket.getTimestamp(),
        ssrc: incomingPacket.getSsrc(),
        marker: incomingPacket.getMarker(),
        payloadType: incomingPacket.getPayloadType(),
        payload: payloadBuffer
      };

      // Process through jitter buffer if connected to OpenAI
      if (this.isConnectedToOpenAI && this.jitterBuffer) {
        this.jitterBuffer.addPacket(packetInfo);
      }

    } catch (error) {
      this.logger.warn('Error processing RTP packet', { error });
    }
  }

  private handleOpenAIAudio(event: any): void {
    this.logger.trace('handleOpenAIAudio called', {
      hasEventDelta: !!event.delta,
      deltaLength: event.delta ? event.delta.length : 0
    });
    
    try {
      // Handle response.audio.delta event from OpenAI
      if (event.delta && this.openaiAudioSourceManager) {
        // Decode base64 G.711 audio from OpenAI
        const audioBuffer = Buffer.from(event.delta, 'base64');
        
        this.logger.trace('Decoded OpenAI audio buffer', {
          base64Length: event.delta.length,
          bufferLength: audioBuffer.length
        });
        
        // Add to continuous stream (will be chunked automatically)
        this.openaiAudioSourceManager.addOpenAIAudio(audioBuffer);
      }
      
    } catch (error) {
      this.logger.error('Error handling OpenAI audio', error);
    }
  }


  private handleCallerTranscript(event: any): void {
    if (!this.transcriptionManager) {
      return;
    }

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
    if (!this.transcriptionManager) {
      return;
    }

    try {
      // The complete AI transcript is in event.transcript for the done event
      const transcript = event.transcript;
      if (transcript && transcript.trim() && transcript !== '\n') {
        this.transcriptionManager.addCompletedTranscript('ai', transcript);
      }
    } catch (error) {
      this.logger.error('Error handling AI transcript done', error);
    }
  }


  private detectFrameSize(packet: RtpPacket): void {
    const timestamp = packet.getTimestamp();
    const seqNum = packet.getSequenceNumber();
    const payloadLength = packet.getPayload().byteLength;

    if (this.frameSizeDetection.lastReceivedTimestamp !== undefined && 
        this.frameSizeDetection.lastReceivedSeqNum !== undefined) {
      
      const seqDiff = (seqNum - this.frameSizeDetection.lastReceivedSeqNum + 0x10000) & 0xFFFF;
      
      if (seqDiff === 1) {
        // Consecutive packet - calculate timestamp increment
        const timestampDiff = (timestamp - this.frameSizeDetection.lastReceivedTimestamp + 0x100000000) & 0xFFFFFFFF;
        
        // Sanity check: frame size should be reasonable
        if (timestampDiff > 80 && timestampDiff < 1920) {
          this.frameSizeDetection.detectedSamplesPerFrame = timestampDiff;

          // Try to confirm with payload size
          const payloadSamples = this.codecHandler.calculateSamplesFromPayload(
            this.config.codec, 
            payloadLength
          );
          
          if (payloadSamples !== null && 
              payloadSamples === timestampDiff && 
              !this.frameSizeDetection.frameSizeConfirmed) {
            
            this.logger.trace('Dynamic frame size confirmed', {
              samples: timestampDiff,
              payloadBytes: payloadLength,
              codec: this.config.codec.name
            });
            this.frameSizeDetection.frameSizeConfirmed = true;
          }
        }
      }
    }

    this.frameSizeDetection.lastReceivedTimestamp = timestamp;
    this.frameSizeDetection.lastReceivedSeqNum = seqNum;
  }


  private sendAudioPacket(payload: Buffer, isOpenAIAudio: boolean = false, marker: boolean = false): void {
    // Add AI audio to continuous recording timeline when sending to caller
    if (this.callRecorder && isOpenAIAudio) {
      this.callRecorder.addAIAudio(payload);
    }

    // Update RTP packet fields
    this.rtpPacket.setMarker(marker);
    this.rtpPacket.setPayload(rtpJsUtils.nodeBufferToDataView(payload));

    // Use detected frame size if available
    const samplesPerFrame = this.frameSizeDetection.detectedSamplesPerFrame || this.samplesPerFrame;

    // Update timestamp and sequence number
    const currentTimestamp = this.rtpPacket.getTimestamp();
    const newTimestamp = (currentTimestamp + samplesPerFrame) & 0xFFFFFFFF;
    this.rtpPacket.setTimestamp(newTimestamp);

    const currentSeqNum = this.rtpPacket.getSequenceNumber();
    const newSeqNum = (currentSeqNum + 1) & 0xFFFF;
    this.rtpPacket.setSequenceNumber(newSeqNum);

    // Update RTCP handler with current timestamp
    if (this.rtcpHandler) {
      this.rtcpHandler.updateTimestamp(newTimestamp);
    }

    // Serialize and send
    const rtpView = this.rtpPacket.getView();
    const rtpBuffer = rtpJsUtils.dataViewToNodeBuffer(rtpView);
    
    this.rtpSocket!.send(rtpBuffer, this.config.remotePort, this.config.remoteAddress);
    this.updateRtpStats(rtpBuffer.length, 'sent');
  }

  

  public getFrameSizeInfo(): FrameSizeDetection {
    return { ...this.frameSizeDetection };
  }

  /**
   * Process clean audio from jitter buffer - handles both recording and OpenAI forwarding
   */
  private processCleanAudio(packet: RtpPacketInfo): void {
    // Add caller audio to continuous recording timeline
    if (this.callRecorder) {
      this.callRecorder.addCallerAudio(packet.payload);
    }

    // Forward to OpenAI
    this.forwardToOpenAI(packet);
  }

  /**
   * Forward a packet to OpenAI Realtime API
   */
  private forwardToOpenAI(packet: RtpPacketInfo): void {
    if (!this.isConnectedToOpenAI || !this.realtimeSession) {
      return;
    }

    try {
      // Base64 encode the G.711 audio
      const base64Audio = packet.payload.toString('base64');
      
      // Send to OpenAI via WebSocket
      this.realtimeSession.transport.sendEvent({
        type: 'input_audio_buffer.append',
        audio: base64Audio
      });
      
      this.logger.trace('Forwarded packet to OpenAI after jitter buffer', {
        sequenceNumber: packet.sequenceNumber,
        payloadSize: packet.payload.length
      });
    } catch (error) {
      this.logger.error('Error forwarding packet to OpenAI', error);
    }
  }

  /**
   * Handle a lost packet by generating comfort noise
   */
  private handlePacketLoss(sequenceNumber: number): void {
    this.logger.debug('Handling lost packet', { sequenceNumber });
    
    // Generate comfort noise for the lost packet
    const silencePayload = this.codecHandler.createSilencePayload(this.bridgeConfig.codec, 20);
    const comfortNoisePacket: RtpPacketInfo = {
      sequenceNumber: sequenceNumber,
      timestamp: 0, // Timestamp doesn't matter for comfort noise
      ssrc: 0,
      marker: false,
      payloadType: this.bridgeConfig.codec.payload,
      payload: silencePayload
    };
    
    // Process comfort noise (both record and forward to OpenAI)
    this.processCleanAudio(comfortNoisePacket);
  }

  /**
   * Get jitter buffer statistics
   */
  public getJitterBufferStats() {
    return this.jitterBuffer?.getStats() ?? null;
  }

  /**
   * Flush any remaining packets from jitter buffer immediately
   * This ensures all received audio is processed before session ends
   */
  public flushJitterBuffer(): void {
    if (this.jitterBuffer) {
      this.jitterBuffer.flush();
    }
  }
}