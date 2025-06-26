# AI Voice Chat Playground

A playground for real-time voice chat and audio transcription using OpenAI's Realtime API.
Supports live microphone input, bidirectional voice chat, file-based transcription, and audio playback utilities.

## Features

- **Realtime voice chat** with OpenAI's Realtime API
- **Bidirectional audio streaming** - speak and hear AI responses
- **Live transcription** for both user and AI speech
- **Audio playback utilities** for WAV and raw PCM files
- **Multiple API approaches** - Agents SDK and direct WebSocket
- **Cross-platform audio** using mic and speaker packages

## Quick Start

### Prerequisites

- Node.js 18+
- OpenAI API key
- SoX audio library (included in devbox environment)

### Setup

1. **Clone and install dependencies:**
   ```bash
   git clone https://github.com/gmiroshnykov/ai-voicechat-playground.git
   cd ai-voicechat-playground
   npm install
   ```

2. **Set up environment:**
   ```bash
   # Using devbox (recommended)
   devbox shell

   # Set your OpenAI API key
   echo "OPENAI_API_KEY=your_api_key_here" > .env
   ```

### Usage

#### Voice Chat with AI
```bash
# Start realtime voice conversation
bin/chat

# With custom audio settings
bin/chat --rate 24000 --channels 1
```

#### Transcription Only Mode
```bash
# Live microphone transcription (Agents SDK)
bin/mic

# Live microphone transcription (WebSocket)
bin/mic-ws

# Transcribe audio file (Agents SDK)
bin/transcribe

# Transcribe audio file (WebSocket)
bin/transcribe-ws
```

#### Audio Playback
```bash
# Play WAV files
bin/play audio/count.wav

# Play raw PCM files
bin/play-raw audio/count.raw --sample-rate 22050
```

## Architecture


### Audio Processing

- **Input**: Raw PCM16 audio at 24kHz mono
- **Capture**: Cross-platform microphone access via 'mic' package
- **VAD**: Semantic Voice Activity Detection for natural speech boundaries
- **Streaming**: Real-time audio buffer transmission to OpenAI

## Configuration Options


### Voice Activity Detection

- **`semantic_vad`** - AI-powered speech boundary detection (automatically configured)
- **Eagerness levels**: `low`, `medium`, `high`, `auto`

## API Integration

### OpenAI Realtime API

The tools use OpenAI's Realtime API for voice chat and transcription:

- **WebSocket transport** for real-time audio streaming
- **Audio streaming** via `input_audio_buffer.append` events
- **Real-time deltas** through `conversation.item.input_audio_transcription.delta`

### Event Flow

1. Connect to OpenAI's realtime API
2. Configure session with semantic VAD
3. Stream raw PCM16 audio chunks
4. Receive real-time transcription deltas
5. Get final transcription results

## Testing

The project includes test audio files in the `audio/` directory with counting phrases.

Run transcription tests:
```bash
# Test with audio file (Agents SDK)
bin/transcribe

# Test with audio file (WebSocket)
bin/transcribe-ws

# Test audio playback
bin/play audio/count.wav
bin/play-raw audio/count.raw
```

Expected output demonstrates streaming transcription with high accuracy.

## Development

### Project Structure

```
ai-voicechat-playground/
├── audio/                         # Audio files and conversion docs
│   ├── README.md                  # Audio file documentation
│   ├── *.wav                      # Test WAV files
│   └── *.raw                      # Test raw PCM files
├── bin/                           # Executable scripts
│   ├── chat                       # Realtime voice chat
│   ├── mic                        # Live microphone transcription (Agents SDK)
│   ├── mic-ws                     # Live microphone transcription (WebSocket)
│   ├── play                       # WAV file player
│   ├── play-raw                   # Raw PCM file player
│   ├── transcribe                 # Transcribe audio file (Agents SDK)
│   ├── transcribe-ws              # Transcribe audio file (WebSocket)
├── package.json                   # Dependencies and scripts
└── README.md                      # This file
```

### Environment Setup

This project uses [devbox](https://www.jetify.com/devbox) for consistent development environments:

```bash
devbox shell
```

### Dependencies

- **`@openai/agents`** - OpenAI Agents SDK for Realtime API (used by bin/mic and bin/transcribe)
- **`mic`** - Cross-platform microphone access
- **`speaker`** - Cross-platform audio playback
- **`ws`** - WebSocket client for direct API access
- **`commander`** - CLI argument parsing
- **`dotenv`** - Environment variable management
- **SoX** - Audio processing and file conversion

## Troubleshooting

### Common Issues

1. **No microphone access**
   - Grant microphone permissions to Terminal/iTerm
   - Ensure microphone hardware is working

2. **API connection errors**
   - Verify `OPENAI_API_KEY` is set correctly
   - Check internet connectivity

3. **Audio quality issues**
   - Try different sample rates (16000, 24000, 44100)
   - Adjust VAD sensitivity settings

### Debug Mode

Enable event logging to see all API events in the chat script by uncommenting the debug line in the WebSocket message handler.

## License

AGPL-3.0

## Contributing

This project was developed collaboratively with Claude Code. Contributions welcome!