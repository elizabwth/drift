import { app, BrowserWindow, ipcMain, screen, globalShortcut, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const MIN_WIDTH = 280
const MIN_HEIGHT = 300
const MINI_SIZE = 48

// Wishlist ask: "put it on the area where chat should be, configurable /
// snap to sides in settings" - a fixed screen-position preset, distinct
// from the removed v0.1.15 auto-snap-to-game-window feature (which docked
// against whatever window happened to have focus and got pulled for
// "jumping around unpredictably"). This is the opposite: the user picks
// one of 8 screen zones once, it stays there until they either drag the
// window manually (which drops back to 'free', same as it's always
// worked) or pick a different zone.
type OverlayZone = 'free' | 'top-left' | 'top' | 'top-right' | 'left' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right'
const ZONE_MARGIN = 12

// Remembers window position/size across launches. Just x/y/width/height -
// nothing sensitive, safe to keep in userData alongside electron-updater's
// own cache.
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json')

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  snapZone?: OverlayZone
}

function loadWindowState(): WindowState {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
    if (typeof parsed.width === 'number' && typeof parsed.height === 'number') {
      return parsed
    }
  } catch {
    // No saved state yet (first launch) or the file is corrupt - use defaults.
  }
  return { width: 400, height: 600 }
}

function saveWindowState(bounds: WindowState) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(bounds))
  } catch (err) {
    console.error('Failed to save window state:', err)
  }
}

// A saved x/y can end up pointing off any current display (monitor
// unplugged, resolution changed, etc.) - land it back on-screen instead
// of leaving it wherever Windows decides to put an off-screen window,
// which is what actually looked like "bouncing around" between launches.
function clampToVisibleDisplay(state: WindowState): WindowState {
  if (state.x === undefined || state.y === undefined) return state
  const display = screen.getDisplayNearestPoint({ x: state.x, y: state.y })
  const wa = display.workArea
  const x = Math.min(Math.max(state.x, wa.x), wa.x + wa.width - state.width)
  const y = Math.min(Math.max(state.y, wa.y), wa.y + wa.height - state.height)
  return { ...state, x, y }
}

// Anchors a zone to whichever display the window is currently on (not
// always the primary monitor) - matters on a multi-monitor setup where the
// game and Drift might both be on a secondary screen.
function computeZoneBounds(zone: OverlayZone, width: number, height: number, anchor: { x: number; y: number }): { x: number; y: number } | null {
  if (zone === 'free') return null
  const wa = screen.getDisplayNearestPoint(anchor).workArea
  const left = wa.x + ZONE_MARGIN
  const right = wa.x + wa.width - width - ZONE_MARGIN
  const centerX = wa.x + (wa.width - width) / 2
  const top = wa.y + ZONE_MARGIN
  const bottom = wa.y + wa.height - height - ZONE_MARGIN
  const centerY = wa.y + (wa.height - height) / 2

  switch (zone) {
    case 'top-left': return { x: left, y: top }
    case 'top': return { x: centerX, y: top }
    case 'top-right': return { x: right, y: top }
    case 'left': return { x: left, y: centerY }
    case 'right': return { x: right, y: centerY }
    case 'bottom-left': return { x: left, y: bottom }
    case 'bottom': return { x: centerX, y: bottom }
    case 'bottom-right': return { x: right, y: bottom }
  }
}

// toggleOverlay/openChat are registered as real OS-wide shortcuts (via
// globalShortcut) since they need to work while a game has focus, not just
// Drift itself - that's the entire point of a game overlay hotkey.
// dismissInput is deliberately NOT registered globally: it defaults to
// Escape, and a global Escape hook would swallow that key for every other
// running app, including the game's own pause menu. It's stored here
// anyway so the settings UI has one shared source of truth, but the
// renderer just reads it and matches it locally against its own keydown
// events (which only fire while Drift's window actually has focus, i.e.
// exactly while chat is open).
const SHORTCUTS_FILE = path.join(app.getPath('userData'), 'shortcuts.json')
const GLOBAL_SHORTCUT_KEYS = ['toggleOverlay', 'openChat'] as const

interface Shortcuts {
  toggleOverlay: string
  openChat: string
  dismissInput: string
}

// Plain Alt+letter and bare function keys are exactly the combos capture/
// overlay/driver software (GeForce Experience, streaming tools, etc.)
// tends to grab first, and Electron's globalShortcut.register() fails
// *silently* on a conflict - no error, no throw, it just never fires. A
// three-modifier combo is far less likely to already be spoken for.
const DEFAULT_SHORTCUTS: Shortcuts = {
  toggleOverlay: 'Ctrl+Alt+D',
  openChat: 'Ctrl+Alt+C',
  dismissInput: 'Escape',
}

