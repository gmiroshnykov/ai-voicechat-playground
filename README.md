# Firefly VoIP Platform

An experimental VoIP system that bridges telephone calls to OpenAI's Realtime API, enabling AI-powered voice conversations over traditional phone networks. This research project explores implementing production-grade telephony features including multi-tenant support and carrier integration, though currently tested only in development environments.

## Features (Current Implementation)

- **PSTN-to-AI Bridge:** Direct telephone calls to OpenAI Realtime API (experimental)
- **Advanced VoIP Handling:** SIP/RTP with NAT traversal, jitter buffer, packet loss recovery
- **Call Recording:** Stereo audio recording with metadata storage
- **Call Context Preservation:** Caller ID and call metadata extraction (via Diversion headers)
- **Kyivstar Compatibility:** Designed for symmetric RTP and carrier-specific requirements
- **Research-Grade Implementation:** Sophisticated packet handling and audio processing

*Note: Multi-tenant routing and production reliability features are designed but require further testing with real carrier deployments.*

## Quick Start

### Prerequisites

- Node.js 18+
- OpenAI API Key (for AI chat features)
- SIP credentials or FreeSWITCH for testing

### Basic Setup

```bash
git clone https://github.com/gmiroshnykov/ai-voicechat-playground.git
cd ai-voicechat-playground

# Use devbox for consistent environment (recommended)
devbox shell

# Set up Firefly service
cd firefly
npm install
npm run build

# Start FreeSWITCH for local testing
cd ../freeswitch
./run.sh
```

## Components

### Firefly VoIP Service ([firefly/](firefly/))
The main experimental VoIP service - TypeScript-based SIP/RTP bridge to OpenAI Realtime API:
- G.711 PCMA/PCMU direct passthrough (no transcoding)
- Jitter buffer with packet loss recovery
- Stereo call recording with metadata
- Ukrainian/English AI assistant (experimental)
- NAT traversal and RTCP support

### FreeSWITCH PBX ([freeswitch/](freeswitch/))
Local testing infrastructure - VoIP PBX for development and testing:
- Pre-configured dialplan for Firefly integration
- SIP user registration for local testing
- Audio codec support
- Call routing and management

### Audio Test Files ([audio/](audio/))
Sample audio files for testing and development.

## Architecture

```
PSTN/Mobile Phone → VoIP Provider/FreeSWITCH → Firefly (TypeScript) → OpenAI Realtime API
                                                       ↓
                                            Call Recording & Metadata
```

### Directory Structure
```
firefly-voip-platform/
├── firefly/              # Main VoIP service (TypeScript)
├── freeswitch/           # Local PBX for testing
├── audio/                # Test audio files
├── recordings/           # Call recordings (generated)
└── docker-compose.yml    # Drachtio server
```

## Usage Patterns

**Target Use Case (Designed For):**
- Bridge PSTN calls via Kyivstar VoIP service to OpenAI Realtime API
- Multi-tenant routing based on forwarding subscriber (Diversion headers)
- Production telephony handling with concurrent calls and reliability
- ⚠️ **Current Status**: Designed but only tested in development environments

**Current Experimental Testing:**
- Use `firefly/` with `--mode chat` to bridge phone calls to OpenAI Realtime API
- Tested with personal laptop setup and VoIP provider credentials
- G.711 PCMA direct passthrough for minimal latency
- AI agent starts in Ukrainian, switches to English when prompted

**Local Development and Testing:**
- Use `freeswitch/` PBX for local SIP testing without carrier costs
- Use `firefly/` with `--mode echo` for audio echo testing
- Test with any SIP client (softphone apps)
- Mock call forwarding scenarios and various call flows

## Documentation

- **[Firefly Guide](firefly/README.md)** - Main experimental VoIP service with OpenAI integration
- **[FreeSWITCH Guide](freeswitch/README.md)** - Local PBX setup for testing and development
- **[Audio Files Guide](audio/README.md)** - Test audio specifications
- **[DESIGN.md](DESIGN.md)** - System architecture and design decisions

## Development

Use [Devbox](https://www.jetify.com/devbox) for consistent development environment:

```bash
devbox shell
cd firefly
npm install
npm run build
npm start -- --mode chat  # or --mode echo for testing
```

## Current Status

This project implements the core architecture designed for production Kyivstar VoIP integration with multi-tenant support, but remains experimental. Current validation is limited to:

- ✅ **Basic PSTN-to-AI bridging** with personal VoIP provider testing
- ✅ **Sophisticated packet handling** including jitter buffer and loss recovery
- ✅ **Call recording and metadata extraction** 
- ✅ **Diversion header parsing** for call context preservation
- ⚠️ **Not yet validated**: Multi-tenant routing in production carrier environments
- ⚠️ **Not yet validated**: Concurrent call handling under real load
- ⚠️ **Not yet validated**: Production reliability and error recovery with real users

The technical implementation follows production design principles but requires carrier deployment validation to meet the full objectives outlined in DESIGN.md.

## Security Notes

- Never commit credentials or API keys to version control
- Use `.envrc.local` for sensitive configuration (VoIP provider credentials)
- Call recordings may contain sensitive information - secure appropriately
- ⚠️ **Research Use**: Not yet security-audited for production deployment

## Contributing

This project was developed collaboratively with Claude Code, Gemini, and OpenAI Codex as an exploration of AI-assisted software engineering.

## License

This project is licensed under the AGPL-3.0 License.
