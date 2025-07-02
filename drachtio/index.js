require('dotenv').config();
const Srf = require('drachtio-srf');
const sdpTransform = require('sdp-transform');
const dgram = require('dgram');

const srf = new Srf();

// RTP echo handler
class RtpEcho {
  constructor(localPort, remotePort, remoteAddr) {
    this.localPort = localPort;
    this.remotePort = remotePort;
    this.remoteAddr = remoteAddr;
    this.socket = dgram.createSocket('udp4');
    this.active = false;
    this.ssrc = Math.floor(Math.random() * 0xFFFFFFFF); // Random SSRC
    this.sequenceNumber = Math.floor(Math.random() * 0xFFFF);
    this.timestamp = Math.floor(Math.random() * 0xFFFFFFFF);
  }

  start() {
    this.socket.on('message', (msg, rinfo) => {
      // Echo the RTP packet back to sender
      if (this.active && rinfo.address === this.remoteAddr) {
        this.socket.send(msg, this.remotePort, this.remoteAddr);
      }
    });

    this.socket.bind(this.localPort, process.env.LOCAL_IP, () => {
      console.log(`RTP echo listening on ${process.env.LOCAL_IP}:${this.localPort}`);
      this.active = true;
      
      // Send initial silence packets to establish symmetric RTP
      this.sendInitialSilence();
    });
  }

  sendInitialSilence() {
    // Send 5 packets of silence (PCMU payload type 0) to prime symmetric RTP
    const silencePayload = Buffer.alloc(160, 0xFF); // 160 bytes of PCMU silence (0xFF)
    
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        const rtpPacket = this.createRtpPacket(0, silencePayload); // Payload type 0 = PCMU
        this.socket.send(rtpPacket, this.remotePort, this.remoteAddr);
        console.log(`Sent silence packet ${i + 1}/5 to prime RTP`);
      }, i * 20); // Send every 20ms
    }
  }

  createRtpPacket(payloadType, payload) {
    const header = Buffer.alloc(12);
    
    // RTP version 2, no padding, no extension, no CSRC
    header[0] = 0x80;
    // Payload type
    header[1] = payloadType;
    // Sequence number (big endian)
    header.writeUInt16BE(this.sequenceNumber++, 2);
    // Timestamp (big endian)
    header.writeUInt32BE(this.timestamp, 4);
    this.timestamp += 160; // Increment by 160 samples (20ms at 8kHz)
    // SSRC (big endian)
    header.writeUInt32BE(this.ssrc, 8);
    
    return Buffer.concat([header, payload]);
  }

  stop() {
    this.active = false;
    this.socket.close();
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
      'Contact': contact,
      'Expires': '3600',
      'User-Agent': 'drachtio-echo/1.0'
    },
    auth: {
      username: process.env.SIP_USERNAME,
      password: process.env.SIP_PASSWORD
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
      console.error(`Registration failed with status ${res.status}`);
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

    // Create echo handler
    const rtpEcho = new RtpEcho(localPort, remotePort, remoteAddr);
    rtpEcho.start();

    // Build answer SDP
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
      name: 'drachtio-echo',
      connection: {
        version: 4,
        ip: process.env.LOCAL_IP
      },
      timing: { start: 0, stop: 0 },
      media: [{
        rtp: [{
          payload: audioMedia.rtp[0].payload,
          codec: audioMedia.rtp[0].codec,
          rate: audioMedia.rtp[0].rate
        }],
        type: 'audio',
        port: localPort,
        protocol: 'RTP/AVP',
        payloads: audioMedia.payloads,
        ptime: audioMedia.ptime || 20,
        sendrecv: 'sendrecv'
      }]
    };

    const answerSdp = sdpTransform.write(answer);
    
    // Create UAS dialog with SDP answer
    const dialog = await srf.createUAS(req, res, {
      localSdp: answerSdp
    });

    console.log(`Call established, echoing RTP on port ${localPort}`);
    
    // Store session using dialog ID
    rtpSessions.set(dialog.id, rtpEcho);

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