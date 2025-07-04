const Srf = require('drachtio-srf');
const sdpTransform = require('sdp-transform');
const dgram = require('dgram');
const { packets: rtpJsPackets, utils: rtpJsUtils } = require('rtp.js');

const srf = new Srf();

// RTP echo handler
class RtpEcho {
  constructor(localPort, remotePort, remoteAddr, codec) {
    this.localPort = localPort;
    this.remotePort = remotePort;
    this.remoteAddr = remoteAddr;
    this.socket = dgram.createSocket('udp4');
    this.active = false;

    // Store codec info for proper RTP handling
    this.codec = codec;
    this.payloadType = codec.payload;
    this.clockRate = codec.rate;

    // Calculate samples per 20ms frame based on codec
    this.samplesPerFrame = this.getSamplesPerFrame();

    // Track expected remote address for security validation
    this.expectedRemoteAddr = remoteAddr;
    this.rtpLatched = false;

    // RTCP latching for NAT traversal
    this.rtcpLatched = false;
    this.remoteRtcpAddr = null;
    this.remoteRtcpPort = null;

    // RTP packet handling with rtp.js
    this.rtpPacket = new rtpJsPackets.RtpPacket();
    this.rtpPacket.setPayloadType(codec.payload);
    this.rtpPacket.setSsrc(Math.floor(Math.random() * 0xFFFFFFFF));
    this.rtpPacket.setSequenceNumber(Math.floor(Math.random() * 0xFFFF));
    this.rtpPacket.setTimestamp(Math.floor(Math.random() * 0xFFFFFFFF));

    // RTCP statistics tracking
    this.rtpStats = {
      packetsReceived: 0,
      bytesReceived: 0,
      packetsSent: 0,
      bytesSent: 0,
      firstPacketTime: null,
      lastPacketTime: null
    };

    // RTCP socket and timing
    this.rtcpSocket = null;
    this.rtcpInterval = null;

    // Dynamic frame size detection
    this.lastReceivedTimestamp = null;
    this.lastReceivedSeqNum = null;
    this.detectedSamplesPerFrame = null;
    this.frameSizeConfirmed = false;
  }

  getSamplesPerFrame() {
    // Calculate samples for 20ms frame based on clock rate
    switch (this.codec.codec.toUpperCase()) {
      case 'OPUS':
        return 960; // 20ms at 48kHz
      case 'PCMU':
      case 'PCMA':
        return 160; // 20ms at 8kHz
      case 'G722':
        return 160; // 20ms at 16kHz (but clock rate is 8kHz)
      default:
        // Default: 20ms worth of samples at the codec's clock rate
        return Math.floor(this.clockRate * 0.02);
    }
  }

  calculateSamplesFromPayload(payloadLength) {
    // Calculate number of samples based on payload length and codec
    switch (this.codec.codec.toUpperCase()) {
      case 'OPUS':
        // OPUS has variable bitrate, can't determine from payload alone
        // Return null to use timestamp-based detection
        return null;
      case 'PCMU':
      case 'PCMA':
        // G.711: 1 byte per sample
        return payloadLength;
      case 'G722':
        // G.722: 1 byte per sample (even though it's 16kHz audio)
        return payloadLength;
      default:
        // Unknown codec, use timestamp-based detection
        return null;
    }
  }

  validateRtpSource(sourceAddr) {
    // Allow latching on first packet or if source is from same /24 subnet
    if (!this.rtpLatched) {
      return true; // First packet always allowed
    }

    // Check if source is from same /24 subnet as expected address
    const expectedOctets = this.expectedRemoteAddr.split('.');
    const sourceOctets = sourceAddr.split('.');

    if (expectedOctets.length === 4 && sourceOctets.length === 4) {
      const expectedSubnet = expectedOctets.slice(0, 3).join('.');
      const sourceSubnet = sourceOctets.slice(0, 3).join('.');
      return expectedSubnet === sourceSubnet;
    }

    return false; // Invalid IP format or different subnet
  }

