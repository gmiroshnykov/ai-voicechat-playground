# Node.js Realtime Audio Transcription

A Node.js CLI tool for real-time audio transcription using OpenAI's Realtime API. Supports both live microphone input and file-based transcription with streaming text output.

## Features

- **Real-time transcription** from microphone input
- **Streaming text output** with word-by-word deltas
- **File-based testing** with consistent audio samples
- **Semantic Voice Activity Detection** for natural speech boundaries
- **Cross-platform audio capture** using SoX
- **Reusable library** for integration into other projects

## Quick Start

### Prerequisites

- Node.js 18+
- OpenAI API key
- SoX audio library (included in devbox environment)

### Setup

1. **Clone and install dependencies:**
   ```bash
   git clone <repository-url>
   cd nodejs-mic
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

#### Live Microphone Transcription
```bash
# Start live transcription
./main.js

# Or with custom settings
./main.js --rate 44100 --channels 1
```

#### Test with Audio File
```bash
# Test transcription accuracy
./test.js

# Or via npm
npm test
```

## Architecture

### Core Library (`lib/agents-transcriber.js`)

The `AgentsTranscriber` class provides a reusable interface for OpenAI's Realtime API using the Agents SDK:

```javascript
import AgentsTranscriber from './lib/agents-transcriber.js';

const transcriber = new AgentsTranscriber({
  sampleRate: 24000,
  channels: 1,
  model: 'gpt-4o-realtime-preview-2025-06-03',
  vadEagerness: 'medium',
  onTranscriptionDelta: (delta) => console.log(delta),
  onTranscriptionComplete: (transcript) => console.log(`Final: "${transcript}"`)
});

await transcriber.initialize();
await transcriber.connect();
await transcriber.startMicrophoneCapture();
```

### Entry Points

- **`main.js`** - Live microphone transcription CLI
- **`test.js`** - File-based transcription testing

### Audio Processing

- **Input**: Raw PCM16 audio at 24kHz mono
- **Capture**: SoX `rec` command for cross-platform microphone access
- **VAD**: Semantic Voice Activity Detection for natural speech boundaries
- **Streaming**: Real-time audio buffer transmission to OpenAI

## Configuration Options

### AgentsTranscriber Options

| Option | Default | Description |
|--------|---------|-------------|
| `sampleRate` | `24000` | Audio sample rate (Hz) |
| `channels` | `1` | Number of audio channels |
| `model` | `'gpt-4o-realtime-preview-2025-06-03'` | OpenAI realtime model |
| `language` | `'en'` | Transcription language |
| `vadEagerness` | `'medium'` | VAD responsiveness level |

### Voice Activity Detection

- **`semantic_vad`** - AI-powered speech boundary detection (automatically configured)
- **Eagerness levels**: `low`, `medium`, `high`, `auto`

## API Integration

### OpenAI Realtime API

The tool uses OpenAI's Realtime API via the Agents SDK for transcription-focused sessions:

- **Agents SDK** integration with `RealtimeAgent` and `RealtimeSession`
- **WebSocket transport** for real-time audio streaming
- **Audio streaming** via `input_audio_buffer.append` events
- **Real-time deltas** through `conversation.item.input_audio_transcription.delta`

### Event Flow

1. Initialize transcription agent with focused instructions
2. Create realtime session with semantic VAD
3. Connect to OpenAI's realtime API
4. Stream raw PCM16 audio chunks
5. Receive real-time transcription deltas
6. Get final transcription results

## Testing

The project includes a test audio file (`count.wav`) with the phrase:
> "This is a test message: one, two, three, four, five, six, seven, eight, nine, ten."

Run transcription tests:
```bash
npm test
```

Expected output demonstrates streaming transcription with high accuracy.

## Development

### Project Structure

```
nodejs-mic/
├── lib/
│   └── agents-transcriber.js      # Core transcription library
├── main.js                        # Live microphone CLI
├── test.js                        # File-based testing
├── count.wav                      # Test audio file
├── count.raw                      # Raw PCM test data
├── package.json                   # Dependencies and scripts
└── README.md                      # This file
```

### Environment Setup

This project uses [devbox](https://www.jetify.com/devbox) for consistent development environments:

```bash
devbox shell  # Includes Node.js and SoX
```

### Dependencies

- **`@openai/agents`** - OpenAI Agents SDK for Realtime API
- **`commander`** - CLI argument parsing
- **`dotenv`** - Environment variable management
- **SoX** - Audio processing and capture

## Troubleshooting

### Common Issues

1. **No microphone access**
   - Grant microphone permissions to Terminal/iTerm
   - Ensure SoX is installed and accessible

2. **API connection errors**
   - Verify `OPENAI_API_KEY` is set correctly
   - Check internet connectivity

3. **Audio quality issues**
   - Try different sample rates (16000, 24000, 44100)
   - Adjust VAD sensitivity settings

### Debug Mode

Enable event logging to see all API events:
```javascript
// In lib/agents-transcriber.js, uncomment:
console.log('📨 Event:', event);
```

## License

ISC

## Contributing

This project was developed collaboratively with Claude Code. Contributions welcome!