# SIP Echo Service

A standalone Go-based SIP echo service that provides voice echo functionality for testing VoIP connections.

## Features

- **SIP Registration:** Registers with external SIP providers using digest authentication
- **Echo Service:** Echoes incoming audio back to the caller
- **RTP Streaming:** Real-time audio transport with codec mirroring (uses caller's codec configuration)
- **NAT Traversal:** Supports various network configurations with optional public IP advertisement
- **Concurrent Sessions:** Handles multiple simultaneous calls with proper session management
- **Re-INVITE Support:** Handles mid-call session modifications and RTP endpoint updates
- **TCP Transport:** Uses TCP for reliable SIP signaling
- **Dynamic Port Allocation:** Automatically finds available ports for SIP and RTP
- **RTP Priming:** Sends initial packet to establish media path through NAT
- **NOTIFY Support:** Handles SIP NOTIFY messages (e.g., voicemail indicators)

## Prerequisites

- Go 1.24.4+
- SIP account credentials from a VoIP provider
- Network access to SIP server (configurable port)

## Configuration

Set the following environment variables in the parent directory's `.env` file (i.e., `../.env` relative to the sip-echo directory):

```bash
SIP_USER=your_sip_username
SIP_PASSWORD=your_sip_password
SIP_SERVER=your_sip_server
SIP_PORT=5060                    # SIP server port
SIP_ADVERTISE_IP=your_public_ip  # Optional, for NAT traversal
```

## Usage

```bash
# From the sip-echo directory
go run main.go

# Or build and run
go build
./sip-echo
```

The service will:
1. Load `.env` file from the parent directory (optional)
2. Discover local network configuration
3. Register with the SIP server
4. Listen for incoming calls
5. Log all SIP activity to stdout

To stop the service, use Ctrl+C (SIGINT) or SIGTERM for graceful shutdown.

## How It Works

1. **Registration:** The service registers with your SIP provider using the provided credentials with digest authentication (MD5)
2. **Listen:** Waits for incoming INVITE requests on a dynamically allocated port
3. **Answer:** Accepts the call with 200 OK and establishes RTP audio streams
4. **Echo:** Receives audio packets and sends them back to the caller (with RTP priming)
5. **Re-INVITE Support:** Handles session modifications during active calls
6. **Cleanup:** Properly tears down the session when BYE is received

## Network Configuration

### Behind NAT

If running behind NAT, set `SIP_ADVERTISE_IP` to your public IP address. The service will:
- Use the advertised IP in SIP Contact headers
- Use the local IP (discovered via default route) in SDP for media
- Bind to all interfaces (0.0.0.0)
- Enable NAT mode for the SIP client

### Firewall Rules

Ensure the following ports are accessible:
- **SIP:** Dynamically allocated port for client/server - TCP
- **RTP:** Dynamic ports 10000-20000 - UDP (for audio streams)

## Troubleshooting

### Registration Failed

- Verify SIP credentials are correct
- Check network connectivity to SIP server
- Ensure firewall allows outbound UDP on SIP port
- Try enabling SIP ALG on your router

### No Audio

- Check firewall rules for RTP ports (10000-20000)
- Verify NAT configuration if behind router
- Ensure `SIP_ADVERTISE_IP` is set correctly if using NAT
- The service mirrors the caller's codec configuration from their SDP

### Call Drops

- Check for SIP session timeout issues
- Verify stable network connection
- Review logs for specific error messages

## Development

### Dependencies

- `github.com/emiago/sipgo` v0.33.0 - SIP protocol implementation
- `github.com/joho/godotenv` v1.5.1 - Environment variable management

### Testing

1. Configure your SIP credentials
2. Run the service
3. Call your SIP number from any phone
4. You should hear your voice echoed back

## Technical Details

### SIP Implementation

- Uses TCP transport for SIP signaling (more reliable than UDP)
- Implements MD5 digest authentication with support for qop=auth
- Generates unique Call-IDs and tags for each registration session
- Supports the following SIP methods: REGISTER, INVITE, ACK, BYE, NOTIFY
- Includes standard SIP headers including Supported capabilities

### RTP Implementation

- Binds to ports in range 10000-20000 for RTP
- Echoes received packets back to the negotiated SDP endpoint
- Sends an initial RTP priming packet to establish NAT traversal
- Uses goroutines with context-based cancellation for each session
- Thread-safe session management with mutex protection

### Network Discovery

- Automatically discovers local IP on the default route interface
- Prefers IPv4 over IPv6 for better SIP compatibility
- Separates advertised IP (for Contact headers) from SDP IP (for media)

## Security Notes

- Never commit SIP credentials to version control
- Use strong passwords for SIP accounts
- Consider IP whitelisting at the provider level
- Monitor for unauthorized registration attempts