  start() {
    this.socket.on('message', (msg, rinfo) => {
      // Echo the RTP packet back to sender with symmetric RTP latching
      if (this.active && this.validateRtpSource(rinfo.address)) {
        // Update RTP statistics
        this.rtpStats.packetsReceived++;
        this.rtpStats.bytesReceived += msg.length;
        const now = Date.now();
        if (!this.rtpStats.firstPacketTime) {
          this.rtpStats.firstPacketTime = now;
        }
        this.rtpStats.lastPacketTime = now;

        // Log source changes for security monitoring (only when address actually changes)
        if (!this.rtpLatched || this.remoteAddr !== rinfo.address || this.remotePort !== rinfo.port) {
          console.log(`RTP latching to ${rinfo.address}:${rinfo.port} (was ${this.remoteAddr}:${this.remotePort})`);
        }

        // Latch to actual RTP source address/port (RFC 4961 symmetric RTP)
        this.remoteAddr = rinfo.address;
        this.remotePort = rinfo.port;
        this.rtpLatched = true;

        // Parse and echo RTP packet using rtp.js
        try {
          const rtpView = rtpJsUtils.nodeBufferToDataView(msg);
          if (rtpJsPackets.isRtp(rtpView)) {
            // Parse the incoming RTP packet for dynamic frame size detection
            const incomingPacket = new rtpJsPackets.RtpPacket(rtpView);
            const timestamp = incomingPacket.getTimestamp();
            const seqNum = incomingPacket.getSequenceNumber();
            const payloadLength = incomingPacket.getPayload().byteLength;

            // Detect frame size from timestamp differences
            if (this.lastReceivedTimestamp !== null && this.lastReceivedSeqNum !== null) {
              const seqDiff = (seqNum - this.lastReceivedSeqNum + 0x10000) & 0xFFFF;
              if (seqDiff === 1) {
                // Consecutive packet - calculate timestamp increment with wraparound handling
                const timestampDiff = (timestamp - this.lastReceivedTimestamp + 0x100000000) & 0xFFFFFFFF;
                // Sanity check: frame size should be between 80 (5ms) and 1920 (40ms at 48kHz)
                if (timestampDiff > 80 && timestampDiff < 1920) {
                  this.detectedSamplesPerFrame = timestampDiff;

                  // Also try to detect from payload if possible (log only once)
                  const payloadSamples = this.calculateSamplesFromPayload(payloadLength);
                  if (payloadSamples !== null && payloadSamples === timestampDiff && !this.frameSizeConfirmed) {
                    console.log(`Dynamic frame size confirmed: ${timestampDiff} samples (${payloadLength} bytes)`);
                    this.frameSizeConfirmed = true;
                  }
                }
              }
            }

            this.lastReceivedTimestamp = timestamp;
            this.lastReceivedSeqNum = seqNum;

            // Echo packet back
            this.socket.send(msg, rinfo.port, rinfo.address);
            this.rtpStats.packetsSent++;
            this.rtpStats.bytesSent += msg.length;
          } else {
            console.warn('Received non-RTP packet, ignoring');
          }
        } catch (error) {
          console.warn('Error parsing RTP packet:', error.message);
        }
      } else if (this.active) {
        console.warn(`Rejected RTP from untrusted source: ${rinfo.address}:${rinfo.port}`);
      }
    });

    this.socket.bind(this.localPort, process.env.LOCAL_IP, () => {
      console.log(`RTP echo listening on ${process.env.LOCAL_IP}:${this.localPort}`);
      this.active = true;

      // Send initial silence packets to establish symmetric RTP
      this.sendInitialSilence();

      // Start RTCP socket and reports
      this.startRtcp();
    });
  }

  startRtcp() {
    // Create RTCP socket on RTP port + 1 (standard convention)
    this.rtcpSocket = dgram.createSocket('udp4');
    const rtcpPort = this.localPort + 1;

    this.rtcpSocket.bind(rtcpPort, process.env.LOCAL_IP, () => {
      console.log(`RTCP listening on ${process.env.LOCAL_IP}:${rtcpPort}`);
      console.log(`Expected remote RTCP port: ${this.remotePort + 1} (RTP port ${this.remotePort} + 1)`);

      // Send periodic RTCP Sender Reports (every 5 seconds)
      this.rtcpInterval = setInterval(() => {
        this.sendRtcpSenderReport();
      }, 5000);
    });

    // Handle incoming RTCP packets with symmetric latching
    this.rtcpSocket.on('message', (msg, rinfo) => {
      try {
        const rtcpView = rtpJsUtils.nodeBufferToDataView(msg);
        if (rtpJsPackets.isRtcp(rtcpView)) {
          // Implement symmetric RTCP latching (like symmetric RTP)
          if (!this.rtcpLatched) {
            console.log(`RTCP latching to ${rinfo.address}:${rinfo.port} (was expecting ${this.remoteAddr}:${this.remotePort + 1})`);
            this.rtcpLatched = true;
          }

          // Always update to actual source (symmetric RTCP)
          this.remoteRtcpAddr = rinfo.address;
          this.remoteRtcpPort = rinfo.port;

          console.log(`Received RTCP packet from ${rinfo.address}:${rinfo.port}`);
          // Parse RTCP for statistics or other processing if needed
        }
      } catch (error) {
        console.warn('Error parsing RTCP packet:', error.message);
      }
    });
  }

