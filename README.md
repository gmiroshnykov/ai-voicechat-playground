# AI Voice Chat Playground

A comprehensive platform for real-time voice chat and audio processing, leveraging OpenAI's Realtime API. This project demonstrates bidirectional voice communication, live transcription, and robust audio utilities across multiple technology stacks.

## Features

-   **Real-time Voice Chat:** Engage in live voice conversations with AI, powered by OpenAI's Realtime API.
-   **Bidirectional Audio Streaming:** Seamlessly transmit user speech and receive AI responses.
-   **Live Transcription:** Obtain real-time transcriptions for both user and AI dialogue.
-   **Flexible API Integration:** Supports both OpenAI Agents SDK and direct WebSocket connections for diverse use cases.
-   **Cross-Platform Audio:** Utilizes `mic` and `speaker` packages for reliable audio input/output.
-   **Modular Architecture:** Features a Go-based backend for robust API handling and a Next.js frontend for an interactive web interface.

## Quick Start

### Prerequisites

-   Node.js 18+
-   Go 1.22+
-   OpenAI API Key
-   SoX audio library (recommended, included in `devbox` environment)

### Setup

1.  **Clone the repository and install dependencies:**

    ```bash
    git clone https://github.com/gmiroshnykov/ai-voicechat-playground.git
    cd ai-voicechat-playground
    npm install
    ```

2.  **Configure environment variables:**

    ```bash
    # Using devbox (recommended for consistent environment)
    devbox shell

    # Set your OpenAI API key
    echo "OPENAI_API_KEY=your_api_key_here" > .env
    ```

### Usage

#### Voice Chat CLI

```bash
# Start a real-time voice conversation
bin/chat

# Customize audio settings (e.g., sample rate, channels)
bin/chat --rate 24000 --channels 1
```

#### Transcription CLI

```bash
# Live microphone transcription (Agents SDK)
bin/mic

# Live microphone transcription (WebSocket)
bin/mic-ws

# Transcribe an audio file (Agents SDK)
bin/transcribe

# Transcribe an audio file (WebSocket)
bin/transcribe-ws
```

#### Audio Playback CLI

```bash
# Play WAV files
bin/play audio/count.wav

# Play raw PCM files
bin/play-raw audio/count.raw --sample-rate 22050
```

#### Go Server

The `server-go` directory contains a Go application that can handle API requests.

```bash
cd server-go
go run main.go
```

#### Web Frontend

The `web` directory hosts a Next.js application for a web-based interface.

```bash
cd web
npm run dev
```

## Architecture Overview

The project is structured into distinct components:

-   **CLI Tools:** Located in `bin/`, these Node.js scripts provide direct interaction with the OpenAI API for voice chat, transcription, and audio playback.
-   **Go Backend (`server-go/`):** A Go application designed for robust API handling and potential integration with the frontend.
-   **Next.js Frontend (`web/`):** A React-based web application providing a user interface for voice chat and other features.

### Audio Processing

-   **Input:** Primarily raw PCM16 audio at 24kHz mono.
-   **Capture:** Cross-platform microphone access via the `mic` package.
-   **VAD:** Semantic Voice Activity Detection ensures natural speech boundaries.
-   **Streaming:** Real-time audio buffer transmission to OpenAI for processing.

## API Integration

This project primarily integrates with OpenAI's Realtime API for voice chat and transcription:

-   **WebSocket Transport:** Utilizes WebSockets for efficient real-time audio streaming.
-   **Audio Streaming:** Achieved by appending audio chunks to `input_audio_buffer`.
-   **Real-time Deltas:** Transcriptions are received as real-time deltas via `conversation.item.input_audio_transcription.delta`.

## Testing

The `audio/` directory contains test audio files for verifying transcription and playback functionality.

```bash
# Test transcription with audio files
bin/transcribe
bin/transcribe-ws

# Test audio playback
bin/play audio/count.wav
bin/play-raw audio/count.raw
```

Expected output demonstrates accurate streaming transcription.

## Development

### Project Structure

```
ai-voicechat-playground/
├── audio/                         # Test audio files and documentation
├── bin/                           # Executable CLI scripts (Node.js)
├── conversations/                 # Stores conversation data
├── server-go/                     # Go backend application
│   ├── go.mod                     # Go module file
│   ├── main.go                    # Main Go application entry
│   └── ...
├── web/                           # Next.js web frontend
│   ├── package.json               # Frontend dependencies
│   ├── src/                       # Frontend source code
│   └── ...
├── package.json                   # Root Node.js dependencies and scripts
└── README.md                      # Project documentation
```

### Environment Setup

[Devbox](https://www.jetify.com/devbox) is used to ensure a consistent development environment across different systems.

```bash
devbox shell
```

### Key Dependencies

-   **`@openai/agents`**: OpenAI Agents SDK for Realtime API.
-   **`mic`**: Cross-platform microphone access.
-   **`speaker`**: Cross-platform audio playback.
-   **`ws`**: WebSocket client for direct API interaction.
-   **`commander`**: CLI argument parsing.
-   **`dotenv`**: Environment variable management.
-   **SoX**: Audio processing and file conversion utility.

## Troubleshooting

### Common Issues

1.  **Microphone Access:**
    -   Ensure your terminal application (e.g., Terminal, iTerm) has microphone permissions.
    -   Verify microphone hardware functionality.
2.  **API Connection Errors:**
    -   Confirm `OPENAI_API_KEY` is correctly set in your `.env` file.
    -   Check your internet connection.
3.  **Audio Quality:**
    -   Experiment with different sample rates (e.g., 16000, 24000, 44100).
    -   Adjust Voice Activity Detection (VAD) sensitivity settings if applicable.

### Debugging

Enable detailed event logging in the chat scripts by uncommenting relevant debug lines within the WebSocket message handlers.

## License

This project is licensed under the AGPL-3.0 License.

## Contributing

This project was developed collaboratively with Claude Code, Gemini, and OpenAI Codex.
