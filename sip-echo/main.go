package main

import (
	"context"
	"crypto/md5"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"

	"github.com/emiago/sipgo"
	"github.com/emiago/sipgo/sip"
)

type EchoSession struct {
	remoteAddr *net.UDPAddr
	localPort  int
	conn       *net.UDPConn
	cancel     context.CancelFunc
	mutex      sync.RWMutex
}

var (
	activeSessions = make(map[string]*EchoSession)
	sessionsMutex  sync.RWMutex
)

func main() {
	// Environment variables are provided by direnv in the parent directory
	sipUser := os.Getenv("SIP_USERNAME")
	sipPassword := os.Getenv("SIP_PASSWORD") 
	sipServer := os.Getenv("SIP_DOMAIN")
	sipPort := os.Getenv("SIP_PORT")
	advertiseIP := os.Getenv("SIP_ADVERTISE_IP")

	if sipUser == "" || sipPassword == "" || sipServer == "" || sipPort == "" {
		log.Fatal("SIP credentials must be set")
	}

	// Always bind to all interfaces, but determine which IP to advertise
	bindIP := "0.0.0.0"

	// Discover our local IP on the default route interface
	localIP, err := getDefaultRouteIP()
	if err != nil {
		log.Fatal("Failed to get default route IP:", err)
	}

	var publicIP, sdpIP string
	if advertiseIP != "" {
		// Use specific advertise IP for Contact headers, local IP for SDP
		publicIP = advertiseIP
		sdpIP = localIP
		log.Printf("Binding to all interfaces, advertising Contact IP: %s, SDP IP: %s", publicIP, sdpIP)
	} else {
		// Use discovered local IP for both Contact and SDP
		publicIP = localIP
		sdpIP = localIP
		log.Printf("Binding to all interfaces, advertising IP: %s", publicIP)
	}

	// Create User Agent
	ua, err := sipgo.NewUA(sipgo.WithUserAgent("SIP Echo Client v1.0"))
	if err != nil {
		log.Fatal(err)
	}
	defer ua.Close()

	// Find an available port first
	listener, err := net.Listen("tcp", bindIP+":0")
	if err != nil {
		log.Fatal("Failed to find available port:", err)
	}
	clientPort := listener.Addr().(*net.TCPAddr).Port
	listener.Close()

	// Create client with the available port
	client, err := sipgo.NewClient(ua, sipgo.WithClientHostname(publicIP), sipgo.WithClientPort(clientPort), sipgo.WithClientNAT())
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Client created on %s:%d (advertising %s:%d)", bindIP, clientPort, publicIP, clientPort)

	// Create server using same UA - it will use client's transport
	server, err := sipgo.NewServer(ua)
	if err != nil {
		log.Fatal("Failed to create server:", err)
	}

	// Convert sipPort to int
	serverPort, err := strconv.Atoi(sipPort)
	if err != nil {
		log.Fatal("Invalid SIP_PORT:", sipPort)
	}

	// Build SIP URIs for registration
	serverURI := &sip.Uri{
		Scheme:    "sip",
		Host:      sipServer,
		Port:      serverPort,
		UriParams: sip.HeaderParams{"transport": "tcp"},
	}

	fromURI := &sip.Uri{
		Scheme: "sip",
		User:   sipUser,
		Host:   sipServer,
	}

	contactURI := &sip.Uri{
		Scheme:    "sip",
		User:      sipUser,
		Host:      publicIP,
		Port:      clientPort,
		UriParams: sip.HeaderParams{"transport": "tcp"},
	}

	// Set up call handlers BEFORE registering (capture localIP in closure)
	server.OnInvite(func(req *sip.Request, tx sip.ServerTransaction) {
		callID := req.CallID().Value()
		log.Printf("Incoming call from %s (Call-ID: %s)", req.From().Address.String(), callID)

		// Parse SDP to get remote RTP information
		sdpBody := string(req.Body())
		remoteIP, remotePort, err := parseSDP(sdpBody)
		if err != nil {
			log.Printf("Failed to parse SDP: %v", err)
			res := sip.NewResponseFromRequest(req, 400, "Bad Request", nil)
			tx.Respond(res)
			return
		}

		log.Printf("Remote RTP endpoint: %s:%d", remoteIP, remotePort)

		sessionsMutex.Lock()
		existingSession, sessionExists := activeSessions[callID]
		sessionsMutex.Unlock()

		if sessionExists {
			// This is a re-INVITE, update the existing session
			log.Printf("Re-INVITE detected for Call-ID %s, updating RTP endpoint", callID)

			err := existingSession.updateRTPEndpoint(remoteIP, remotePort)
			if err != nil {
				log.Printf("Failed to update RTP endpoint: %v", err)
				res := sip.NewResponseFromRequest(req, 500, "Internal Server Error", nil)
				tx.Respond(res)
				return
			}

			// Create SDP response with existing local port
			localSDP := createSDPResponse(sdpIP, existingSession.localPort, sdpBody)

			// Create 200 OK response with SDP
			res := sip.NewResponseFromRequest(req, 200, "OK", []byte(localSDP))
			res.AppendHeader(sip.NewHeader("Content-Type", "application/sdp"))

			// Send 200 OK to accept the re-INVITE
			if err := tx.Respond(res); err != nil {
				log.Printf("Failed to send 200 OK for re-INVITE: %v", err)
				return
			}

			log.Printf("Re-INVITE answered with 200 OK, updated RTP endpoint to %s:%d", remoteIP, remotePort)
		} else {
			// This is a new INVITE, create a new session
			session, err := setupEchoSession(remoteIP, remotePort)
			if err != nil {
				log.Printf("Failed to setup echo session: %v", err)
				res := sip.NewResponseFromRequest(req, 500, "Internal Server Error", nil)
				tx.Respond(res)
				return
			}

			// Store session
			sessionsMutex.Lock()
			activeSessions[callID] = session
			sessionsMutex.Unlock()

			// Create SDP response
			localSDP := createSDPResponse(sdpIP, session.localPort, sdpBody)

			// Create 200 OK response with SDP
			res := sip.NewResponseFromRequest(req, 200, "OK", []byte(localSDP))
			res.AppendHeader(sip.NewHeader("Content-Type", "application/sdp"))

			// Send 200 OK to accept the call
			if err := tx.Respond(res); err != nil {
				log.Printf("Failed to send 200 OK: %v", err)
				session.cleanup()
				sessionsMutex.Lock()
				delete(activeSessions, callID)
				sessionsMutex.Unlock()
				return
			}

			log.Printf("Call answered with 200 OK, local RTP port: %d", session.localPort)
		}
	})

	server.OnBye(func(req *sip.Request, tx sip.ServerTransaction) {
		callID := req.CallID().Value()
		log.Printf("Call ended by %s (Call-ID: %s)", req.From().Address.String(), callID)

		// Cleanup session
		sessionsMutex.Lock()
		if session, exists := activeSessions[callID]; exists {
			session.cleanup()
			delete(activeSessions, callID)
		}
		sessionsMutex.Unlock()

		res := sip.NewResponseFromRequest(req, 200, "OK", nil)
		tx.Respond(res)
		log.Println("Call terminated and session cleaned up")
	})

	server.OnAck(func(req *sip.Request, tx sip.ServerTransaction) {
		log.Printf("Received ACK for Call-ID: %s", req.CallID().Value())
		// ACK does not require a response from the server
	})

	// Handle NOTIFY requests (typically for voicemail/message waiting indicators)
	server.OnNotify(func(req *sip.Request, tx sip.ServerTransaction) {
		log.Printf("Received NOTIFY from %s", req.From().Address.String())
		// Just acknowledge the NOTIFY with 200 OK
		res := sip.NewResponseFromRequest(req, 200, "OK", nil)
		tx.Respond(res)
	})

	// Generate unique identifiers for this registration session
	callID := generateCallID()
	fromTag := generateCNonce()[:8] // Use first 8 chars as tag

	// Create REGISTER request
	req := sip.NewRequest(sip.REGISTER, *serverURI)
	req.AppendHeader(sip.NewHeader("From", fromURI.String()+";tag="+fromTag))
	req.AppendHeader(sip.NewHeader("To", fromURI.String()))
	req.AppendHeader(sip.NewHeader("Contact", fmt.Sprintf("\"SIP Echo Client\" <%s>", contactURI.String())))
	req.AppendHeader(sip.NewHeader("Call-ID", callID))
	req.AppendHeader(sip.NewHeader("CSeq", "1 REGISTER"))
	req.AppendHeader(sip.NewHeader("Expires", "3600"))
	req.AppendHeader(sip.NewHeader("Max-Forwards", "70"))
	req.AppendHeader(sip.NewHeader("Supported", "replaces, outbound, gruu, path, record-aware"))
	req.AppendHeader(sip.NewHeader("Content-Length", "0"))

	log.Printf("Sending REGISTER to %s", serverURI.String())
	log.Printf("From: %s", fromURI.String())
	log.Printf("Contact: %s", fmt.Sprintf("\"SIP Echo Client\" <%s>", contactURI.String()))

	ctx := context.Background()

	// Send REGISTER
	tx, err := client.TransactionRequest(ctx, req)
	if err != nil {
		log.Fatal("Failed to send REGISTER:", err)
	}

	// Wait for response
	select {
	case res := <-tx.Responses():
		log.Printf("Received response: %s", res.StartLine())

		if res.StatusCode == 401 || res.StatusCode == 407 {
			log.Println("Authentication required - sending credentials")

			// Parse WWW-Authenticate header
			authHeader := res.GetHeader("WWW-Authenticate")
			if authHeader == nil {
				log.Fatal("No WWW-Authenticate header in 401 response")
			}

			// Extract realm, nonce, opaque, and qop from challenge
			authStr := authHeader.Value()
			realm := extractAuthParam(authStr, "realm")
			nonce := extractAuthParam(authStr, "nonce")
			opaque := extractAuthParam(authStr, "opaque")
			qop := extractAuthParam(authStr, "qop")

			log.Printf("Realm: %s, Nonce: %s, Opaque: %s, QoP: %s", realm, nonce, opaque, qop)

			// Create authenticated REGISTER request (reuse same Call-ID and tag, increment CSeq)
			authReq := sip.NewRequest(sip.REGISTER, *serverURI)
			authReq.AppendHeader(sip.NewHeader("From", fromURI.String()+";tag="+fromTag))
			authReq.AppendHeader(sip.NewHeader("To", fromURI.String()))
			authReq.AppendHeader(sip.NewHeader("Contact", fmt.Sprintf("\"SIP Echo Client\" <%s>", contactURI.String())))
			authReq.AppendHeader(sip.NewHeader("Call-ID", callID))
			authReq.AppendHeader(sip.NewHeader("CSeq", "2 REGISTER"))
			authReq.AppendHeader(sip.NewHeader("Expires", "3600"))
			authReq.AppendHeader(sip.NewHeader("Max-Forwards", "70"))
			authReq.AppendHeader(sip.NewHeader("Supported", "replaces, outbound, gruu, path, record-aware"))
			authReq.AppendHeader(sip.NewHeader("Content-Length", "0"))

			// Create digest response
			uri := serverURI.String()
			var authHeaderValue string

			if qop == "auth" {
				// Use qop=auth with cnonce and nc (match Linphone's parameter order)
				cnonce := generateCNonce()
				nc := "00000001"
				response := calculateDigestResponseWithQop(sipUser, realm, sipPassword, "REGISTER", uri, nonce, cnonce, nc)

				// Match Linphone's exact format: realm, nonce, algorithm, opaque, username, uri, response, cnonce, nc, qop
				authHeaderValue = fmt.Sprintf(`Digest realm="%s", nonce="%s", algorithm=MD5`, realm, nonce)

				if opaque != "" {
					authHeaderValue += fmt.Sprintf(`, opaque="%s"`, opaque)
				}

				authHeaderValue += fmt.Sprintf(`, username="%s", uri="%s", response="%s", cnonce="%s", nc=%s, qop=auth`,
					sipUser, uri, response, cnonce, nc)
			} else {
				// Legacy digest without qop
				response := calculateDigestResponse(sipUser, realm, sipPassword, "REGISTER", uri, nonce)
				authHeaderValue = fmt.Sprintf(`Digest username="%s", realm="%s", nonce="%s", uri="%s", response="%s"`,
					sipUser, realm, nonce, uri, response)

				if opaque != "" {
					authHeaderValue += fmt.Sprintf(`, opaque="%s"`, opaque)
				}
			}

			authReq.AppendHeader(sip.NewHeader("Authorization", authHeaderValue))

			log.Printf("Sending authenticated REGISTER with digest auth")

			// Send authenticated request
			authTx, err := client.TransactionRequest(ctx, authReq)
			if err != nil {
				log.Fatal("Failed to send authenticated REGISTER:", err)
			}

			// Wait for final response
			select {
			case authRes := <-authTx.Responses():
				log.Printf("Auth response: %s", authRes.StartLine())
				if authRes.StatusCode == 200 {
					log.Println("Registration successful!")
				} else {
					log.Printf("Authentication failed: %d %s", authRes.StatusCode, authRes.Reason)
				}
			case <-ctx.Done():
				log.Println("Auth request timeout")
			}

		} else if res.StatusCode == 200 {
			log.Println("Registration successful!")
		} else {
			log.Printf("Registration failed: %d %s", res.StatusCode, res.Reason)
			log.Printf("Response body: %s", res.Body())
		}
	case <-ctx.Done():
		log.Println("Request timeout")
	}

	// Start server to actually listen for incoming calls
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// Use the same port as the client
	serverAddr := fmt.Sprintf("%s:%d", bindIP, clientPort)
	log.Printf("SIP client registered, starting server on %s", serverAddr)

	go func() {
		if err := server.ListenAndServe(ctx, "tcp", serverAddr); err != nil {
			log.Printf("Server error: %v", err)
		}
	}()

	log.Println("Server started, ready to receive calls")

	// Keep running until signal
	<-ctx.Done()
	log.Println("Shutting down...")

	// Cleanup all active sessions
	sessionsMutex.Lock()
	for _, session := range activeSessions {
		session.cleanup()
	}
	sessionsMutex.Unlock()
}

