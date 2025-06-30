# TROUBLESHOOTING: RTP/Media Issues with FreeSWITCH, Linphone, and Go Echo Service

## Problem Overview

When setting up a test environment with:
- **Linphone** (SIP softphone)
- **FreeSWITCH** (running in Docker)
- **Custom Go-based SIP echo service**

...calls from Linphone to the Go echo service via FreeSWITCH would connect (SIP signaling succeeded), but **no audio was heard** (no RTP echo).

## Symptoms
- SIP call setup completed successfully (INVITE, 200 OK, ACK all exchanged).
- RTP packets were visible in packet captures, but:
  - All RTP was from Linphone to FreeSWITCH (same host, different ports).
  - No RTP was seen from FreeSWITCH to the Go echo service.
  - The Go echo service did not receive or echo any RTP.
- No audio/echo was heard on the call.

## Root Cause
- **FreeSWITCH was acting as a media relay (B2BUA)** by default.
- Linphone sent RTP to the port FreeSWITCH advertised in its SDP.
- **FreeSWITCH did not relay RTP to the Go echo service.** Possible reasons:
  - The Go service was not properly registered or reachable.
  - The call leg to the Go service was not fully established.
  - FreeSWITCH did not process the Go service's SDP/200 OK correctly.
  - FreeSWITCH was waiting for RTP from the Go service (symmetric RTP/comedia), but the Go service never received any RTP to echo.
- As a result, RTP/media never reached the Go echo service, so no echo was possible.

## Solution / Workaround

### Enable Direct Media (Bypass Media)

By forcing **bypass media** in the FreeSWITCH dialplan, we instructed FreeSWITCH to:
- Handle only SIP signaling.
- Let Linphone and the Go echo service exchange RTP/media directly (point-to-point), bypassing FreeSWITCH entirely for media.

**How we did it:**
1. Edited the dialplan extension for the echo service (in `freeswitch/conf/dialplan/default.xml`):
    ```xml
    <extension name="echo_service">
      <condition field="destination_number" expression="^echo$">
        <action application="set" data="bypass_media=true"/>
        <action application="bridge" data="user/echo@${domain_name}"/>
      </condition>
    </extension>
    ```
2. Reloaded the dialplan and restarted FreeSWITCH.
3. Placed a test call.

### Result
- RTP packets now flow directly between Linphone and the Go echo service.
- Both endpoints send and receive RTP on the correct ports (as seen in packet captures).
- The echo service receives RTP and echoes it back—**audio echo works!**

## Key Takeaways
- If SIP signaling works but there is no audio, always check RTP flows in packet captures.
- FreeSWITCH (and other B2BUAs) may not relay RTP if the call leg is not fully established or if there are registration/dialplan issues.
- Enabling `bypass_media` is a reliable workaround for lab/test environments where direct media is acceptable and simplifies troubleshooting.

---

**If you encounter similar issues:**
- Check SIP/SDP negotiation and registration status for all endpoints.
- Use packet captures to confirm RTP flows.
- Try enabling `bypass_media` to isolate signaling from media path issues.

# 2025-06-29/30: Further Troubleshooting RTP/Media Issues (No Direct Media)

## Context
- Reverted to default FreeSWITCH configuration (no `bypass_media`).
- Setup: Linphone (host), FreeSWITCH (Docker), Go-based SIP echo service (host).
- Goal: Get RTP/media working through FreeSWITCH as a relay (B2BUA), not direct.

## Steps & Observations
- **Reverted dialplan** to remove `bypass_media=true`.
- **Confirmed Go echo service and Linphone both register successfully.**
- **FreeSWITCH config:**
  - `external_rtp_ip` and `external_sip_ip` set to host IP (`192.168.50.100`).
  - `rtp-ip` and `sip-ip` in internal profile set to `$${local_ip_v4}` (container IP).
- **SDP Analysis:**
  - All endpoints advertise `192.168.50.100` as RTP IP in SDP.
  - Linphone offers RTP on port 57888.
  - Go echo service listens on 10101, sends to 30486 (from logs).
- **RTP Analysis (pcap/tcpdump):**
  - All RTP flows are between 57888 and 17454 (and 57317/17455), all on `192.168.50.100`.
  - No RTP to/from 10101 or 30486 (Go echo or Linphone's actual ports).
- **SIP packet review:**
  - Linphone's INVITE offers 57888 for RTP.
  - Go echo's actual listening port (10101) does not appear in RTP flows.
  - No evidence of FreeSWITCH relaying RTP to the correct endpoint ports.

## Hypotheses & Findings
- **Port mismatch:** FreeSWITCH is not relaying RTP to the ports the endpoints are actually using.
- **Possible causes:**
  - Go echo service may not be advertising the port it is actually listening on in its SDP.
  - FreeSWITCH may not be relaying the correct port in its SDP answer to Linphone.
  - Docker bridge networking may be interfering with correct port mapping.
- **No evidence of NAT or firewall blocking, but Docker bridge mode may be a factor.**

## Next Steps (for future troubleshooting)
- Extract and review the 200 OK SDP from both Go echo and FreeSWITCH to confirm advertised RTP ports.
- Ensure Go echo service binds to and advertises the correct port in its SDP.
- Consider running FreeSWITCH in host network mode for simpler RTP routing.
- Double-check Docker port mappings and firewall rules if using bridge mode.

# RESOLUTION: 2025-06-30 - Native FreeSWITCH + TCP Transport

## Final Solution
After extensive troubleshooting, the issue was resolved by:

1. **Moving from Docker to native FreeSWITCH installation** (via Homebrew on macOS)
2. **Configuring sipgo echo client to use TCP transport** (matching linphone)
3. **Using dynamic IP discovery** instead of hardcoded addresses

## Root Cause Analysis
The original problems were caused by:
- **Docker networking complexity** with bridge mode and port mapping conflicts
- **Transport protocol mismatch** between UDP (sipgo) and TCP (linphone) registration
- **Hardcoded IP addresses** in FreeSWITCH configuration preventing dynamic discovery

## Technical Details

### Native FreeSWITCH Setup
- Installed via `brew install freeswitch`
- Runs directly on host network (no Docker bridge)
- Configuration simplified and minimized for echo testing only

### Transport Protocol Alignment
- **Before**: sipgo registered via UDP, linphone via TCP → registration conflicts
- **After**: Both clients register via TCP → clean SIP registration and call flow

### Dynamic Network Configuration
- Removed hardcoded `192.168.50.100` from `vars.xml`
- FreeSWITCH now auto-discovers local IP via `$${local_ip_v4}`
- SIP/RTP endpoints adapt to actual network configuration

## Verification
**SIP Registration:**
- Both linphone and sipgo register successfully via TCP on port 5060
- Clean registration renewal without conflicts

**RTP Echo Testing:**
- Successful call establishment (INVITE → 200 OK → ACK)
- Bidirectional RTP flow between linphone and sipgo echo service
- Perfect audio echo functionality confirmed

**Configuration Cleanup:**
- FreeSWITCH modules reduced from 60+ to 8 essential modules
- Dialplan simplified to only echo test extensions
- User accounts reduced to essential minimum (echo, linphone, template)
- Removed all demo content and unused features

## Key Learnings
1. **Docker networking adds complexity** for real-time media applications
2. **Transport protocol consistency** is critical for SIP registration
3. **Hardcoded IPs prevent portability** and dynamic network adaptation
4. **Minimal configurations are easier to debug** and maintain

---