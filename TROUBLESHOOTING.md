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

# SIP ALG Router Interference: 30-Second Call Timeouts with Kyivstar VoIP

## Problem Summary
Calls to/from Kyivstar VoIP service consistently terminated after exactly 30 seconds with "no ACK received" timeout errors. Subsequent call attempts resulted in "user is busy" responses, preventing successful call establishment.

## Investigation Timeline

### Initial Symptoms
- **Exact 30-second call duration** before automatic disconnection
- **SIP Timer F timeout** (32-second INVITE transaction timeout) 
- **"No ACK received"** error in call termination reason
- **"User is busy"** responses on subsequent call attempts
- **Contact header corruption** showing mystery IP `10.0.9.158` instead of actual client IP

### Troubleshooting Steps Performed

1. **FreeSWITCH Configuration Analysis**
   - Verified gateway registration and SIP profiles
   - Confirmed proper network settings and transport protocols
   - Ruled out FreeSWITCH-specific configuration issues

2. **Linphone Client Testing**
   - Isolated issue by testing with Linphone instead of FreeSWITCH
   - Confirmed same 30-second timeout behavior
   - Eliminated FreeSWITCH as the source of the problem

3. **Transport Protocol Testing**
   - **TCP Transport**: Same timeout behavior observed
   - **TLS Transport**: Initially thought to bypass SIP ALG, but timeout persisted
   - **UDP Transport**: Confirmed same Contact header corruption

4. **STUN Configuration Testing**
   - Configured STUN servers to assist with NAT traversal
   - No improvement in call duration or Contact header issues
   - STUN helped with media but didn't resolve signaling problems

5. **Network Packet Analysis**
   - **Multiple packet captures** across different protocols and configurations
   - **Contact header inspection** revealed corrupted IP addresses
   - **Mystery IP `10.0.9.158`** appearing in Contact headers instead of actual client IP
   - **SIP message flow analysis** showing proper INVITE → 200 OK but missing ACK delivery

### Root Cause Discovery

The issue was traced to **SIP ALG (Application Layer Gateway)** on the home router:

- **Contact Header Corruption**: SIP ALG was rewriting Contact headers with incorrect IP addresses
- **ACK Delivery Failure**: Corrupted Contact headers prevented proper ACK message routing
- **Timer F Timeout**: Missing ACK triggered SIP Timer F (32-second timeout), causing call termination
- **Dialog State Issues**: Failed ACK delivery left SIP dialogs in inconsistent states

### Technical Evidence

**Packet Capture Analysis:**
```
Contact: <sip:USERNAME@10.0.9.158;gr=...>  // Corrupted by SIP ALG
```
Should have been:
```
Contact: <sip:USERNAME@192.168.50.100:61600;transport=udp>  // Correct client IP
```

**Call Flow Pattern:**
1. INVITE sent successfully
2. 180 Ringing received
3. 200 OK received with corrupted Contact header
4. ACK sent to corrupted Contact address (never delivered)
5. Timer F expires after ~30 seconds
6. BYE sent with Reason: "no ACK received"

## Solution

**Disable SIP ALG on the router** through the router's administrative interface. The exact location varies by manufacturer but is typically found under network/WAN settings or NAT configuration.

## Result
- **Calls establish and maintain properly** without timeout
- **Contact headers remain uncorrupted** 
- **ACK messages delivered successfully**
- **No more "user is busy" responses**
- **Full bidirectional audio confirmed**

## Key Learnings

1. **SIP ALG is often problematic** for VoIP applications and should be disabled
2. **30-second timeouts** combined with "no ACK received" are classic SIP ALG symptoms
3. **Contact header corruption** is a clear indicator of SIP ALG interference
4. **Multiple transport protocols** (UDP, TCP, TLS) can all be affected by SIP ALG
5. **Packet capture analysis** is essential for diagnosing SIP dialog issues
6. **Router-level network interference** should be considered early in VoIP troubleshooting

