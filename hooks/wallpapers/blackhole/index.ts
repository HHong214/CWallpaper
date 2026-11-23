// The black hole as a wallpaper: ASCII art drawn by code (./field), played as
// one SVG picture (./svg). It has no options of its own. Pure: settings in, a
// picture out. No `$`, no JSX, so the core and the tools can import it under Node.
import type { Settings, Wallpaper } from '../../core/registry.ts'
import { BLACKHOLE_ALT, blackhole as blackholeSvg } from './svg.ts'
import type { BlackholeMotion } from './svg.ts'

// The app's colors, for the design system's own helper: near-black in dark mode
// with an amber accent, the gold of its ring; warm paper in light mode. Danger,
// success and warning keep their meaning.
const HOLE = Object.freeze({
  label: 'Black hole',
  roles: { accent: '#f0a020', danger: '#d4503a', success: '#5f9a4c', warning: '#e0a030', pro: '#d07a4a' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#f1e8d8', 'surface-1': '#f6efe2', 'surface-2': '#fbf7ee',
        'text-primary': '#2b2118', 'text-secondary': '#54473a', 'text-muted': '#6b5d4e',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#070508', 'surface-1': '#0c090b', 'surface-2': '#110d0e', 'surface-3': '#161112',
        'text-primary': '#f5ecdc', 'text-secondary': '#d8cab2', 'text-muted': '#b2a288',
      },
    },
  },
})

const motionOf = (s: Settings): BlackholeMotion => {
  const m = s && typeof s === 'object' ? s.motion : undefined
  return m === 'light' || m === 'off' ? m : 'smooth'
}
const dimOf = (s: Settings): number => {
  const d = s && typeof s === 'object' ? s.dim : undefined
  return typeof d === 'number' && Number.isFinite(d) ? d : 30
}

// One picture per motion and dimming, built once and kept: a redraw then costs nothing to make.
const made = new Map<string, string>()

export const blackhole: Wallpaper = Object.freeze<Wallpaper>({
  id: 'blackhole',
  label: 'Black hole',
  aliases: ['black-hole', 'hole'],
  kind: 'svg',
  options: [],
  colors: () => HOLE,
  svg: s => {
    const motion = motionOf(s)
    const dim = dimOf(s)
    const key = `${motion}|${dim}`
    let svg = made.get(key)
    if (svg === undefined) {
      try {
        svg = blackholeSvg({ motion, dim })
      } catch {
        svg = blackholeSvg({ motion: 'off' })
      }
      made.set(key, svg)
    }
    return svg
  },
  moves: s => motionOf(s) !== 'off',
  alt: () => BLACKHOLE_ALT,
})
