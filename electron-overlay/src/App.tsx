import { useState, useRef, useEffect } from 'react'
import type { ReactNode } from 'react'
import Peer, { DataConnection } from 'peerjs'
import './App.scss'

interface ChatMessage {
  username: string
  message: string
  timestamp: number
}

// The minimized bubble's hold-to-restore ring - matches the 48x48 viewBox
// set on it below.
const HOLD_RING_RADIUS = 21
const HOLD_RING_CIRCUMFERENCE = 2 * Math.PI * HOLD_RING_RADIUS

// Electron accelerator strings only, no Mac support needed - this app only
// ships Windows builds, so there's no CommandOrControl ambiguity to handle.
const SPECIAL_KEY_MAP: Record<string, string> = {
  ' ': 'Space',
  Escape: 'Escape',
  Tab: 'Tab',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Enter: 'Return',
  Backspace: 'Backspace',
  Delete: 'Delete',
}

// Used both to format a captured combo while recording a new shortcut and
// to check an incoming keydown against a saved one (dismissInput's local
// match) - sharing one function keeps those two always in agreement.
function keyEventToAccelerator(e: KeyboardEvent): string | null {
  const key = e.key
  if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') return null

  let mainKey: string
  if (SPECIAL_KEY_MAP[key]) {
    mainKey = SPECIAL_KEY_MAP[key]
  } else if (/^[a-zA-Z]$/.test(key)) {
    mainKey = key.toUpperCase()
  } else if (/^[0-9]$/.test(key)) {
    mainKey = key
  } else if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key)) {
    mainKey = key
  } else {
    return null
  }

  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(mainKey)
  return parts.join('+')
}

// Wishlist #06 ("custom notification sounds"): every tone is synthesized
// (no audio asset to bundle/upload), so "custom" means picking a preset
// frequency sweep rather than a fixed one - matches the existing
// no-assets architecture instead of adding file storage for a Low-impact
// item. The outgoing send tone stays fixed (660->440); only the incoming
// notification tone is user-selectable.
const NOTIFICATION_TONES: Record<string, { label: string; startFreq: number; endFreq: number }> = {
  chime: { label: 'Chime', startFreq: 880, endFreq: 1320 },
  pop: { label: 'Pop', startFreq: 1200, endFreq: 700 },
  blip: { label: 'Blip', startFreq: 1046, endFreq: 1046 },
  drop: { label: 'Drop', startFreq: 660, endFreq: 220 },
}
const DEFAULT_NOTIFICATION_TONE = 'chime'

