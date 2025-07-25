package main

import (
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/signal"
	"regexp"
	"strings"
	"syscall"
	"time"
)

type Config struct {
	Port      int
	Protocols []string
	Verbose   bool
}

func main() {
	var config Config
	var protocolsFlag string

	flag.IntVar(&config.Port, "port", 1505, "Port to listen on")
	flag.StringVar(&protocolsFlag, "protocols", "tcp,udp", "Protocols to support (tcp,udp or both)")
	flag.BoolVar(&config.Verbose, "verbose", false, "Enable verbose logging")
	flag.Parse()

	config.Protocols = strings.Split(protocolsFlag, ",")
	for i, p := range config.Protocols {
		config.Protocols[i] = strings.TrimSpace(strings.ToLower(p))
	}

	logf("Starting Echo Server on port %d", config.Port)
	logf("Protocols: %v", config.Protocols)

	// Setup signal handling for graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Start servers for each protocol
	for _, protocol := range config.Protocols {
		switch protocol {
		case "tcp":
			go startTCPServer(config)
		case "udp":
			go startUDPServer(config)
		default:
			log.Fatalf("Unsupported protocol: %s", protocol)
		}
	}

	// Wait for shutdown signal
	<-sigChan
	logf("Shutdown signal received, stopping servers...")
}

// logf prints a timestamped log message
func logf(format string, args ...interface{}) {
	timestamp := time.Now().Format("2006-01-02 15:04:05.000")
	fmt.Printf("[%s] %s\n", timestamp, fmt.Sprintf(format, args...))
}

// parseUDPMessage parses the UDP message and extracts custom reply address if present
// Format: "<IP>:<PORT>\n<MESSAGE>"
// Returns the reply address and the actual message to echo
func parseUDPMessage(message string, defaultAddr *net.UDPAddr) (*net.UDPAddr, string) {
	// Check if message contains a newline (potential custom address format)
	if idx := strings.Index(message, "\n"); idx != -1 {
		firstLine := message[:idx]
		actualMessage := message[idx+1:]
		
		// Basic regex to match IP:PORT pattern
		// Supports IPv4 and IPv6 addresses
		ipPortRegex := regexp.MustCompile(`^(.+):(\d+)$`)
		if matches := ipPortRegex.FindStringSubmatch(firstLine); matches != nil {
			customAddr := firstLine
			if udpAddr, err := net.ResolveUDPAddr("udp", customAddr); err == nil {
				return udpAddr, actualMessage
			}
		}
	}
	
	// Fallback to default behavior: use source address and treat whole payload as message
	return defaultAddr, message
}

func startTCPServer(config Config) {
	addr := fmt.Sprintf("0.0.0.0:%d", config.Port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("Failed to start TCP server: %v", err)
	}
	defer listener.Close()

	logf("TCP Echo Server listening on %s", addr)

	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("Failed to accept TCP connection: %v", err)
			continue
		}

		go handleTCPConnection(conn, config.Verbose)
	}
}

func handleTCPConnection(conn net.Conn, verbose bool) {
	defer conn.Close()

	clientAddr := conn.RemoteAddr().String()
	if verbose {
		logf("TCP: New connection from %s", clientAddr)
	}

	// Set read timeout
	conn.SetReadDeadline(time.Now().Add(30 * time.Second))

	buffer := make([]byte, 4096)
	for {
		n, err := conn.Read(buffer)
		if err != nil {
			if err == io.EOF {
				if verbose {
					logf("TCP: Connection closed by %s", clientAddr)
				}
				return
			}
			log.Printf("TCP: Error reading from %s: %v", clientAddr, err)
			return
		}

		message := string(buffer[:n])
		if verbose {
			logf("TCP: Received from %s: %q", clientAddr, message)
		}

		// Echo back the message
		_, err = conn.Write(buffer[:n])
		if err != nil {
			log.Printf("TCP: Error writing to %s: %v", clientAddr, err)
			return
		}

		if verbose {
			logf("TCP: Echoed to %s: %q", clientAddr, message)
		}

		// Reset read deadline
		conn.SetReadDeadline(time.Now().Add(30 * time.Second))
	}
}

func startUDPServer(config Config) {
	addr := fmt.Sprintf("0.0.0.0:%d", config.Port)
	udpAddr, err := net.ResolveUDPAddr("udp", addr)
	if err != nil {
		log.Fatalf("Failed to resolve UDP address: %v", err)
	}

	conn, err := net.ListenUDP("udp", udpAddr)
	if err != nil {
		log.Fatalf("Failed to start UDP server: %v", err)
	}
	defer conn.Close()

	logf("UDP Echo Server listening on %s", addr)

	buffer := make([]byte, 4096)
	for {
		n, clientAddr, err := conn.ReadFromUDP(buffer)
		if err != nil {
			log.Printf("UDP: Error reading: %v", err)
			continue
		}

		message := string(buffer[:n])
		if config.Verbose {
			logf("UDP: Received from %s: %q", clientAddr, message)
		}

		// Parse custom reply address from message
		replyAddr, actualMessage := parseUDPMessage(message, clientAddr)
		
		if config.Verbose && replyAddr.String() != clientAddr.String() {
			logf("UDP: Custom reply address: %s", replyAddr)
		}

		// Echo back the actual message (without the custom address header)
		_, err = conn.WriteToUDP([]byte(actualMessage), replyAddr)
		if err != nil {
			log.Printf("UDP: Error writing to %s: %v", replyAddr, err)
			continue
		}

		if config.Verbose {
			logf("UDP: Echoed to %s: %q", replyAddr, actualMessage)
		}
	}
}