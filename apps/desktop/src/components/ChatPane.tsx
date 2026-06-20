import { useState, useEffect, useRef, useCallback } from 'react';

interface Message {
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: string;
  runId?: string;
}

interface ChatPaneProps {
  wsUrl: string | null;
}

function ChatPane({ wsUrl }: ChatPaneProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // WebSocket connection management
  useEffect(() => {
    if (!wsUrl) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setIsConnected(false);
      return;
    }

    const connect = () => {
      console.log('[ChatPane] Connecting to WebSocket:', wsUrl);
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[ChatPane] WebSocket connected');
        setIsConnected(true);
        
        // Fetch initial chat history
        fetchChatHistory();
      };

      ws.onclose = () => {
        console.log('[ChatPane] WebSocket disconnected');
        setIsConnected(false);
        wsRef.current = null;
      };

      ws.onerror = (error) => {
        console.error('[ChatPane] WebSocket error:', error);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[ChatPane] Received message:', data);
          
          // Handle different message types
          if (data.type === 'message' || data.role) {
            const message: Message = {
              role: data.role || 'assistant',
              text: data.text || data.content || JSON.stringify(data),
              timestamp: data.timestamp || new Date().toISOString(),
              runId: data.runId,
            };
            
            // Don't add duplicate messages
            setMessages((prev) => {
              const isDuplicate = prev.some(
                (m) => m.timestamp === message.timestamp && m.text === message.text
              );
              if (isDuplicate) return prev;
              return [...prev, message];
            });
          } else if (data.type === 'ping' || data.type === 'pong') {
            // Heartbeat - no action needed
          } else if (data.type === 'error') {
            setMessages((prev) => [
              ...prev,
              {
                role: 'system',
                text: `Error: ${data.message || 'Unknown error'}`,
                timestamp: new Date().toISOString(),
              },
            ]);
          }
        } catch (err) {
          console.error('[ChatPane] Failed to parse message:', err);
        }
      };

      wsRef.current = ws;
    };

    connect();

    // Heartbeat
    const heartbeat = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

    return () => {
      clearInterval(heartbeat);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [wsUrl]);

  // Fetch chat history from REST API
  const fetchChatHistory = async () => {
    if (!wsUrl) return;
    
    const port = wsUrl.match(/ws:\/\/127\.0\.0\.1:(\d+)/)?.[1];
    if (!port) return;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/messages?limit=50`);
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.messages)) {
          setMessages(
            data.messages.map((m: { role: string; content: string; timestamp: string; runId?: string }) => ({
              role: m.role as 'user' | 'assistant' | 'system',
              text: m.content,
              timestamp: m.timestamp,
              runId: m.runId,
            }))
          );
        }
      }
    } catch (err) {
      console.log('[ChatPane] Could not fetch chat history:', err);
    }
  };

  const handleSendMessage = useCallback(() => {
    if (!inputValue.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    const message = {
      type: 'message',
      role: 'user',
      text: inputValue.trim(),
      timestamp: new Date().toISOString(),
    };

    wsRef.current.send(JSON.stringify(message));
    
    // Optimistically add user message to UI
    setMessages((prev) => [
      ...prev,
      {
        role: 'user',
        text: inputValue.trim(),
        timestamp: message.timestamp,
      },
    ]);
    
    setInputValue('');
    setIsLoading(true);

    // Set timeout for response
    setTimeout(() => {
      setIsLoading(false);
    }, 60000);
  }, [inputValue]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return timestamp;
    }
  };

  if (!wsUrl) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🔌</div>
        <h2 className="empty-state-title">Not Connected</h2>
        <p className="empty-state-description">
          Start the FFT_nano host to begin chatting. Use the Start button in the header to launch the host.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">💬</div>
            <h2 className="empty-state-title">Ready to Chat</h2>
            <p className="empty-state-description">
              Send a message to start a conversation with FFT_nano.
            </p>
          </div>
        )}
        
        {messages.map((message, index) => (
          <div key={index} className={`message message-${message.role}`}>
            <div className="message-content">{message.text}</div>
            <div className="message-timestamp">{formatTimestamp(message.timestamp)}</div>
          </div>
        ))}
        
        {isLoading && (
          <div className="message message-assistant">
            <div className="message-content">
              <div className="loading-spinner">
                <div className="spinner"></div>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-container">
        <textarea
          className="chat-input"
          placeholder={isConnected ? 'Type a message...' : 'Connecting...'}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!isConnected}
          rows={1}
        />
        <button
          className="chat-send-btn"
          onClick={handleSendMessage}
          disabled={!isConnected || !inputValue.trim()}
        >
          Send
        </button>
      </div>
    </>
  );
}

export default ChatPane;
