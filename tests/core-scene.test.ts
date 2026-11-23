// Tests for what the Backdrop shows: hooks/core/scene.ts (pure: never throws; junk in gives the default out).
// Written before the code, to the contract in core-contract.md.
//
// NAMES THIS FILE PINS, with their signatures:
//
//   type Scene =
//     | { kind: 'none' }                                              the wallpaper is off
//     | { kind: 'svg'; source: string; alt: string }                  an svg wallpaper; a shader wallpaper with
//                                                                     motion off
//     | { kind: 'shader'; id: string; values: Record<string, number>; source: string; alt: string }
//                                                                     a shader wallpaper with motion on
//   sceneFor(settings: Settings, wallpapers: readonly Wallpaper[], now: number): Scene
//     The wallpaper is the one `settings.wallpaper` names (the first, Kiki, when it names none). `source` is that
//     wallpaper's `svg(settings, now)` (for a Kiki picture with the dimming veil laid inside it, as 1.9.0 did:
//     the settings' dim, painted last, over all of it). `alt` is a non-empty string. For a shader scene `values`
//     hold the wallpaper's own `values(settings)` and always `dim` (settings.dim / 100, so 0 to 0.8), `speed`
//     (1 for smooth, 0.5 for light) and `fps` (1 when Show FPS is on, else 0).
//
// A stand-in wallpaper of kind 'shader' (and one of kind 'svg') is built here, since no shader wallpaper exists
// yet; it also records the arguments `svg` was called with. Until hooks/core/scene.ts and hooks/core/registry.ts
// exist this file fails to load as a whole.
import { expect, test } from 'claude-code/testing'

import { WALLPAPERS } from '../hooks/core/registry'
import { sceneFor } from '../hooks/core/scene'

type Over = Record<string, unknown>
type Scene = { kind: string; source?: string; alt?: string; id?: string; values?: Record<string, number> }

