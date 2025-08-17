# Firefly - VoIP to OpenAI Realtime API Bridge (TypeScript)

A production-ready SIP service built with TypeScript that bridges telephone calls to OpenAI's Realtime API, enabling AI-powered voice conversations over traditional phone networks.

## Features

- **SIP Registration**: Registers as a SIP endpoint with any SIP server
- **Call Handling**: Accepts incoming SIP calls with proper SDP negotiation
- **FreeSWITCH Integration**: Professional media server via drachtio-fsmrf for robust telephony features
- **OpenAI Integration**: Real-time AI conversation bridging via WebSocket audio streams
- **WebSocket Audio Streaming**: Bidirectional audio streaming between FreeSWITCH and application services
- **Call Recording**: Comprehensive recording capabilities with metadata and flexible output formats
- **Multi-tenant Support**: Extracts call context from Diversion headers
- **Production Ready**: Built for carrier integration with proper error handling
- **Type Safety**: Full TypeScript with strict mode for reliability

## Architecture

```
Caller → SIP Server → drachtio-server → Firefly (TypeScript)
           ↓                                    ↓
      FreeSWITCH ←──── WebSocket Audio ──── AudioStreamServer
           ↓                                    ↓
      Media Processing                   OpenAI Realtime API
      (Recording, Echo)                    (WebSocket)
```

### Key Components

- **Config Module**: Type-safe environment configuration with validation
- **SIP Module**: Registration and call handling with drachtio-srf  
- **Audio Module**: WebSocket audio streaming and OpenAI integration
- **FreeSWITCH Handlers**: Route-specific handlers (welcome, echo, chat) via drachtio-fsmrf
- **Utils**: Structured logging and custom error handling

## Prerequisites

1. **Node.js** - Version 18 or higher
2. **TypeScript** - Version 5.x (installed as dev dependency)
3. **Drachtio Server** - SIP server for protocol handling
4. **FreeSWITCH** - Media server for audio processing

The complete stack is provided via Kubernetes/Helm deployment.

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
- `SIP_OUTBOUND_PROVIDER`: "kyivstar" or "disabled" (default: disabled)
- `SIP_INBOUND_ENABLED`: Accept SIP registrations (default: true)
- `LOG_LEVEL`: trace, debug, info, warn, error (default: info)

### SIP Configuration
- `SIP_OUTBOUND_DOMAIN`: SIP server domain (for outbound registration)
- `SIP_OUTBOUND_USERNAME`: SIP registration username
- `SIP_OUTBOUND_PASSWORD`: SIP registration password
- `SIP_OUTBOUND_PORT`: SIP server port (default: 5060)

### Drachtio Configuration
- `DRACHTIO_HOST`: drachtio-server host (default: 127.0.0.1)
- `DRACHTIO_PORT`: drachtio-server port (default: 9022)
- `DRACHTIO_SECRET`: drachtio-server secret (default: cymru)

### FreeSWITCH Configuration
- `MEDIA_SERVER_ADDRESS`: FreeSWITCH host (default: 127.0.0.1)
- `MEDIA_SERVER_PORT`: FreeSWITCH event socket port (default: 8021)
- `MEDIA_SERVER_SECRET`: FreeSWITCH event socket password (default: ClueCon)

### OpenAI Configuration
- `OPENAI_API_KEY`: Your OpenAI API key (required for chat mode)
- `OPENAI_ENABLED`: Enable OpenAI integration (default: false)

### Call Routing
- `DEFAULT_ROUTE`: Default route for external calls (welcome, echo, chat)

## Running

```bash
# Development mode
npm run dev

# Production (pre-built)
npm start

# Type checking only
npm run typecheck

# Clean build artifacts
npm run clean
```

### Route Types

**Welcome Route** (`sip:welcome@domain`):
- FreeSWITCH audio file playback via drachtio-fsmrf
- Test audio streaming and codec validation

**Echo Route** (`sip:echo@domain`):
- FreeSWITCH audio loopback via drachtio-fsmrf
- Good for VoIP testing and connectivity verification

**Chat Route** (`sip:chat@domain`):
- Bridges phone calls to OpenAI Realtime API
- Requires `OPENAI_ENABLED=true` and `OPENAI_API_KEY`
- AI agent starts conversation in Ukrainian
- Supports AI-controlled call termination
- Real-time audio streaming via WebSocket

## Development

### Project Structure

```
src/
├── index.ts              # Application entry point
├── config/
│   ├── index.ts         # Configuration loader
│   └── types.ts         # Config type definitions
├── sip/
│   ├── SipHandler.ts    # Main INVITE routing
│   ├── SipRegistrar.ts  # Outbound registration management
│   ├── SipInboundRegistrar.ts # Inbound registration handling
│   ├── DrachtioWelcomeHandler.ts # Welcome route handler
│   ├── DrachtioEchoHandler.ts # Echo route handler
│   ├── DrachtioOpenAIHandler.ts # Chat route handler
│   ├── routing.ts       # Route resolution logic
│   └── types.ts         # SIP-related types
├── audio/
│   ├── AudioStreamServer.ts # WebSocket server for FreeSWITCH
│   ├── AudioStreamConnection.ts # Individual WebSocket connections
│   ├── OpenAIBridgeConnection.ts # OpenAI Realtime API bridge
│   └── TranscriptionManager.ts # Real-time transcription
├── utils/
│   ├── logger.ts        # Structured logging
│   └── errors.ts        # Custom error classes
└── types/
    └── external.d.ts    # External library types
```

### FreeSWITCH Integration

The FreeSWITCH integration includes:

1. **drachtio-fsmrf**: Professional telephony features via FreeSWITCH
2. **WebSocket Audio Streaming**: Real-time bidirectional audio via `uuid_audio_fork`
3. **Route-Specific Handlers**: Welcome, echo, and chat implementations
4. **Professional Media Processing**: FreeSWITCH handles codecs, jitter buffering, recording
5. **OpenAI Bridge**: WebSocket audio bridge to Realtime API with transcription

### Type Safety

The project uses TypeScript strict mode with:
- No implicit any
- Strict null checks
- No unchecked indexed access
- All compiler checks enabled

## Monitoring

The application provides structured JSON logging with:
- Call context (callId, from, to, diversion)
- FreeSWITCH session events and audio statistics
- WebSocket connection lifecycle
- OpenAI Realtime API integration events
- Error tracking with stack traces

## Features Implemented

- [x] FreeSWITCH integration via drachtio-fsmrf
- [x] WebSocket audio streaming with OpenAI Realtime API
- [x] Ukrainian/English language switching
- [x] AI-controlled call termination
- [x] Real-time transcription and conversation management
- [x] Professional telephony features via FreeSWITCH
- [x] Call recording and metadata preservation

## Architecture Benefits

- **Professional Media Handling**: FreeSWITCH provides enterprise-grade telephony features
- **Simplified Development**: No custom RTP/RTCP implementation needed
- **Reliable Audio Processing**: FreeSWITCH handles codec negotiation, jitter buffering, packet loss recovery
- **Scalable WebSocket Integration**: Per-call isolated audio streaming
- **Production Ready**: Built on proven telephony infrastructure

## Future Enhancements

- [ ] WebSocket control interface for call management
- [ ] Prometheus metrics export for monitoring
- [ ] DTMF detection and handling via FreeSWITCH
- [ ] Conference bridge support
- [ ] REST API for call control
- [ ] Call transfer capabilities
- [ ] Advanced recording options (stereo, metadata)

## License

AGPL-3.0