  sendRtcpSenderReport() {
    if (!this.rtpLatched) return; // No point sending RTCP before RTP is established

    try {
      // Create Sender Report
      const sr = new rtpJsPackets.SenderReportPacket();
      sr.setSsrc(this.rtpPacket.getSsrc());

      // Calculate NTP timestamp (current time)
      const now = Date.now();
      const ntpMs = now + 2208988800000; // Convert to NTP epoch (milliseconds)
      const ntpSeconds = Math.floor(ntpMs / 1000);
      const ntpFraction = Math.floor((ntpMs % 1000) * 0xFFFFFFFF / 1000);
      sr.setNtpSeconds(ntpSeconds);
      sr.setNtpFraction(ntpFraction);

      // RTP timestamp should align with current codec timing
      sr.setRtpTimestamp(this.rtpPacket.getTimestamp());
      sr.setPacketCount(this.rtpStats.packetsSent);
      sr.setOctetCount(this.rtpStats.bytesSent);

      // Create compound RTCP packet
      const compound = new rtpJsPackets.CompoundPacket();
      compound.setPackets([sr]);

      // Send RTCP packet using symmetric latching if available
      const rtcpView = compound.getView();
      const rtcpBuffer = rtpJsUtils.dataViewToNodeBuffer(rtcpView);

      // Use latched RTCP address if available, otherwise fall back to RTP port + 1
      const targetAddr = this.rtcpLatched ? this.remoteRtcpAddr : this.remoteAddr;
      const targetPort = this.rtcpLatched ? this.remoteRtcpPort : (this.remotePort + 1);

      this.rtcpSocket.send(rtcpBuffer, targetPort, targetAddr);

      const latchStatus = this.rtcpLatched ? " (latched)" : " (default RTP+1)";
      const frameInfo = this.detectedSamplesPerFrame ?
        ` [dynamic frame: ${this.detectedSamplesPerFrame} samples]` : '';
      console.log(`Sent RTCP SR to ${targetAddr}:${targetPort}${latchStatus}: packets=${sr.getPacketCount()}, bytes=${sr.getOctetCount()}${frameInfo}`);
    } catch (error) {
      console.warn('Error sending RTCP Sender Report:', error.message);
    }
  }

  sendInitialSilence() {
    // Send 5 packets of silence using the negotiated codec to prime symmetric RTP
    const silencePayload = this.createSilencePayload();
    let packetCount = 0;
    const totalPackets = 5;

    // Use single interval timer instead of multiple setTimeout to prevent bunching under load
    const silenceInterval = setInterval(() => {
      if (packetCount >= totalPackets) {
        clearInterval(silenceInterval);
        return;
      }

      this.sendRtpPacket(silencePayload, packetCount === 0); // marker bit on first packet
      console.log(`Sent ${this.codec.codec} silence packet ${packetCount + 1}/${totalPackets} to prime RTP`);
      packetCount++;
    }, 20); // Send every 20ms
  }

