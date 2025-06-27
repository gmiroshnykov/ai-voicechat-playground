package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/gorilla/mux"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
	oggwriter "github.com/pion/webrtc/v4/pkg/media/oggwriter"
)

type ConversationManager struct {
	peers map[string]*webrtc.PeerConnection
}

// handleRTCP processes RTCP packets for the RTP sender
func handleRTCP(rtpSender *webrtc.RTPSender) {
	rtcpBuf := make([]byte, 1500)
	for {
		if _, _, err := rtpSender.Read(rtcpBuf); err != nil {
			return
		}
	}
}

// AudioPacket represents an RTP audio packet for processing
type AudioPacket struct {
	packet *rtp.Packet
}

// startAudioProcessing sets up the audio tee pattern with multiple consumers
// startAudioProcessing sets up the audio tee with multiple consumers and closes queues on hang-up
func startAudioProcessing(inputTrack *webrtc.TrackRemote, outputTrack *webrtc.TrackLocalStaticRTP, conversationID string, pc *webrtc.PeerConnection) {
	// Create channels for different consumers
	echoQueue := make(chan AudioPacket, 100)      // Small buffer for real-time echo
	recorderQueue := make(chan AudioPacket, 2000) // Larger buffer for disk recording

	// Close queues once when the peer connection is disconnected, closed, or failed (client hang-up)
	var closeOnce sync.Once
	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		if state == webrtc.PeerConnectionStateDisconnected || state == webrtc.PeerConnectionStateClosed || state == webrtc.PeerConnectionStateFailed {
			closeOnce.Do(func() {
				close(echoQueue)
				close(recorderQueue)
			})
		}
	})

	// Start consumers and producer
	go echoConsumer(outputTrack, echoQueue)
	go recordingConsumer(conversationID, recorderQueue)
	go audioProducerWithTee(inputTrack, echoQueue, recorderQueue)
}

// audioProducerWithTee reads RTP packets and distributes them to multiple consumers
func audioProducerWithTee(inputTrack *webrtc.TrackRemote, echoQueue, recorderQueue chan<- AudioPacket) {
	rtpBuf := make([]byte, 1500)

	for {
		n, _, err := inputTrack.Read(rtpBuf)
		if err != nil {
			log.Printf("Audio producer stopping: %v", err)
			return
		}

		// Parse the RTP packet
		packet := &rtp.Packet{}
		if err := packet.Unmarshal(rtpBuf[:n]); err != nil {
			log.Printf("Error parsing RTP packet: %v", err)
			continue
		}

		// Create copies for each consumer to avoid data races
		echoPacket := &rtp.Packet{
			Header:  packet.Header,
			Payload: make([]byte, len(packet.Payload)),
		}
		copy(echoPacket.Payload, packet.Payload)

		recorderPacket := &rtp.Packet{
			Header:  packet.Header,
			Payload: make([]byte, len(packet.Payload)),
		}
		copy(recorderPacket.Payload, packet.Payload)

		// Send to echo consumer (prioritize real-time)
		select {
		case echoQueue <- AudioPacket{packet: echoPacket}:
			// Echo packet sent successfully
		default:
			// Echo queue full - potential network issue
			log.Printf("Echo queue full, dropping packet")
		}

		// Send to recorder consumer (non-blocking)
		select {
		case recorderQueue <- AudioPacket{packet: recorderPacket}:
			// Recording packet sent successfully
		default:
			// Recorder queue full - disk I/O issue
			log.Printf("Recorder queue full, dropping packet")
		}
	}
}

// echoConsumer handles real-time audio echo back to client
func echoConsumer(outputTrack *webrtc.TrackLocalStaticRTP, echoQueue <-chan AudioPacket) {
	for audioPacket := range echoQueue {
		// Send packet directly (no delay)
		if err := outputTrack.WriteRTP(audioPacket.packet); err != nil {
			log.Printf("Echo consumer stopping: %v", err)
			return
		}
	}
	log.Printf("Echo consumer finished")
}

// recordingConsumer handles writing audio packets to disk as raw Opus files
func recordingConsumer(conversationID string, recorderQueue <-chan AudioPacket) {
	log.Printf("Recording consumer started for conversation: %s", conversationID)

	// Create conversation directory
	conversationDir := filepath.Join("conversations", conversationID)
	if err := os.MkdirAll(conversationDir, 0755); err != nil {
		log.Printf("Error creating conversation directory: %v", err)
		return
	}

	// Create Ogg/Opus writer to mux raw Opus frames into an Ogg container
	oggFile := filepath.Join(conversationDir, "user_audio.ogg")
	oggWriter, err := oggwriter.New(oggFile, 48000, 2)
	if err != nil {
		log.Printf("Error creating Ogg writer: %v", err)
		return
	}
	log.Printf("Recording Ogg file: %s", oggFile)

	// Consume queued Opus packets and write to Ogg
	for pkt := range recorderQueue {
		if err := oggWriter.WriteRTP(pkt.packet); err != nil {
			log.Printf("Ogg writer error: %v", err)
		}
	}

	// Finalize the Ogg file
	if err := oggWriter.Close(); err != nil {
		log.Printf("Error closing Ogg writer: %v", err)
	} else {
		log.Printf("Finished writing Ogg file: %s", oggFile)
	}

}

