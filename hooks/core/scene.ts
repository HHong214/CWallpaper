// What the Backdrop shows for given settings. Pure: no engine import, no clock
// (the time comes in as `now`), no store, never throws.
import type { Settings } from './options.ts'
import { currentWallpaper } from './registry.ts'
import type { ShaderScene, Wallpaper } from './registry.ts'

export type Scene = { kind: 'none' } | { kind: 'svg'; source: string; alt: string } | ShaderScene

/** A shader takes at most eight values; three are the scene's own. */
const OWN_VALUES = 5

const finite = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** The scene's own values, beside the wallpaper's: dim 0 to 0.8, speed 1 or 0.5, fps 1 or 0. */
function sceneValues(w: Wallpaper, s: Settings): Record<string, number> {
  const out: Record<string, number> = {}
  let own: unknown
  try {
    own = typeof w.values === 'function' ? w.values(s) : undefined
  } catch {
    own = undefined
  }
  if (own && typeof own === 'object') {
    for (const [name, v] of Object.entries(own).slice(0, OWN_VALUES)) if (typeof v === 'number' && Number.isFinite(v)) out[name] = v
  }
  out.dim = Math.min(0.8, Math.max(0, finite(s.dim, 30) / 100))
  out.speed = s.motion === 'light' ? 0.5 : 1
  out.fps = s.fps === true ? 1 : 0
  return out
}

function scene(settings: Settings, wallpapers: readonly Wallpaper[], now: number): Scene {
  if (!settings || typeof settings !== 'object' || settings.on === false) return { kind: 'none' }
  const w = currentWallpaper(settings, wallpapers)
  if (w === undefined) return { kind: 'none' }
  const s: Settings = { ...settings, wallpaper: w.id }
  const source = String(w.svg(s, now))
  let alt = ''
  try {
    alt = typeof w.alt === 'function' ? String(w.alt(s, now)) : ''
  } catch {
    alt = ''
  }
  if (alt === '') alt = `The ${w.label} wallpaper.`
  if (w.kind === 'shader' && s.motion !== 'off') return { kind: 'shader', id: w.id, values: sceneValues(w, s), source, alt }
  return { kind: 'svg', source, alt }
}

/** `{ kind: 'none' }` when off; an svg scene; or, for a shader wallpaper that moves, a shader scene. */
export function sceneFor(settings: Settings, wallpapers: readonly Wallpaper[], now: number): Scene {
  try {
    return scene(settings, wallpapers, now)
  } catch {
    return { kind: 'none' }
  }
}