// Parse SDP to extract remote IP and port
func parseSDP(sdp string) (ip string, port int, err error) {
	lines := strings.Split(sdp, "\n")

	// Find connection line (c=)
	var connectionIP string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "c=") {
			// c=IN IP4 127.0.0.1
			parts := strings.Split(line, " ")
			if len(parts) >= 3 {
				connectionIP = parts[2]
			}
		}
	}

	// Find media line (m=audio)
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "m=audio ") {
			// m=audio 54551 RTP/AVP 96 97 98 0 8 18 101 99 100
			parts := strings.Split(line, " ")
			if len(parts) >= 2 {
				port, err = strconv.Atoi(parts[1])
				if err != nil {
					return "", 0, fmt.Errorf("invalid port in media line: %s", parts[1])
				}
				return connectionIP, port, nil
			}
		}
	}

	return "", 0, fmt.Errorf("no audio media line found in SDP")
}

// Create SDP response for our local endpoint
func createSDPResponse(publicIP string, localPort int, remoteSDP string) string {
	// Extract media line and codec attributes from remote SDP
	lines := strings.Split(remoteSDP, "\n")
	var mediaLine string
	var codecAttrs []string

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "m=audio ") {
			// Replace their port with our port but keep their codec list
			parts := strings.Split(line, " ")
			if len(parts) >= 4 {
				parts[1] = fmt.Sprintf("%d", localPort)
				mediaLine = strings.Join(parts, " ")
			}
		} else if strings.HasPrefix(line, "a=rtpmap:") || strings.HasPrefix(line, "a=fmtp:") {
			codecAttrs = append(codecAttrs, line)
		}
	}

	// Build our response with their exact codec configuration
	response := fmt.Sprintf(`v=0
o=echo 1234567890 1234567890 IN IP4 %s
s=Echo Session
c=IN IP4 %s
t=0 0
%s
`, publicIP, publicIP, mediaLine)

	// Add their codec attributes
	for _, attr := range codecAttrs {
		response += attr + "\n"
	}

	response += "a=sendrecv\n"
	return response
}

