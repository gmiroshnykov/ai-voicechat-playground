package main

import (
	"context"
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
	"github.com/rs/cors"
)

const (
	// Audio constants for Opus codec
	OPUS_SAMPLE_RATE = 48000
	OPUS_CHANNELS    = 2
)

type ConversationManager struct {
	peers map[string]*webrtc.PeerConnection
	mu    sync.Mutex // Mutex to protect access to the peers map
}

// AudioPacket represents an RTP audio packet for processing
type AudioPacket struct {
	packet *rtp.Packet
}

// startAudioProcessing sets up the audio tee pattern with multiple consumers
// and ensures graceful shutdown using context.
func startAudioProcessing(ctx context.Context, inputTrack *webrtc.TrackRemote, outputTrack *webrtc.TrackLocalStaticRTP, conversationID string, pc *webrtc.PeerConnection) {
	// Create channels for different consumers
	echoQueue := make(chan AudioPacket, 100)      // Small buffer for real-time echo
	recorderQueue := make(chan AudioPacket, 2000) // Larger buffer for disk recording

	// Close queues once when the peer connection is disconnected, closed, or failed (client hang-up)
	var closeOnce sync.Once
	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		log.Printf("[%s] Peer Connection State has changed: %s", conversationID, state.String())
		if state == webrtc.PeerConnectionStateDisconnected || state == webrtc.PeerConnectionStateClosed || state == webrtc.PeerConnectionStateFailed {
			closeOnce.Do(func() {
				log.Printf("[%s] Closing audio processing queues due to connection state: %s", conversationID, state.String())
				close(echoQueue)
				close(recorderQueue)
			})
		}
	})

	// Start consumers and producer with context for graceful shutdown
	go echoConsumer(ctx, outputTrack, echoQueue, conversationID)
	go recordingConsumer(ctx, conversationID, recorderQueue)
	go audioProducerWithTee(ctx, inputTrack, echoQueue, recorderQueue, conversationID)
}

// audioProducerWithTee reads RTP packets and distributes them to multiple consumers
func audioProducerWithTee(ctx context.Context, inputTrack *webrtc.TrackRemote, echoQueue, recorderQueue chan<- AudioPacket, conversationID string) {
	rtpBuf := make([]byte, 1500)
	for {
		select {
		case <-ctx.Done():
			log.Printf("[%s] Audio producer stopping due to context cancellation.", conversationID)
			return
		default:
			n, _, err := inputTrack.Read(rtpBuf)
			if err != nil {
				if err == io.EOF {
					log.Printf("[%s] Audio producer stopping: EOF on input track.", conversationID)
				} else {
					log.Printf("[%s] Audio producer stopping: Error reading RTP: %v", conversationID, err)
				}
				return
			}

			// Parse the RTP packet
			packet := &rtp.Packet{}
			if err := packet.Unmarshal(rtpBuf[:n]); err != nil {
				log.Printf("[%s] Error parsing RTP packet: %v", conversationID, err)
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
			case <-ctx.Done():
				log.Printf("[%s] Audio producer stopping: Context cancelled while sending to echo queue.", conversationID)
				return
			default:
				// Echo queue full - potential network issue
				log.Printf("[%s] Echo queue full, dropping packet", conversationID)
			}

			// Send to recorder consumer (non-blocking)
			select {
			case recorderQueue <- AudioPacket{packet: recorderPacket}:
				// Recording packet sent successfully
			case <-ctx.Done():
				log.Printf("[%s] Audio producer stopping: Context cancelled while sending to recorder queue.", conversationID)
				return
			default:
				// Recorder queue full - disk I/O issue
				log.Printf("[%s] Recorder queue full, dropping packet", conversationID)
			}
		}
	}
}

