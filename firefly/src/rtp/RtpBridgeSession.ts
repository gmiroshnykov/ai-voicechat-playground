import * as dgram from 'dgram';
import { packets as rtpJsPackets, utils as rtpJsUtils } from 'rtp.js';
import { RealtimeAgent, RealtimeSession, tool } from '@openai/agents/realtime';
import { RtpSession } from './RtpSession';
import { RtcpHandler } from './RtcpHandler';
import { CodecHandler } from './CodecHandler';
import { JitterBuffer } from './JitterBuffer';
import { RtpSessionConfig, FrameSizeDetection, CodecType, RtpPacketInfo } from './types';
import { OPENAI_AGENT_INSTRUCTIONS, OPENAI_AGENT_NAME } from '../config/types';

// Use the type from the imported namespace
type RtpPacket = InstanceType<typeof rtpJsPackets.RtpPacket>;

export interface RtpBridgeSessionConfig extends RtpSessionConfig {
  openaiApiKey: string;
  jitterBufferMs?: number; // Default: 40ms
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
  
  // Audio packet scheduling
  private audioQueue: Buffer[] = [];
  private packetTimer?: NodeJS.Timeout;
  private isPlayingAudio = false;
  
  // Jitter buffer for packet reordering and loss handling
  private jitterBuffer?: JitterBuffer;

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
    const jitterBufferMs = this.bridgeConfig.jitterBufferMs ?? 40; // Default 40ms
    this.jitterBuffer = new JitterBuffer({
      bufferTimeMs: jitterBufferMs,
      codecInfo: this.bridgeConfig.codec,
      onPacketReady: (packet: RtpPacketInfo) => {
        this.forwardToOpenAI(packet);
      },
      onPacketLost: (sequenceNumber: number) => {
        this.handlePacketLoss(sequenceNumber);
      }
    });
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

    // Send initial silence packets IMMEDIATELY to establish symmetric RTP
    await this.sendInitialSilence();

    // Start periodic keepalive packets while OpenAI connection is establishing
    const keepaliveInterval = setInterval(() => {
      if (!this.isConnectedToOpenAI && this.state === 'active') {
        const silencePayload = this.codecHandler.createSilencePayload(this.config.codec);
        this.sendRtpPacket(silencePayload);
      }
    }, 100); // Send every 100ms

