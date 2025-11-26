import { useState, useRef, useEffect } from 'react'
import Peer, { DataConnection } from 'peerjs'
import './App.scss'

interface ChatMessage {
  username: string
  message: string
  timestamp: number
}

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isHovered, setIsHovered] = useState(false)
  const [username, setUsername] = useState<string | null>(() =>
    localStorage.getItem('drift-username')
  )
  const [usernameInput, setUsernameInput] = useState('')
  const [myPeerId, setMyPeerId] = useState<string>('')
  const [connectToPeerId, setConnectToPeerId] = useState('')
  const [connectedPeers, setConnectedPeers] = useState<DataConnection[]>([])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const peerRef = useRef<Peer | null>(null)
  const connectionsRef = useRef<DataConnection[]>([])

  // Initialize PeerJS
  useEffect(() => {
    if (!username) return

    const peer = new Peer()
    peerRef.current = peer

    peer.on('open', (id) => {
      setMyPeerId(id)
      console.log('My peer ID:', id)
    })

    peer.on('connection', (conn) => {
      setupConnection(conn)
    })

    peer.on('error', (err) => {
      console.error('Peer error:', err)
    })

    return () => {
      peer.destroy()
    }
  }, [username])

  const setupConnection = (conn: DataConnection) => {
    conn.on('open', () => {
      console.log('Connected to peer:', conn.peer)
      connectionsRef.current.push(conn)
      setConnectedPeers([...connectionsRef.current])
    })

    conn.on('data', (data) => {
      const msg = data as ChatMessage
      setMessages((prev) => [...prev, msg])
    })

    conn.on('close', () => {
      console.log('Disconnected from peer:', conn.peer)
      connectionsRef.current = connectionsRef.current.filter((c) => c !== conn)
      setConnectedPeers([...connectionsRef.current])
    })
  }

  const handleConnectToPeer = () => {
    if (!peerRef.current || !connectToPeerId.trim()) return

    const conn = peerRef.current.connect(connectToPeerId.trim())
    setupConnection(conn)
    setConnectToPeerId('')
  }

  const handleSendMessage = () => {
    if (!inputValue.trim() || !username) return

    const msg: ChatMessage = {
      username,
      message: inputValue,
      timestamp: Date.now()
    }

    // Add to local messages
    setMessages((prev) => [...prev, msg])

    // Send to all connected peers
    connectionsRef.current.forEach((conn) => {
      conn.send(msg)
    })

    setInputValue('')
  }

  const handleSetUsername = () => {
    if (usernameInput.trim()) {
      localStorage.setItem('drift-username', usernameInput.trim())
      setUsername(usernameInput.trim())
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSendMessage()
    }
  }

  const handleUsernameKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSetUsername()
    }
  }

  const handleConnectKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleConnectToPeer()
    }
  }

  const handleClose = () => {
    if (window.electronAPI) {
      window.electronAPI.send('close-window')
    }
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Username prompt
  if (!username) {
    return (
      <div
        className="app-container"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{ opacity: isHovered ? 1 : 0.4 }}
      >
        <div className="chat-header">
          <h2>Overlay Chat</h2>
          <button className="close-button" onClick={handleClose}>×</button>
        </div>
        <div className="username-prompt">
          <h3>Enter your username</h3>
          <input
            type="text"
            value={usernameInput}
            onChange={(e) => setUsernameInput(e.target.value)}
            onKeyPress={handleUsernameKeyPress}
            placeholder="Username..."
            autoFocus
          />
          <button onClick={handleSetUsername}>Join</button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="app-container"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{ opacity: isHovered ? 1 : 0.4 }}
    >
      <div className="chat-header">
        <h2>Overlay Chat</h2>
        <div className="connection-status">
          <span className={`status-dot ${connectedPeers.length > 0 ? 'connected' : 'disconnected'}`} />
          <span className="peer-count">{connectedPeers.length}</span>
        </div>
        <button className="close-button" onClick={handleClose}>×</button>
      </div>

      <div className="connection-controls">
        <div className="my-peer-id">
          <small>Your ID:</small>
          <input
            type="text"
            value={myPeerId}
            readOnly
            onClick={(e) => {
              e.currentTarget.select()
              navigator.clipboard.writeText(myPeerId)
            }}
            placeholder="Connecting..."
          />
        </div>
        <div className="connect-peer">
          <input
            type="text"
            value={connectToPeerId}
            onChange={(e) => setConnectToPeerId(e.target.value)}
            onKeyPress={handleConnectKeyPress}
            placeholder="Paste peer ID to connect..."
          />
          <button onClick={handleConnectToPeer}>Connect</button>
        </div>
      </div>

      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="no-messages">No messages yet</div>
        ) : (
          messages.map((msg, index) => (
            <div key={index} className="message message-animate">
              <strong>{msg.username}:</strong> {msg.message}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Type a message..."
        />
        <button onClick={handleSendMessage}>Send</button>
      </div>
    </div>
  )
}

export default App
