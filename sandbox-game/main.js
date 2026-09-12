// Sandbox "game" for testing Drift against - a plain, ordinary game window
// with no in-game text chat (the whole premise Drift exists for). Deliberately
// NOT always-on-top and NOT related to Drift's own code at all, so it behaves
// like a real third-party game would.
const { app, BrowserWindow } = require('electron')
const path = require('path')

let win = null

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    title: 'Sandbox Game',
    backgroundColor: '#0a1426',
    webPreferences: {
      contextIsolation: true,
    },
  })

  win.loadFile(path.join(__dirname, 'index.html'))

  // F11 = toggle real OS-level exclusive-style fullscreen. This is the
  // hardest case for an always-on-top overlay (some games' true fullscreen
  // modes can suppress other windows entirely) - worth testing Drift
  // against deliberately, not just windowed/borderless.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen())
    }
  })

  win.on('closed', () => { win = null })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
