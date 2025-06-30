# CLI Tools

A collection of Node.js command-line tools for voice chat, transcription, and audio playback using OpenAI's Realtime API.

## Available Tools

### Voice Chat

**`chat`** - Interactive voice conversation with AI using WebSocket
```bash
bin/chat

# With custom audio settings
bin/chat --rate 24000 --channels 1
```

### Transcription

**`mic`** - Live microphone transcription using OpenAI Agents SDK
```bash
bin/mic

# With custom audio settings
bin/mic --rate 24000 --channels 1
```

**`mic-ws`** - Live microphone transcription using direct WebSocket connection
```bash
bin/mic-ws

# With custom audio settings  
bin/mic-ws --rate 24000 --channels 1
```

**`transcribe`** - Test script for transcribing audio files using Agents SDK (reads ../audio/count-padded.raw)
```bash
bin/transcribe
```

**`transcribe-ws`** - Test script for transcribing audio files using WebSocket (reads ../audio/count-padded-10s.raw)
```bash
bin/transcribe-ws
```

### Audio Playback

**`play`** - Play WAV audio files with automatic format detection
```bash
bin/play audio/count.wav
```

**`play-raw`** - Play raw PCM audio files with configurable format
```bash
bin/play-raw audio/count.raw --sample-rate 22050
bin/play-raw audio/count.raw --channels 1 --bit-depth 16 --unsigned
```

## Prerequisites

- Node.js 18+ (uses ES modules)
- OpenAI API key with Realtime API access
- Microphone permissions for live audio tools (mic, mic-ws, chat)
- Speaker/audio output permissions for playback tools

## Setup

1. **Install dependencies from project root:**
   ```bash
   npm install
   ```

2. **Configure OpenAI API key:**
   ```bash
   echo "OPENAI_API_KEY=your_api_key_here" > .env
   ```

3. **Make tools executable (if needed):**
   ```bash
   chmod +x bin/*
   ```

## Tool Details

### Chat Tool

