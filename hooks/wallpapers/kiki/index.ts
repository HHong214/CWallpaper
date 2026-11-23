// Kiki as a wallpaper: pixel art of a young witch and her black cat floating on
// a broom toward a seaside city, by day, at sunset or at night (./scene puts
// the picture together). Pure: settings and a time in, a picture out. No `$`,
// no JSX, so the core and the tools can import it under Node.
import type { Settings, Wallpaper } from '../../core/registry.ts'
import { kikiScene } from './scene.ts'
import type { Phase } from './types.ts'
import { phaseAt } from './sun.ts'

const TIMES = ['auto', 'day', 'sunset', 'night'] as const
type Time = (typeof TIMES)[number]

// What `light` rests, for a calmer scene: the shooting star, the one sudden
// streak. The sea, the clouds, the stars, the moon, the lighthouse, the wind,
// the camera's gentle bob and Kiki's own float all still move.
const LIGHT = { stillShoot: true } as const

// The app's colors, for the design system's own helper: a near-black night
// indigo in dark mode, warm paper in light mode. The roles keep their meaning
// (red is danger, green success, amber warning); the accent is dusk violet and
// `pro` the rose of the bow.
const NIGHT = Object.freeze({
  label: 'Kiki night',
  roles: { accent: '#7c6bd0', danger: '#c0453f', success: '#4f8a4a', warning: '#c98a1b', pro: '#c05a86' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#efe6d6', 'surface-1': '#f4ecde', 'surface-2': '#faf5ea',
        'text-primary': '#2a2433', 'text-secondary': '#4f4760', 'text-muted': '#655d76',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#07091a', 'surface-1': '#0b0e22', 'surface-2': '#0f122a', 'surface-3': '#121631',
        'text-primary': '#eeecfa', 'text-secondary': '#c9c6e2', 'text-muted': '#a6a2c6',
      },
    },
  },
})

// The cat's face after the spinner's word, by what Claude is doing.
const FACE: Record<string, string> = {
  requesting: '=^-^=',
  thinking: '=^.^=',
  'tool-input': '=^o^=',
  'tool-use': '=^o^=',
  responding: '=^w^=',
}

const own = (s: Settings): Record<string, unknown> => {
  const all = s && typeof s === 'object' && s.own && typeof s.own === 'object' ? s.own.kiki : undefined
  return all && typeof all === 'object' ? all : {}
}
const timeOf = (s: Settings): Time => {
  const t = own(s).time
  return TIMES.some(x => x === t) ? (t as Time) : 'auto'
}
const motionOf = (s: Settings): 'smooth' | 'light' | 'off' => {
  const m = s && typeof s === 'object' ? s.motion : undefined
  return m === 'light' || m === 'off' ? m : 'smooth'
}

/** The part of the day to show: the one chosen, or in auto the clock's, with the default sun times (06:30 and 18:30). */
function phaseOf(s: Settings, now: number): Phase {
  const time = timeOf(s)
  if (time !== 'auto') return time
  if (typeof now !== 'number' || !Number.isFinite(now)) return 'night'
  return phaseAt(now, -new Date(now).getTimezoneOffset() * 60)
}

/** The dimming, painted last inside the picture, over all of it; none at 0. */
function veiled(source: string, dim: unknown): string {
  const d = typeof dim === 'number' && Number.isFinite(dim) ? Math.min(80, Math.max(0, Math.round(dim))) : 30
  if (d <= 0) return source
  const end = source.lastIndexOf('</svg>')
  if (end < 0) return source
  return `${source.slice(0, end)}<rect width="100%" height="100%" fill="#000" opacity="${d / 100}"/></svg>`
}

function sceneOf(s: Settings, now: number) {
  const motion = motionOf(s)
  return kikiScene(phaseOf(s, now), motion === 'off', motion === 'light' ? LIGHT : undefined)
}

export const kiki: Wallpaper = Object.freeze<Wallpaper>({
  id: 'kiki',
  label: 'Kiki',
  aliases: ['witch', 'night'],
  kind: 'svg',
  options: [
    {
      key: 'time',
      title: 'Kiki: time of day',
      description: 'Which part of the day Kiki shows: auto follows the clock (sunrise at 06:30, sunset at 18:30), or always day, sunset or night.',
      type: 'choice',
      default: 'auto',
      choices: [...TIMES],
    },
    {
      key: 'spinner',
      title: 'Kiki: cat spinner',
      description: 'Adds a small cat face to the line that shows while Claude works, while Kiki is the wallpaper.',
      type: 'boolean',
      default: true,
    },
  ],
  colors: () => NIGHT,
  svg: (s, now) => {
    try {
      return veiled(sceneOf(s, now).layers[0]?.source ?? '', s?.dim)
    } catch {
      return veiled(kikiScene('night').layers[0]?.source ?? '', 30)
    }
  },
  moves: s => motionOf(s) !== 'off',
  alt: (s, now) => {
    try {
      return sceneOf(s, now).alt
    } catch {
      return 'Pixel art of a young witch and her black cat floating on a broom toward a seaside city.'
    }
  },
  spinner: (s, mode) => (own(s).spinner === false ? undefined : (FACE[mode] ?? '=^.^=')),
})
