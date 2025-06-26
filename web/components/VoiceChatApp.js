import { useState, useRef, useEffect } from 'react';
import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';

export default function VoiceChatApp() {
    const [isConnected, setIsConnected] = useState(false);
    const [status, setStatus] = useState({ type: 'disconnected', message: 'Disconnected' });
    const [messages, setMessages] = useState([
        { type: 'system', text: 'Welcome! Click the call button to start chatting with the AI assistant.', id: 'welcome' }
    ]);
    
    // Keep track of messages by itemId for updates
    const messagesMapRef = useRef(new Map());
    
    const sessionRef = useRef(null);
    
    const updateStatus = (type, message) => {
        setStatus({ type, message });
    };
    
    const addMessage = (type, text) => {
        setMessages(prev => [...prev, { type, text, id: Date.now() }]);
    };
    
    const updateMessageText = (itemId, newText) => {
        messagesMapRef.current.set(itemId, newText);
        // Force a re-render by updating the conversation log
        if (sessionRef.current?.history) {
            updateConversationLog(sessionRef.current.history);
        }
    };
    
    const updateConversationLog = (history) => {
        // Keep the welcome message and add history
        const welcomeMessage = { type: 'system', text: 'Welcome! Click the call button to start chatting with the AI assistant.', id: 'welcome' };
        const historyMessages = [];
        
        history.forEach((message, index) => {
            
            // Extract text from content array - based on reference implementation
            let text = '';
            if (message.content && Array.isArray(message.content)) {
                text = message.content.map(item => {
                    if (!item || typeof item !== 'object') return '';
                    if (item.type === 'input_text') return item.text || '';
                    if (item.type === 'audio') return item.transcript || '';
                    if (item.type === 'text') return item.text || '';
                    return '';
                }).filter(Boolean).join('\n');
            }
            
            // Show messages with content, or "[Transcribing...]" for user messages without text yet
            if (message.role === 'user') {
                // Check if we have an updated transcript for this itemId
                const updatedText = messagesMapRef.current.get(message.itemId);
                const displayText = updatedText || text || '[Transcribing...]';
                historyMessages.push({ type: 'user', text: displayText, id: `user-${message.itemId || index}` });
            } else if (message.role === 'assistant' && text) {
                historyMessages.push({ type: 'assistant', text, id: `assistant-${message.itemId || index}` });
            }
        });
        
        setMessages([welcomeMessage, ...historyMessages]);
    };
    
    const getEphemeralToken = async () => {
        try {
            const response = await fetch('/api/session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(errorData.message || `Server error: ${response.status}`);
            }
            
            const tokenData = await response.json();
            return tokenData;
        } catch (error) {
            console.error('Error getting ephemeral token:', error);
            throw error;
        }
    };
    
    const startCall = async () => {
        try {
            updateStatus('connecting', 'Connecting...');
            
            // SDK is now imported directly, no need to check window object
            
            // Get ephemeral token from backend
            const tokenData = await getEphemeralToken();
            if (!tokenData) {
                throw new Error('Failed to get session token');
            }
            
            // Create agent
            const agent = new RealtimeAgent({
                name: 'Assistant',
                instructions: 'You are a helpful AI assistant. Keep responses conversational and concise.',
                voice: 'alloy'
            });
            
            // Create session with WebRTC transport (default)
            const session = new RealtimeSession(agent, {
                model: 'gpt-4o-realtime-preview-2025-06-03'
            });
            
            sessionRef.current = session;
            
            // Set up event listeners based on the reference implementation
            session.on('history_updated', (history) => {
                updateConversationLog(history);
            });
            
            session.on('history_added', (item) => {
                // Handle new items being added to history
                if (item && item.type === 'message') {
                    // Update the conversation log with the full history to maintain order
                    if (session.history) {
                        updateConversationLog(session.history);
                    }
                }
            });
            
            // Listen for transport events to get transcription deltas
            session.on('transport_event', (event) => {
                switch (event.type) {
                    case 'conversation.item.input_audio_transcription.completed':
                        // Update the user message with final transcript
                        if (event.item_id && event.transcript) {
                            const finalTranscript = event.transcript === '\n' ? '[inaudible]' : event.transcript;
                            updateMessageText(event.item_id, finalTranscript);
                        }
                        break;
                    case 'response.audio_transcript.done':
                        // Force update the conversation log for assistant messages
                        if (session.history) {
                            updateConversationLog(session.history);
                        }
                        break;
                }
            });
            
            session.on('error', (error) => {
                console.error('Session error:', error);
                updateStatus('error', `Session error: ${error.message}`);
                addMessage('system', `Error: ${error.message}`);
            });
            
            session.on('session_created', () => {
                // Session created
            });
            
            session.on('session_updated', () => {
                // Session configured
            });
            
            // Connect to OpenAI using ephemeral token
            await session.connect({ 
                apiKey: tokenData.client_secret 
            });
            
            setIsConnected(true);
            updateStatus('connected', 'Connected - Start speaking!');
            
        } catch (error) {
            console.error('Failed to start call:', error);
            updateStatus('error', `Error: ${error.message}`);
            setIsConnected(false);
        }
    };
    
    const endCall = async () => {
        try {
            if (sessionRef.current) {
                sessionRef.current.close();
                sessionRef.current = null;
            }
            
            setIsConnected(false);
            updateStatus('disconnected', 'Disconnected');
            
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
            <h1>AI Voice Chat</h1>
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
                >
                    📞 {isConnected ? 'Hang Up' : 'Call'}
                </button>
            </div>
            <div className={`status ${status.type}`}>
                {status.message}
            </div>
        </div>
    );
}