// echoConsumer handles real-time audio echo back to client
func echoConsumer(ctx context.Context, outputTrack *webrtc.TrackLocalStaticRTP, echoQueue <-chan AudioPacket, conversationID string) {
	for {
		select {
		case <-ctx.Done():
			log.Printf("[%s] Echo consumer stopping due to context cancellation.", conversationID)
			return
		case audioPacket, ok := <-echoQueue:
			if !ok {
				log.Printf("[%s] Echo queue closed, echo consumer finished.", conversationID)
				return
			}
			// Send packet directly (no delay)
			if err := outputTrack.WriteRTP(audioPacket.packet); err != nil {
				log.Printf("[%s] Echo consumer stopping: Error writing RTP to output track: %v", conversationID, err)
				return
			}
		}
	}
}

// recordingConsumer handles writing audio packets to disk as raw Opus files
func recordingConsumer(ctx context.Context, conversationID string, recorderQueue <-chan AudioPacket) {
	log.Printf("[%s] Recording consumer started.", conversationID)

	// Create conversation directory
	conversationDir := filepath.Join("conversations", conversationID)
	if err := os.MkdirAll(conversationDir, 0755); err != nil {
		log.Printf("[%s] Error creating conversation directory %s: %v", conversationID, conversationDir, err)
		return
	}

	// Create Ogg/Opus writer to mux raw Opus frames into an Ogg container
	oggFile := filepath.Join(conversationDir, "user_audio.ogg")
	oggWriter, err := oggwriter.New(oggFile, OPUS_SAMPLE_RATE, OPUS_CHANNELS)
	if err != nil {
		log.Printf("[%s] Error creating Ogg writer for %s: %v", conversationID, oggFile, err)
		return
	}
	log.Printf("[%s] Recording Ogg file: %s", conversationID, oggFile)

	// Consume queued Opus packets and write to Ogg
	for {
		select {
		case <-ctx.Done():
			log.Printf("[%s] Recording consumer stopping due to context cancellation.", conversationID)
			// Attempt to close writer even if context is cancelled
			if err := oggWriter.Close(); err != nil {
				log.Printf("[%s] Error closing Ogg writer on context cancellation: %v", conversationID, err)
			} else {
				log.Printf("[%s] Finished writing Ogg file on context cancellation: %s", conversationID, oggFile)
			}
			return
		case pkt, ok := <-recorderQueue:
			if !ok {
				log.Printf("[%s] Recorder queue closed, recording consumer finished.", conversationID)
				if err := oggWriter.Close(); err != nil {
					log.Printf("[%s] Error closing Ogg writer: %v", conversationID, err)
				} else {
					log.Printf("[%s] Finished writing Ogg file: %s", conversationID, oggFile)
				}
				return
			}
			if err := oggWriter.WriteRTP(pkt.packet); err != nil {
				log.Printf("[%s] Ogg writer error: %v", conversationID, err)
			}
		}
	}
}

func NewConversationManager() *ConversationManager {
	return &ConversationManager{
		peers: make(map[string]*webrtc.PeerConnection),
	}
}

