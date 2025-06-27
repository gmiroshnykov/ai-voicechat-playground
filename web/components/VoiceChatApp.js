import { useState, useRef, useEffect } from 'react';

export default function VoiceChatApp() {
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [status, setStatus] = useState({ type: 'disconnected', message: 'Disconnected' });
    const [messages, setMessages] = useState([
        { type: 'system', text: 'Welcome! Click the call button to start chatting with the AI assistant via WebRTC.', id: 'welcome' }
    ]);
    
    const peerRef = useRef(null);
    const streamRef = useRef(null);
    
    // Cleanup connections when component unmounts
    useEffect(() => {
        return () => {
            cleanupConnections();
        };
    }, []);
    
    const cleanupConnections = () => {
        if (peerRef.current) {
            peerRef.current.close();
            peerRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
    };
    
    const updateStatus = (type, message) => {
        setStatus({ type, message });
    };
    
    const addMessage = (type, text) => {
        setMessages(prev => [...prev, { type, text, id: `${Date.now()}-${Math.random()}` }]);
    };
    
    const startCall = async () => {
        try {
            // Prevent multiple connection attempts
            if (isConnecting || isConnected) {
                console.log('Already connecting or connected');
                return;
            }
            
            setIsConnecting(true);
            updateStatus('connecting', 'Getting microphone access...');
            
            // Get user media first
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 24000
                }
            });
            
            streamRef.current = stream;
            updateStatus('connecting', 'Setting up WebRTC connection...');
            
            // Create native WebRTC peer connection
            const peer = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' }
                ]
            });
            
            peerRef.current = peer;
            
            // Add local stream to peer connection
            stream.getTracks().forEach(track => {
                peer.addTrack(track, stream);
            });
            
            // Handle incoming streams
            peer.ontrack = (event) => {
                console.log('Received echo audio stream from server');
                const [remoteStream] = event.streams;
                
                // Create audio element to play the echoed audio
                const audioElement = document.createElement('audio');
                audioElement.srcObject = remoteStream;
                audioElement.autoplay = true;
                audioElement.volume = 0.8; // Slightly lower to avoid feedback
                
                // Add to page so user can see/control it
                audioElement.controls = true;
                audioElement.style.width = '100%';
                audioElement.style.marginTop = '10px';
                
                // Find a container to add it to, or create one
                const container = document.querySelector('.container') || document.body;
                container.appendChild(audioElement);
                
                addMessage('assistant', 'Echo audio stream started');
            };
            
            // Handle connection state changes
            peer.onconnectionstatechange = () => {
                console.log('Connection state:', peer.connectionState);
                if (peer.connectionState === 'connected') {
                    setIsConnected(true);
                    setIsConnecting(false);
                    updateStatus('connected', 'Connected - Start speaking!');
                    addMessage('system', 'WebRTC connection established');
                } else if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
                    setIsConnected(false);
                    setIsConnecting(false);
                    updateStatus('error', 'Connection failed');
                    addMessage('system', 'Connection failed');
                }
            };
            
            // Handle ICE connection state changes
            peer.oniceconnectionstatechange = () => {
                console.log('ICE connection state:', peer.iceConnectionState);
            };
            
            // Handle signaling state changes
            peer.onsignalingstatechange = () => {
                console.log('Signaling state:', peer.signalingState);
            };
            
            // Create offer and set local description
            const offer = await peer.createOffer({
                offerToReceiveAudio: true
            });
            await peer.setLocalDescription(offer);
            
            // Wait for ICE gathering to complete before sending offer
            await new Promise((resolve) => {
                if (peer.iceGatheringState === 'complete') {
                    resolve();
                } else {
                    peer.addEventListener('icegatheringstatechange', () => {
                        if (peer.iceGatheringState === 'complete') {
                            resolve();
                        }
                    });
                }
            });
            
            console.log('Sending complete SDP offer to server via HTTP');
            updateStatus('connecting', 'Negotiating connection...');
            
            // Send complete offer (with ICE candidates) to server via HTTP
            const response = await fetch('http://localhost:3001/webrtc', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/sdp'
                },
                body: peer.localDescription.sdp
            });
            
            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }
            
            const answerSdp = await response.text();
            const conversationId = response.headers.get('X-Conversation-Id');
            
            console.log('Received SDP answer from server');
            if (conversationId) {
                addMessage('system', `Conversation started: ${conversationId}`);
            }
            
            // Set remote description with the answer
            await peer.setRemoteDescription({
                type: 'answer',
                sdp: answerSdp
            });
            
        } catch (error) {
            console.error('Call setup error:', error);
            setIsConnecting(false);
            updateStatus('error', `Error: ${error.message}`);
            addMessage('system', `Error: ${error.message}`);
        }
    };
    
    const endCall = async () => {
        try {
            cleanupConnections();
            setIsConnected(false);
            setIsConnecting(false);
            updateStatus('disconnected', 'Disconnected');
            addMessage('system', 'Call ended');
            
        } catch (error) {
            console.error('Error ending call:', error);
        }
    };
    
    const toggleCall = () => {
        if (isConnected) {
            endCall();
        } else {
            startCall();
        }
    };
    
    return (
        <div className="container">
            <h1>AI Voice Chat (WebRTC with HTTP Signaling)</h1>
            <div className="conversation-log">
                {messages.map((message) => (
                    <div key={message.id} className={`message ${message.type}`}>
                        {message.text}
                    </div>
                ))}
            </div>
            <div className="controls">
                <button 
                    className={isConnected ? "hangup-button" : "call-button"}
                    onClick={toggleCall}
                    disabled={isConnecting}
                >
                    📞 {isConnecting ? 'Connecting...' : isConnected ? 'Hang Up' : 'Call'}
                </button>
            </div>
            <div className={`status ${status.type}`}>
                {status.message}
            </div>
        </div>
    );
}