# Firefly VoIP Platform

An experimental VoIP system that bridges telephone calls to OpenAI's Realtime API, enabling AI-powered voice conversations over traditional phone networks. This research project explores implementing production-grade telephony features including multi-tenant support and carrier integration, though currently tested only in development environments.

## Features (Current Implementation)

- **Direct SIP Registration:** Built-in SIP registrar accepting client registrations (Linphone, softphones)
- **PSTN-to-AI Bridge:** Direct telephone calls to OpenAI Realtime API (experimental)
- **Stream-Based Audio Pipeline:** Node.js Transform streams for composable real-time audio processing
- **Adaptive RTP Scheduling:** Buffer-depth based packet scheduling (not fixed timing) for optimal flow control
- **Advanced Jitter Buffer:** Packet reordering, loss recovery, and comfort noise generation
- **Call Recording:** Timestamp-synchronized stereo recording with RTP metadata preservation
- **Call Context Preservation:** Caller ID and call metadata extraction (via Diversion headers)
- **Multi-Provider Support:** Direct SIP mode, Kyivstar, or external VoIP providers with symmetric RTP support
- **Audio Processing Features:** AI tempo adjustment, codec negotiation, and NAT traversal

*Note: Multi-tenant routing and production reliability features are designed but require further testing with real carrier deployments.*

## Quick Start

### Prerequisites

- Devbox (handles dependencies via Nix)
- Kubernetes (Docker Desktop or minikube)
- OpenAI API Key (for AI chat features)
- SIP client (Linphone, softphone) for testing

### Setup

```bash
git clone https://github.com/gmiroshnykov/ai-voicechat-playground.git
cd ai-voicechat-playground

# Use devbox for consistent environment
devbox shell

# Set up environment variables
cp .envrc.local.example .envrc.local
# Edit .envrc.local and add your OPENAI_API_KEY

# Start the development environment
tilt up
```

## Components

### Firefly VoIP Service ([firefly/](firefly/))
The main experimental VoIP service - TypeScript-based SIP server with built-in registrar:
- **Stream-Based Architecture:** Composable audio processing pipeline using Node.js Transform streams
- **Direct SIP Registration:** Accepts registrations from SIP clients (no external PBX needed)
- **Multi-Provider Support:** Direct mode, Kyivstar VoIP, or external SIP providers with symmetric RTP
- **OpenAI Integration:** Real-time AI conversation bridging with tempo adjustment
- **Advanced Audio Processing:** G.711 PCMA/PCMU, OPUS support with adaptive jitter buffer and packet loss recovery
- **Intelligent RTP Scheduling:** Buffer-depth based adaptive scheduling for optimal audio flow
- **Call Recording:** Timestamp-synchronized stereo recording with complete metadata
- **NAT Traversal:** RTP latching, symmetric RTP support, and RTCP handling

### Drachtio SIP Server
High-performance SIP server handling protocol operations:
- SIP message parsing and routing
- Authentication and registration management  
- Media negotiation and RTP handling
- Managed via Docker Compose

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
PSTN/Mobile Phone → VoIP Provider (Kyivstar) → Firefly (TypeScript) → OpenAI Realtime API
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

**Testing Modes:**
- `--mode chat`: Bridge calls to OpenAI Realtime API for AI conversations
- `--mode echo`: Audio echo testing for debugging RTP/codec issues
- Extension `123`: Test audio playback with tempo adjustment support for codec/timing validation
- Built-in silence generation and comfort noise for packet loss scenarios
- Comprehensive RTP statistics and jitter buffer monitoring
- G.711 PCMA/PCMU support for minimal latency

## Documentation

- **[Firefly Guide](firefly/README.md)** - Main VoIP service with SIP registrar and OpenAI integration
- **[Audio Files Guide](audio/README.md)** - Test audio specifications
- **[DESIGN.md](DESIGN.md)** - System architecture and design decisions

## Development

```bash
devbox shell
tilt up  # Starts complete stack with live reload

# View Tilt web UI at http://localhost:10350
```

## Current Status

This project implements a complete SIP-to-AI bridge with both direct registration and external provider support, but remains experimental. Current validation includes:

- ✅ **Direct SIP registration** accepting connections from standard SIP clients
- ✅ **Basic PSTN-to-AI bridging** with personal VoIP provider testing
- ✅ **Sophisticated packet handling** including jitter buffer and loss recovery
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
- Use `.envrc.local` for sensitive configuration (VoIP provider credentials)
- Call recordings may contain sensitive information - secure appropriately
- ⚠️ **Research Use**: Not yet security-audited for production deployment

## Contributing

This project was developed collaboratively with Claude Code, Gemini, and OpenAI Codex as an exploration of AI-assisted software engineering.

## License

This project is licensed under the AGPL-3.0 License.