// 3x3 layout for the overlay-position picker in Settings - center cell is
// 'free' (dragged-anywhere, the default), the other 8 are screen zones
// computed in electron/main.ts.
const ZONE_GRID: (OverlayZone | null)[][] = [
  ['top-left', 'top', 'top-right'],
  ['left', 'free', 'right'],
  ['bottom-left', 'bottom', 'bottom-right'],
]
const ZONE_LABELS: Record<OverlayZone, string> = {
  'top-left': 'Top left',
  top: 'Top',
  'top-right': 'Top right',
  left: 'Left',
  free: 'Free (drag anywhere)',
  right: 'Right',
  'bottom-left': 'Bottom left',
  bottom: 'Bottom',
  'bottom-right': 'Bottom right',
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

// Wishlist #04 ("media sending support, embedded links to youtube/w.e"):
// purely client-side link detection over the existing plain-text message
// protocol - no wire-format change, so it stays compatible with any peer
// still on an older build (their message just renders as plain linkified
// text instead of an embed, never breaks). Every recognized URL still
// shows as a real link underneath so it's never a dead end if the embed
// itself fails to load.
const URL_PATTERN = /(https?:\/\/[^\s<>"]+)/g
const YOUTUBE_PATTERN = /^https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)([\w-]{11})|youtu\.be\/([\w-]{11}))/i
const IMAGE_EXT_PATTERN = /\.(png|jpe?g|gif|webp|avif|bmp)(\?.*)?$/i
const VIDEO_EXT_PATTERN = /\.(mp4|webm|mov|ogg)(\?.*)?$/i

function MessageBody({ text }: { text: string }) {
  const parts = text.split(URL_PATTERN)
  const media: ReactNode[] = []

  const rendered = parts.map((part, i) => {
    if (!URL_PATTERN.test(part)) {
      URL_PATTERN.lastIndex = 0
      return part ? <span key={i}>{part}</span> : null
    }
    URL_PATTERN.lastIndex = 0

    const youtubeMatch = part.match(YOUTUBE_PATTERN)
    if (youtubeMatch) {
      const videoId = youtubeMatch[1] || youtubeMatch[2]
      media.push(
        <div className="message-media message-media-youtube" key={`yt-${i}`}>
          <iframe
            src={`https://www.youtube.com/embed/${videoId}`}
            title="YouTube video"
            frameBorder={0}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )
    } else if (IMAGE_EXT_PATTERN.test(part)) {
      media.push(
        <div className="message-media" key={`img-${i}`}>
          <img src={part} alt="" loading="lazy" />
        </div>
      )
    } else if (VIDEO_EXT_PATTERN.test(part)) {
      media.push(
        <div className="message-media" key={`vid-${i}`}>
          <video src={part} controls />
        </div>
      )
    }

    return (
      <a className="message-link" href={part} key={i} target="_blank" rel="noreferrer">
        {part}
      </a>
    )
  })

  return (
    <>
      {rendered}
      {media}
    </>
  )
}

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isHovered, setIsHovered] = useState(false)
  // Actively typing counts as "in use" regardless of hover - without this,
  // moving the mouse off the window mid-message fades .chat-input along
  // with the rest of the chrome (see isIdle), taking the text you're
  // typing along with it.
  const [isInputFocused, setIsInputFocused] = useState(false)
  // Whether the mouse is allowed to interact with the chat view at all -
  // deliberately controlled ONLY by explicit actions (dismissInput turns
  // it off, openChat/toggleOverlay-restore turn it on), never by hovering.
  // A dwell-based "un-ignore once the cursor lingers" was tried and
  // rejected - any mouse arrival looks identical to an arrival-to-click,
  // so it made click-through impossible to ever rely on. Starts true so a
  // freshly joined room is immediately usable.
  // Wishlist #05, corrected 2026-09-11: "mouse interactions should pass
  // through UNTIL the shortcut [to open chat] has been pressed" - meaning
  // pass-through is the DEFAULT, not something you opt into via dismiss.
  // Previously this started true (interactive) and only dismissInput
  // (Escape) ever set it false - the opposite polarity from what was
  // actually asked for, which just happened to not matter for the join
  // screen (see the click-through effect below, now fixed to only ever
  // apply within an actual joined room).
  const [isMouseActive, setIsMouseActive] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  // Restoring from the minimized bubble is hover-and-hold rather than a
  // click, so a stray mouse pass over the corner doesn't yank the window
  // back open mid-game. The radial ring's fill IS the hold timer - it's
  // driven entirely by a CSS transition (see .mini-hold-ring-progress),
  // not a JS interval, so this bool is the only state needed.
  const [isHoldingMini, setIsHoldingMini] = useState(false)
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
  const [appVersion] = useState(__APP_VERSION__)
  const [showSettings, setShowSettings] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('drift-sound-enabled') !== 'false')
  const [notificationTone, setNotificationTone] = useState(() => {
    const saved = localStorage.getItem('drift-notification-tone')
    return saved && NOTIFICATION_TONES[saved] ? saved : DEFAULT_NOTIFICATION_TONE
  })
  const [shortcuts, setShortcuts] = useState<Shortcuts | null>(null)
  // Whether toggleOverlay/openChat's *current* saved accelerator is
  // actually registered right now - register() fails silently on a
  // conflict with something else already holding that combo, so without
  // this Settings has no way to show "this is bound but not working."
  const [shortcutStatus, setShortcutStatus] = useState<ShortcutStatus>({})
  const [recordingShortcut, setRecordingShortcut] = useState<keyof Shortcuts | null>(null)
  const [shortcutError, setShortcutError] = useState<keyof Shortcuts | null>(null)
  const [overlayZone, setOverlayZone] = useState<OverlayZone>('free')

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<HTMLInputElement>(null)
  // Set right before restoring from minimized in response to the openChat
  // shortcut - the input doesn't exist in the DOM yet at that point (the
  // mini-bubble branch is still rendered), so focusing has to wait for the
  // isMinimized-keyed effect below to run after the re-render.
  const pendingFocusInputRef = useRef(false)
  // Whether the user is (or was, before the latest render) scrolled to the
  // bottom of the chat - a ref rather than just the mirrored state below so
  // the messages-changed effect always reads the current value instead of
  // whatever it was when that effect's closure was created.
  const isAtBottomRef = useRef(true)
  // electronAPI.on() has no matching off(), so the shortcut-event effect
  // below registers its listeners exactly once ([isElectron] deps) and has
  // to read current isMinimized through this ref rather than a closure.
  const isMinimizedRef = useRef(false)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)
  // A programmatic scrollIntoView still fires 'scroll' events on its way to
  // the target - without this, the scroll handler below reads those
  // mid-animation positions as the user having scrolled away and pops the
  // jump button right back up during every auto-scroll.
  const isAutoScrollingRef = useRef(false)
  const autoScrollTimeoutRef = useRef<number | null>(null)
  const peerRef = useRef<Peer | null>(null)
  const connectionsRef = useRef<DataConnection[]>([])
  const connectTimeoutRef = useRef<number | null>(null)
  // A ref (not just the state) because the connection's own event handlers
  // are registered once, inside a useEffect closure keyed on the room -
  // they'd otherwise keep seeing whatever volume/soundEnabled was set at
  // join time.
  const volumeRef = useRef(volume)
  const soundEnabledRef = useRef(soundEnabled)
  const notificationToneRef = useRef(notificationTone)
  // Set briefly whenever a message arrives from someone else (never on a
  // message you sent yourself) - drives a one-shot glow pulse on that
  // message bubble (wishlist #06's "glow the latest chat message"). A ref
  // for the auto-clear timer, not state, since it's just bookkeeping for
  // cancelling the previous timeout if messages arrive in quick succession.
  const [glowMessageIndex, setGlowMessageIndex] = useState<number | null>(null)
  const glowTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    volumeRef.current = volume
    localStorage.setItem('drift-volume', String(volume))
  }, [volume])

  useEffect(() => {
    soundEnabledRef.current = soundEnabled
    localStorage.setItem('drift-sound-enabled', String(soundEnabled))
  }, [soundEnabled])

  useEffect(() => {
    notificationToneRef.current = notificationTone
    localStorage.setItem('drift-notification-tone', notificationTone)
  }, [notificationTone])

  // The same web bundle also runs standalone in a browser/WebView (e.g.
  // the Android build) - every window.electronAPI call is already
  // optional-chained so nothing breaks there, but the minimize/close
  // buttons would be dead controls with no native window behind them,
  // so just don't render them outside Electron.
  const isElectron = Boolean(window.electronAPI)

  // The window itself is always transparent at the OS level; whether it
  // looks solid or see-through comes entirely from the panel's own CSS
  // background below. Solid while setting up, see-through once actually
  // attached to a peer. Join/settings never fade - only the chat view does
  // (see isIdle below), and only its chrome, not the message bubbles.
  const isAttached = connectedPeers.length > 0
  // Message bubbles stay fully readable (like a game's own chat overlay)
  // while the header/room-bar/input/panel chrome around them fades to
  // nothing - see .app-container.idle. !isMouseActive forces this
  // unconditionally (dismissed = definitely faded, and definitionally
  // can't un-fade from hovering - see isMouseActive above); isInputFocused
  // overrides it the other way - actively typing keeps the input box
  // itself visible even if the mouse happens to be elsewhere.
  //
  // Used to also require isAttached (a peer actually connected) before
  // mouse-leave alone would fade the chrome - removed 2026-09-11 ("remove
  // the more than one person requirement"): fades on mouse-leave now even
  // solo/waiting for someone to join, not just once someone's actually in
  // the room.
  const isIdle = !isInputFocused && (!isMouseActive || !isHovered)

  // Solid background while solo/setting up so the panel reads as a real
  // window rather than a stray floating message list; once actually idle
  // (see .app-container.idle above) that solid color has to get out of the
  // way too, or - since an inline style always wins over the stylesheet's
  // .idle background-color:transparent rule regardless of what triggered
  // idle - the panel background would stay stuck solid even while
  // everything else correctly faded (bug found 2026-09-11 right after
  // idle became reachable while solo, via the isAttached removal above:
  // the solid color was previously "safe" only because idle could never be
  // true while unattached, so this inline/stylesheet conflict never had a
  // chance to actually show up).
  const containerStyle = {
    backgroundColor: !isAttached && !isIdle ? '#121620' : undefined,
  }

  // Click-through while inactive: only in the chat view itself - join/
  // settings/the mini bubble always want normal clicks. Tied purely to
  // isMouseActive, not isIdle - the visual fade above is allowed to be
  // hover-reactive, but whether clicks land is not, on purpose (see
  // isMouseActive's own comment).
  //
  // The `username && roomId` check is new (2026-09-11) - without it, this
  // was relying entirely on isMouseActive's old default of `true` to keep
  // the join screen clickable. Now that pass-through is the default, this
  // guard is load-bearing: it's the only thing stopping the join screen
  // itself from going click-through before anyone's even joined a room.
  useEffect(() => {
    if (!isElectron) return
    const inRoom = Boolean(username && roomId)
    window.electronAPI?.send('set-ignore-mouse-events', inRoom && !isMinimized && !showSettings && !isMouseActive)
  }, [isElectron, username, roomId, isMinimized, showSettings, isMouseActive])

  // The mini bubble doesn't wire up its own hover to isHovered, so without
  // this, hovering the minimize button then moving away would leave
  // isHovered stuck true - meaning the visual idle-fade would wrongly stay
  // off the next time the chat view is restored, until the next real
  // mouseleave happens to fire on it.
  useEffect(() => {
    if (isMinimized) setIsHovered(false)
  }, [isMinimized])

  // Restoring from the mini bubble - whether by hold-to-restore, the
  // minimize button, or the toggleOverlay shortcut - is always a
  // deliberate action, so it's one of the few things (along with openChat)
  // allowed to grant mouse interactivity back.
  //
  // BUG #1 (found 2026-09-11, "i still can interact with it"): useEffect
  // also runs once on initial mount, not just on later transitions - and
  // isMinimized's own default is false. So this was firing right at
  // startup, before any hotkey was ever pressed, immediately overwriting
  // the new pass-through-by-default value with true.
  //
  // BUG #2 (found immediately after, via a temporary console.log traced
  // through CDP - "everything I asked = not working"): a naive
  // "only run after the first mount" ref guard does NOT survive React 18
  // StrictMode (enabled in main.tsx), which deliberately mounts every
  // component's effects TWICE specifically to catch bugs like this one -
  // the ref persists across that double-invoke (same component instance),
  // so the second simulated invocation saw the guard already flipped and
  // fired setIsMouseActive(true) anyway. Confirmed via the debug log
  // showing isMouseActive flip from false to true before any hotkey or
  // room join ever happened.
  //
  // Fix: stop trying to detect "is this the first run" at all - compare
  // against the PREVIOUS isMinimized value instead, and only act on an
  // actual true->false transition. This is correct regardless of how many
  // times an effect happens to be invoked with the same inputs, which is
  // the property StrictMode's double-invocation is specifically designed
  // to demand.
  const prevMinimizedRef = useRef(isMinimized)
  useEffect(() => {
    const wasMinimized = prevMinimizedRef.current
    prevMinimizedRef.current = isMinimized
    if (wasMinimized && !isMinimized) setIsMouseActive(true)
  }, [isMinimized])

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
      // behind a symmetric NAT/CGNAT (common on home ISPs, and basically
      // always true for cellular carriers) - it needs an actual relay to
      // fall back to. Previously used Open Relay Project's free public
      // TURN service, but it (and every other free demo TURN tried) is
      // now dead/unreachable - self-hosted on bazzie instead. Both the
      // LAN and public addresses are listed since whichever one a given
      // client can actually reach depends on where it's connecting from.
      { urls: 'turn:192.168.0.113:3478', username: 'driftrelay', credential: 'REDACTED_TURN_CREDENTIAL' },
      { urls: 'turn:REDACTED_PUBLIC_IP:3478', username: 'driftrelay', credential: 'REDACTED_TURN_CREDENTIAL' },
    ]

    const createPeer = (id: string) =>
      new Peer(id, {
        host: '0.peerjs.com',
        port: 443,
        path: '/',
        secure: true,
        config: { iceServers }
      })

    // "If the chat is not connected to a room, default to the login
    // screen" (2026-09-12) - PeerJS fires 'disconnected' specifically when
    // the Peer loses its connection to the signaling server itself (network
    // drop, laptop sleep/wake, etc.) - distinct from a data connection
    // closing (a peer leaving) or 'error', neither of which mean the room
    // registration itself is gone. Previously nothing handled this at all:
    // the chat view just sat there silently pretending to still be a valid
    // room. Resetting username/roomId falls straight back to the join
    // screen, matching how the app already treats a fresh launch.
    const handlePeerDisconnected = () => {
      if (destroyed) return
      console.error('Peer disconnected from signaling server - returning to login screen')
      setConnectStatus({ type: 'error', message: 'Disconnected from server' })
      setUsername(null)
      setRoomId(null)
    }

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
      peer.on('disconnected', handlePeerDisconnected)

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
    peer.on('disconnected', handlePeerDisconnected)

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
      setMessages((prev) => {
        setGlowMessageIndex(prev.length)
        if (glowTimeoutRef.current) window.clearTimeout(glowTimeoutRef.current)
        glowTimeoutRef.current = window.setTimeout(() => setGlowMessageIndex(null), 1400)
        return [...prev, msg]
      })
      if (soundEnabledRef.current) {
        const tone = NOTIFICATION_TONES[notificationToneRef.current] ?? NOTIFICATION_TONES[DEFAULT_NOTIFICATION_TONE]
        playBleep(tone.startFreq, tone.endFreq, volumeRef.current)
      }
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
    // Sending a message always follows it down, even if scrolled up reading
    // history - same as every other chat app.
    isAtBottomRef.current = true
    setShowJumpToBottom(false)

    // Send to all connected peers
    connectionsRef.current.forEach((conn) => {
      conn.send(msg)
    })

    if (soundEnabled) playBleep(660, 440, volumeRef.current)
    setInputValue('')

    // Match the standard game-chat convention (Minecraft/Subnautica/
    // Stardew Valley: open key focuses chat, Enter sends AND closes it
    // back to the game, Escape closes without sending) - 2026-09-12,
    // "opening chat should follow like the video game chat method."
    // Same blur+dismiss dismissInput already does, just triggered by a
    // successful send instead of Escape - sending shouldn't leave chat
    // sitting open and interactive over the game afterward.
    chatInputRef.current?.blur()
    setIsMouseActive(false)
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

  // Back to the join screen - the roomId effect's own cleanup destroys the
  // peer connection, so this just needs to clear the local view of it too.
  const handleLeaveRoom = () => {
    if (connectTimeoutRef.current) {
      window.clearTimeout(connectTimeoutRef.current)
      connectTimeoutRef.current = null
    }
    connectionsRef.current = []
    setConnectedPeers([])
    setConnectStatus(null)
    setRoomId(null)
    setUsername(null)
  }

  // Shrinks the actual window down to a small bubble in the corner rather
  // than an OS-level minimize, which would just vanish behind a fullscreen
  // game. Toggling back snaps the window to whatever bounds it had before.
  // Uses the updater-function form (not the closed-over isMinimized) since
  // this also gets called from the shortcut-event effect's long-lived
  // listener, which only ever sees whatever isMinimized was when it was
  // first registered otherwise.
  const handleToggleMinimize = () => {
    setIsMinimized((prev) => {
      const next = !prev
      window.electronAPI?.send('toggle-minimize', next)
      return next
    })
  }

  const handleClearHistory = () => {
    if (!roomId) return
    setMessages([])
    try {
      localStorage.removeItem(`drift-chat-${roomId}`)
    } catch {
      // Storage unavailable - the in-memory clear above still took effect.
    }
  }

  const handleStartRecordingShortcut = (key: keyof Shortcuts) => {
    setShortcutError(null)
    setRecordingShortcut(key)
  }

  // How close to the bottom (px) still counts as "at the bottom" - a little
  // slack so sub-pixel scroll rounding doesn't spuriously show the button.
  const AT_BOTTOM_THRESHOLD = 32

  const scrollToBottom = (smooth = true) => {
    isAutoScrollingRef.current = true
    if (autoScrollTimeoutRef.current) window.clearTimeout(autoScrollTimeoutRef.current)
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' })
    // Comfortably longer than a smooth scroll to a nearby target actually
    // takes, so the flag is still up for the whole animation.
    autoScrollTimeoutRef.current = window.setTimeout(() => {
      isAutoScrollingRef.current = false
    }, smooth ? 500 : 50)
  }

  const handleMessagesScroll = () => {
    if (isAutoScrollingRef.current) return
    const el = messagesContainerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_THRESHOLD
    isAtBottomRef.current = atBottom
    setShowJumpToBottom(!atBottom)
  }

  const handleJumpToBottom = () => {
    isAtBottomRef.current = true
    setShowJumpToBottom(false)
    scrollToBottom()
  }

  // Only follow new messages down if the user was already at the bottom -
  // scrolled up to read history, a new message shouldn't yank them back
  // down. If they weren't at the bottom, surface the jump button instead.
  useEffect(() => {
    if (isAtBottomRef.current) {
      scrollToBottom()
    } else {
      setShowJumpToBottom(true)
    }
  }, [messages])

  // Mobile keyboards resize the visual viewport instead of triggering a
  // normal resize/scroll event on the chat container, so without this the
  // latest message ends up hidden behind the keyboard the moment it opens -
  // that's the "doesn't stick" bug. Re-stick to bottom on every viewport
  // resize, but only if the user was already following the conversation.
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const onResize = () => {
      if (isAtBottomRef.current) scrollToBottom(false)
    }
    viewport.addEventListener('resize', onResize)
    return () => viewport.removeEventListener('resize', onResize)
  }, [])

  // Pull the saved bindings from main once at startup - only Electron has
  // any concept of these (Android has no keyboard to shortcut).
  useEffect(() => {
    if (!isElectron) return
    window.electronAPI?.getShortcuts().then(({ shortcuts, status }) => {
      setShortcuts(shortcuts)
      setShortcutStatus(status)
    })
  }, [isElectron])

  // Overlay position preset (wishlist: "put it on the area where chat
  // should be, configurable / snap to sides"). Loaded once from main, then
  // kept live via 'overlay-zone-changed' - fires both when Settings picks a
  // new zone and when the user drags the window manually (which drops it
  // back to 'free' on the main-process side).
  useEffect(() => {
    if (!isElectron) return
    window.electronAPI?.getOverlayZone().then(setOverlayZone)
    const handler = (zone: OverlayZone) => setOverlayZone(zone)
    window.electronAPI?.on('overlay-zone-changed', handler)
  }, [isElectron])

  useEffect(() => {
    isMinimizedRef.current = isMinimized
  }, [isMinimized])

  // toggleOverlay/openChat are real OS-wide hotkeys registered in the main
  // process (see electron/main.ts) - it forwards them here as plain IPC
  // events since only the renderer knows the current isMinimized state and
  // has an actual chat input to focus. electronAPI.on has no matching off,
  // so this is meant to register exactly once - but an "empty-ish deps"
  // array alone does NOT guarantee that under React 18 StrictMode (enabled
  // in main.tsx), which deliberately invokes every mount effect twice to
  // catch exactly this kind of bug. Confirmed via a live trace 2026-09-12:
  // every real hotkey press logged the handler firing twice. Harmless here
  // (both calls are idempotent - focusing/reactivating twice looks the
  // same as once) but still a real double-registration that would silently
  // double-fire any future side effect added here. Fixed properly with a
  // ref that survives the double-invoke and blocks the second one, rather
  // than trusting the dependency array alone.
  const hasRegisteredHotkeyListenersRef = useRef(false)
  useEffect(() => {
    if (!isElectron || hasRegisteredHotkeyListenersRef.current) return
    hasRegisteredHotkeyListenersRef.current = true
    const onOpenChat = () => {
      setIsMouseActive(true)
      if (isMinimizedRef.current) {
        pendingFocusInputRef.current = true
        handleToggleMinimize()
      } else {
        chatInputRef.current?.focus()
      }
    }
    window.electronAPI?.on('shortcut-toggle-overlay', handleToggleMinimize)
    window.electronAPI?.on('shortcut-open-chat', onOpenChat)
  }, [isElectron])

  // Finishes the openChat shortcut's restore-then-focus sequence once the
  // window has actually finished transitioning out of the mini bubble.
  useEffect(() => {
    if (!isMinimized && pendingFocusInputRef.current) {
      pendingFocusInputRef.current = false
      chatInputRef.current?.focus()
    }
  }, [isMinimized])

  // dismissInput is intentionally local rather than a registered global
  // shortcut (see electron/main.ts) - it only needs to fire while Drift's
  // own window has focus, which is exactly when the chat is open anyway.
  // It blurs the input, forces the idle-fade (chrome gone, messages still
  // visible), and drops mouse interactivity (see isMouseActive) - all
  // without minimizing. Settings is left alone entirely while open, only
  // its own back button closes it.
  useEffect(() => {
    if (!username || !roomId || isMinimized || recordingShortcut || showSettings) return
    const dismissAccelerator = shortcuts?.dismissInput ?? 'Escape'
    const onKeyDown = (e: KeyboardEvent) => {
      if (keyEventToAccelerator(e) !== dismissAccelerator) return
      e.preventDefault()
      chatInputRef.current?.blur()
      setIsMouseActive(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [username, roomId, isMinimized, recordingShortcut, shortcuts, showSettings])

  // .chat-messages is the only scrollable region in this window - when
  // nothing has focus (e.g. right after dismissInput's blur(), or just
  // clicking somewhere that isn't the input), Home/End/PageUp/PageDown
  // fall through to the browser's own default scroll behavior and yank it
  // straight to the top/bottom/a page at a time, fighting the position
  // this app already tracks and drives itself (isAtBottomRef/
  // scrollToBottom/handleMessagesScroll). None of these keys have any
  // purpose in this app, so just eat them globally - except while actually
  // typing in a text field, where Home/End still need to move the text
  // caret as normal, so those are left alone.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Home' && e.key !== 'End' && e.key !== 'PageUp' && e.key !== 'PageDown') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Captures the next keypress while rebinding a shortcut in Settings.
  useEffect(() => {
    if (!recordingShortcut) return
    const key = recordingShortcut
    const onKeyDown = async (e: KeyboardEvent) => {
      e.preventDefault()
      const accelerator = keyEventToAccelerator(e)
      if (!accelerator) return // lone modifier or an unsupported key - keep waiting
      setRecordingShortcut(null)
      const result = await window.electronAPI?.setShortcut(key, accelerator)
      if (result?.success) {
        setShortcuts((prev) => (prev ? { ...prev, [key]: accelerator } : prev))
        // A successful register() means it's now actually held - update
        // optimistically rather than re-fetching from main.
        setShortcutStatus((prev) => ({ ...prev, [key]: true }))
      } else {
        setShortcutError(key)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [recordingShortcut])

  // Restore this room's chat history from a prior session as soon as we
  // join it, so reopening the app doesn't lose the conversation.
  //
  // Used to also force setIsMouseActive(true) here, making the chat land
  // fully interactive the instant you join - removed 2026-09-11, since
  // that's exactly backwards from "pass through until the shortcut has
  // been pressed": joining a room shouldn't itself be the thing that grants
  // interactivity, pressing openChat should be.
  useEffect(() => {
    if (!roomId) return
    isAtBottomRef.current = true
    setShowJumpToBottom(false)
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
        <div
          className="app-container app-container-mini"
          onMouseEnter={() => setIsHoldingMini(true)}
          onMouseLeave={() => setIsHoldingMini(false)}
        >
          <img src="./icon.png" alt="Drift" className="mini-icon" />
          <span className={`status-dot ${connectedPeers.length > 0 ? 'connected' : 'disconnected'}`} />
          <svg className="mini-hold-ring" viewBox="0 0 48 48">
            <circle className="mini-hold-ring-track" cx="24" cy="24" r={HOLD_RING_RADIUS} />
            <circle
              className={`mini-hold-ring-progress${isHoldingMini ? ' holding' : ''}`}
              cx="24"
              cy="24"
              r={HOLD_RING_RADIUS}
              strokeDasharray={HOLD_RING_CIRCUMFERENCE}
              strokeDashoffset={isHoldingMini ? 0 : HOLD_RING_CIRCUMFERENCE}
              onTransitionEnd={(e) => {
                // Only the fill-up transition should open the window - the
                // snap-back transition when the mouse leaves early ends
                // with isHoldingMini already false, so it's a no-op here.
                if (e.propertyName === 'stroke-dashoffset' && isHoldingMini) {
                  handleToggleMinimize()
                }
              }}
            />
          </svg>
        </div>
      </div>
    )
  }

  // Join screen - always shown on launch, pre-filled with whatever room ID
  // and username were used last time, so returning is a single click but
  // switching rooms/identities is always just as visible an option.
  if (showSettings) {
    const shortcutRows: { key: keyof Shortcuts; label: string }[] = [
      { key: 'toggleOverlay', label: 'Show/hide Drift' },
      { key: 'openChat', label: 'Open chat and start typing' },
      { key: 'dismissInput', label: 'Dismiss input' },
    ]

    return (
      <div className="app-shell">
        <div
          className="app-container"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          style={containerStyle}
        >
          <div className="chat-header">
            <button className="leave-button" onClick={() => setShowSettings(false)} title="Back">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <h2>Settings</h2>
            {isElectron && (
              <>
                <button className="minimize-button" onClick={handleToggleMinimize}>–</button>
                <button className="close-button" onClick={handleClose}>×</button>
              </>
            )}
          </div>

          <div className="settings-body">
            <div className="settings-row">
              <label htmlFor="settings-sound">Message sounds</label>
              <input
                id="settings-sound"
                type="checkbox"
                checked={soundEnabled}
                onChange={(e) => setSoundEnabled(e.target.checked)}
              />
            </div>

            <div className="settings-row settings-row-slider">
              <label htmlFor="settings-volume">Volume</label>
              <input
                id="settings-volume"
                type="range"
                min={0}
                max={100}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
              />
            </div>

            <div className="settings-row">
              <label htmlFor="settings-tone">Notification sound</label>
              <div className="settings-tone-picker">
                <select
                  id="settings-tone"
                  value={notificationTone}
                  onChange={(e) => setNotificationTone(e.target.value)}
                >
                  {Object.entries(NOTIFICATION_TONES).map(([key, tone]) => (
                    <option value={key} key={key}>{tone.label}</option>
                  ))}
                </select>
                <button
                  className="settings-action-button"
                  onClick={() => {
                    const tone = NOTIFICATION_TONES[notificationTone]
                    playBleep(tone.startFreq, tone.endFreq, volume || 50)
                  }}
                >
                  Test
                </button>
              </div>
            </div>

            {isElectron && (
              <div className="settings-row settings-row-position">
                <label>Overlay position</label>
                <div className="position-grid">
                  {ZONE_GRID.flat().map((zone, i) => (
                    zone === null ? <span key={i} /> : (
                      <button
                        key={zone}
                        className={`position-cell${zone === overlayZone ? ' active' : ''}${zone === 'free' ? ' position-cell-free' : ''}`}
                        title={ZONE_LABELS[zone]}
                        onClick={() => window.electronAPI?.send('set-overlay-zone', zone)}
                      >
                        {zone === 'free' && <span className="position-cell-dot" />}
                      </button>
                    )
                  ))}
                </div>
              </div>
            )}

            <div className="settings-row">
              <label>Chat history</label>
              <button className="settings-action-button" onClick={handleClearHistory}>Clear</button>
            </div>

            {isElectron && (
              <>
                <div className="settings-divider">Keyboard shortcuts</div>
                {shortcutRows.map(({ key, label }) => (
                  <div className="settings-row settings-row-shortcut" key={key}>
                    <label>{label}</label>
                    {recordingShortcut === key ? (
                      <span className="shortcut-recording">Press a key…</span>
                    ) : (
                      <button
                        className="settings-action-button shortcut-value"
                        onClick={() => handleStartRecordingShortcut(key)}
                      >
                        {shortcuts?.[key] ?? '…'}
                      </button>
                    )}
                    {shortcutError === key && <span className="shortcut-error">Already in use</span>}
                    {shortcutError !== key && shortcutStatus[key as keyof ShortcutStatus] === false && (
                      <span className="shortcut-error" title="Something else on your system already has this combo - try a different one">
                        Not active - try another combo
                      </span>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
        {resizeHandles}
      </div>
    )
  }

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
            <button className="settings-button" onClick={() => setShowSettings(true)} title="Settings">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
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
        className={`app-container${isIdle ? ' idle' : ''}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={containerStyle}
      >
        <div className="chat-header">
          <h2>Drift</h2>
          <button className="leave-button" onClick={handleLeaveRoom} title="Back to room select">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </button>
          <button className="settings-button" onClick={() => setShowSettings(true)} title="Settings">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
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

        <div className="chat-messages-wrapper">
          <div className="chat-messages" ref={messagesContainerRef} onScroll={handleMessagesScroll}>
            {messages.length === 0 ? (
              <div className="no-messages">
                No messages yet{isElectron && shortcuts?.openChat ? ` — press ${shortcuts.openChat} to chat` : ''}
              </div>
            ) : (
              messages.map((msg, index) => (
                <div
                  key={index}
                  className={`message message-animate${index === glowMessageIndex ? ' message-glow' : ''}`}
                >
                  <strong>{msg.username}:</strong> <MessageBody text={msg.message} />
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
          {showJumpToBottom && (
            <button className="jump-to-bottom" onClick={handleJumpToBottom} title="Jump to latest">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14" />
                <path d="m5 12 7 7 7-7" />
              </svg>
            </button>
          )}
        </div>

        <div className="chat-input">
          <input
            ref={chatInputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
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
