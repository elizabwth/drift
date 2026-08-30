import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const MIN_WIDTH = 280
const MIN_HEIGHT = 300

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
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
