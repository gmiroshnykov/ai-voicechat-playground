# Go Backend Server

A Go-based WebRTC server that handles real-time voice echo service with audio recording capabilities.

## Features

- **WebRTC Support:** Full WebRTC peer connection handling with STUN server configuration
- **Real-time Audio Echo:** Echoes received audio back to the client with minimal latency
- **Audio Recording:** Captures incoming audio in OGG/Opus format
- **HTTP Signaling:** Uses HTTP POST for WebRTC offer/answer exchange
- **CORS Support:** Configured for cross-origin requests
- **Health Monitoring:** Provides health check endpoint with active conversation tracking

## Prerequisites

- Go 1.21+
- No external API keys required

## Configuration

The server uses the following default configuration:
- Default port: 3001 (configurable via PORT environment variable)
- STUN server: stun.l.google.com:19302
- Audio codec: Opus (48kHz, stereo)

## Usage

```bash
# From the server-go directory
go run main.go

# Or build and run
go build
./ai-voicechat-server

# With custom port
PORT=8080 go run main.go
```

The server will start on `http://localhost:3001` by default.

## API Endpoints

### WebRTC Signaling Endpoint

```
POST /webrtc
Content-Type: application/sdp
```

Accepts a WebRTC SDP offer and returns an SDP answer. The response includes:
- SDP answer in the response body
- `X-Conversation-Id` header with the unique conversation ID

### Health Check Endpoint

```
GET /health
```

Returns server status with:
- Current timestamp
- Number of active WebRTC conversations
- Server status

Example response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z",
  "active_conversations": 2
}
```

## Architecture

### WebRTC Flow

1. **Offer Reception:** Client sends SDP offer via HTTP POST to `/webrtc`
2. **Peer Connection:** Server creates WebRTC peer connection with STUN configuration
3. **Track Handling:** Server sets up audio track for echo functionality
4. **Answer Generation:** Server generates SDP answer with ICE candidates
5. **Audio Processing:** Incoming audio is processed through a tee pattern for multiple consumers

### Audio Processing Architecture

The server implements a sophisticated audio processing pipeline using a tee pattern:

1. **Audio Producer:** Reads RTP packets from the incoming WebRTC track
2. **Tee Distribution:** Distributes packets to multiple consumers:
   - **Echo Consumer:** Real-time echo with small buffer (100 packets)
   - **Recording Consumer:** Disk recording with larger buffer (2000 packets)
3. **Graceful Shutdown:** Context-based cancellation ensures clean resource cleanup

### Conversation Storage

Audio recordings are stored in the following structure:

```
server-go/conversations/
├── 1751014936301809000/
│   └── user_audio.ogg
├── 1751015083832097000/
│   └── user_audio.ogg
└── .../
```

Each conversation directory is named with a nanosecond timestamp for uniqueness.

## Development

### Dependencies

- `github.com/gorilla/mux` v1.8.1 - HTTP router
- `github.com/pion/webrtc/v4` v4.1.2 - WebRTC implementation
- `github.com/pion/rtp` v1.8.18 - RTP packet handling
- `github.com/rs/cors` v1.11.1 - CORS middleware

### Audio Specifications

- **Codec:** Opus
- **Sample Rate:** 48kHz
- **Channels:** Stereo (2 channels)
- **Container Format:** OGG
- **RTP Payload:** Standard Opus RTP format

### Error Handling

The server implements comprehensive error handling for:
- WebRTC connection state changes
- ICE connection failures
- RTP packet parsing errors
- File system operations
- Queue overflow conditions (separate handling for echo vs recording)

### Performance Considerations

- **Buffer Management:** Separate queue sizes for real-time echo (100) vs recording (2000)
- **Non-blocking Operations:** Audio distribution uses non-blocking sends to prevent bottlenecks
- **Resource Cleanup:** Automatic cleanup on peer connection failure/disconnect
- **Concurrent Access:** Thread-safe peer connection management with mutex protection

## Security Considerations

- CORS configured to allow all origins (adjust for production)
- No authentication implemented (add for production use)
- ICE candidate gathering timeout prevents hanging connections
- Proper cleanup of resources on connection failure

## Troubleshooting

### Connection Issues

- Check browser WebRTC support
- Verify STUN server accessibility
- Review browser console for ICE connection errors
- Check server logs for peer connection state changes

### Audio Issues

- Verify Opus codec support in browser
- Check for queue overflow messages in logs
- Ensure sufficient disk space for recordings
- Monitor CPU usage during high load

### Recording Issues

- Check write permissions in conversations directory
- Verify OGG file creation in conversation folders
- Look for "Ogg writer error" messages in logs
- Ensure proper cleanup on connection close