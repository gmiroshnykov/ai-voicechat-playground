# Drachtio Echo Service

A SIP echo service built with drachtio that registers with a SIP server (FreeSWITCH/Kyivstar) and echoes RTP audio back to callers.

## Features

- Registers as a SIP endpoint with any SIP server
- Accepts incoming calls
- Echoes RTP packets back without transcoding
- Extracts call context (From, To, Diversion headers)
- Manages RTP port allocation

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

2. Copy `.env.example` to `.env` and configure:
   ```bash
   cp .env.example .env
   ```

3. Update `.env` with your settings:
   - `LOCAL_IP`: Your machine's IP address
   - `SIP_DOMAIN`: FreeSWITCH or Kyivstar server
   - `SIP_USERNAME`/`SIP_PASSWORD`: Registration credentials

## Testing with FreeSWITCH

1. Add a user in FreeSWITCH's `directory/default.xml`:
   ```xml
   <user id="drachtio-echo">
     <params>
       <param name="password" value="password"/>
     </params>
   </user>
   ```

2. Start the echo service:
   ```bash
   npm start
   ```

3. Make a call to `drachtio-echo` from another SIP client

## Architecture

```
Caller → SIP Server → drachtio-server → drachtio-echo (Node.js)
           ↓                                    ↓
         [RTP] ←──────── echo ──────────── [RTP Handler]
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