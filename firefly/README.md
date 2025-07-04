# Firefly - VoIP to OpenAI Realtime API Bridge (TypeScript)

A production-ready SIP service built with TypeScript that bridges telephone calls to OpenAI's Realtime API, enabling AI-powered voice conversations over traditional phone networks.

## Features

- **SIP Registration**: Registers as a SIP endpoint with any SIP server
- **Call Handling**: Accepts incoming SIP calls with proper SDP negotiation
- **RTP Processing**: Currently echoes RTP packets (ready for OpenAI bridge implementation)
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
         [RTP] ←──────── echo ──────────── [RTP Handler]
                                               ↓
                                    (Future: OpenAI Realtime API)
```

### Key Components

- **Config Module**: Type-safe environment configuration with validation
- **SIP Module**: Registration and call handling with drachtio-srf
- **RTP Module**: Modular RTP/RTCP session management
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

Environment variables are managed by direnv in the project root. Key variables:

- `SIP_PROVIDER`: "freeswitch" (default) or "kyivstar"
- `LOCAL_IP`: Your machine's IP address (required)
- `SIP_DOMAIN`: SIP server domain
- `SIP_USERNAME`: SIP registration username
- `SIP_PASSWORD`: SIP registration password
- `SIP_PORT`: SIP server port (default: 5060)
- `DRACHTIO_HOST`: drachtio-server host (default: 127.0.0.1)
- `DRACHTIO_PORT`: drachtio-server port (default: 9022)
- `DRACHTIO_SECRET`: drachtio-server secret (default: cymru)
- `RTP_PORT_MIN`: Minimum RTP port (default: 10000)
- `RTP_PORT_MAX`: Maximum RTP port (default: 20000)
- `LOG_LEVEL`: debug, info, warn, error (default: info)

### Provider-Specific Configuration

**FreeSWITCH (Development)**:
- Default settings work out of the box
- Add user to FreeSWITCH directory

**Kyivstar (Production)**:
- Set `SIP_PROVIDER="kyivstar"`
- Configure credentials in `.envrc.local`

## Running

```bash
# Development (build and run)
npm start

# Production (pre-built)
node dist/index.js

# Type checking only
npm run typecheck

# Clean build artifacts
npm run clean
```

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

### Adding OpenAI Bridge

To add OpenAI Realtime API support:

1. Create `RtpBridgeSession` extending `RtpSession`
2. Implement WebSocket connection to OpenAI
3. Convert RTP audio to/from OpenAI format
4. Handle session lifecycle and error cases

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

## Future Enhancements

- [ ] OpenAI Realtime API integration
- [ ] WebSocket control interface
- [ ] Prometheus metrics export
- [ ] Call recording to S3
- [ ] Dynamic codec transcoding
- [ ] DTMF detection and handling
- [ ] Conference bridge support
- [ ] REST API for call control

## License

ISC