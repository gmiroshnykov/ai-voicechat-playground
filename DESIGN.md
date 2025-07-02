# VoIP to OpenAI Realtime API Bridge - Design Document

## Objective

Bridge incoming telephone calls to OpenAI's Realtime API, enabling AI-powered voice conversations over traditional phone networks.

## Core Requirements

### Functional
- **Bidirectional real-time audio**: Stream caller audio to OpenAI and AI responses back to caller
- **Multi-tenant support**: Route calls based on forwarding subscriber (via Diversion headers)
- **Call recording**: Store raw audio and metadata for all conversations
- **Call context preservation**: Maintain caller ID, forwarded-from number, and other metadata

### Technical
- **Carrier compatibility**: Handle Kyivstar VoIP quirks (symmetric RTP, NAT traversal)
- **Low latency**: Maintain natural conversation flow
- **Concurrent calls**: Support multiple simultaneous conversations
- **Production reliability**: Graceful error handling and recovery

### Development
- **Local testing**: Test without PSTN costs using SIP registration
- **Call simulation**: Mock forwarding scenarios and various call flows
- **Clear architecture**: Separation of concerns for maintainability

## Key Constraints

- Must work with existing Kyivstar VoIP service
- Must extract and use Diversion headers for tenant identification
- Must provide production-grade telephony handling
- Should enable easy testing and development workflows

## Success Metrics

1. Reliable call establishment with Kyivstar
2. Natural, low-latency AI conversations
3. Accurate multi-tenant routing
4. Comprehensive call recording and logging
5. Simplified testing without external dependencies