func (cm *ConversationManager) handleWebRTC(w http.ResponseWriter, r *http.Request) {
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
	log.Printf("[%s] Starting new conversation.", conversationID)

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
		log.Printf("[%s] Error creating peer connection: %v", conversationID, err)
		http.Error(w, "Error creating peer connection", http.StatusInternalServerError)
		return
	}

	// Store the peer connection
	cm.mu.Lock()
	cm.peers[conversationID] = peerConnection
	cm.mu.Unlock()

	// Create echo track upfront so it's included in the SDP answer
	localTrack, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{
		MimeType: webrtc.MimeTypeOpus, // Use MimeTypeOpus constant
	}, "audio", "echo")
	if err != nil {
		log.Printf("[%s] Error creating local track: %v", conversationID, err)
		http.Error(w, "Error creating local track", http.StatusInternalServerError)
		return
	}

	// Add the echo track to the peer connection
	_, err = peerConnection.AddTrack(localTrack) // Removed rtpSender as handleRTCP is removed
	if err != nil {
		log.Printf("[%s] Error adding track: %v", conversationID, err)
		http.Error(w, "Error adding track", http.StatusInternalServerError)
		return
	}

	// Create a context for audio processing goroutines
	audioCtx, audioCancel := context.WithCancel(context.Background())

	// Handle incoming audio tracks
	peerConnection.OnTrack(func(track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		log.Printf("[%s] Received audio track: %s, Codec: %s", conversationID, track.Kind(), track.Codec().MimeType)
		// Start audio processing with tee pattern for multiple consumers
		startAudioProcessing(audioCtx, track, localTrack, conversationID, peerConnection)
	})

	// Handle ICE connection state changes
	peerConnection.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		log.Printf("[%s] ICE connection state changed: %s", conversationID, state.String())
	})

	// Track ICE gathering completion
	iceGatheringComplete := make(chan bool)

	// Handle ICE candidates
	peerConnection.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate != nil {
			log.Printf("[%s] Generated ICE candidate: %s", conversationID, candidate.String())
		} else {
			log.Printf("[%s] ICE candidate gathering complete", conversationID)
			select {
			case iceGatheringComplete <- true:
			default:
			}
		}
	})

	// Handle connection state changes
	peerConnection.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		log.Printf("[%s] Peer Connection State has changed: %s", conversationID, state.String())
		if state == webrtc.PeerConnectionStateClosed || state == webrtc.PeerConnectionStateFailed {
			log.Printf("[%s] Cleaning up peer connection.", conversationID)
			cm.mu.Lock()
			delete(cm.peers, conversationID)
			cm.mu.Unlock()
			audioCancel() // Cancel the context for audio processing goroutines
		}
	})

	// Set the remote description (offer)
	offer := webrtc.SessionDescription{
		Type: webrtc.SDPTypeOffer,
		SDP:  string(offerSDP),
	}

	err = peerConnection.SetRemoteDescription(offer)
	if err != nil {
		log.Printf("[%s] Error setting remote description: %v", conversationID, err)
		http.Error(w, "Error setting remote description", http.StatusInternalServerError)
		return
	}

	// Create an answer
	answer, err := peerConnection.CreateAnswer(nil)
	if err != nil {
		log.Printf("[%s] Error creating answer: %v", conversationID, err)
		http.Error(w, "Error creating answer", http.StatusInternalServerError)
		return
	}

	// Set the local description
	err = peerConnection.SetLocalDescription(answer)
	if err != nil {
		log.Printf("[%s] Error setting local description: %v", conversationID, err)
		http.Error(w, "Error setting local description", http.StatusInternalServerError)
		return
	}

	// Wait for ICE gathering to complete
	select {
	case <-iceGatheringComplete:
		log.Printf("[%s] ICE gathering completed, sending answer", conversationID)
	case <-time.After(10 * time.Second):
		log.Printf("[%s] ICE gathering timeout (10s), sending incomplete answer", conversationID)
	}

	log.Printf("[%s] Generated SDP answer.", conversationID)

	// Send the complete answer (with ICE candidates) back
	w.Header().Set("Content-Type", "application/sdp")
	w.Header().Set("X-Conversation-Id", conversationID)
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(peerConnection.LocalDescription().SDP))
}

func (cm *ConversationManager) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	cm.mu.Lock()
	activeConversations := len(cm.peers)
	cm.mu.Unlock()
	response := map[string]interface{}{
		"status":               "ok",
		"timestamp":            time.Now().Format(time.RFC3339),
		"active_conversations": activeConversations,
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

	// Use CORS middleware
	c := cors.New(cors.Options{
		AllowedOrigins: []string{"*"}, // Allow all origins for development
		AllowedMethods: []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders: []string{"Content-Type", "X-Conversation-Id"},
		ExposedHeaders: []string{"X-Conversation-Id"},
		Debug:          false, // Set to true for CORS debugging
	})

	handler := c.Handler(r)

	log.Printf("Starting WebRTC server with HTTP signaling on port %s", port)
	log.Printf("Server running on http://localhost:%s", port)
	log.Printf("HTTP-based WebRTC signaling ready")

	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatalf("Server failed to start: %v", err) // Use Fatalf to exit on critical error
	}
}