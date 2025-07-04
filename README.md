# AI Voice Chat Playground

A comprehensive platform for real-time voice chat and audio processing, demonstrating multiple approaches to voice communication including OpenAI's Realtime API, WebRTC, and VoIP technologies.

## Features

- **Real-time Voice Chat:** Multiple implementations for conversing with AI
- **VoIP Integration:** Complete VoIP solutions from simple echo services to full PBX
- **Cross-Platform Audio:** CLI tools, web interfaces, and standalone services
- **Flexible Architecture:** Mix-and-match components for different use cases

## Quick Start

### Prerequisites

- Node.js 18+, Go 1.22+
- OpenAI API Key (for AI chat features)
- SIP credentials (for VoIP features)

### Basic Setup

```bash
git clone https://github.com/gmiroshnykov/ai-voicechat-playground.git
cd ai-voicechat-playground
npm install

# Set up environment
echo "OPENAI_API_KEY=your_api_key_here" > .env

# Use devbox for consistent environment (recommended)
devbox shell
```

For component-specific setup, see the documentation in each directory.

## Components

### CLI Tools ([bin/](bin/))
Command-line voice chat and transcription tools using OpenAI's Realtime API.

### Web Interface ([web/](web/))
Browser-based WebRTC echo service with modern UI.

### Backend Server ([server-go/](server-go/))
Go-based WebRTC server with audio recording capabilities.

### SIP Echo Service ([sip-echo/](sip-echo/))
Standalone SIP/RTP echo service for VoIP testing (Go-based).

### Firefly VoIP Service ([firefly/](firefly/))
Advanced TypeScript-based SIP/RTP echo service with NAT traversal and RTCP support.

### FreeSWITCH PBX ([freeswitch/](freeswitch/))
Full-featured VoIP PBX with echo dialplan configuration.

### Test Audio Files ([audio/](audio/))
Sample audio files for testing various components.

## Architecture

```
ai-voicechat-playground/
├── bin/                   # CLI tools (Node.js)
├── web/                   # Web interface (Next.js)
├── server-go/            # Backend server (Go)
├── sip-echo/             # SIP echo service (Go)
├── firefly/              # Advanced VoIP echo service (TypeScript)
├── freeswitch/           # VoIP PBX configuration
└── audio/                # Test audio files
```

## Usage Patterns

**For AI Voice Chat:**
- Use `bin/chat` for command-line conversations
- Use `web/` + `server-go/` for browser-based chat

**For VoIP Testing:**
- Use `sip-echo/` for lightweight Go-based SIP echo testing
- Use `firefly/` for advanced TypeScript-based SIP echo with NAT traversal
- Use `freeswitch/` for full PBX functionality

**For Development:**
- Use `bin/` tools for API testing and audio verification
- Use `audio/` files for consistent testing

## Documentation

- **[CLI Tools Guide](bin/README.md)** - Command-line tools for voice chat and transcription
- **[Web Interface Guide](web/README.md)** - Browser-based voice chat setup
- **[Backend Server Guide](server-go/README.md)** - WebRTC server architecture
- **[SIP Echo Guide](sip-echo/README.md)** - Standalone Go-based SIP service configuration
- **[Firefly Guide](firefly/README.md)** - Advanced TypeScript-based VoIP service with NAT traversal
- **[FreeSWITCH Guide](freeswitch/README.md)** - VoIP PBX deployment
- **[Audio Files Guide](audio/README.md)** - Test audio specifications

## Development

Use [Devbox](https://www.jetify.com/devbox) for consistent development environment:

```bash
devbox shell
```

Each component has its own dependencies and setup instructions - see the individual READMEs for details.

## Security

- Never commit credentials or API keys to version control
- Use `.env` files for sensitive configuration
- Configure network ACLs for VoIP services
- Review logs regularly for unauthorized access

## License

This project is licensed under the AGPL-3.0 License.

## Contributing

This project was developed collaboratively with Claude Code, Gemini, and OpenAI Codex.
