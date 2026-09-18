import { contextBridge, ipcRenderer } from 'electron'

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  send: (channel: string, data?: any) => {
    // Whitelist channels
    const validChannels = ['message-sent', 'toggle-overlay', 'resize-delta', 'toggle-minimize', 'set-ignore-mouse-events', 'set-overlay-zone', 'set-chat-engaged', 'clear-chat-history']
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data)
    }
  },
  on: (channel: string, callback: Function) => {
    const validChannels = ['message-received', 'overlay-toggled', 'shortcut-toggle-overlay', 'shortcut-open-chat', 'overlay-zone-changed', 'shortcut-dismiss-input', 'clear-chat-history', 'shortcuts-updated']
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args))
    }
  },
  getShortcuts: () => ipcRenderer.invoke('get-shortcuts'),
  setShortcut: (key: string, accelerator: string) => ipcRenderer.invoke('set-shortcut', { key, accelerator }),
  getOverlayZone: () => ipcRenderer.invoke('get-overlay-zone'),
})