function loadShortcuts(): Shortcuts {
  try {
    const parsed = JSON.parse(fs.readFileSync(SHORTCUTS_FILE, 'utf-8'))
    return { ...DEFAULT_SHORTCUTS, ...parsed }
  } catch {
    return { ...DEFAULT_SHORTCUTS }
  }
}

function saveShortcuts(shortcuts: Shortcuts) {
  try {
    fs.writeFileSync(SHORTCUTS_FILE, JSON.stringify(shortcuts))
  } catch (err) {
    console.error('Failed to save shortcuts:', err)
  }
}

let shortcuts: Shortcuts = loadShortcuts()

const GLOBAL_SHORTCUT_CHANNELS: Record<(typeof GLOBAL_SHORTCUT_KEYS)[number], string> = {
  toggleOverlay: 'shortcut-toggle-overlay',
  openChat: 'shortcut-open-chat',
}

// Whether each global shortcut's *current* accelerator is actually held
// right now - register() failing is silent (see below), so without this
// there's no way for the settings UI to tell "bound but dead" apart from
// "working". Rebinding through Settings already caught this for the key
// being changed, but a fresh app launch never checked at all - if
// whatever's squatting the accelerator was already running at startup,
// the shortcut would just silently never fire, forever, with zero
// indication anywhere. This is exposed via get-shortcuts so Settings can
// show it inline.
const shortcutStatus: Partial<Record<(typeof GLOBAL_SHORTCUT_KEYS)[number], boolean>> = {}

// register() doesn't throw on a conflicting accelerator (already taken by
// another app, or malformed) - it just silently returns false, so callers
// have to check the return value to know whether it actually took.
function registerOneGlobalShortcut(key: (typeof GLOBAL_SHORTCUT_KEYS)[number]): boolean {
  const channel = GLOBAL_SHORTCUT_CHANNELS[key]
  let ok: boolean
  try {
    ok = globalShortcut.register(shortcuts[key], () => {
      mainWindow?.webContents.send(channel)
    })
  } catch {
    ok = false
  }
  shortcutStatus[key] = ok
  return ok
}

function registerGlobalShortcuts() {
  globalShortcut.unregisterAll()
  for (const key of GLOBAL_SHORTCUT_KEYS) {
    registerOneGlobalShortcut(key)
  }
}

ipcMain.handle('get-shortcuts', () => ({ shortcuts, status: shortcutStatus }))

ipcMain.handle('set-shortcut', (_event, { key, accelerator }: { key: keyof Shortcuts; accelerator: string }) => {
  const previous = shortcuts[key]
  shortcuts[key] = accelerator

  if ((GLOBAL_SHORTCUT_KEYS as readonly string[]).includes(key)) {
    // unregisterAll() wipes every global shortcut, not just this one, so
    // both have to be re-registered together either way.
    globalShortcut.unregisterAll()
    let ok = true
    for (const k of GLOBAL_SHORTCUT_KEYS) {
      const success = registerOneGlobalShortcut(k)
      if (k === key) ok = success
    }
    if (!ok) {
      // Conflicts with something else on the system - roll back and leave
      // the previous binding intact rather than silently going dead.
      shortcuts[key] = previous
      globalShortcut.unregisterAll()
      for (const k of GLOBAL_SHORTCUT_KEYS) registerOneGlobalShortcut(k)
      return { success: false }
    }
  }

  saveShortcuts(shortcuts)
  return { success: true }
})

let mainWindow: BrowserWindow | null = null
// The window's bounds while NOT shrunk to the corner bubble - this is what
// gets persisted and what "restore" snaps back to, so minimizing never
// clobbers the size/position the user actually cares about remembering.
let normalBounds: WindowState = { width: 400, height: 600 }
let isMinimized = false
let saveStateTimeout: ReturnType<typeof setTimeout> | null = null
let currentZone: OverlayZone = 'free'
// Distinguishes our own setBounds() call (applying a zone) from a real user
// drag, so the move handler below only clears the zone back to 'free' on an
// actual manual drag - not on the very move event the zone-apply itself causes.
let isApplyingZone = false

function persistBoundsDebounced() {
  if (isMinimized || !mainWindow) return
  if (saveStateTimeout) clearTimeout(saveStateTimeout)
  saveStateTimeout = setTimeout(() => {
    if (!mainWindow) return
    normalBounds = mainWindow.getBounds()
    saveWindowState({ ...normalBounds, snapZone: currentZone })
  }, 400)
}

