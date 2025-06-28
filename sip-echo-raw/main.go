package main

import (
	"context"
	"crypto/md5"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/emiago/sipgo"
	"github.com/emiago/sipgo/sip"
	"github.com/joho/godotenv"
)

type EchoSession struct {
	remoteAddr *net.UDPAddr
	localPort  int
	conn       *net.UDPConn
	done       chan struct{}
}

var (
	activeSessions = make(map[string]*EchoSession)
	sessionsMutex  sync.RWMutex
)

func main() {
	// Load environment variables
	err := godotenv.Load("../.env")
	if err != nil {
		log.Println("Error loading .env file:", err)
	}

	sipUser := os.Getenv("SIP_USER")
	sipPassword := os.Getenv("SIP_PASSWORD")
	sipServer := os.Getenv("SIP_SERVER")
	sipPort := os.Getenv("SIP_PORT")

	if sipUser == "" || sipPassword == "" || sipServer == "" || sipPort == "" {
		log.Fatal("SIP credentials must be set")
	}

	// Create User Agent
	ua, err := sipgo.NewUA(sipgo.WithUserAgent("SIP Echo Client v1.0"))
	if err != nil {
		log.Fatal(err)
	}
	defer ua.Close()

	// Create client with fixed port - this establishes the transport
	clientPort := 5070
	client, err := sipgo.NewClient(ua, sipgo.WithClientHostname("127.0.0.1"), sipgo.WithClientPort(clientPort))
	if err != nil {
		log.Fatal(err)
	}

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
		Host:      "127.0.0.1",
		Port:      clientPort,
		UriParams: sip.HeaderParams{"transport": "tcp"},
	}

	

	// Set up call handlers BEFORE registering
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

		// Set up local RTP echo server
		session, err := setupEchoSession(remoteIP, remotePort)
		if err != nil {
			log.Printf("Failed to setup echo session: %v", err)
			res := sip.NewResponseFromRequest(req, 500, "Internal Server Error", nil)
			tx.Respond(res)
			return
		}

		// Store session for later cleanup (prevent duplicates)
		sessionsMutex.Lock()
		if _, exists := activeSessions[callID]; exists {
			sessionsMutex.Unlock()
			log.Printf("Call-ID %s already has an active session, ignoring duplicate INVITE", callID)
			session.cleanup()
			return
		}
		activeSessions[callID] = session
		sessionsMutex.Unlock()

		// Create SDP response
		localSDP := createSDPResponse("127.0.0.1", session.localPort)

		// Create 200 OK response with SDP
		res := sip.NewResponseFromRequest(req, 200, "OK", []byte(localSDP))
		res.AppendHeader(sip.NewHeader("Content-Type", "application/sdp"))
		res.AppendHeader(sip.NewHeader("Content-Length", strconv.Itoa(len(localSDP))))

		// Send 200 OK to accept the call
		if err := tx.Respond(res); err != nil {
			log.Printf("Failed to send 200 OK: %v", err)
			session.cleanup()
			return
		}

		log.Printf("Call answered with 200 OK, local RTP port: %d", session.localPort)
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

	// Create REGISTER request
	req := sip.NewRequest(sip.REGISTER, *serverURI)
	req.AppendHeader(sip.NewHeader("From", fromURI.String()+";tag=12345"))
	req.AppendHeader(sip.NewHeader("To", fromURI.String()))
	req.AppendHeader(sip.NewHeader("Contact", contactURI.String()))
	req.AppendHeader(sip.NewHeader("Call-ID", "test-call-id-12345"))
	req.AppendHeader(sip.NewHeader("CSeq", "1 REGISTER"))
	req.AppendHeader(sip.NewHeader("Expires", "3600"))
	req.AppendHeader(sip.NewHeader("Max-Forwards", "70"))
	req.AppendHeader(sip.NewHeader("Content-Length", "0"))

	log.Printf("Sending REGISTER to %s", serverURI.String())
	log.Printf("From: %s", fromURI.String())
	log.Printf("Contact: %s", contactURI.String())

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

			// Extract realm and nonce from challenge
			authStr := authHeader.Value()
			realm := extractAuthParam(authStr, "realm")
			nonce := extractAuthParam(authStr, "nonce")

			log.Printf("Realm: %s, Nonce: %s", realm, nonce)

			// Create authenticated REGISTER request
			authReq := sip.NewRequest(sip.REGISTER, *serverURI)
			authReq.AppendHeader(sip.NewHeader("From", fromURI.String()+";tag=12345"))
			authReq.AppendHeader(sip.NewHeader("To", fromURI.String()))
			authReq.AppendHeader(sip.NewHeader("Contact", contactURI.String()))
			authReq.AppendHeader(sip.NewHeader("Call-ID", "test-call-id-12345"))
			authReq.AppendHeader(sip.NewHeader("CSeq", "2 REGISTER"))
			authReq.AppendHeader(sip.NewHeader("Expires", "3600"))
			authReq.AppendHeader(sip.NewHeader("Max-Forwards", "70"))
			authReq.AppendHeader(sip.NewHeader("Content-Length", "0"))

			// Create digest response
			uri := serverURI.String()
			response := calculateDigestResponse(sipUser, realm, sipPassword, "REGISTER", uri, nonce)

			authHeaderValue := fmt.Sprintf(`Digest username="%s", realm="%s", nonce="%s", uri="%s", response="%s"`,
				sipUser, realm, nonce, uri, response)

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

	log.Println("SIP client registered, starting server on 127.0.0.1:5070")

	// Start server to actually listen for incoming calls
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	go func() {
		if err := server.ListenAndServe(ctx, "tcp", "127.0.0.1:5070"); err != nil {
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
func createSDPResponse(localIP string, localPort int) string {
	return fmt.Sprintf(`v=0
o=echo 1234567890 1234567890 IN IP4 %s
s=Echo Session
c=IN IP4 %s
t=0 0
m=audio %d RTP/AVP 0 8
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=sendrecv
`, localIP, localIP, localPort)
}

// Set up RTP echo session
func setupEchoSession(remoteIP string, remotePort int) (*EchoSession, error) {
	// Create UDP connection for RTP
	localAddr, err := net.ResolveUDPAddr("udp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}

	conn, err := net.ListenUDP("udp", localAddr)
	if err != nil {
		return nil, err
	}

	localPort := conn.LocalAddr().(*net.UDPAddr).Port

	remoteAddr, err := net.ResolveUDPAddr("udp", fmt.Sprintf("%s:%d", remoteIP, remotePort))
	if err != nil {
		conn.Close()
		return nil, err
	}

	session := &EchoSession{
		remoteAddr: remoteAddr,
		localPort:  localPort,
		conn:       conn,
		done:       make(chan struct{}),
	}

	// Start echo goroutine
	go session.echoLoop()

	return session, nil
}

// RTP echo loop
func (s *EchoSession) echoLoop() {
	log.Printf("Starting RTP echo loop, listening on port %d, echoing to %s", s.localPort, s.remoteAddr)

	buffer := make([]byte, 1500) // Standard MTU size

	for {
		select {
		case <-s.done:
			log.Printf("Echo loop stopping for port %d", s.localPort)
			return
		default:
			// Set read timeout to avoid blocking indefinitely
			s.conn.SetReadDeadline(time.Now().Add(100 * time.Millisecond))

			n, addr, err := s.conn.ReadFromUDP(buffer)
			if err != nil {
				if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
					continue // Timeout is expected, continue loop
				}
				log.Printf("RTP read error: %v", err)
				continue
			}

			// Echo the packet back to whoever sent it (not necessarily the SDP endpoint)
			_, err = s.conn.WriteToUDP(buffer[:n], addr)
			if err != nil {
				log.Printf("RTP write error: %v", err)
			}
		}
	}
}

// Cleanup session
func (s *EchoSession) cleanup() {
	close(s.done)
	s.conn.Close()
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

// Calculate MD5 digest response for SIP authentication
func calculateDigestResponse(username, realm, password, method, uri, nonce string) string {
	// HA1 = MD5(username:realm:password)
	ha1 := fmt.Sprintf("%x", md5.Sum([]byte(username+":"+realm+":"+password)))

	// HA2 = MD5(method:uri)
	ha2 := fmt.Sprintf("%x", md5.Sum([]byte(method+":"+uri)))

	// Response = MD5(HA1:nonce:HA2)
	response := fmt.Sprintf("%x", md5.Sum([]byte(ha1+":"+nonce+":"+ha2)))

	return response
}