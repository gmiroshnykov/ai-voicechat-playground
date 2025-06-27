'use client';

import { useState, useRef, useEffect } from 'react';

const SIGNALING_SERVER_URL = process.env.NEXT_PUBLIC_WEBRTC_URL || 'http://localhost:3001/webrtc';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export default function VoiceChat() {
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
    const [statusMessage, setStatusMessage] = useState('Disconnected');
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

    const peerRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        if (remoteStream && audioRef.current) {
            audioRef.current.srcObject = remoteStream;
        }
    }, [remoteStream]);

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
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop());
            localStreamRef.current = null;
        }
        setRemoteStream(null);
        setConnectionStatus('disconnected');
        setStatusMessage('Disconnected');
    };

    const updateStatus = (status: ConnectionStatus, message: string) => {
        setConnectionStatus(status);
        setStatusMessage(message);
    };

    const startCall = async () => {
        try {
            if (connectionStatus === 'connecting' || connectionStatus === 'connected') {
                console.log('Already connecting or connected');
                return;
            }

            updateStatus('connecting', 'Getting microphone access...');

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 24000
                }
            });

            localStreamRef.current = stream;
            updateStatus('connecting', 'Setting up WebRTC connection...');

            const peer = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' }
                ]
            });

            peerRef.current = peer;

            stream.getTracks().forEach(track => {
                peer.addTrack(track, stream);
            });

            peer.ontrack = (event) => {
                console.log('Received echo audio stream from server');
                const [remoteStream] = event.streams;
                setRemoteStream(remoteStream);
            };

            peer.onconnectionstatechange = () => {
                console.log('Connection state:', peer.connectionState);
                if (peer.connectionState === 'connected') {
                    updateStatus('connected', 'Connected - Start speaking!');
                } else if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
                    updateStatus('error', 'Connection failed');
                    cleanupConnections();
                }
            };

            peer.oniceconnectionstatechange = () => {
                console.log('ICE connection state:', peer.iceConnectionState);
            };

            peer.onsignalingstatechange = () => {
                console.log('Signaling state:', peer.signalingState);
            };

            const offer = await peer.createOffer({
                offerToReceiveAudio: true
            });
            await peer.setLocalDescription(offer);

            await new Promise<void>((resolve) => {
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

            const response = await fetch(SIGNALING_SERVER_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/sdp'
                },
                body: peer.localDescription?.sdp
            });

            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            const answerSdp = await response.text();
            await peer.setRemoteDescription({
                type: 'answer',
                sdp: answerSdp
            });

        } catch (error: any) {
            console.error('Call setup error:', error);
            updateStatus('error', `Error: ${error.message}`);
            cleanupConnections();
        }
    };

    const endCall = () => {
        cleanupConnections();
    };

    const toggleCall = () => {
        if (connectionStatus === 'connected') {
            endCall();
        } else {
            startCall();
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
            <h1 className="text-4xl font-light text-gray-800 mb-8">AI Voice Chat</h1>
            
            <div className="w-full max-w-md bg-white rounded-lg shadow-lg p-6 mb-6 space-y-4">
                <div className="text-center text-lg font-medium">
                    Status: <span className={`font-bold ${connectionStatus === 'connected' ? 'text-green-600' : connectionStatus === 'connecting' ? 'text-yellow-600' : 'text-red-600'}`}>{statusMessage}</span>
                </div>
                
                <div className="flex justify-center">
                    <button 
                        className={`py-3 px-8 rounded-full text-white font-semibold text-lg transition-all duration-300 ease-in-out 
                            ${connectionStatus === 'connected' ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}
                            ${connectionStatus === 'connecting' ? 'opacity-60 cursor-not-allowed' : ''}`}
                        onClick={toggleCall}
                        disabled={connectionStatus === 'connecting'}
                    >
                        {connectionStatus === 'connecting' ? 'Connecting...' : connectionStatus === 'connected' ? 'Hang Up' : 'Call'}
                    </button>
                </div>

                {remoteStream && (
                    <div className="hidden">
                        <audio 
                            ref={audioRef} 
                            autoPlay 
                            controls 
                            className="w-full" 
                        />
                    </div>
                )}
            </div>

            </div>
    );
}