// Set up RTP echo session
func setupEchoSession(remoteIP string, remotePort int) (*EchoSession, error) {
	// Create UDP connection for RTP - allocate port in range 10000-20000
	var conn *net.UDPConn
	var err error

	// Try to bind to a port in the range 10000-20000
	for port := 10000; port <= 20000; port++ {
		localAddr, addrErr := net.ResolveUDPAddr("udp", fmt.Sprintf(":%d", port))
		if addrErr != nil {
			continue
		}

		conn, err = net.ListenUDP("udp", localAddr)
		if err == nil {
			break // Successfully bound to this port
		}
	}

	if conn == nil {
		return nil, fmt.Errorf("failed to bind to any port in range 10000-20000: %v", err)
	}

	localPort := conn.LocalAddr().(*net.UDPAddr).Port
	log.Printf("Listening for RTP on %s", conn.LocalAddr().String())

	remoteAddr, err := net.ResolveUDPAddr("udp", fmt.Sprintf("%s:%d", remoteIP, remotePort))
	if err != nil {
		conn.Close()
		return nil, err
	}

	// Create context for this session
	ctx, cancel := context.WithCancel(context.Background())

	session := &EchoSession{
		remoteAddr: remoteAddr,
		localPort:  localPort,
		conn:       conn,
		cancel:     cancel,
	}

	// Start echo goroutine with context
	go session.echoLoop(ctx)

	// --- RTP priming logic ---
	// Send a single dummy RTP packet to the remote endpoint to prime the media path
	dummyRTP := make([]byte, 12) // Minimal RTP header (all zeros)
	_, err = conn.WriteToUDP(dummyRTP, remoteAddr)
	if err != nil {
		log.Printf("Failed to send priming RTP packet to %s: %v", remoteAddr, err)
	} else {
		log.Printf("Sent priming RTP packet to %s", remoteAddr)
	}
	// --- End RTP priming logic ---

	return session, nil
}

