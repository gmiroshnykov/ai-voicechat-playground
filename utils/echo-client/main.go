package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

type Config struct {
	Host      string
	Port      int
	Protocol  string
	Message   string
	Timeout   int
	Verbose   bool
	ReplyHost string
	ReplyPort int
}

func main() {
	var config Config

	flag.StringVar(&config.Host, "host", "localhost", "Server host/IP")
	flag.IntVar(&config.Port, "port", 1505, "Server port")
	flag.StringVar(&config.Protocol, "protocol", "tcp", "Protocol (tcp or udp)")
	flag.StringVar(&config.Message, "message", "Hello, Echo Server!", "Message to send")
	flag.IntVar(&config.Timeout, "timeout", 5, "Timeout in seconds")
	flag.BoolVar(&config.Verbose, "verbose", false, "Enable verbose logging")
	flag.StringVar(&config.ReplyHost, "reply-host", "", "Custom reply host for UDP (auto-detected if not specified)")
	flag.IntVar(&config.ReplyPort, "reply-port", 0, "Custom reply port for UDP (random if not specified)")
	flag.Parse()

	config.Protocol = strings.ToLower(config.Protocol)

	// For UDP, auto-detect reply host and port if not specified
	if config.Protocol == "udp" {
		if config.ReplyHost == "" {
			if host, err := getDefaultGatewayInterface(); err == nil {
				config.ReplyHost = host
			} else {
				config.ReplyHost = "127.0.0.1"
				if config.Verbose {
					logf("Failed to auto-detect reply host: %v, using %s", err, config.ReplyHost)
				}
			}
		}

		if config.ReplyPort == 0 {
			if port, err := getRandomPort(); err == nil {
				config.ReplyPort = port
			} else {
				config.ReplyPort = 9999
				if config.Verbose {
					logf("Failed to get random port: %v, using %d", err, config.ReplyPort)
				}
			}
		}
	}

	if config.Verbose {
		logf("Connecting to %s://%s:%d", config.Protocol, config.Host, config.Port)
		logf("Message: %q", config.Message)
		logf("Timeout: %d seconds", config.Timeout)
		if config.Protocol == "udp" && config.ReplyHost != "" {
			logf("Custom reply address: %s:%d", config.ReplyHost, config.ReplyPort)
		}
	}

	var response string
	var err error

	switch config.Protocol {
	case "tcp":
		response, err = sendTCP(config)
	case "udp":
		response, err = sendUDP(config)
	default:
		log.Fatalf("Unsupported protocol: %s", config.Protocol)
	}

	if err != nil {
		log.Fatalf("Error: %v", err)
	}

	logf("Response: %q", response)

	// Verify echo (should match the original message, not the formatted one)
	if response == config.Message {
		fmt.Println("✓ Echo successful!")
		os.Exit(0)
	} else {
		fmt.Printf("✗ Echo failed! Expected: %q, Got: %q\n", config.Message, response)
		os.Exit(1)
	}
}

func sendTCP(config Config) (string, error) {
	addr := fmt.Sprintf("%s:%d", config.Host, config.Port)

	if config.Verbose {
		logf("TCP: Connecting to %s", addr)
	}

	conn, err := net.DialTimeout("tcp", addr, time.Duration(config.Timeout)*time.Second)
	if err != nil {
		return "", fmt.Errorf("failed to connect: %v", err)
	}
	defer conn.Close()

	if config.Verbose {
		logf("TCP: Connected to %s", conn.RemoteAddr())
	}

	// Set read/write timeouts
	timeout := time.Duration(config.Timeout) * time.Second
	conn.SetWriteDeadline(time.Now().Add(timeout))
	conn.SetReadDeadline(time.Now().Add(timeout))

	// Send message
	if config.Verbose {
		logf("TCP: Sending: %q", config.Message)
	}

	_, err = conn.Write([]byte(config.Message))
	if err != nil {
		return "", fmt.Errorf("failed to write: %v", err)
	}

	// Read response
	buffer := make([]byte, 4096)
	n, err := conn.Read(buffer)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %v", err)
	}

	response := string(buffer[:n])
	if config.Verbose {
		logf("TCP: Received: %q", response)
	}

	return response, nil
}