## Prevention
- **Always disable SIP ALG** on home/office routers when deploying VoIP services
- **Use packet captures** to verify Contact header integrity during VoIP testing
- **Monitor for Timer F timeouts** as early indicators of ACK delivery problems

---

# Kyivstar VoIP Integration: Symmetric RTP and Immediate Media Establishment

## Problem Summary
FreeSWITCH calls with Kyivstar VoIP gateway experienced brief (~10 second) call durations, despite successful SIP signaling and registration. The issue was related to RTP media path establishment and NAT traversal with a carrier-grade provider.

## Investigation Process

### Initial Symptoms
- **FreeSWITCH registered successfully** with Kyivstar gateway
- **Calls connected** but terminated after ~10 seconds
- **Brief audio feedback** occasionally heard before disconnection
- **Linphone client worked perfectly** with same Kyivstar credentials

### Key Discovery: Symmetric RTP
Through packet capture analysis comparing Linphone vs FreeSWITCH traffic, we discovered:

**Linphone SDP (working):**
```
v=0
o=USERNAME 2214 3185 IN IP4 192.168.50.100
c=IN IP4 192.168.50.100
m=audio 55183 RTP/AVP 8 0 18 101
```

**FreeSWITCH SDP (initially failing):**
```
v=0  
o=FreeSWITCH 1751378290 1751378291 IN IP4 192.168.50.100
c=IN IP4 192.168.50.100
m=audio 17202 RTP/AVP 8 101
```

**Critical Insight:** Kyivstar uses **symmetric RTP (comedia)** - they ignore SDP-advertised IP addresses and instead:
1. Send initial RTP to the SDP-advertised address
2. **Wait for first incoming RTP packet** to learn the real source IP/port
3. Switch to sending RTP to that learned address for the remainder of the call

## Root Cause
The issue was **delayed RTP establishment**. Unlike Linphone which immediately sent RTP, FreeSWITCH applications like `echo` waited for incoming RTP before generating outbound RTP. This created a deadlock:
- Kyivstar waited for first RTP packet to learn the real media path
- FreeSWITCH echo waited for incoming RTP before echoing
- Result: No RTP flow, causing call termination

## Solution
**Immediate RTP establishment** using a brief silence stream before echo:

```xml
<extension name="kyivstar_incoming">
  <condition field="destination_number" expression="^USERNAME$">
    <action application="answer"/>
    <action application="playback" data="silence_stream://100"/>
    <action application="echo"/>
  </condition>
</extension>
```

### Why This Works
1. **`silence_stream://100`** generates 100ms of inaudible silence
2. **Immediate RTP flow** starts as soon as the call is answered
3. **Kyivstar learns** the real IP/port from first RTP packet
4. **Echo application** then works normally with established media path
5. **Calls now last indefinitely** (until manually hung up)

## Configuration Optimizations

### Transport Protocol
```xml
<param name="register-transport" value="udp"/>
<param name="contact-params" value="transport=udp"/>
```
Matched working Linphone configuration.

### IP Configuration (Simplified)
```xml
<X-PRE-PROCESS cmd="set" data="external_rtp_ip=${local_ip_v4}"/>
<X-PRE-PROCESS cmd="set" data="external_sip_ip=${local_ip_v4}"/>
```
Since Kyivstar uses symmetric RTP, complex STUN configuration is unnecessary. Local IP in SDP works fine because Kyivstar learns the real path from packet flow.

## Key Learnings

1. **Carrier-grade providers often use symmetric RTP** for NAT traversal
2. **SDP IP addresses may be ignored** in favor of actual packet sources  
3. **Immediate RTP establishment** is crucial for symmetric RTP scenarios
4. **Brief silence streams** provide an elegant solution for triggering media flow
5. **Packet capture comparison** between working/failing clients reveals critical insights
6. **Minimal configuration** often works better than complex NAT traversal attempts

## Testing Results
- **Call duration**: Now unlimited (tested 45+ seconds)
- **Audio quality**: Clear bidirectional echo
- **Connection establishment**: Immediate and reliable
- **Configuration complexity**: Minimal and maintainable

---