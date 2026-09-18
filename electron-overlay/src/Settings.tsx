import { useEffect, useState } from 'react'
import './App.scss'
import { keyEventToAccelerator } from './shortcutUtils'
import { NOTIFICATION_TONES, DEFAULT_NOTIFICATION_TONE, playBleep } from './soundUtils'
import { ZONE_GRID, ZONE_LABELS } from './overlayZones'

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

        <div className="settings-row">
          <label>Chat history</label>
          <button className="settings-action-button" onClick={handleClearHistory}>Clear</button>
        </div>

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
      </div>
    </div>
  )
}

export default Settings
