// Chat-specific theming (2026-09-18) - a small set of accent colors for
// the CHAT window only (message glow, the input's focus ring, etc.), not
// a full app reskin. Picked in Settings, applied via a single CSS custom
// property (--drift-accent, set inline on .app-container in App.tsx) that
// App.scss's chat-specific rules read with a fallback to the original
// hardcoded indigo - so leaving it on "Default" is pixel-identical to
// before this existed. Settings' own UI (position-grid, shortcut-
// recording, etc.) deliberately never sets this property, so it stays the
// original color regardless of the chosen chat theme - CSS custom
// properties only cascade to elements actually inside the tree that set
// them, and Settings is a wholly separate window/DOM tree.
export const CHAT_THEMES: Record<string, { label: string; accent: string }> = {
  default: { label: 'Default', accent: '#818cf8' },
  ocean: { label: 'Ocean', accent: '#38bdf8' },
  forest: { label: 'Forest', accent: '#4ade80' },
  sunset: { label: 'Sunset', accent: '#fb923c' },
  rose: { label: 'Rose', accent: '#f472b6' },
}
export const DEFAULT_CHAT_THEME = 'default'
