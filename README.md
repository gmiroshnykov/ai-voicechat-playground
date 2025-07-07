# Firefly VoIP Platform

An experimental VoIP system that bridges telephone calls to OpenAI's Realtime API, enabling AI-powered voice conversations over traditional phone networks. This research project explores implementing production-grade telephony features including multi-tenant support and carrier integration, though currently tested only in development environments.

## Features (Current Implementation)

- **Direct SIP Registration:** Built-in SIP registrar accepting client registrations (Linphone, softphones)
- **PSTN-to-AI Bridge:** Direct telephone calls to OpenAI Realtime API (experimental)
- **Advanced VoIP Handling:** SIP/RTP with NAT traversal, jitter buffer, packet loss recovery
- **Call Recording:** Stereo audio recording with metadata storage
- **Call Context Preservation:** Caller ID and call metadata extraction (via Diversion headers)
- **Multi-Provider Support:** Direct SIP mode, Kyivstar, or external VoIP providers
- **Research-Grade Implementation:** Sophisticated packet handling and audio processing

*Note: Multi-tenant routing and production reliability features are designed but require further testing with real carrier deployments.*

## Quick Start

### Prerequisites

- Node.js 18+
- Docker and Docker Compose
- OpenAI API Key (for AI chat features)
- SIP client (Linphone, softphone) for testing direct mode

### Basic Setup

```bash
git clone https://github.com/gmiroshnykov/ai-voicechat-playground.git
cd ai-voicechat-playground

# Use devbox for consistent environment (recommended)
devbox shell

# Set up environment variables
cp firefly/.env.example firefly/.env
# Edit firefly/.env and add your OPENAI_API_KEY

# Start the complete stack (Drachtio + Firefly)
docker-compose up --build
```

## Components

### Firefly VoIP Service ([firefly/](firefly/))
The main experimental VoIP service - TypeScript-based SIP server with built-in registrar:
- **Direct SIP Registration:** Accepts registrations from SIP clients (no external PBX needed)
- **Multi-Provider Support:** Direct mode, Kyivstar VoIP, or external SIP providers
- **OpenAI Integration:** Real-time AI conversation bridging
- **Advanced Audio:** G.711 PCMA/PCMU, OPUS support with jitter buffer
- **Call Recording:** Stereo audio recording with metadata
- **NAT Traversal:** RTP latching and RTCP support

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
firefly-voip-platform/
├── firefly/              # Main VoIP service with SIP registrar
├── audio/                # Test audio files
├── recordings/           # Call recordings (generated)
└── docker-compose.yml    # Drachtio + Firefly services
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
- G.711 PCMA/PCMU direct passthrough for minimal latency
- AI agent starts in Ukrainian, switches to English when prompted

## Documentation

- **[Firefly Guide](firefly/README.md)** - Main VoIP service with SIP registrar and OpenAI integration
- **[Audio Files Guide](audio/README.md)** - Test audio specifications
- **[DESIGN.md](DESIGN.md)** - System architecture and design decisions

## Development

**Docker Development (Recommended):**
```bash
devbox shell
docker-compose up --build  # Starts Drachtio + Firefly
```

**Local Development:**
```bash
devbox shell

# Start Drachtio server
docker-compose up drachtio

# In separate terminal, run Firefly locally
cd firefly
npm install
npm run build
npm start -- --mode chat  # or --mode echo for testing
```

## Current Status

This project implements a complete SIP-to-AI bridge with both direct registration and external provider support, but remains experimental. Current validation includes:

- ✅ **Direct SIP registration** accepting connections from standard SIP clients
- ✅ **Basic PSTN-to-AI bridging** with personal VoIP provider testing
- ✅ **Sophisticated packet handling** including jitter buffer and loss recovery
- ✅ **Call recording and metadata extraction** 
- ✅ **Multi-provider architecture** supporting direct, Kyivstar, and external modes
- ✅ **Docker deployment** with service orchestration
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
