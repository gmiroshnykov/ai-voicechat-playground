# Firefly - VoIP to OpenAI Realtime API Bridge (TypeScript)

A production-ready SIP service built with TypeScript that bridges telephone calls to OpenAI's Realtime API, enabling AI-powered voice conversations over traditional phone networks.

## Features

- **SIP Registration**: Registers as a SIP endpoint with any SIP server
- **Call Handling**: Accepts incoming SIP calls with proper SDP negotiation
- **OpenAI Integration**: Bridges telephone calls directly to OpenAI Realtime API with G.711 support
- **Codec Support**: OPUS, PCMU (G.711 μ-law), PCMA (G.711 A-law), G.722
- **NAT Traversal**: Symmetric RTP/RTCP with dynamic latching
- **RTCP Reports**: Sends periodic sender reports for call quality
- **Multi-tenant Support**: Extracts call context from Diversion headers
- **Production Ready**: Built for Kyivstar VoIP integration with proper error handling
- **Type Safety**: Full TypeScript with strict mode for reliability

## Architecture

```
Caller → SIP Server → drachtio-server → Firefly (TypeScript)
           ↓                                    ↓
         [RTP] ←────── G.711 PCMA ──────── [RTP Handler]
                                               ↓
                                     OpenAI Realtime API
                                        (WebSocket)
```

### Key Components

- **Config Module**: Type-safe environment configuration with validation
- **SIP Module**: Registration and call handling with drachtio-srf  
- **RTP Module**: Modular RTP/RTCP session management with OpenAI bridge
- **OpenAI Module**: WebSocket connection to Realtime API with G.711 audio streaming
- **Utils**: Structured logging and custom error handling

## Prerequisites

1. **Node.js** - Version 18 or higher
2. **TypeScript** - Version 5.x (installed as dev dependency)
3. **Drachtio Server** - You'll need drachtio-server running:

   ```bash
   # Option 1: Docker (recommended for testing)
   docker run -d --name drachtio --net=host \
     drachtio/drachtio-server:latest \
     drachtio --contact "sip:*:5060;transport=udp" --loglevel info

   # Option 2: Build from source (see drachtio docs)
   ```

## Installation

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build
```

## Configuration

Environment variables for development. Key variables:

### Core Settings
- `SIP_PROVIDER`: "freeswitch" (default) or "kyivstar"
- `LOCAL_IP`: Your machine's IP address (required)
- `LOG_LEVEL`: trace, debug, info, warn, error (default: info)

### SIP Configuration
- `SIP_DOMAIN`: SIP server domain
- `SIP_USERNAME`: SIP registration username
- `SIP_PASSWORD`: SIP registration password
- `SIP_PORT`: SIP server port (default: 5060)

### Drachtio Configuration
- `DRACHTIO_HOST`: drachtio-server host (default: 127.0.0.1)
- `DRACHTIO_PORT`: drachtio-server port (default: 9022)
- `DRACHTIO_SECRET`: drachtio-server secret (default: cymru)

### RTP Configuration
- `RTP_PORT_MIN`: Minimum RTP port (default: 10000)
- `RTP_PORT_MAX`: Maximum RTP port (default: 20000)

### OpenAI Configuration
- `OPENAI_API_KEY`: Your OpenAI API key (required for chat mode)

### Provider-Specific Configuration

**FreeSWITCH (Development)**:
- Default settings work out of the box
- Add user to FreeSWITCH directory

**Kyivstar (Production)**:
- Set `SIP_PROVIDER="kyivstar"`
- Configure credentials via Kubernetes Secrets

## Running

```bash
# Echo mode (default) - RTP packets are echoed back
npm start

# Chat mode - Bridge calls to OpenAI Realtime API  
npm start -- --mode chat

# Production (pre-built)
node dist/index.js --mode chat

# Type checking only
npm run typecheck

# Clean build artifacts
npm run clean
```

### Modes

**Echo Mode** (`--mode echo` or default):
- Traditional RTP echo service
- Good for VoIP testing and connectivity verification

**Chat Mode** (`--mode chat`):
- Bridges phone calls to OpenAI Realtime API
- Requires `OPENAI_API_KEY` environment variable
- AI agent starts conversation in Ukrainian
- Supports hang up via AI assistant
- No transcoding - direct G.711 PCMA audio streaming

## Testing with FreeSWITCH

1. Add a user in FreeSWITCH's `directory/default.xml`:
   ```xml
   <user id="firefly">
     <params>
       <param name="password" value="password"/>
     </params>
   </user>
   ```

2. Start Firefly:
   ```bash
   npm start
   ```

3. Make a call to the `firefly` extension from any SIP client

## Development

### Project Structure

```
src/
├── index.ts              # Application entry point
├── config/
│   ├── index.ts         # Configuration loader
│   └── types.ts         # Config type definitions
├── sip/
│   ├── SipHandler.ts    # INVITE handling
│   ├── SipRegistrar.ts  # Registration management
│   └── types.ts         # SIP-related types
├── rtp/
│   ├── RtpSession.ts    # Base RTP session class
│   ├── RtpEchoSession.ts # Echo implementation
│   ├── RtpBridgeSession.ts # OpenAI bridge implementation
│   ├── RtpManager.ts    # Port allocation & lifecycle
│   ├── RtcpHandler.ts   # RTCP reports
│   ├── CodecHandler.ts  # Codec-specific logic
│   └── types.ts         # RTP/RTCP types
├── utils/
│   ├── logger.ts        # Structured logging
│   └── errors.ts        # Custom error classes
└── types/
    └── external.d.ts    # External library types
```

### OpenAI Bridge Implementation

The OpenAI Realtime API integration includes:

1. **RtpBridgeSession**: Extends `RtpSession` with OpenAI WebSocket connection
2. **Audio Processing**: Direct G.711 PCMA streaming without transcoding
3. **Session Management**: Proper connection lifecycle and error handling
4. **AI Tools**: Hang up functionality for conversation completion
5. **Multi-language**: Starts in Ukrainian, switches to English on request

### Type Safety

The project uses TypeScript strict mode with:
- No implicit any
- Strict null checks
- No unchecked indexed access
- All compiler checks enabled

## Monitoring

The application provides structured JSON logging with:
- Call context (callId, from, to, diversion)
- RTP statistics (packets, bytes, jitter)
- Session lifecycle events
- Error tracking with stack traces

## Features Implemented

- [x] OpenAI Realtime API integration with G.711 PCMA
- [x] Ukrainian/English language switching
- [x] AI-controlled call termination
- [x] Real-time audio streaming without transcoding
- [x] Proper cleanup and resource management

## Future Enhancements

- [ ] WebSocket control interface
- [ ] Prometheus metrics export  
- [ ] Dynamic codec transcoding
- [ ] DTMF detection and handling
- [ ] Conference bridge support
- [ ] REST API for call control
- [ ] Call transfer capabilities

## License

ISC