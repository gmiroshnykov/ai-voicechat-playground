# Firefly VoIP Platform

An experimental VoIP service connecting telephone calls to OpenAI's Realtime API, enabling AI-powered voice conversations over traditional phone networks. This research project explores implementing production-grade telephony features including intelligent call routing and carrier integration, though currently tested only in development environments.

## Features (Current Implementation)

- **Direct SIP Registration:** Built-in SIP registrar accepting client registrations (Linphone, softphones)
- **Intelligent Call Routing:** SIP URI-based routing (`sip:chat@domain`, `sip:welcome@domain`) with configurable defaults
- **FreeSWITCH Media Server:** Professional media handling with drachtio-fsmrf integration for robust audio processing
- **WebSocket Audio Streaming:** Real-time bidirectional audio streaming between FreeSWITCH and application services
- **Call Recording:** Comprehensive call recording with metadata preservation and flexible format options
- **Call Context Preservation:** Caller ID and call metadata extraction (via Diversion headers)
- **Multi-Provider Support:** Direct SIP mode, Kyivstar, or external VoIP providers with FreeSWITCH media handling
- **Audio Processing Features:** AI tempo adjustment with FreeSWITCH handling codec negotiation and RTP management

*Note: Multi-tenant routing and production reliability features are designed but require further testing with real carrier deployments.*

## Quick Start

### Prerequisites

- Kubernetes (Docker Desktop or minikube)
- OpenAI API Key (for AI chat features)
- SIP client (Linphone, softphone) for testing

### Setup

```bash
git clone https://github.com/gmiroshnykov/ai-voicechat-playground.git
cd ai-voicechat-playground

# Start the development environment
tilt up
```

## Components

### Firefly VoIP Service ([firefly/](firefly/))
The main experimental VoIP service - TypeScript-based SIP server with built-in registrar:
- **FreeSWITCH Integration:** Professional media server via drachtio-fsmrf for robust telephony features
- **Direct SIP Registration:** Accepts registrations from SIP clients (no external PBX needed)
- **WebSocket Audio Bridge:** Real-time audio streaming between FreeSWITCH and application services
- **OpenAI Integration:** Real-time AI conversation bridging with WebSocket audio streams
- **Professional Audio Handling:** FreeSWITCH manages G.711 PCMA/PCMU, codec negotiation, jitter buffering, and packet loss recovery
- **Call Recording:** Comprehensive recording capabilities with metadata and flexible output formats
- **Media Server Features:** FreeSWITCH handles RTP/RTCP, NAT traversal, and telephony protocols

### Drachtio SIP Server
High-performance SIP server handling protocol operations:
- SIP message parsing and routing
- Authentication and registration management  
- Media negotiation and session control
- Managed via Kubernetes with Helm

### FreeSWITCH Media Server
Professional media server providing telephony features:
- RTP/RTCP media handling and processing
- Codec transcoding and negotiation
- Jitter buffering and packet loss recovery
- Audio recording and playback capabilities
- Integrated via drachtio-fsmrf

### Audio Test Files ([audio/](audio/))
Sample audio files for testing and development.

## Architecture

**Direct SIP Mode (Default):**
```
SIP Client (Linphone/Softphone) → Firefly SIP Registrar → OpenAI Realtime API
                                           ↓
                                Call Recording & Metadata
```

**External Provider Mode:**
```
PSTN/Mobile Phone → VoIP Provider (Kyivstar) → Firefly Route Resolver → OpenAI/Echo/Welcome
                                                        ↓
                                             Call Recording & Metadata
```

### Directory Structure
```
ai-voicechat-playground/
├── firefly/              # Main VoIP service (TypeScript)
├── audio/                # Test audio files
├── helm/                 # Kubernetes deployment with Helm
├── utils/                # Go-based echo servers for testing
└── Tiltfile             # Development environment with Tilt
```

## Usage Patterns

**Direct SIP Mode (Default):**
- Configure any SIP client (Linphone, softphone) to register with Firefly
- Make calls directly to AI assistant without external infrastructure
- Built-in authentication (username: `linphone`, password: `test123`)
- Perfect for development, testing, and standalone deployments

**External Provider Mode:**
- Bridge PSTN calls via Kyivstar VoIP service to OpenAI Realtime API
- Multi-tenant routing based on forwarding subscriber (Diversion headers)
- Production telephony handling with concurrent calls and reliability
- ⚠️ **Current Status**: Designed but only tested in development environments

**Call Routing:**
- **Named Routes**: Call `sip:chat@domain`, `sip:welcome@domain`, `sip:echo@domain`
- **Default Route**: External calls (phone numbers) route to configurable default (welcome/echo/chat)  
- **Route Types**:
  - `chat` - OpenAI Realtime API conversations (requires OpenAI API key + `OPENAI_ENABLED=true`)
  - `echo` - Audio loopback testing via FreeSWITCH for debugging codec/media issues
  - `welcome` - Test audio playback with tempo adjustment via FreeSWITCH audio streaming
- FreeSWITCH handles silence generation, comfort noise, and packet loss recovery
- Professional telephony features including comprehensive media statistics and monitoring
- Full codec support (G.711 PCMA/PCMU, G.722, OPUS) with automatic negotiation

## Documentation

- **[Firefly Guide](firefly/README.md)** - Main VoIP service with SIP registrar and OpenAI integration
- **[Audio Files Guide](audio/README.md)** - Test audio specifications
- **[DESIGN.md](DESIGN.md)** - System architecture and design decisions

## Development

```bash
tilt up  # Starts complete stack with live reload

# View Tilt web UI at http://localhost:10350
```

## Current Status

This project implements a complete SIP-to-AI bridge with both direct registration and external provider support, but remains experimental. Current validation includes:

- ✅ **Direct SIP registration** accepting connections from standard SIP clients
- ✅ **Basic PSTN-to-AI bridging** with personal VoIP provider testing
- ✅ **Professional media handling** via FreeSWITCH with enterprise-grade telephony features
- ✅ **Call recording and metadata extraction** 
- ✅ **Multi-provider architecture** supporting direct, Kyivstar, and external modes
- ✅ **Docker deployment** with service orchestration
- ✅ **Kubernetes deployment** with Helm charts and Tilt integration
- ⚠️ **Not yet validated**: Multi-tenant routing in production carrier environments
- ⚠️ **Not yet validated**: Concurrent call handling under real load
- ⚠️ **Not yet validated**: Production reliability and error recovery with real users

The technical implementation follows production design principles but requires carrier deployment validation to meet the full objectives outlined in DESIGN.md.

## Security Notes

- Never commit credentials or API keys to version control
- Use Kubernetes Secrets for sensitive configuration (VoIP provider credentials)
- Call recordings may contain sensitive information - secure appropriately
- ⚠️ **Research Use**: Not yet security-audited for production deployment

## Contributing

This project was developed collaboratively with Claude Code, Gemini, and OpenAI Codex as an exploration of AI-assisted software engineering.

## License

This project is licensed under the AGPL-3.0 License.
