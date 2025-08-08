# CLAUDE.md

This file provides guidance to Claude Code when working with this VoIP-to-AI bridge codebase.

## Development Commands

- `tilt up` - Start complete development environment with Kubernetes/Helm
- `tilt down` - Stop development environment  
- `k` (kubectl alias) - Kubernetes operations

## Environment Setup

- Environment variables are configured via Kubernetes ConfigMaps and Secrets

## Critical Technical Constraints

- **Never try to make Node.js real-time.** Accept that setTimeout() will drift and work around it with adaptive algorithms instead of precision timing.
- **Use stream-based processing.** The system uses Node.js Transform streams for the audio pipeline.
- **Use adaptive RTP scheduling.** Packets are scheduled based on buffer depth, not fixed timing intervals.
- **Let errors bubble up** unless you can meaningfully handle them (retries, fallbacks, adding context).
- **Avoid generic try/catch blocks** that only log errors. Either add meaningful context or let them bubble up.

## Testing Modes

- `--mode echo` - Use this for audio/RTP debugging without OpenAI dependency
- Extension `123` - Triggers test audio playback for codec validation
- Other extensions - Start AI conversations with OpenAI Realtime API

## API Integration Rules

- Use context7 when looking up API documentation
- Never use the whisper-1 model for transcription
- The system is designed to run on localhost only

## Key Directories

- `firefly/src/rtp/` - Audio processing pipeline
- `firefly/src/sip/` - SIP protocol handling  
- `helm/firefly/` - Kubernetes deployment