// Update RTP endpoint for re-INVITE
func (s *EchoSession) updateRTPEndpoint(remoteIP string, remotePort int) error {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	newRemoteAddr, err := net.ResolveUDPAddr("udp", fmt.Sprintf("%s:%d", remoteIP, remotePort))
	if err != nil {
		return err
	}

	s.remoteAddr = newRemoteAddr
	log.Printf("Updated RTP endpoint to %s for session on port %d", s.remoteAddr, s.localPort)
	return nil
}

// RTP echo loop with context-based cancellation
func (s *EchoSession) echoLoop(ctx context.Context) {
	log.Printf("Starting RTP echo loop, listening on port %d, echoing to %s", s.localPort, s.remoteAddr)

	// Close connection when context is cancelled to interrupt blocking reads
	go func() {
		<-ctx.Done()
		s.conn.Close()
	}()

	buffer := make([]byte, 1500) // Standard MTU size

	for {
		n, _, err := s.conn.ReadFromUDP(buffer)
		if err != nil {
			// Check if context was cancelled
			if ctx.Err() != nil {
				log.Printf("Echo loop stopping for port %d", s.localPort)
				return
			}
			log.Printf("RTP read error: %v", err)
			continue
		}

		// Echo the packet to the negotiated SDP endpoint (spec compliant)
		s.mutex.RLock()
		remoteAddr := s.remoteAddr
		s.mutex.RUnlock()

		_, err = s.conn.WriteToUDP(buffer[:n], remoteAddr)
		if err != nil {
			if ctx.Err() != nil {
				return // Context cancelled during write
			}
			log.Printf("RTP write error: %v", err)
		}
	}
}

