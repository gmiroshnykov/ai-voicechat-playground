# Web Frontend - WebRTC Echo Service

A Next.js web application providing a simple WebRTC audio echo service interface.

## Features

- 🎙️ **WebRTC Audio:** Browser-based audio capture and streaming
- 🔊 **Echo Service:** Audio is echoed back from the server
- 🎯 **Connection Management:** Simple call/hang up interface
- ✨ **Modern UI:** Clean, responsive interface with Tailwind CSS

## Prerequisites

- Node.js 18+
- Running WebRTC signaling server (see ../sip-echo/ for server implementation)
- Modern web browser with microphone access

## Setup

1. **Install dependencies:**

   ```bash
   cd web
   npm install
   ```

2. **Configure environment:**

   Copy `.env.example` to `.env.local`:

   ```bash
   cp .env.example .env.local
   ```

   Or create a `.env.local` file with:

   ```bash
   NEXT_PUBLIC_WEBRTC_URL=http://localhost:3001/webrtc
   ```

3. **Start the development server:**

   ```bash
   npm run dev
   ```

4. **Open in browser:**

   Navigate to `http://localhost:3000`

## Usage

1. **Start a call:**
   - Click the "Call" button
   - Grant microphone permissions when prompted
   - Start speaking - your audio will be echoed back from the server

2. **During the call:**
   - Audio is streamed bidirectionally via WebRTC
   - Your microphone input is processed by the server and echoed back
   - Connection status is displayed in real-time

3. **End the call:**
   - Click "Hang Up" to end the session
   - All WebRTC connections are cleaned up

## Architecture

### Technology Stack

- **Framework:** Next.js 15+ with App Router and Turbopack
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Audio:** WebRTC (RTCPeerConnection)
- **Communication:** HTTP for signaling (SDP exchange)

### Component Structure

```
src/app/
├── components/
│   └── VoiceChat.tsx    # Main voice chat component
├── page.tsx             # Home page
├── layout.tsx           # Root layout
└── globals.css          # Global styles
```

### Audio Flow

1. **Capture:** getUserMedia API captures microphone input
2. **WebRTC Setup:** RTCPeerConnection establishes peer-to-peer connection
3. **Signaling:** HTTP POST to `/webrtc` endpoint exchanges SDP offer/answer
4. **Streaming:** Audio streamed directly via WebRTC to server
5. **Echo:** Server processes and echoes audio back via WebRTC
6. **Playback:** Echoed audio played through HTML audio element

## Configuration

### Audio Settings

The application uses optimized settings for voice communication:

- **Sample Rate:** 24kHz (requested, actual depends on browser/system)
- **Echo Cancellation:** Enabled
- **Noise Suppression:** Enabled
- **Auto Gain Control:** Enabled

### WebRTC Configuration

- **ICE Servers:** Google STUN server (stun:stun.l.google.com:19302)
- **Signaling:** HTTP POST with SDP offer/answer exchange
- **Media:** Audio only, bidirectional streaming

## Development

### Available Scripts

```bash
# Development server (with Turbopack)
npm run dev

# Production build
npm run build

# Start production server
npm start

# Linting
npm run lint
```

### Key Dependencies

- `next` (v15.3.4) - React framework with App Router
- `react` (v18) - UI library
- `react-dom` (v18) - DOM rendering
- `tailwindcss` (v3) - Utility-first CSS framework
- `typescript` (v5) - Type safety

## Troubleshooting

### Microphone Access

- Ensure browser has microphone permissions
- Check system audio input settings
- Try using HTTPS in production

### Connection Issues

- Verify WebRTC signaling server is running on port 3001
- Check NEXT_PUBLIC_WEBRTC_URL in `.env.local`
- Review browser console for WebRTC connection errors

### Audio Quality

- Use headphones to prevent feedback loops
- Check microphone quality and position
- Ensure stable internet connection for WebRTC

### Browser Compatibility

Tested on:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Security Notes

- Microphone access requires user consent
- WebRTC signaling is unencrypted HTTP in development
- Use HTTPS in production for secure getUserMedia
- WebRTC media streams are encrypted by default

## Future Enhancements

- [ ] Visual audio level indicators
- [ ] Connection quality indicators
- [ ] Voice activity detection UI
- [ ] Audio settings panel (sample rate, codecs)
- [ ] Error handling improvements