  sendRtpPacket(payload, marker = false) {
    // Update RTP packet fields
    this.rtpPacket.setMarker(marker);
    this.rtpPacket.setPayload(rtpJsUtils.nodeBufferToDataView(payload));

    // Use dynamically detected frame size if available, otherwise fall back to default
    const samplesPerFrame = this.detectedSamplesPerFrame || this.samplesPerFrame;

    // For codecs where we can calculate from payload, verify against detected value
    const payloadSamples = this.calculateSamplesFromPayload(payload.length);
    if (payloadSamples !== null && this.detectedSamplesPerFrame &&
        payloadSamples !== this.detectedSamplesPerFrame) {
      console.log(`Frame size mismatch: payload suggests ${payloadSamples} samples, ` +
                  `but detected ${this.detectedSamplesPerFrame} from timestamps`);
    }

    // Update timestamp and sequence number
    const newTimestamp = this.rtpPacket.getTimestamp() + samplesPerFrame;
    this.rtpPacket.setTimestamp(newTimestamp);

    const newSeqNum = (this.rtpPacket.getSequenceNumber() + 1) & 0xFFFF;
    this.rtpPacket.setSequenceNumber(newSeqNum);

    // Get serialized packet view and convert to Buffer
    const rtpView = this.rtpPacket.getView();
    const rtpBuffer = rtpJsUtils.dataViewToNodeBuffer(rtpView);
    this.socket.send(rtpBuffer, this.remotePort, this.remoteAddr);

    // Update statistics
    this.rtpStats.packetsSent++;
    this.rtpStats.bytesSent += rtpBuffer.length;
  }

  createSilencePayload() {
    switch (this.codec.codec.toUpperCase()) {
      case 'OPUS':
        // OPUS silence frame (minimal valid OPUS packet)
        return Buffer.from([0xf8, 0xff, 0xfe]); // OPUS silence frame
      case 'PCMU':
        // PCMU silence (160 bytes of 0xFF for 20ms at 8kHz)
        return Buffer.alloc(160, 0xFF);
      case 'PCMA':
        // PCMA silence (160 bytes of 0xD5 for 20ms at 8kHz) - canonical positive zero
        return Buffer.alloc(160, 0xD5);
      default:
        // Fallback to PCMU silence
        return Buffer.alloc(160, 0xFF);
    }
  }


  stop() {
    this.active = false;
    this.socket.close();

    // Clean up RTCP resources
    if (this.rtcpInterval) {
      clearInterval(this.rtcpInterval);
      this.rtcpInterval = null;
    }
    if (this.rtcpSocket) {
      this.rtcpSocket.close();
      this.rtcpSocket = null;
    }

    // Reset latching state
    this.rtpLatched = false;
    this.rtcpLatched = false;
    this.remoteRtcpAddr = null;
    this.remoteRtcpPort = null;
    this.frameSizeConfirmed = false;
  }
}

// Connect to drachtio server
srf.connect({
  host: process.env.DRACHTIO_HOST,
  port: process.env.DRACHTIO_PORT,
  secret: process.env.DRACHTIO_SECRET
});

srf.on('connect', async (err, hp) => {
  if (err) {
    console.error('Error connecting to drachtio:', err);
    process.exit(1);
  }
  console.log(`Connected to drachtio server at ${hp}`);

  // Register with SIP server
  try {
    await registerWithSipServer();
  } catch (error) {
    console.error('Registration failed:', error);
    process.exit(1);
  }
});

// Keep track of active RTP sessions
const rtpSessions = new Map();
let nextRtpPort = parseInt(process.env.RTP_PORT_MIN);

// Register with SIP server
async function registerWithSipServer() {
  const uri = `sip:${process.env.SIP_USERNAME}@${process.env.SIP_DOMAIN}:${process.env.SIP_PORT}`;
  const contact = `sip:${process.env.SIP_USERNAME}@${process.env.LOCAL_IP}:${process.env.DRACHTIO_SIP_PORT}`;

  console.log(`Registering as ${uri}`);

  const register = await srf.request(uri, {
    method: 'REGISTER',
    headers: {
      'To': `sip:${process.env.SIP_USERNAME}@${process.env.SIP_DOMAIN}`,
      'From': `sip:${process.env.SIP_USERNAME}@${process.env.SIP_DOMAIN}`,
      'Contact': contact,
      'Expires': '3600',
      'User-Agent': 'firefly/1.0'
    },
    auth: {
      username: process.env.SIP_USERNAME,
      password: process.env.SIP_PASSWORD,
    }
  });

  // Handle registration response
  register.on('response', (res) => {
    if (res.status === 200) {
      console.log('Successfully registered with SIP server');
      // Re-register before expiration
      setTimeout(() => registerWithSipServer(), 3500 * 1000);
    } else if (res.status === 401 || res.status === 407) {
      console.log('Authentication challenge received, retrying...');
    } else {
      // Fatal registration errors - exit immediately
      console.error(`Registration failed with status ${res.status}`);
      if (res.status === 403) {
        console.error('Authentication failed - check username/password');
      } else if (res.status >= 400) {
        console.error('Fatal SIP registration error');
      }
      process.exit(1);
    }
  });
}