    try {
      // Initialize OpenAI Realtime connection (this takes time)
      await this.initializeOpenAIConnection();
    } finally {
      // Stop keepalive packets once OpenAI is connected or if connection fails
      clearInterval(keepaliveInterval);
    }
  }

  protected async onStop(): Promise<void> {
    // Stop audio playback timer
    if (this.packetTimer) {
      clearTimeout(this.packetTimer);
      this.packetTimer = undefined;
    }
    
    // Clear audio queue
    this.audioQueue = [];
    this.isPlayingAudio = false;
    
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
      
      this.realtimeSession = new RealtimeSession(this.realtimeAgent, {
        model: 'gpt-4o-realtime-preview-2025-06-03',
        transport: 'websocket',
        config: {
          inputAudioFormat: audioFormat,
          outputAudioFormat: audioFormat,
          inputAudioTranscription: {
            model: 'gpt-4o-mini-transcribe',
          }
        }
      });

      // Set up event handlers
      this.setupOpenAIEventHandlers();

      // Connect to OpenAI
      await this.realtimeSession.connect({ 
        apiKey: this.bridgeConfig.openaiApiKey 
      });

      this.isConnectedToOpenAI = true;
      this.logger.info('Connected to OpenAI Realtime API', {
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

    // Handle audio deltas from OpenAI
    this.realtimeSession.on('transport_event', (event: any) => {
      if (event.type === 'response.audio.delta') {
        this.handleOpenAIAudio(event);
      } else if (event.type === 'session.updated') {
        this.logger.info('Session updated', {
          inputFormat: event.session?.input_audio_format,
          outputFormat: event.session?.output_audio_format
        });
      } else if (event.type === 'error') {
        this.logger.error('OpenAI transport error', event.error);
      }
    });

    // Handle errors
    this.realtimeSession.on('error', (error) => {
      this.logger.error('OpenAI session error', error);
    });

    // Note: connection events will be handled via the session lifecycle
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
      
      this.logger.info('RTP latching to source', {
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
      if (!rtpJsPackets.isRtp(rtpView)) {
        this.logger.warn('Received non-RTP packet on RTP port');
        return;
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
    try {
      // Handle response.audio.delta event from OpenAI
      if (event.delta) {
        // Decode base64 G.711 audio from OpenAI
        const audioBuffer = Buffer.from(event.delta, 'base64');
        
        // Chunk into proper G.711 packet sizes (160 bytes = 20ms at 8kHz)
        this.chunkAndSendAudio(audioBuffer);
      }
      
    } catch (error) {
      this.logger.error('Error handling OpenAI audio', error);
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
            
            this.logger.info('Dynamic frame size confirmed', {
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

  private async sendInitialSilence(): Promise<void> {
    const silencePayload = this.codecHandler.createSilencePayload(this.config.codec);
    const totalPackets = 10; // Increased from 5 to 10

    this.logger.debug('Sending initial silence packets', {
      count: totalPackets,
      codec: this.config.codec.name
    });

    // Send packets with 20ms intervals
    for (let i = 0; i < totalPackets; i++) {
      this.sendRtpPacket(silencePayload, i === 0); // Marker bit on first packet
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }

  private sendRtpPacket(payload: Buffer, marker: boolean = false): void {
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

  private chunkAndSendAudio(audioBuffer: Buffer): void {
    const chunkSize = 160; // G.711 PCMA: 160 bytes = 20ms at 8kHz
    let offset = 0;
    const chunks: Buffer[] = [];
    
    while (offset < audioBuffer.length) {
      const remainingBytes = audioBuffer.length - offset;
      const currentChunkSize = Math.min(chunkSize, remainingBytes);
      
      // Extract chunk
      const chunk = audioBuffer.subarray(offset, offset + currentChunkSize);
      
      // Pad with silence if chunk is smaller than expected (should rarely happen)
      let paddedChunk = chunk;
      if (chunk.length < chunkSize) {
        paddedChunk = Buffer.alloc(chunkSize);
        chunk.copy(paddedChunk);
        // Fill remainder with codec-appropriate silence using CodecHandler
        const silencePayload = this.codecHandler.createSilencePayload(this.bridgeConfig.codec, 20);
        const silenceValue: number = silencePayload.length > 0 ? silencePayload[0]! : 0xFF; // Get the silence byte value for this codec
        paddedChunk.fill(silenceValue, chunk.length);
        
      }
      
      chunks.push(paddedChunk);
      offset += currentChunkSize;
    }
    
    // Add chunks to queue
    this.audioQueue.push(...chunks);
    
    // Start audio playback if not already playing
    this.startAudioPlayback();
  }
  
  private startAudioPlayback(): void {
    if (this.isPlayingAudio || this.audioQueue.length === 0) {
      return;
    }
    
    this.isPlayingAudio = true;
    this.scheduleNextPacket();
  }
  
  private scheduleNextPacket(): void {
    if (this.audioQueue.length === 0) {
      this.isPlayingAudio = false;
      return;
    }
    
    // Send next packet
    const nextChunk = this.audioQueue.shift();
    if (nextChunk) {
      this.sendRtpPacket(nextChunk);
      
      // Schedule next packet in 20ms
      this.packetTimer = setTimeout(() => {
        this.scheduleNextPacket();
      }, 20);
    }
  }

  public getFrameSizeInfo(): FrameSizeDetection {
    return { ...this.frameSizeDetection };
  }

  /**
   * Forward a packet from the jitter buffer to OpenAI
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
    
    // Forward comfort noise to OpenAI
    this.forwardToOpenAI(comfortNoisePacket);
  }

  /**
   * Get jitter buffer statistics
   */
  public getJitterBufferStats() {
    return this.jitterBuffer?.getStats() ?? null;
  }
}