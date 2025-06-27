# AI Voice Chat - Web Version (New)

A minimal web implementation of a voice chat application that uses WebRTC for audio streaming and a Go server for signaling.

## Features

- 📞 Simple call/hang up interface
- 🎙️ WebRTC audio for browser compatibility
- 🚀 Go-based signaling server
- ✨ Modern UI with Tailwind CSS

## Setup

1.  **Start the Go signaling server**

    Follow the instructions in the `server-go` directory to run the WebRTC signaling server. By default, it runs on `http://localhost:3001`.

2.  **Install web client dependencies**

    ```bash
    cd web
    npm install
    ```

3.  **Configure the signaling server URL**

    Create a `.env.local` file by copying the example file:

    ```bash
    cp .env.example .env.local
    ```

    Edit `.env.local` and set `NEXT_PUBLIC_WEBRTC_URL` to the address of your Go signaling server.

    ```.env
    NEXT_PUBLIC_WEBRTC_URL=http://localhost:3001/webrtc
    ```

4.  **Start the development server**

    ```bash
    npm run dev
    ```

5.  Open `http://localhost:3000` in your browser.

6.  Click "Call", grant microphone permissions, and start speaking!

## Architecture

-   **Framework**: Next.js with React for the frontend
-   **Styling**: Tailwind CSS
-   **Signaling**: Go server handles the WebRTC session negotiation (SDP exchange).
-   **Transport**: WebRTC for real-time, peer-to-peer audio communication.

## How it works

1.  The React frontend captures audio from the user's microphone.
2.  It sends a WebRTC offer (containing network and media information) to the Go signaling server.
3.  The Go server receives the offer, sets up a peer connection, and returns an answer.
4.  The frontend receives the answer, establishing a direct WebRTC connection.
5.  Audio is streamed directly between the browser and the server.

## Notes

-   Requires microphone permissions in the browser.
-   The Go signaling server must be running for the web client to work.