// min returns the smaller of two ints
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// Cleanup session
func (s *EchoSession) cleanup() {
	s.cancel() // This will trigger context cancellation and close the connection
	log.Printf("Cleaned up echo session on port %d", s.localPort)
}

// Extract parameter from WWW-Authenticate header
func extractAuthParam(authStr, param string) string {
	parts := strings.Split(authStr, param+"=")
	if len(parts) < 2 {
		return ""
	}
	value := strings.TrimSpace(parts[1])
	if strings.HasPrefix(value, "\"") {
		end := strings.Index(value[1:], "\"")
		if end > 0 {
			return value[1 : end+1]
		}
	} else {
		end := strings.IndexAny(value, ", ")
		if end > 0 {
			return value[:end]
		}
	}
	return value
}

// Generate a random cnonce for digest authentication
func generateCNonce() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// Generate a random Call-ID
func generateCallID() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// Calculate MD5 digest response for SIP authentication with qop=auth
func calculateDigestResponseWithQop(username, realm, password, method, uri, nonce, cnonce, nc string) string {
	// HA1 = MD5(username:realm:password)
	ha1 := fmt.Sprintf("%x", md5.Sum([]byte(username+":"+realm+":"+password)))

	// HA2 = MD5(method:uri)
	ha2 := fmt.Sprintf("%x", md5.Sum([]byte(method+":"+uri)))

	// Response = MD5(HA1:nonce:nc:cnonce:qop:HA2)
	response := fmt.Sprintf("%x", md5.Sum([]byte(ha1+":"+nonce+":"+nc+":"+cnonce+":auth:"+ha2)))

	return response
}

