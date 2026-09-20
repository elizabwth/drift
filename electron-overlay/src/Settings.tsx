import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import './App.scss'
import { keyEventToAccelerator } from './shortcutUtils'
import { NOTIFICATION_TONES, DEFAULT_NOTIFICATION_TONE, playBleep } from './soundUtils'
import { ZONE_GRID, ZONE_LABELS } from './overlayZones'
import { CHAT_THEMES, DEFAULT_CHAT_THEME } from './themes'

// Small line-icon set matching the rest of Drift's chrome (the old
// header's gear/home icons - see App.tsx) - same viewBox/stroke
// conventions, just one per settings row now that this is a real page of
// its own rather than a single icon-less list.
function IconIndent({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}

const SpeakerIcon = () => (
  <IconIndent>
    <path d="M11 5 6 9H2v6h4l5 4V5z" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
  </IconIndent>
)

const VolumeBarsIcon = () => (
  <IconIndent>
    <rect x="4" y="14" width="3" height="6" />
    <rect x="10.5" y="9" width="3" height="11" />
    <rect x="17" y="4" width="3" height="16" />
  </IconIndent>
)

const BellIcon = () => (
  <IconIndent>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </IconIndent>
)

const TargetIcon = () => (
  <IconIndent>
    <circle cx="12" cy="12" r="8" />
    <line x1="12" y1="2" x2="12" y2="6" />
    <line x1="12" y1="18" x2="12" y2="22" />
    <line x1="2" y1="12" x2="6" y2="12" />
    <line x1="18" y1="12" x2="22" y2="12" />
  </IconIndent>
)

const TrashIcon = () => (
  <IconIndent>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </IconIndent>
)

const KeyboardIcon = () => (
  <IconIndent>
    <rect x="2" y="6" width="20" height="12" rx="2" ry="2" />
    <line x1="6" y1="10" x2="6" y2="10.01" />
    <line x1="10" y1="10" x2="10" y2="10.01" />
    <line x1="14" y1="10" x2="14" y2="10.01" />
    <line x1="18" y1="10" x2="18" y2="10.01" />
    <line x1="6" y1="14" x2="18" y2="14" />
  </IconIndent>
)

const PlayIcon = () => (
  <IconIndent>
    <polygon points="6 3 20 12 6 21 6 3" />
  </IconIndent>
)

const PaletteIcon = () => (
  <IconIndent>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8" cy="8" r="1.5" />
    <circle cx="16" cy="8" r="1.5" />
    <circle cx="8" cy="16" r="1.5" />
    <circle cx="16" cy="16" r="1.5" />
  </IconIndent>
)

// This is a real, normal Electron window (native title bar/close/minimize
// via the OS) rather than the chat overlay's frameless click-through one -
// see the 2026-09-18 tray rework in electron/main.ts. It reads/writes the
// same localStorage keys and main-process state the chat window does, so
// the two stay in sync without sharing a React tree: the localStorage-
// backed prefs (sound/volume/tone) sync via the browser's native 'storage'
// event, which fires in the *other* window whenever one changes them -
// and shortcuts/overlay zone already went through IPC to the main process
// either way, so there's nothing extra needed there beyond listening for
// the same broadcasts the chat window does.
function Settings() {
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('drift-sound-enabled') !== 'false')
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('drift-volume')
    return saved !== null ? Number(saved) : 50
  })
  const [notificationTone, setNotificationTone] = useState(() => {
    const saved = localStorage.getItem('drift-notification-tone')
    return saved && NOTIFICATION_TONES[saved] ? saved : DEFAULT_NOTIFICATION_TONE
  })
  const [chatTheme, setChatTheme] = useState(() => {
    const saved = localStorage.getItem('drift-chat-theme')
    return saved && CHAT_THEMES[saved] ? saved : DEFAULT_CHAT_THEME
  })
  const [shortcuts, setShortcuts] = useState<Shortcuts | null>(null)
  const [shortcutStatus, setShortcutStatus] = useState<ShortcutStatus>({})
  const [recordingShortcut, setRecordingShortcut] = useState<keyof Shortcuts | null>(null)
  const [shortcutError, setShortcutError] = useState<keyof Shortcuts | null>(null)
  const [overlayZone, setOverlayZone] = useState<OverlayZone>('free')

  useEffect(() => {
    localStorage.setItem('drift-sound-enabled', String(soundEnabled))
  }, [soundEnabled])

  useEffect(() => {
    localStorage.setItem('drift-volume', String(volume))
  }, [volume])

  useEffect(() => {
    localStorage.setItem('drift-notification-tone', notificationTone)
  }, [notificationTone])

  useEffect(() => {
    localStorage.setItem('drift-chat-theme', chatTheme)
  }, [chatTheme])

  useEffect(() => {
    window.electronAPI?.getShortcuts().then(({ shortcuts, status }) => {
      setShortcuts(shortcuts)
      setShortcutStatus(status)
    })
  }, [])

  useEffect(() => {
    window.electronAPI?.getOverlayZone().then(setOverlayZone)
    const handler = (zone: OverlayZone) => setOverlayZone(zone)
    window.electronAPI?.on('overlay-zone-changed', handler)
  }, [])

  // The chat window rebinding a shortcut isn't currently possible (that UI
  // lives only here now), but this keeps both windows honest if that ever
  // changes, for the cost of one listener.
  useEffect(() => {
    const handler = (updated: Shortcuts) => setShortcuts(updated)
    window.electronAPI?.on('shortcuts-updated', handler)
  }, [])

  const handleStartRecordingShortcut = (key: keyof Shortcuts) => {
    setShortcutError(null)
    setRecordingShortcut(key)
  }

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
        setShortcutStatus((prev) => ({ ...prev, [key]: true }))
      } else {
        setShortcutError(key)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [recordingShortcut])

  const handleClearHistory = () => {
    window.electronAPI?.send('clear-chat-history')
  }

  const shortcutRows: { key: keyof Shortcuts; label: string }[] = [
    { key: 'toggleOverlay', label: 'Show/hide Drift' },
    { key: 'openChat', label: 'Open chat and start typing' },
    { key: 'dismissInput', label: 'Dismiss input' },
  ]

  return (
    <div className="settings-page">
      <div className="settings-body">
        <div className="settings-row">
          <label htmlFor="settings-sound"><SpeakerIcon />Message sounds</label>
          <input
            id="settings-sound"
            type="checkbox"
            checked={soundEnabled}
            onChange={(e) => setSoundEnabled(e.target.checked)}
          />
        </div>

        <div className="settings-row settings-row-slider">
          <label htmlFor="settings-volume"><VolumeBarsIcon />Volume</label>
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
          <label htmlFor="settings-tone"><BellIcon />Notification sound</label>
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
              title="Preview this tone"
              onClick={() => {
                const tone = NOTIFICATION_TONES[notificationTone]
                playBleep(tone.startFreq, tone.endFreq, volume || 50)
              }}
            >
              <PlayIcon />
            </button>
          </div>
        </div>

        <div className="settings-row">
          <label><PaletteIcon />Chat theme</label>
          <div className="theme-swatches">
            {Object.entries(CHAT_THEMES).map(([key, theme]) => (
              <button
                key={key}
                className={`theme-swatch${key === chatTheme ? ' active' : ''}`}
                style={{ backgroundColor: theme.accent }}
                title={theme.label}
                onClick={() => setChatTheme(key)}
              />
            ))}
          </div>
        </div>

        <div className="settings-row settings-row-position">
          <label><TargetIcon />Overlay position</label>
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

        <div className="settings-row">
          <label><TrashIcon />Chat history</label>
          <button className="settings-action-button" onClick={handleClearHistory}>Clear</button>
        </div>

        <div className="settings-divider"><KeyboardIcon />Keyboard shortcuts</div>
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
      </div>
    </div>
  )
}

export default Settings
