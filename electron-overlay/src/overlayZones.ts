// Shared by the Settings window (the position picker itself lives there
// now) - kept separate from Settings.tsx only because OverlayZone is a
// global ambient type (see vite-env.d.ts) shared with electron/main.ts.

// 3x3 layout for the overlay-position picker in Settings - center cell is
// 'free' (dragged-anywhere, the default), the other 8 are screen zones
// computed in electron/main.ts.
export const ZONE_GRID: (OverlayZone | null)[][] = [
  ['top-left', 'top', 'top-right'],
  ['left', 'free', 'right'],
  ['bottom-left', 'bottom', 'bottom-right'],
]
export const ZONE_LABELS: Record<OverlayZone, string> = {
  'top-left': 'Top left',
  top: 'Top',
  'top-right': 'Top right',
  left: 'Left',
  free: 'Free (drag anywhere)',
  right: 'Right',
  'bottom-left': 'Bottom left',
  bottom: 'Bottom',
  'bottom-right': 'Bottom right',
}
