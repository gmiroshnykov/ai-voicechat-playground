# AI Voice Chat - Web Version

A minimal web implementation of the voice chat using OpenAI's Agents SDK with WebRTC transport.

## Features

- 📞 Simple call/hang up interface
- 💬 Real-time conversation log
- 🎙️ WebRTC audio for browser compatibility
- 🔒 Secure API key handling with ephemeral tokens
- ⚡ Vite dev server with backend proxy

## Setup

1. Install dependencies:
   ```bash
   cd web
   npm install
   ```

2. Set up your OpenAI API key:
   ```bash
   cp .env.example .env.local
   # Edit .env.local and add your OPENAI_API_KEY
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open http://localhost:3000 in your browser

5. Click "Call", grant microphone permissions, and start speaking!

## Architecture

- **Framework**: Next.js full-stack with API routes
- **Frontend**: React components with OpenAI Agents SDK
- **Backend**: Next.js API routes for secure API key management
- **Security**: Uses ephemeral client tokens (no API keys in browser)
- **Transport**: WebRTC for real-time audio communication

## How it works

1. Frontend requests ephemeral token from `/api/session`
2. Next.js API route generates short-lived client token using your API key
3. Frontend uses client token to connect to OpenAI Realtime API
4. WebRTC handles audio input/output automatically
5. Conversation history updates in real-time

## Development

- Full-stack app: http://localhost:3000 (Next.js)
- API routes: `/api/*` handled by Next.js serverless functions

## Notes

- Requires microphone permissions
- Uses `gpt-4o-realtime-preview-2025-06-03` model
- Voice is set to "alloy"
- API key never leaves the server