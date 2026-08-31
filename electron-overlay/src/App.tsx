import { useState, useRef, useEffect } from 'react'
import Peer, { DataConnection } from 'peerjs'
import './App.scss'

interface ChatMessage {
  username: string
  message: string
  timestamp: number
}

// A short synthesized blip (no audio asset needed) - a quick rising square
// wave, like a retro game UI beep (RollerCoaster Tycoon click / Borderlands
// skill point).
const playBleep = (startFreq: number, endFreq: number, volume: number) => {
  if (volume <= 0) return
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square'
    osc.frequency.setValueAtTime(startFreq, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + 0.08)
    gain.gain.setValueAtTime(0.05 * (volume / 100), ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.12)
    osc.onended = () => ctx.close()
  } catch {
    // Audio isn't essential - silently skip if the browser blocks it
    // (e.g. no user gesture yet) or AudioContext is unavailable.
  }
}

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isHovered, setIsHovered] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  // Room ID and username are decoupled: the room ID is what actually
  // determines the P2P connection identity (what a friend types into
  // "connect" to reach you), while username is purely a display name on
  // messages. Both are remembered, but the join screen always shows on
  // launch (pre-filled) rather than skipping straight to the last room.
  const [username, setUsername] = useState<string | null>(null)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [usernameInput, setUsernameInput] = useState(() => localStorage.getItem('drift-username') || '')
  const [roomIdInput, setRoomIdInput] = useState(() => localStorage.getItem('drift-room-id') || '')
  const [connectedPeers, setConnectedPeers] = useState<DataConnection[]>([])
  const [connectStatus, setConnectStatus] = useState<{ type: 'connecting' | 'success' | 'error'; message: string } | null>(null)
  // 0-100; 0 doubles as "muted" rather than tracking a separate flag.
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('drift-volume')
    return saved !== null ? Number(saved) : 50
  })
  const [showVolumePopover, setShowVolumePopover] = useState(false)
  const [appVersion, setAppVersion] = useState('')

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const peerRef = useRef<Peer | null>(null)
  const connectionsRef = useRef<DataConnection[]>([])
  const connectTimeoutRef = useRef<number | null>(null)
  // A ref (not just the state) because the connection's own event handlers
  // are registered once, inside a useEffect closure keyed on the room -
  // they'd otherwise keep seeing whatever volume was set at join time.
  const volumeRef = useRef(volume)

  useEffect(() => {
    volumeRef.current = volume
    localStorage.setItem('drift-volume', String(volume))
  }, [volume])

  // The same web bundle also runs standalone in a browser/WebView (e.g.
  // the Android build) - every window.electronAPI call is already
  // optional-chained so nothing breaks there, but the minimize/close
  // buttons would be dead controls with no native window behind them,
  // so just don't render them outside Electron.
  const isElectron = Boolean(window.electronAPI)

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

  const resizeHandles = isElectron ? (
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
  ) : null

  // Initialize PeerJS. The peer ID is derived from the room ID instead of
  // PeerJS's default random UUID. Whoever registers the room ID first
  // becomes the host and just waits for connections; anyone who types the
  // same room ID afterward gets an unavailable-id error back from the
  // broker - rather than treating that as a failure, they register under
  // their own id and connect straight to the host. So two people entering
  // the same room ID is the entire "connect to each other" mechanism, no
  // manual paste-and-connect step required.
  useEffect(() => {
    if (!roomId) return

    const slugify = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

    const roomSlug = slugify(roomId) || 'drift-room'
    let destroyed = false
    let peer: Peer

    const iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
      // STUN alone can't get two peers connected when either side is
      // behind a symmetric NAT/CGNAT (common on home ISPs) - it needs an
      // actual relay to fall back to. Open Relay Project is a free public
      // TURN service for exactly this.
      { urls: 'stun:openrelay.metered.ca:80' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'REDACTED_DEMO_CREDENTIAL', credential: 'REDACTED_DEMO_CREDENTIAL' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'REDACTED_DEMO_CREDENTIAL', credential: 'REDACTED_DEMO_CREDENTIAL' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'REDACTED_DEMO_CREDENTIAL', credential: 'REDACTED_DEMO_CREDENTIAL' }
    ]

    const createPeer = (id: string) =>
      new Peer(id, {
        host: '0.peerjs.com',
        port: 443,
        path: '/',
        secure: true,
        config: { iceServers }
      })

    const joinAsGuest = () => {
      peer = createPeer(`${roomSlug}-${Math.floor(1000 + Math.random() * 9000)}`)
      peerRef.current = peer

      peer.on('open', (guestId) => {
        console.log('Registered as guest', guestId, '- connecting to host', roomSlug)
        setConnectStatus({ type: 'connecting', message: `Joining ${roomId}...` })
        if (connectTimeoutRef.current) window.clearTimeout(connectTimeoutRef.current)
        connectTimeoutRef.current = window.setTimeout(() => {
          setConnectStatus((prev) => (prev?.type === 'connecting' ? { type: 'error', message: 'Connection timed out' } : prev))
        }, 10000)
        setupConnection(peer.connect(roomSlug))
      })

      peer.on('connection', (conn) => setupConnection(conn))

      peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') {
          console.error('Host not reachable:', err)
          if (connectTimeoutRef.current) {
            window.clearTimeout(connectTimeoutRef.current)
            connectTimeoutRef.current = null
          }
          setConnectStatus({ type: 'error', message: "Couldn't find that room" })
          return
        }
        console.error('Peer error:', err)
      })
    }

    peer = createPeer(roomSlug)
    peerRef.current = peer

    peer.on('open', (id) => {
      console.log('Registered as host', id, '- waiting for connections')
    })

    peer.on('connection', (conn) => {
      console.log('Incoming connection from', conn.peer)
      setupConnection(conn)
    })

    peer.on('error', (err) => {
      if (err.type === 'unavailable-id' && !destroyed) {
        console.log('Room already taken, joining as guest instead')
        peer.destroy()
        joinAsGuest()
        return
      }
      console.error('Peer error:', err)
    })

    return () => {
      destroyed = true
      peer?.destroy()
    }
  }, [roomId])

  const setupConnection = (conn: DataConnection) => {
    conn.on('open', () => {
      console.log('Connected to peer:', conn.peer)
      connectionsRef.current.push(conn)
      setConnectedPeers([...connectionsRef.current])

      if (connectTimeoutRef.current) {
        window.clearTimeout(connectTimeoutRef.current)
        connectTimeoutRef.current = null
      }
      setConnectStatus({ type: 'success', message: `Connected to ${conn.peer}` })
      window.setTimeout(() => {
        setConnectStatus((prev) => (prev?.message === `Connected to ${conn.peer}` ? null : prev))
      }, 3000)
    })

    conn.on('data', (data) => {
      const msg = data as ChatMessage
      setMessages((prev) => [...prev, msg])
      playBleep(880, 1320, volumeRef.current)
    })

    conn.on('close', () => {
      console.log('Disconnected from peer:', conn.peer)
      connectionsRef.current = connectionsRef.current.filter((c) => c !== conn)
      setConnectedPeers([...connectionsRef.current])
    })

    conn.on('error', (err) => {
      console.error('Connection error:', err)
      if (connectTimeoutRef.current) {
        window.clearTimeout(connectTimeoutRef.current)
        connectTimeoutRef.current = null
      }
      setConnectStatus({ type: 'error', message: 'Connection failed' })
    })

    // Surfaces the actual WebRTC negotiation state instead of only ever
    // seeing a generic 10s timeout - lets us tell a real NAT/ICE failure
    // apart from the signaling side never reaching the other person at all.
    conn.on('iceStateChanged', (state) => {
      console.log('ICE state for', conn.peer, ':', state)
      if (state === 'failed' || state === 'disconnected') {
        if (connectTimeoutRef.current) {
          window.clearTimeout(connectTimeoutRef.current)
          connectTimeoutRef.current = null
        }
        setConnectStatus({ type: 'error', message: `Network connection failed (${state})` })
      }
    })
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

    playBleep(660, 440, volumeRef.current)
    setInputValue('')
  }

  const handleJoin = () => {
    const nextUsername = usernameInput.trim()
    const nextRoomId = roomIdInput.trim()
    if (!nextUsername || !nextRoomId) return
    localStorage.setItem('drift-username', nextUsername)
    localStorage.setItem('drift-room-id', nextRoomId)
    setUsername(nextUsername)
    setRoomId(nextRoomId)
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSendMessage()
    }
  }

  const handleJoinKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleJoin()
    }
  }

  const handleClose = () => {
    if (window.electronAPI) {
      window.electronAPI.send('close-window')
    }
  }

  const handleCopyRoomId = () => {
    if (roomId) navigator.clipboard.writeText(roomId)
  }

  // Shrinks the actual window down to a small bubble in the corner rather
  // than an OS-level minimize, which would just vanish behind a fullscreen
  // game. Toggling back snaps the window to whatever bounds it had before.
  const handleToggleMinimize = () => {
    const next = !isMinimized
    setIsMinimized(next)
    window.electronAPI?.send('toggle-minimize', next)
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    window.electronAPI?.getVersion().then(setAppVersion)
  }, [])

  // Restore this room's chat history from a prior session as soon as we
  // join it, so reopening the app doesn't lose the conversation.
  useEffect(() => {
    if (!roomId) return
    try {
      const cached = localStorage.getItem(`drift-chat-${roomId}`)
      setMessages(cached ? JSON.parse(cached) : [])
    } catch {
      setMessages([])
    }
  }, [roomId])

  // Keep the cache for the current room up to date. Capped so a
  // long-running chat doesn't grow localStorage without bound.
  useEffect(() => {
    if (!roomId) return
    try {
      localStorage.setItem(`drift-chat-${roomId}`, JSON.stringify(messages.slice(-200)))
    } catch {
      // Storage full or unavailable - chat still works, just won't persist.
    }
  }, [messages, roomId])

  if (isMinimized) {
    return (
      <div className="app-shell">
        <div className="app-container app-container-mini" onClick={handleToggleMinimize}>
          <img src="./icon.png" alt="Drift" className="mini-icon" />
          <span className={`status-dot ${connectedPeers.length > 0 ? 'connected' : 'disconnected'}`} />
        </div>
      </div>
    )
  }

  // Join screen - always shown on launch, pre-filled with whatever room ID
  // and username were used last time, so returning is a single click but
  // switching rooms/identities is always just as visible an option.
  if (!username || !roomId) {
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
            {isElectron && (
              <>
                <button className="minimize-button" onClick={handleToggleMinimize}>–</button>
                <button className="close-button" onClick={handleClose}>×</button>
              </>
            )}
          </div>
          <div className="username-prompt">
            <h3>Join a room</h3>
            <input
              type="text"
              value={roomIdInput}
              onChange={(e) => setRoomIdInput(e.target.value)}
              onKeyPress={handleJoinKeyPress}
              placeholder="Room ID..."
              autoFocus
            />
            <input
              type="text"
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
              onKeyPress={handleJoinKeyPress}
              placeholder="Username..."
            />
            <button onClick={handleJoin}>Join</button>
            {appVersion && <div className="app-version">v{appVersion}</div>}
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
          <div className="volume-control">
            <button className="volume-button" onClick={() => setShowVolumePopover((v) => !v)}>
              {volume === 0 ? (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
              )}
            </button>
            {showVolumePopover && (
              <div className="volume-popover">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                />
              </div>
            )}
          </div>
          {isElectron && (
            <>
              <button className="minimize-button" onClick={handleToggleMinimize}>–</button>
              <button className="close-button" onClick={handleClose}>×</button>
            </>
          )}
        </div>

        <div className="room-bar">
          <span className="room-bar-id" title={`${roomId} - click to copy`} onClick={handleCopyRoomId}>{roomId}</span>
          <div className="connection-status">
            <span className={`status-dot ${connectedPeers.length > 0 ? 'connected' : 'disconnected'}`} />
            <span className="peer-count">{connectedPeers.length}</span>
          </div>
        </div>

        {connectStatus && (
          <div className={`connect-status connect-status-${connectStatus.type}`}>
            {connectStatus.message}
          </div>
        )}

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
