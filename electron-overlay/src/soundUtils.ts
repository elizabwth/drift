// Shared by the main chat window (playing an incoming-message tone) and
// the Settings window (previewing a tone via its "Test" button).

// Wishlist #06 ("custom notification sounds"): every tone is synthesized
// (no audio asset to bundle/upload), so "custom" means picking a preset
// frequency sweep rather than a fixed one - matches the existing
// no-assets architecture instead of adding file storage for a Low-impact
// item. The outgoing send tone stays fixed (660->440); only the incoming
// notification tone is user-selectable.
export const NOTIFICATION_TONES: Record<string, { label: string; startFreq: number; endFreq: number }> = {
  chime: { label: 'Chime', startFreq: 880, endFreq: 1320 },
  pop: { label: 'Pop', startFreq: 1200, endFreq: 700 },
  blip: { label: 'Blip', startFreq: 1046, endFreq: 1046 },
  drop: { label: 'Drop', startFreq: 660, endFreq: 220 },
}
export const DEFAULT_NOTIFICATION_TONE = 'chime'

// A short synthesized blip (no audio asset needed) - a quick rising square
// wave, like a retro game UI beep (RollerCoaster Tycoon click / Borderlands
// skill point).
export const playBleep = (startFreq: number, endFreq: number, volume: number) => {
  if (volume <= 0) return
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square'
    osc.frequency.setValueAtTime(startFreq, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + 0.08)
    gain.gain.setValueAtTime(0.05 * (volume / 100), ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.12)
    osc.onended = () => ctx.close()
  } catch {
    // Audio isn't essential - silently skip if the browser blocks it
    // (e.g. no user gesture yet) or AudioContext is unavailable.
  }
}
