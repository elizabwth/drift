import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { autoUpdater } from 'electron-updater'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const MIN_WIDTH = 280
const MIN_HEIGHT = 300
const MINI_SIZE = 48

// Remembers window position/size across launches. Just x/y/width/height -
// nothing sensitive, safe to keep in userData alongside electron-updater's
// own cache.
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json')

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
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

let mainWindow: BrowserWindow | null = null
// The window's bounds while NOT shrunk to the corner bubble - this is what
// gets persisted and what "restore" snaps back to, so minimizing never
// clobbers the size/position the user actually cares about remembering.
let normalBounds: WindowState = { width: 400, height: 600 }
let isMinimized = false
let saveStateTimeout: ReturnType<typeof setTimeout> | null = null

function persistBoundsDebounced() {
  if (isMinimized || !mainWindow) return
  if (saveStateTimeout) clearTimeout(saveStateTimeout)
  saveStateTimeout = setTimeout(() => {
    if (!mainWindow) return
    normalBounds = mainWindow.getBounds()
    saveWindowState(normalBounds)
  }, 400)
}

function createWindow() {
  const savedState = loadWindowState()
  normalBounds = savedState

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

  mainWindow.on('resize', persistBoundsDebounced)
  mainWindow.on('move', persistBoundsDebounced)

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
