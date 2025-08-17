# CLAUDE.md

This file provides guidance to Claude Code when working with this VoIP-to-AI service codebase.

**📖 For architecture, features, and usage patterns, see [README.md](README.md)**

## Development Commands

- `tilt up` - Start complete development environment with Kubernetes/Helm
- `tilt down` - Stop development environment

## Critical Technical Constraints

- **Never try to make Node.js real-time.** Accept that setTimeout() will drift and work around it with adaptive algorithms instead of precision timing.
- **Use FreeSWITCH for media processing.** The system uses FreeSWITCH via drachtio-fsmrf for professional media handling, with WebSocket streams for application integration.
- **FreeSWITCH handles RTP/media.** Let FreeSWITCH manage packet scheduling, jitter buffering, codec negotiation, and telephony protocols.
- **Let errors bubble up** unless you can meaningfully handle them (retries, fallbacks, adding context).
- **Avoid generic try/catch blocks** that only log errors. Either add meaningful context or let them bubble up.
- **Prefer enums/string literals over boolean variables** for configuration (e.g., `SIP_OUTBOUND_PROVIDER="kyivstar"` instead of `USE_KYIVSTAR=true`).

## API Integration Rules

- Use context7 when looking up API documentation
- Never use the whisper-1 model for transcription
- The system is designed to run on localhost only

## Key Directories

- `firefly/src/audio/` - WebSocket audio streaming and OpenAI integration
- `firefly/src/sip/` - SIP protocol handling
- `helm/firefly/` - Kubernetes deployment
- Never add an "any" type without explicit permission.