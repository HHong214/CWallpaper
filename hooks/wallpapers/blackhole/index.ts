// The black hole as a wallpaper: an ASCII black hole the app plays on the GPU (./shader.ts), over its
// still picture (./still.ts, a real frame of the shader), which shows alone with motion off, under
// Reduce Motion, on the phone, and wherever the shader is not played. Its own options are the hole's
// size and a calmer motion. Pure: settings in, numbers and a picture out. No `$` and no JSX, so the
// core and the tools can import it under Node; its Backdrop tree is written with the global `h`.
import type { SceneKit, Settings, ShaderScene, Wallpaper } from '../../core/registry.ts'
import { STILL_ALT, stillSvg } from './still.ts'

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

const SIZES = ['small', 'medium', 'large'] as const
type Size = (typeof SIZES)[number]
/** The shader's `size` for each choice: the hole's radius is this times the place it is given. */
const SIZE_VALUE: Record<Size, number> = { small: 0.8, medium: 1, large: 1.25 }

const own = (s: Settings): Record<string, unknown> => {
  const all = s && typeof s === 'object' && s.own && typeof s.own === 'object' ? s.own.blackhole : undefined
  return all && typeof all === 'object' ? all : {}
}
const sizeOf = (s: Settings): Size => {
  const v = own(s).size
  return SIZES.some(x => x === v) ? (v as Size) : 'medium'
}
const motionOf = (s: Settings): 'smooth' | 'light' | 'off' => {
  const m = s && typeof s === 'object' ? s.motion : undefined
  return m === 'light' || m === 'off' ? m : 'smooth'
}
const dimOf = (s: Settings): number => {
  const d = s && typeof s === 'object' ? s.dim : undefined
  return typeof d === 'number' && Number.isFinite(d) ? Math.min(80, Math.max(0, d)) : 30
}

export const blackhole: Wallpaper = Object.freeze<Wallpaper>({
  id: 'blackhole',
  label: 'Black hole',
  aliases: ['black-hole', 'hole'],
  kind: 'shader',
  options: [
    {
      key: 'size',
      title: 'Black hole: size',
      description: 'How large the black hole is drawn over the chat column: small, medium or large.',
      type: 'choice',
      default: 'medium',
      choices: [...SIZES],
    },
    {
      key: 'calm',
      title: 'Black hole: calmer motion',
      description: 'Slows and softens the black hole: the disc streams more gently, fewer streaks and clumps, dimmer matter falling in.',
      type: 'boolean',
      default: false,
    },
  ],
  colors: () => HOLE,
  // The still picture, the same whatever the motion and the clock.
  svg: s => {
    try {
      return stillSvg({ dim: dimOf(s), own: { blackhole: { size: sizeOf(s) } } })
    } catch {
      return stillSvg({})
    }
  },
  moves: s => motionOf(s) !== 'off',
  // The shader's four numbers, each inside the range its `values` declares.
  values: s => ({
    dim: Math.round(dimOf(s)) / 100,
    speed: motionOf(s) === 'light' ? 0.5 : 1,
    calm: own(s).calm === true ? 1 : 0,
    size: SIZE_VALUE[sizeOf(s)],
  }),
  // One Shader over the still. The module path is read off this source by the engine: keep it a literal.
  scene: (kit: SceneKit, scene: ShaderScene) =>
    h(kit.Shader as never, { module: './shader.ts', values: scene.values }, h(kit.Svg as never, { source: scene.source, alt: scene.alt })),
  alt: () => STILL_ALT,
})