Provides real-time voice conversation with AI using direct WebSocket connection:
- Captures microphone input continuously using `mic` package
- Streams audio to OpenAI Realtime API (wss://api.openai.com/v1/realtime)
- Plays AI voice responses through speakers using `speaker` package
- Displays conversation transcripts in real-time
- Uses gpt-4o-realtime-preview model with 'alloy' voice
- Supports natural conversation flow with semantic VAD

Options:
- `--rate`: Audio sample rate (default: 24000)
- `--channels`: Number of audio channels (default: 1)

### Transcription Tools

**Live Transcription Tools:**

**`mic` (Agents SDK):**
- Uses OpenAI's official @openai/agents SDK
- Live microphone transcription with server VAD
- Uses gpt-4o-realtime-preview-2025-06-03 model
- Higher-level abstraction with RealtimeAgent

**`mic-ws` (WebSocket):**
- Direct WebSocket connection to OpenAI Realtime API
- Uses intent=transcription endpoint
- More control over protocol with custom session configuration
- Includes noise reduction and VAD settings

**File Transcription Tools:**

**`transcribe` (Agents SDK):**
- Test script that transcribes ../audio/count-padded.raw
- Streams audio at realistic pace (48KB/s for 24kHz PCM16)
- Saves AI response audio to response.wav using sox conversion
- Uses throttled streaming to simulate real-time

**`transcribe-ws` (WebSocket):**
- Test script that transcribes ../audio/count-padded-10s.raw
- Sends audio in 100ms chunks (4800 bytes each)
- Direct WebSocket implementation without Agents SDK

### Audio Playback Tools

**`play`:**
- Plays standard WAV files with automatic format detection
- Parses WAV headers to extract format information
- Supports PCM format only, rejects other formats
- Uses `speaker` package for cross-platform playback

**`play-raw`:**
- Plays raw PCM audio data with configurable format
- Default format: 1 channel, 22050Hz, 16-bit signed
- Options: `--channels`, `--sample-rate`, `--bit-depth`, `--unsigned`
- Validates format parameters before playback

## Audio Formats

### Input (Microphone/Files)
- **Format:** PCM16 (for Realtime API)
- **Sample Rate:** 24kHz (configurable via --rate option)
- **Channels:** Mono (configurable via --channels option)
- **Encoding:** Signed 16-bit (as per mic package defaults)

### Output (Speaker)
- **Format:** PCM16
- **Sample Rate:** 24kHz (matches input)
- **Channels:** Mono
- **Bit Depth:** 16-bit signed

### Test Files
Located in `../audio/`:
- `count.wav` - WAV format test file (for play tool)
- `count.raw` - Raw PCM test file (for play-raw tool) 
- `count-padded.raw` - Raw PCM file used by transcribe tool
- `count-padded-10s.raw` - 10-second Raw PCM file used by transcribe-ws tool
- `count-padded.wav` and `count-padded-10s.wav` - WAV versions
- `response.wav` - Output from transcribe tool (AI response audio)

## Implementation Notes

### Dependencies
Based on actual package.json:
- `@openai/agents: ^0.0.10` - Official OpenAI Agents SDK
- `commander: ^14.0.0` - Command-line interface
- `dotenv: ^16.5.0` - Environment variable loading
- `mic: ^2.1.2` - Microphone input capture
- `speaker: ^0.5.5` - Audio output playback
- `ws: ^8.18.2` - WebSocket client for direct API connections

### Microphone Capture
Uses the `mic` npm package for cross-platform audio input:
```javascript
{
  rate: sampleRate,      // Default: 24000
  channels: channels,    // Default: 1
  debug: false,
  exitOnSilence: 0
}
```

### Speaker Playback
Uses the `speaker` npm package for cross-platform audio output:
```javascript
{
  channels: channels,    // Matches input
  bitDepth: 16,         // PCM16
  sampleRate: sampleRate, // Matches input
  signed: true
}
```

### API Protocols

**Agents SDK:**
- Uses RealtimeAgent and RealtimeSession classes
- Automatic event handling and connection management
- Uses `session.sendAudio(buffer)` for audio streaming

**Direct WebSocket:**
- Connects to `wss://api.openai.com/v1/realtime`
- Manual event handling for all protocol messages
- Send: `input_audio_buffer.append` with base64 audio
- Receive: `response.audio.delta` with base64 audio chunks
- Transcripts via `conversation.item.input_audio_transcription.delta`

## Troubleshooting

### No Audio Input
- Check microphone permissions in system settings
- Verify microphone is not being used by another application
- Test with different `--rate` values (try 16000, 22050, 44100)
- On macOS, check privacy settings for terminal/microphone access

### No Audio Output
- Check speaker/headphone volume and connections
- Verify audio output device is working with other applications
- Try different audio output sample rates
- Check if another application is blocking audio output

### API Errors
- Verify `OPENAI_API_KEY` is set in `.env` file
- Ensure API key has access to Realtime API (may require waitlist)
- Check for rate limiting or quota exceeded errors
- Verify internet connection for WebSocket connections

### Poor Audio Quality
- Use headphones to prevent audio feedback loops
- Adjust microphone gain/volume in system settings
- Try different sample rates with `--rate` option
- Ensure stable internet connection for real-time streaming

### Tool-Specific Issues

**transcribe/transcribe-ws fail:**
- Verify audio files exist in `../audio/` directory
- Check that audio files are in correct PCM16 format
- For transcribe tool, ensure `sox` is available for WAV conversion

**File playback issues:**
- Verify audio file format (WAV files must be PCM format)
- Check file paths are correct relative to current directory
- For raw files, try different format parameters

## Development

### Architecture
- All tools are standalone Node.js scripts with shebang headers
- Use ES modules (`"type": "module"` in package.json)
- Common functionality is duplicated across tools for simplicity
- Each tool handles its own CLI parsing with `commander`

### Adding New Tools

1. Create new file in `bin/` directory
2. Add shebang: `#!/usr/bin/env node`
3. Make executable: `chmod +x bin/your-tool`
4. Import required dependencies (`dotenv/config`, `commander`, etc.)
5. Add OpenAI API key validation
6. Implement CLI interface with proper error handling

### Testing

Test individual components:
```bash
# Test microphone input
bin/mic

# Test audio playback
bin/play ../audio/count.wav

# Test raw audio playback  
bin/play-raw ../audio/count.raw

# Test full voice chat pipeline
bin/chat

# Test file transcription
bin/transcribe
bin/transcribe-ws
```