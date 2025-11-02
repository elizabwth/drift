/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    send: (channel: string, data?: any) => void
    on: (channel: string, callback: Function) => void
  }
}
