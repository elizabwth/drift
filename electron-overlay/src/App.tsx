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

  // The window itself is always transparent at the OS level; whether it
  // looks solid or see-through comes entirely from the panel's own CSS
  // background/opacity below. Solid while setting up, see-through once
  // actually attached to a peer.
  const isAttached = connectedPeers.length > 0
  const containerStyle = {
    opacity: isAttached && !isHovered ? 0.4 : 1,
    backgroundColor: isAttached ? undefined : '#121620',
  }

  // Manual resize: Windows doesn't do native edge-drag resize for a
  // transparent frameless window, so these handles forward mouse deltas to
  // the main process, which resizes the actual BrowserWindow.
  const lastPos = useRef({ x: 0, y: 0 })

  const startResize = (edge: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    lastPos.current = { x: e.screenX, y: e.screenY }

    const onMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.screenX - lastPos.current.x
      const dy = moveEvent.screenY - lastPos.current.y
      lastPos.current = { x: moveEvent.screenX, y: moveEvent.screenY }
      if (dx !== 0 || dy !== 0) {
        window.electronAPI?.send('resize-delta', { dx, dy, edge })
      }
    }

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const resizeHandles = (
    <>
      <div className="resize-handle resize-handle-top" onMouseDown={startResize('top')} />
      <div className="resize-handle resize-handle-left" onMouseDown={startResize('left')} />
      <div className="resize-handle resize-handle-corner resize-handle-tl" onMouseDown={startResize('top-left')} />
      <div className="resize-handle resize-handle-corner resize-handle-tr" onMouseDown={startResize('top-right')} />
      <div className="resize-handle resize-handle-corner resize-handle-bl" onMouseDown={startResize('bottom-left')} />
      <div className="resize-handle resize-handle-right" onMouseDown={startResize('right')} />
      <div className="resize-handle resize-handle-bottom" onMouseDown={startResize('bottom')} />
      <div className="resize-handle resize-handle-corner resize-handle-br" onMouseDown={startResize('bottom-right')} />
    </>
  )

  // Initialize PeerJS. The peer ID is derived from the username instead of
  // PeerJS's default random UUID, so it's short and something the user
  // effectively "set" themselves (via their username) rather than a
  // cryptic ID they'd have to copy/paste around.
  useEffect(() => {
    if (!username) return

    const slugify = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

    let destroyed = false
    let peer: Peer

    const connect = (id: string) => {
      peer = new Peer(id, {
        host: '0.peerjs.com',
        port: 443,
        path: '/',
        secure: true,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      })
      peerRef.current = peer

      peer.on('open', (openedId) => {
        setMyPeerId(openedId)
      })

      peer.on('connection', (conn) => {
        setupConnection(conn)
      })

      peer.on('error', (err) => {
        // Someone else is already using this short ID on the broker -
        // fall back to a suffixed variant rather than a raw UUID.
        if (err.type === 'unavailable-id' && !destroyed) {
          peer.destroy()
          connect(`${id}-${Math.floor(1000 + Math.random() * 9000)}`)
          return
        }
        console.error('Peer error:', err)
      })
    }

    connect(slugify(username) || 'drift-user')

    return () => {
      destroyed = true
      peer?.destroy()
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
      <div className="app-shell">
        <div
          className="app-container"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          style={containerStyle}
        >
          <div className="chat-header">
            <h2>Drift</h2>
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
        {resizeHandles}
      </div>
    )
  }

  return (
    <div className="app-shell">
      <div
        className="app-container"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={containerStyle}
      >
        <div className="chat-header">
          <h2>Drift</h2>
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
      {resizeHandles}
    </div>
  )
}

export default App