// Calculate MD5 digest response for SIP authentication (legacy without qop)
func calculateDigestResponse(username, realm, password, method, uri, nonce string) string {
	// HA1 = MD5(username:realm:password)
	ha1 := fmt.Sprintf("%x", md5.Sum([]byte(username+":"+realm+":"+password)))

	// HA2 = MD5(method:uri)
	ha2 := fmt.Sprintf("%x", md5.Sum([]byte(method+":"+uri)))

	// Response = MD5(HA1:nonce:HA2)
	response := fmt.Sprintf("%x", md5.Sum([]byte(ha1+":"+nonce+":"+ha2)))

	return response
}

// Get our local IP address on the default route interface
func getDefaultRouteIP() (string, error) {
	// Use a well-known external IP to determine which local interface would be used
	// We use Google's DNS server as it's always reachable
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return "", err
	}
	defer conn.Close()

	localAddr := conn.LocalAddr().(*net.UDPAddr)
	ip := localAddr.IP

	// Prefer IPv4 over IPv6 for SIP compatibility
	if ip.To4() != nil {
		return ip.String(), nil
	}

	// If we got IPv6, try to find an IPv4 alternative
	if ip.IsLoopback() {
		return "127.0.0.1", nil // Use IPv4 loopback instead of ::1
	}

	return ip.String(), nil
}

// Get the local IP address that would be used to reach the given destination (deprecated, use getDefaultGatewayIP)
func getLocalIPForDestination(destination, port string) (string, error) {
	// Use the actual destination port for the UDP dial to determine routing
	conn, err := net.Dial("udp", destination+":"+port)
	if err != nil {
		return "", err
	}
	defer conn.Close()

	localAddr := conn.LocalAddr().(*net.UDPAddr)
	ip := localAddr.IP

	// Prefer IPv4 over IPv6 for SIP compatibility
	if ip.To4() != nil {
		return ip.String(), nil
	}

	// If we got IPv6, try to find an IPv4 alternative
	if ip.IsLoopback() {
		return "127.0.0.1", nil // Use IPv4 loopback instead of ::1
	}

	return ip.String(), nil
}
