// Shared by the main chat window (App.tsx, matching a saved accelerator
// against a live keydown) and the Settings window (Settings.tsx, recording
// a new one) - kept in one place so the two never drift out of agreement
// on what a given keypress is called.

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

export function keyEventToAccelerator(e: KeyboardEvent): string | null {
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