function applyOverlayZone(zone: OverlayZone) {
  currentZone = zone
  mainWindow?.webContents.send('overlay-zone-changed', currentZone)
  if (zone === 'free' || !mainWindow) {
    saveWindowState({ ...normalBounds, snapZone: currentZone })
    return
  }
  const bounds = mainWindow.getBounds()
  const target = computeZoneBounds(zone, bounds.width, bounds.height, bounds)
  if (!target) return
  isApplyingZone = true
  mainWindow.setBounds({ ...target, width: bounds.width, height: bounds.height })
  normalBounds = mainWindow.getBounds()
  saveWindowState({ ...normalBounds, snapZone: currentZone })
  setTimeout(() => { isApplyingZone = false }, 100)
}

function createWindow() {
  const savedState = clampToVisibleDisplay(loadWindowState())
  normalBounds = savedState
  currentZone = savedState.snapZone ?? 'free'

  // Land directly on the saved zone at launch (rather than opening at the
  // raw saved x/y and then jumping) - recomputed fresh against the current
  // display/work area each time, not a stale cached pixel position, so it
  // stays correct across resolution or monitor changes.
  if (currentZone !== 'free') {
    const target = computeZoneBounds(currentZone, savedState.width, savedState.height, savedState)
    if (target) {
      savedState.x = target.x
      savedState.y = target.y
    }
  }

  mainWindow = new BrowserWindow({
    width: savedState.width,
    height: savedState.height,
    x: savedState.x,
    y: savedState.y,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    roundedCorners: true,
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  })

  // Plain alwaysOnTop:true only claims a "floating" z-order level, which
  // plenty of games can still beat once clicked/focused. 'screen-saver' is
  // the highest level Electron exposes and is what actually wins that
  // fight.
  //
  // A single synchronous reassert on 'blur' is NOT enough, confirmed via a
  // real WinAPI z-order check (2026-09-11): the window's WS_EX_TOPMOST bit
  // stays set the whole time, but a plain non-topmost window clicked right
  // after still ends up visually above Drift - our reassert races Windows'
  // own "raise the newly-activated window" step and can lose, since the
  // exact timing isn't ours to control. (True Steam/Discord-style overlays
  // sidestep this entirely by hooking the game's own DirectX/OpenGL Present
  // call and drawing as part of its frame, never touching window z-order at
  // all - a fundamentally different architecture, not a window-manager
  // trick, and out of scope for Drift's current design.)
  //
  // Fix: stop relying on one racy attempt. Fire a burst of reassertions at
  // staggered delays after blur (covers whatever the actual race timing
  // turns out to be) AND keep a fast heartbeat running the whole time Drift
  // isn't focused (catches any future focus-steal that doesn't even go
  // through 'blur' cleanly). 80ms is fast enough that a loss self-corrects
  // well under one visible frame at typical refresh rates.
  const assertTopmost = () => mainWindow?.setAlwaysOnTop(true, 'screen-saver')
  assertTopmost()

  let topmostHeartbeat: NodeJS.Timeout | null = null
  const startTopmostHeartbeat = () => {
    if (topmostHeartbeat) return
    topmostHeartbeat = setInterval(() => {
      if (mainWindow && !mainWindow.isFocused()) assertTopmost()
    }, 80)
  }
  const stopTopmostHeartbeat = () => {
    if (topmostHeartbeat) {
      clearInterval(topmostHeartbeat)
      topmostHeartbeat = null
    }
  }

  mainWindow.on('blur', () => {
    assertTopmost()
    ;[30, 80, 150, 300, 600].forEach((delay) => setTimeout(assertTopmost, delay))
    startTopmostHeartbeat()
  })
  mainWindow.on('focus', () => {
    stopTopmostHeartbeat()
  })
  mainWindow.on('closed', () => {
    stopTopmostHeartbeat()
  })

  mainWindow.on('resize', persistBoundsDebounced)
  mainWindow.on('move', persistBoundsDebounced)

  // "Add spacing above the taskbar in main mode" (2026-09-13): the mini
  // bubble already only ever gets positioned via workArea math (see
  // toggle-minimize below), so it never overlaps the taskbar - but the
  // normal/main window only ever got clamped to workArea ONCE, at launch
  // (clampToVisibleDisplay above). Nothing stopped a manual drag afterward
  // from pulling it down behind the taskbar. This keeps it clamped
  // continuously instead, on every drag tick, same idea as
  // clampToVisibleDisplay but live rather than launch-only.
  let isClampingToWorkArea = false
  mainWindow.on('move', () => {
    if (isMinimized || isClampingToWorkArea || !mainWindow) return
    const bounds = mainWindow.getBounds()
    const wa = screen.getDisplayNearestPoint(bounds).workArea
    const x = Math.min(Math.max(bounds.x, wa.x), wa.x + wa.width - bounds.width)
    const y = Math.min(Math.max(bounds.y, wa.y), wa.y + wa.height - bounds.height)
    if (x !== bounds.x || y !== bounds.y) {
      isClampingToWorkArea = true
      mainWindow.setBounds({ x, y, width: bounds.width, height: bounds.height })
      isClampingToWorkArea = false
    }
  })

  // Dragging the window manually always wins - a snap zone is a one-time
  // placement, not something that fights the user for control afterward.
  // isApplyingZone distinguishes our own applyOverlayZone() setBounds()
  // call from a real drag, so applying a zone doesn't immediately clear
  // right back to 'free' on its own resulting move event.
  mainWindow.on('move', () => {
    if (!isApplyingZone && currentZone !== 'free' && !isMinimized) {
      currentZone = 'free'
      mainWindow?.webContents.send('overlay-zone-changed', currentZone)
    }
  })

  ipcMain.handle('get-overlay-zone', () => currentZone)
  ipcMain.on('set-overlay-zone', (_event, zone: OverlayZone) => {
    applyOverlayZone(zone)
  })

  // Custom "minimize": rather than the OS taskbar minimize (useless for an
  // always-on-top overlay sitting over a fullscreen game), shrink the actual
  // window down to a small bubble in the corner, then snap back to whatever
  // bounds it had before on restore.
  ipcMain.on('toggle-minimize', (_event, minimized: boolean) => {
    if (!mainWindow) return

    if (minimized) {
      normalBounds = mainWindow.getBounds()
      isMinimized = true
      const display = screen.getDisplayMatching(normalBounds)
      const margin = 12
      mainWindow.setMinimumSize(MINI_SIZE, MINI_SIZE)
      mainWindow.setBounds({
        x: display.workArea.x + display.workArea.width - MINI_SIZE - margin,
        y: display.workArea.y + margin,
        width: MINI_SIZE,
        height: MINI_SIZE,
      })
    } else {
      isMinimized = false
      mainWindow.setMinimumSize(MIN_WIDTH, MIN_HEIGHT)
      mainWindow.setBounds(normalBounds)
    }
  })

  // Handle close window request from renderer
  ipcMain.on('close-window', () => {
    if (mainWindow) {
      mainWindow.close()
    }
  })

  // Click-through while idle: mouse clicks (and drags) pass straight to
  // whatever's behind the overlay - the game - instead of the window
  // eating them. Deliberately not hover-reactive in either direction -
  // the renderer only ever sends `true` on dismissInput and `false` on
  // openChat/toggleOverlay, so the only way back to interactive is the
  // keyboard shortcut that opened it in the first place, never just
  // brushing the mouse across it.
  ipcMain.on('set-ignore-mouse-events', (_event, ignore: boolean) => {
    mainWindow?.setIgnoreMouseEvents(ignore)
  })

  // Native edge-drag resize doesn't work on Windows for a transparent
  // frameless window, so the renderer drives resizing manually via its own
  // resize-handle elements and forwards mouse deltas here. `edge` is one of
  // top/bottom/left/right or a hyphenated corner combo like 'top-left'.
  ipcMain.on('resize-delta', (_event, { dx, dy, edge }: { dx: number; dy: number; edge: string }) => {
    if (!mainWindow) return
    const bounds = mainWindow.getBounds()
    let { x, y, width, height } = bounds
    const rightEdge = x + width
    const bottomEdge = y + height

    if (edge.includes('right')) {
      width = Math.max(MIN_WIDTH, width + dx)
    }
    if (edge.includes('left')) {
      width = Math.max(MIN_WIDTH, width - dx)
      x = rightEdge - width
    }
    if (edge.includes('bottom')) {
      height = Math.max(MIN_HEIGHT, height + dy)
    }
    if (edge.includes('top')) {
      height = Math.max(MIN_HEIGHT, height - dy)
      y = bottomEdge - height
    }

    mainWindow.setBounds({ x, y, width, height })
  })

  // Enable acrylic blur on Windows
  // if (mainWindow.isVisible()) {
  //   if (process.platform === 'win32') {
  //     mainWindow.setBackgroundMaterial('acrylic')
  //   }
  // }

  // Chat messages can now contain real links (wishlist #04, media/YouTube
  // embeds) - a plain, non-embeddable link should open in the user's real
  // browser, never as a second Electron window layered into the overlay.
  // Registered before either load path below so it applies in both dev and
  // production, not just one.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // In development, load from Vite dev server
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    // In production, load the built files
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  createWindow()
  registerGlobalShortcuts()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  // Checks bugtit.com/drift/latest.yml on launch; downloads silently in the
  // background and installs on next quit. No-op in dev (no update feed there).
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error('autoUpdater check failed:', err)
    })
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  if (saveStateTimeout) clearTimeout(saveStateTimeout)
  if (!isMinimized && mainWindow) {
    normalBounds = mainWindow.getBounds()
  }
  saveWindowState(normalBounds)
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