func sendUDP(config Config) (string, error) {
	serverAddr := fmt.Sprintf("%s:%d", config.Host, config.Port)

	if config.Verbose {
		logf("UDP: Connecting to %s", serverAddr)
	}

	udpAddr, err := net.ResolveUDPAddr("udp", serverAddr)
	if err != nil {
		return "", fmt.Errorf("failed to resolve UDP address: %v", err)
	}

	// Create separate receiving socket first
	replyAddr := fmt.Sprintf("0.0.0.0:%d", config.ReplyPort)
	replyUDPAddr, err := net.ResolveUDPAddr("udp", replyAddr)
	if err != nil {
		return "", fmt.Errorf("failed to resolve reply UDP address: %v", err)
	}

	replyConn, err := net.ListenUDP("udp", replyUDPAddr)
	if err != nil {
		return "", fmt.Errorf("failed to create reply socket: %v", err)
	}
	defer replyConn.Close()

	if config.Verbose {
		logf("UDP: Listening for replies on %s", replyConn.LocalAddr())
	}

	// Create sending socket
	sendConn, err := net.DialUDP("udp", nil, udpAddr)
	if err != nil {
		return "", fmt.Errorf("failed to connect to server: %v", err)
	}
	defer sendConn.Close()

	if config.Verbose {
		logf("UDP: Connected to %s from %s", sendConn.RemoteAddr(), sendConn.LocalAddr())
	}

	// Set timeouts
	timeout := time.Duration(config.Timeout) * time.Second
	sendConn.SetWriteDeadline(time.Now().Add(timeout))
	replyConn.SetReadDeadline(time.Now().Add(timeout))

	// Always use new-style format for UDP
	messageToSend := fmt.Sprintf("%s:%d\n%s", config.ReplyHost, config.ReplyPort, config.Message)

	// Send message
	if config.Verbose {
		logf("UDP: Sending: %q", messageToSend)
	}

	_, err = sendConn.Write([]byte(messageToSend))
	if err != nil {
		return "", fmt.Errorf("failed to write: %v", err)
	}

	buffer := make([]byte, 4096)
	n, _, err := replyConn.ReadFromUDP(buffer)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %v", err)
	}

	response := string(buffer[:n])
	if config.Verbose {
		logf("UDP: Received: %q", response)
	}

	return response, nil
}

// logf prints a timestamped log message
func logf(format string, args ...interface{}) {
	timestamp := time.Now().Format("2006-01-02 15:04:05.000")
	fmt.Printf("[%s] %s\n", timestamp, fmt.Sprintf(format, args...))
}

// getDefaultGatewayInterface returns the IP address of the default gateway interface
func getDefaultGatewayInterface() (string, error) {
	// Run route command to get default gateway interface
	cmd := exec.Command("route", "-n", "get", "default")
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to run route command: %v", err)
	}

	// Parse the output to find the interface
	lines := strings.Split(string(output), "\n")
	var interfaceName string
	for _, line := range lines {
		if strings.Contains(line, "interface:") {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				interfaceName = parts[1]
				break
			}
		}
	}

	if interfaceName == "" {
		return "", fmt.Errorf("could not find default gateway interface")
	}

	// Get IP address of the interface
	cmd = exec.Command("ifconfig", interfaceName)
	output, err = cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to run ifconfig: %v", err)
	}

	// Parse ifconfig output to find IPv4 address
	re := regexp.MustCompile(`inet\s+(\d+\.\d+\.\d+\.\d+)`)
	matches := re.FindStringSubmatch(string(output))
	if len(matches) < 2 {
		return "", fmt.Errorf("could not find IPv4 address for interface %s", interfaceName)
	}

	return matches[1], nil
}

// getRandomPort returns a random available port
func getRandomPort() (int, error) {
	addr, err := net.ResolveTCPAddr("tcp", "localhost:0")
	if err != nil {
		return 0, err
	}

	l, err := net.ListenTCP("tcp", addr)
	if err != nil {
		return 0, err
	}
	defer l.Close()

	return l.Addr().(*net.TCPAddr).Port, nil
}