const calls: unknown[][] = []
const MARK = 'stand-still-picture'
const still = (s: { motion: string }, now: number): string => {
  calls.push([s, now])
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>${MARK}-${s.motion}</title></svg>`
}
const moves = (s: { motion: string }): boolean => s.motion !== 'off'
const colors = () => ({ label: 'Stand' })
const SHADER = {
  id: 'stand',
  label: 'Stand',
  aliases: [],
  kind: 'shader',
  options: [],
  colors,
  svg: still,
  moves,
  values: (s: { own: { stand?: { glow?: number } } }) => ({ glow: s.own.stand?.glow ?? 2, wave: 3 }),
} as never
const FLAT = { id: 'flat', label: 'Flat', aliases: [], kind: 'svg', options: [], colors, svg: still, moves } as never
const ALL = [...WALLPAPERS, SHADER, FLAT] as never

/** `over.hole`, when given, holds the black hole's own settings (size, calm). */
const settings = (over: Over = {}, kiki: Over = {}) => {
  const { hole, ...top } = over as Over & { hole?: Over }
  return {
    on: true,
    wallpaper: 'kiki',
    motion: 'smooth',
    clear: 100,
    blur: 0,
    dim: 30,
    colors: true,
    fps: false,
    ...top,
    own: { kiki: { time: 'night', spinner: true, ...kiki }, blackhole: { size: 'medium', calm: false, ...hole }, stand: {}, flat: {} },
  } as never
}

const local = (h: number, m = 0): number => new Date(2026, 5, 15, h, m, 0).getTime()
const NOON = local(12)
const scene = (over: Over = {}, kiki: Over = {}, wallpapers: unknown = ALL, now = NOON): Scene =>
  sceneFor(settings(over, kiki), wallpapers as never, now) as unknown as Scene

test('off is no scene at all, for every wallpaper', () => {
  for (const wallpaper of ['kiki', 'blackhole', 'stand', 'flat']) {
    expect([wallpaper, scene({ on: false, wallpaper })]).toEqual([wallpaper, { kind: 'none' }])
  }
  for (const motion of ['smooth', 'light', 'off']) expect(scene({ on: false, motion })).toEqual({ kind: 'none' })
})

test('an svg wallpaper is an svg scene: its picture and a label, nothing else', () => {
  for (const wallpaper of ['kiki', 'flat']) {
    const s = scene({ wallpaper })
    expect([wallpaper, s.kind]).toEqual([wallpaper, 'svg'])
    expect([wallpaper, Object.keys(s).sort()]).toEqual([wallpaper, ['alt', 'kind', 'source']])
    expect([wallpaper, typeof s.source, (s.source ?? '').startsWith('<svg')]).toEqual([wallpaper, 'string', true])
    expect([wallpaper, typeof s.alt, (s.alt ?? '').length > 0]).toEqual([wallpaper, 'string', true])
    expect([wallpaper, (s.source ?? '').length <= 131_072]).toEqual([wallpaper, true])
  }
  // The stand-in svg wallpaper's picture is what its `svg` made, from these settings and this time.
  calls.length = 0
  const flat = scene({ wallpaper: 'flat' }, {}, ALL, NOON + 5)
  expect(flat.source).toContain(`${MARK}-smooth`)
  expect(calls.at(-1)?.[1]).toBe(NOON + 5)
  expect((calls.at(-1)?.[0] as { wallpaper: string }).wallpaper).toBe('flat')
})

test('Kiki\'s scene moves with smooth and light and is still with motion off, in the time of day the settings say', () => {
  const smooth = scene({ motion: 'smooth' })
  const light = scene({ motion: 'light' })
  const off = scene({ motion: 'off' })
  expect((smooth.source ?? '').includes('@keyframes')).toBe(true)
  expect((light.source ?? '').includes('@keyframes')).toBe(true)
  expect((off.source ?? '').includes('@keyframes')).toBe(false)
  expect((off.source ?? '').includes('<animate')).toBe(false)
  const phases = ['day', 'sunset', 'night'].map(time => scene({}, { time }).source)
  expect(new Set(phases).size).toBe(3)
  // In auto, the clock's.
  expect(scene({}, { time: 'auto' }, ALL, local(12)).source).toBe(phases[0])
  expect(scene({}, { time: 'auto' }, ALL, local(18, 20)).source).toBe(phases[1])
  expect(scene({}, { time: 'auto' }, ALL, local(23)).source).toBe(phases[2])
})

test('Kiki\'s picture is dimmed by the settings\' dim, the veil painted last inside it, and not at all at 0', () => {
  for (const dim of [10, 30, 55, 80]) {
    const source = scene({ dim }).source ?? ''
    expect([dim, source.endsWith(`<rect width="100%" height="100%" fill="#000" opacity="${dim / 100}"/></svg>`)]).toEqual([dim, true])
  }
  expect((scene({ dim: 0 }).source ?? '').includes('fill="#000" opacity')).toBe(false)
  // Still, too.
  const still = scene({ dim: 30, motion: 'off' }).source ?? ''
  expect(still.endsWith('<rect width="100%" height="100%" fill="#000" opacity="0.3"/></svg>')).toBe(true)
})

test('the black hole is a shader scene with motion on: its five values, and a still picture without animation', () => {
  const smooth = scene({ wallpaper: 'blackhole' })
  expect(smooth.kind).toBe('shader')
  expect(Object.keys(smooth).sort()).toEqual(['alt', 'id', 'kind', 'source', 'values'])
  expect(smooth.id).toBe('blackhole')
  expect(smooth.values).toEqual({ dim: 0.3, speed: 1, fps: 0, calm: 0, size: 1 })
  expect((smooth.source ?? '').startsWith('<svg')).toBe(true)
  expect((smooth.source ?? '').length <= 124_000).toBe(true)
  expect((smooth.source ?? '').includes('@keyframes')).toBe(false)
  expect((smooth.alt ?? '').length > 0).toBe(true)
  const light = scene({ wallpaper: 'blackhole', motion: 'light', fps: true, dim: 80, hole: { size: 'large', calm: true } })
  expect(light.kind).toBe('shader')
  expect(light.values).toEqual({ dim: 0.8, speed: 0.5, fps: 1, calm: 1, size: 1.25 })
  // The same still picture under the shader and alone.
  expect(scene({ wallpaper: 'blackhole', motion: 'off' }).source).toBe(smooth.source)
})

test('the black hole with motion off is an svg scene of the same still picture', () => {
  const off = scene({ wallpaper: 'blackhole', motion: 'off', hole: { size: 'small' } })
  expect(off.kind).toBe('svg')
  expect(Object.keys(off).sort()).toEqual(['alt', 'kind', 'source'])
  expect((off.source ?? '').includes('@keyframes')).toBe(false)
  expect((off.source ?? '').includes('animation')).toBe(false)
  expect((off.alt ?? '').length > 0).toBe(true)
})

test('a shader wallpaper with motion off is an svg scene of its still picture', () => {
  calls.length = 0
  const s = scene({ wallpaper: 'stand', motion: 'off', fps: true }, {}, ALL, NOON + 9)
  expect(s.kind).toBe('svg')
  expect(Object.keys(s).sort()).toEqual(['alt', 'kind', 'source'])
  expect(s.source).toContain(`${MARK}-off`)
  expect((s.alt ?? '').length > 0).toBe(true)
  expect(calls.at(-1)?.[1]).toBe(NOON + 9)
  // Off still wins.
  expect(scene({ wallpaper: 'stand', motion: 'off', on: false })).toEqual({ kind: 'none' })
})

test('a shader wallpaper with motion on is a shader scene: its id, its picture, its own values with dim, speed and fps', () => {
  calls.length = 0
  const s = scene({ wallpaper: 'stand', motion: 'smooth', dim: 30, fps: false }, {}, ALL, NOON + 3)
  expect(s.kind).toBe('shader')
  expect(Object.keys(s).sort()).toEqual(['alt', 'id', 'kind', 'source', 'values'])
  expect(s.id).toBe('stand')
  expect(s.source).toContain(MARK)
  expect((s.source ?? '').startsWith('<svg')).toBe(true)
  expect((s.alt ?? '').length > 0).toBe(true)
  expect(s.values).toEqual({ glow: 2, wave: 3, dim: 0.3, speed: 1, fps: 0 })
  expect(calls.at(-1)?.[1]).toBe(NOON + 3)
})

test('the shader values: dim is the setting over 100 (0 to 0.8), speed 1 for smooth and 0.5 for light, fps 1 or 0', () => {
  const values = (over: Over): Record<string, number> => scene({ wallpaper: 'stand', ...over }).values ?? {}
  expect(values({ dim: 0 }).dim).toBe(0)
  expect(values({ dim: 50 }).dim).toBe(0.5)
  expect(values({ dim: 80 }).dim).toBe(0.8)
  expect(values({ dim: 200 }).dim).toBe(0.8)
  expect(values({ dim: -20 }).dim).toBe(0)
  expect(values({ motion: 'smooth' }).speed).toBe(1)
  expect(values({ motion: 'light' }).speed).toBe(0.5)
  expect(values({ fps: true }).fps).toBe(1)
  expect(values({ fps: false }).fps).toBe(0)
  // A wallpaper's own numbers ride beside them, from its own settings.
  const own = sceneFor({ ...(settings({ wallpaper: 'stand' }) as object), own: { stand: { glow: 7 } } } as never, ALL, NOON) as unknown as Scene
  expect(own.values?.glow).toBe(7)
  expect(own.values?.wave).toBe(3)
  // At most eight names in all would be the wallpaper's: three are the scene's.
  for (const name of Object.keys(values({}))) expect(typeof values({})[name]).toBe('number')
})

test('a wallpaper the settings do not know is Kiki, and an svg scene is the same for the same settings', () => {
  const ghost = scene({ wallpaper: 'ghost' })
  expect(ghost).toEqual(scene({ wallpaper: 'kiki' }))
  expect(ghost.kind).toBe('svg')
  expect(scene({ wallpaper: 'picture' })).toEqual(scene({ wallpaper: 'kiki' }))
  expect(scene({ wallpaper: 'blackhole' })).toEqual(scene({ wallpaper: 'blackhole' }))
  expect(scene({}, {}, WALLPAPERS)).toEqual(scene({}))
})

test('sceneFor changes nothing it is given', () => {
  const s = settings({ wallpaper: 'stand' })
  const before = JSON.stringify(s)
  sceneFor(s, ALL, NOON)
  sceneFor(settings({ on: false }), ALL, NOON)
  expect(JSON.stringify(s)).toBe(before)
})