func NewConversationManager() *ConversationManager {
	return &ConversationManager{
		peers: make(map[string]*webrtc.PeerConnection),
	}
}

func (cm *ConversationManager) handleWebRTC(w http.ResponseWriter, r *http.Request) {
	// CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	log.Println("Received WebRTC signaling request")

	// Read SDP offer from request body
	offerSDP, err := io.ReadAll(r.Body)
	if err != nil {
		log.Printf("Error reading request body: %v", err)
		http.Error(w, "Error reading request body", http.StatusBadRequest)
		return
	}

	// Generate conversation ID
	conversationID := fmt.Sprintf("%d", time.Now().UnixNano())
	log.Printf("Starting conversation: %s", conversationID)

	// Create a new WebRTC peer connection
	config := webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{
				URLs: []string{"stun:stun.l.google.com:19302"},
			},
		},
	}

	peerConnection, err := webrtc.NewPeerConnection(config)
	if err != nil {
		log.Printf("Error creating peer connection: %v", err)
		http.Error(w, "Error creating peer connection", http.StatusInternalServerError)
		return
	}

	// Store the peer connection
	cm.peers[conversationID] = peerConnection

	// Create echo track upfront so it's included in the SDP answer
	localTrack, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{
		MimeType: "audio/opus",
	}, "audio", "echo")
	if err != nil {
		log.Printf("Error creating local track: %v", err)
		http.Error(w, "Error creating local track", http.StatusInternalServerError)
		return
	}

	// Add the echo track to the peer connection
	rtpSender, err := peerConnection.AddTrack(localTrack)
	if err != nil {
		log.Printf("Error adding track: %v", err)
		http.Error(w, "Error adding track", http.StatusInternalServerError)
		return
	}

	// Handle RTCP packets in background
	go handleRTCP(rtpSender)

	// Handle incoming audio tracks
	peerConnection.OnTrack(func(track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		log.Printf("Received audio track: %s", track.Kind())
		// Start audio processing with tee pattern for multiple consumers
		startAudioProcessing(track, localTrack, conversationID, peerConnection)
	})

	// Handle ICE connection state changes
	peerConnection.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		log.Printf("ICE connection state changed: %s", state.String())
	})

	// Track ICE gathering completion
	iceGatheringComplete := make(chan bool)

	// Handle ICE candidates
	peerConnection.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate != nil {
			log.Printf("Generated ICE candidate: %s", candidate.String())
		} else {
			log.Printf("ICE candidate gathering complete")
			select {
			case iceGatheringComplete <- true:
			default:
			}
		}
	})

	// Handle connection state changes
	peerConnection.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		log.Printf("Connection state changed: %s", state.String())
		if state == webrtc.PeerConnectionStateClosed || state == webrtc.PeerConnectionStateFailed {
			delete(cm.peers, conversationID)
		}
	})

	// Set the remote description (offer)
	offer := webrtc.SessionDescription{
		Type: webrtc.SDPTypeOffer,
		SDP:  string(offerSDP),
	}

	err = peerConnection.SetRemoteDescription(offer)
	if err != nil {
		log.Printf("Error setting remote description: %v", err)
		http.Error(w, "Error setting remote description", http.StatusInternalServerError)
		return
	}

	// Create an answer
	answer, err := peerConnection.CreateAnswer(nil)
	if err != nil {
		log.Printf("Error creating answer: %v", err)
		http.Error(w, "Error creating answer", http.StatusInternalServerError)
		return
	}

	// Set the local description
	err = peerConnection.SetLocalDescription(answer)
	if err != nil {
		log.Printf("Error setting local description: %v", err)
		http.Error(w, "Error setting local description", http.StatusInternalServerError)
		return
	}

	// Wait for ICE gathering to complete
	select {
	case <-iceGatheringComplete:
		log.Printf("ICE gathering completed, sending answer")
	case <-time.After(10 * time.Second):
		log.Printf("ICE gathering timeout, sending incomplete answer")
	}

	log.Printf("Generated SDP answer for conversation: %s", conversationID)

	// Send the complete answer (with ICE candidates) back
	w.Header().Set("Content-Type", "application/sdp")
	w.Header().Set("X-Conversation-Id", conversationID)
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(peerConnection.LocalDescription().SDP))
}

func (cm *ConversationManager) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	response := map[string]interface{}{
		"status":               "ok",
		"timestamp":            time.Now().Format(time.RFC3339),
		"active_conversations": len(cm.peers),
	}
	json.NewEncoder(w).Encode(response)
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3001"
	}

	cm := NewConversationManager()

	r := mux.NewRouter()
	r.HandleFunc("/webrtc", cm.handleWebRTC).Methods("POST", "OPTIONS")
	r.HandleFunc("/health", cm.handleHealth).Methods("GET")

	log.Printf("Starting WebRTC server with HTTP signaling on port %s", port)
	log.Printf("Server running on http://localhost:%s", port)
	log.Printf("HTTP-based WebRTC signaling ready")

	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatal("Server failed to start:", err)
	}
}
