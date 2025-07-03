# Firefly - VoIP to OpenAI Realtime API Bridge

A SIP service built with drachtio that bridges telephone calls to OpenAI's Realtime API, enabling AI-powered voice conversations over traditional phone networks.

## Features

- Registers as a SIP endpoint with any SIP server
- Accepts incoming calls
- Echoes RTP packets back without transcoding (development mode)
- Extracts call context (From, To, Diversion headers)
- Manages RTP port allocation
- Multi-tenant support via Diversion headers
- Production-ready for Kyivstar VoIP integration

## Prerequisites

1. **Drachtio Server** - You'll need drachtio-server running. Options:

   ```bash
   # Option 1: Docker (recommended for testing)
   docker run -d --name drachtio --net=host \
     drachtio/drachtio-server:latest \
     drachtio --contact "sip:*:5060;transport=udp" --loglevel info

   # Option 2: Build from source (see drachtio docs)
   ```

2. **Node.js** - Version 14 or higher

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Environment variables are managed by direnv in the project root:
   - FreeSWITCH configuration works out of the box
   - For production/Kyivstar: copy `.envrc.local.example` to `.envrc.local` and configure
   - Set `SIP_PROVIDER="kyivstar"` to switch from FreeSWITCH to Kyivstar

3. Key environment variables:
   - `SIP_PROVIDER`: "freeswitch" (default) or "kyivstar"
   - `LOCAL_IP`: Your machine's IP address
   - `SIP_*`: SIP server credentials (auto-configured based on provider)

## Testing with FreeSWITCH

1. Add a user in FreeSWITCH's `directory/default.xml`:
   ```xml
   <user id="firefly">
     <params>
       <param name="password" value="password"/>
     </params>
   </user>
   ```

2. Start the echo service:
   ```bash
   npm start
   ```

3. Make a call to `firefly` extension from another SIP client

## Architecture

```
Caller → SIP Server → drachtio-server → Firefly (Node.js)
           ↓                                    ↓
         [RTP] ←──────── echo ──────────── [RTP Handler]
                                               ↓
                                    (Future: OpenAI Realtime API)
```

## How It Works

1. Service registers with SIP server using provided credentials
2. On incoming call, extracts remote RTP endpoint from SDP
3. Allocates local RTP port and starts UDP listener
4. Echoes received RTP packets back to sender
5. Cleans up when call ends

## Environment Variables

- `DRACHTIO_HOST`: drachtio-server host (default: 127.0.0.1)
- `DRACHTIO_PORT`: drachtio-server port (default: 9022)
- `DRACHTIO_SECRET`: drachtio-server secret (default: cymru)
- `SIP_DOMAIN`: SIP server to register with
- `SIP_USERNAME`: SIP registration username
- `SIP_PASSWORD`: SIP registration password
- `LOCAL_IP`: Local IP for RTP binding
- `RTP_PORT_MIN/MAX`: RTP port range