// Handle incoming calls
srf.invite(async (req, res) => {
  console.log('Incoming call from:', req.get('From'));
  console.log('To:', req.get('To'));

  const diversion = req.get('Diversion');
  if (diversion) {
    console.log('Call forwarded from:', diversion);
  }

  try {
    // Parse offered SDP
    const offer = sdpTransform.parse(req.body);
    const audioMedia = offer.media.find(m => m.type === 'audio');

    if (!audioMedia) {
      console.error('No audio media in offer');
      return res.send(488); // Not Acceptable Here
    }

    // Get remote RTP details
    const remoteAddr = offer.connection?.ip || offer.origin.address;
    const remotePort = audioMedia.port;

    // Allocate local RTP port
    const localPort = nextRtpPort;
    nextRtpPort += 2; // Skip RTCP port
    if (nextRtpPort > parseInt(process.env.RTP_PORT_MAX)) {
      nextRtpPort = parseInt(process.env.RTP_PORT_MIN);
    }

    // Get negotiated codec info
    const negotiatedCodec = audioMedia.rtp[0];
    console.log(`Negotiated codec: ${negotiatedCodec.codec} (payload ${negotiatedCodec.payload}, rate ${negotiatedCodec.rate})`);

    // Create echo handler with codec info
    const rtpEcho = new RtpEcho(localPort, remotePort, remoteAddr, negotiatedCodec);
    rtpEcho.start();

    // Build answer SDP with proper codec handling
    const answerRtp = {
      payload: negotiatedCodec.payload,
      codec: negotiatedCodec.codec,
      rate: negotiatedCodec.rate
    };

    // Handle OPUS special encoding (add /2 for channels)
    if (negotiatedCodec.codec.toUpperCase() === 'OPUS') {
      answerRtp.encoding = negotiatedCodec.encoding || '2'; // Default to 2 channels if not specified
    }

    const answer = {
      version: 0,
      origin: {
        username: '-',
        sessionId: Date.now(),
        sessionVersion: 0,
        netType: 'IN',
        ipVer: 4,
        address: process.env.LOCAL_IP
      },
      name: 'firefly',
      connection: {
        version: 4,
        ip: process.env.LOCAL_IP
      },
      timing: { start: 0, stop: 0 },
      media: [{
        rtp: [answerRtp],
        type: 'audio',
        port: localPort,
        protocol: 'RTP/AVP',
        payloads: negotiatedCodec.payload.toString(),
        ptime: audioMedia.ptime || 20,
        sendrecv: 'sendrecv'
      }]
    };

    const answerSdp = sdpTransform.write(answer);

    // Create UAS dialog with SDP answer
    const dialog = await srf.createUAS(req, res, {
      localSdp: answerSdp,
      headers: {
        'Contact': `<sip:firefly@${process.env.LOCAL_IP}:${process.env.DRACHTIO_SIP_PORT}>`,
        'Allow': 'INVITE, ACK, BYE, CANCEL, OPTIONS, MESSAGE, INFO, UPDATE',
        'Supported': 'timer'
      }
    });

    console.log(`Call established, echoing RTP on port ${localPort}`);

    // Store session using dialog ID
    rtpSessions.set(dialog.id, rtpEcho);

    // Handle specific SIP methods during call
    dialog.on('update', (req, res) => {
      console.log('Received UPDATE request - session refresh');
      res.send(200);
    });

    dialog.on('info', (req, res) => {
      console.log('Received INFO request');
      res.send(200);
    });

    dialog.on('modify', (req, res) => {
      console.log('Received re-INVITE (modify)');
      res.send(200, {
        body: answerSdp,
        headers: {
          'Content-Type': 'application/sdp'
        }
      });
    });

    // Log when dialog is fully established
    dialog.on('ack', () => {
      console.log('Dialog fully established - ACK received');
    });

    // Handle call termination
    dialog.on('destroy', () => {
      console.log('Call ended');
      const echo = rtpSessions.get(dialog.id);
      if (echo) {
        echo.stop();
        rtpSessions.delete(dialog.id);
      }
    });

  } catch (error) {
    console.error('Error handling INVITE:', error);
    res.send(500);
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  rtpSessions.forEach(echo => echo.stop());
  srf.disconnect();
  process.exit(0);
});