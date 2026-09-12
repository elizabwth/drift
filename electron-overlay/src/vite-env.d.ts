/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface Shortcuts {
  toggleOverlay: string
  openChat: string
  dismissInput: string
}

// Only toggleOverlay/openChat have a meaningful status - they're the only
// ones actually registered as OS-wide hotkeys (see electron/main.ts).
type ShortcutStatus = Partial<Record<'toggleOverlay' | 'openChat', boolean>>

// Mirrors OverlayZone in electron/main.ts - a fixed screen-position preset
// for the overlay window, separate from the removed auto-snap-to-game
// feature. 'free' means dragged-anywhere, the original/default behavior.
type OverlayZone = 'free' | 'top-left' | 'top' | 'top-right' | 'left' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right'

interface Window {
  electronAPI?: {
    send: (channel: string, data?: any) => void
    on: (channel: string, callback: Function) => void
    getShortcuts: () => Promise<{ shortcuts: Shortcuts; status: ShortcutStatus }>
    setShortcut: (key: keyof Shortcuts, accelerator: string) => Promise<{ success: boolean }>
    getOverlayZone: () => Promise<OverlayZone>
  }
}
