// Tests for the wallpapers and how to find one: hooks/core/registry.ts, with the two wallpapers it lists,
// hooks/wallpapers/kiki/index.ts (exports `kiki`) and hooks/wallpapers/blackhole/index.ts (exports `blackhole`).
// Written before the code, to the contract in core-contract.md.
//
// NAMES THIS FILE PINS, with their signatures:
//
//   type Wallpaper = {
//     id: string; label: string; aliases: readonly string[]
//     kind: 'svg' | 'shader'                        'svg': the app animates the SVG itself; 'shader': a GPU shader
//                                                   over a still SVG
//     options: readonly OptionSpec[]                its own options, with SHORT keys ('time'); see core-options.test.ts
//     colors(settings: Settings): object            what `makeColors` takes (its `label`, its `roles`)
//     svg(settings: Settings, now: number): string  the SVG, at most 124,000 characters; `now` is epoch milliseconds
//     moves(settings: Settings): boolean            false when settings.motion is 'off'
//     values?(settings: Settings): Record<string, number>     a shader wallpaper's numbers, at most 8 names
//     scene?: unknown                               (not pinned)
//   }
//   WALLPAPERS: readonly Wallpaper[]                [kiki, blackhole], Kiki first (the default)
//   findWallpaper(name: string): Wallpaper | undefined      by id or alias, whatever the letter case
//   kiki: Wallpaper                                 from hooks/wallpapers/kiki/index.ts
//   blackhole: Wallpaper                            from hooks/wallpapers/blackhole/index.ts; its `svg` is the builder
//                                                   `blackhole({ motion, dim })` of hooks/wallpapers/blackhole/svg.ts
//
// Settings are built by hand below (the shape of core-options.test.ts), so this file needs the registry, the
// two wallpapers and the black hole's builder; until they exist it fails to load as a whole. What is NOT pinned
// here: where the dimming veil of a Kiki picture is laid (the scene's test pins what the Backdrop shows), and
// `scene`.
import { expect, test } from 'claude-code/testing'

import { WALLPAPERS, findWallpaper } from '../hooks/core/registry'
import { kiki } from '../hooks/wallpapers/kiki/index'
import { blackhole } from '../hooks/wallpapers/blackhole/index'
import { blackhole as blackholeSvg } from '../hooks/wallpapers/blackhole/svg'

const CAP = 124_000
type Over = Record<string, unknown>

/** Settings as `readSettings({})` would give them, with Kiki fixed to the night unless told otherwise. */
const settings = (over: Over = {}, own: Over = {}) =>
  ({
    on: true,
    wallpaper: 'kiki',
    motion: 'smooth',
    clear: 100,
    blur: 0,
    dim: 30,
    colors: true,
    fps: false,
    ...over,
    own: { kiki: { time: 'night', spinner: true, ...(own.kiki as Over | undefined) }, blackhole: {} },
  }) as never

const local = (h: number, m = 0): number => new Date(2026, 5, 15, h, m, 0).getTime()
const NOON = local(12)

test('WALLPAPERS lists Kiki first and the black hole second, as 1.9.0 names them', () => {
  expect(WALLPAPERS.map(w => w.id)).toEqual(['kiki', 'blackhole'])
  expect(WALLPAPERS.map(w => w.label)).toEqual(['Kiki', 'Black hole'])
  expect(WALLPAPERS[0]).toBe(kiki)
  expect(WALLPAPERS[1]).toBe(blackhole)
  for (const w of WALLPAPERS) {
    expect(w.kind).toBe('svg')
    expect(Array.isArray(w.aliases)).toBe(true)
    expect(Array.isArray(w.options)).toBe(true)
    expect(typeof w.colors).toBe('function')
    expect(typeof w.svg).toBe('function')
    expect(typeof w.moves).toBe('function')
  }
})

test('Kiki\'s own options are time and spinner, with their kinds, choices and defaults; the black hole has none yet', () => {
  expect(kiki.options.map(o => o.key)).toEqual(['time', 'spinner'])
  expect(kiki.options[0]).toMatchObject({ type: 'choice', default: 'auto', choices: ['auto', 'day', 'sunset', 'night'] })
  expect(kiki.options[1]).toMatchObject({ type: 'boolean', default: true })
  for (const o of kiki.options) {
    expect(typeof o.title).toBe('string')
    expect(typeof o.description).toBe('string')
    expect(o.description.length > 0).toBe(true)
  }
  expect(blackhole.options).toEqual([])
})

test('the aliases include 1.9.0\'s words, and no word is two wallpapers\' or a command\'s', () => {
  expect(kiki.aliases).toContain('witch')
  expect(kiki.aliases).toContain('night')
  expect(blackhole.aliases).toContain('black-hole')
  expect(blackhole.aliases).toContain('hole')
  const words = WALLPAPERS.flatMap(w => [w.id, ...w.aliases].map(a => a.toLowerCase()))
  expect(new Set(words).size).toBe(words.length)
  const commands = ['on', 'off', 'help', 'settings', 'motion', 'clear', 'blur', 'dim', 'colors', 'fps', 'time', 'spinner', 'picture', 'video']
  for (const c of commands) expect([c, words.includes(c)]).toEqual([c, false])
})

test('findWallpaper finds by id or alias, whatever the letter case', () => {
  for (const name of ['kiki', 'Kiki', 'KIKI', 'witch', 'Witch', 'night', 'NIGHT']) expect([name, findWallpaper(name)]).toEqual([name, kiki])
  for (const name of ['blackhole', 'BlackHole', 'black-hole', 'Black-Hole', 'hole', 'HOLE']) expect([name, findWallpaper(name)]).toEqual([name, blackhole])
  expect(findWallpaper('black-hole')?.id).toBe('blackhole')
  expect(findWallpaper('hole')?.id).toBe('blackhole')
})

test('findWallpaper gives undefined for what is not a wallpaper (picture and video among them), and never throws', () => {
  for (const name of ['', ' ', 'picture', 'video', 'my-picture', 'my-video', 'pixel-valley', 'moonbase', 'on']) {
    expect([name, findWallpaper(name)]).toEqual([name, undefined])
  }
  for (const junk of [undefined, null, 5, true, {}, []]) expect([junk, findWallpaper(junk as never)]).toEqual([junk, undefined])
})

test('colors gives what makeColors takes: Kiki\'s night indigo with its violet accent, the black hole\'s own with amber', () => {
  const k = kiki.colors(settings()) as { label?: string; roles?: { accent?: string } }
  const h = blackhole.colors(settings({ wallpaper: 'blackhole' })) as { label?: string; roles?: { accent?: string } }
  expect(k.label).toBe('Kiki night')
  expect(k.roles?.accent).toBe('#7c6bd0')
  expect(h.label).toBe('Black hole')
  expect(h.roles?.accent).toBe('#f0a020')
})

test('svg gives one SVG of at most 124,000 characters, for every motion, and the same one for the same settings', () => {
  for (const w of WALLPAPERS) {
    for (const motion of ['smooth', 'light', 'off']) {
      for (const time of ['day', 'sunset', 'night']) {
        const s = settings({ wallpaper: w.id, motion }, { kiki: { time } })
        const svg = w.svg(s, NOON)
        expect([w.id, motion, time, typeof svg]).toEqual([w.id, motion, time, 'string'])
        expect([w.id, motion, time, svg.startsWith('<svg')]).toEqual([w.id, motion, time, true])
        expect([w.id, motion, time, svg.trimEnd().endsWith('</svg>')]).toEqual([w.id, motion, time, true])
        expect([w.id, motion, time, svg.length <= CAP]).toEqual([w.id, motion, time, true])
        expect(w.svg(s, NOON) === svg).toBe(true)
      }
    }
  }
})

test('with motion off the SVG holds no animation, and with smooth or light it does', () => {
  for (const w of WALLPAPERS) {
    const off = w.svg(settings({ wallpaper: w.id, motion: 'off' }), NOON)
    expect([w.id, off.includes('@keyframes')]).toEqual([w.id, false])
    expect([w.id, off.includes('<animate')]).toEqual([w.id, false])
    expect([w.id, off.includes('animation')]).toEqual([w.id, false])
    for (const motion of ['smooth', 'light']) {
      expect([w.id, motion, w.svg(settings({ wallpaper: w.id, motion }), NOON).includes('@keyframes')]).toEqual([w.id, motion, true])
    }
  }
})

test('moves is false with motion off and true otherwise', () => {
  for (const w of WALLPAPERS) {
    expect([w.id, 'off', w.moves(settings({ wallpaper: w.id, motion: 'off' }))]).toEqual([w.id, 'off', false])
    expect([w.id, 'smooth', w.moves(settings({ wallpaper: w.id, motion: 'smooth' }))]).toEqual([w.id, 'smooth', true])
    expect([w.id, 'light', w.moves(settings({ wallpaper: w.id, motion: 'light' }))]).toEqual([w.id, 'light', true])
  }
})

test('Kiki shows the time of day the settings choose: three different pictures, and in auto the one the clock is in', () => {
  const at = (time: string, now = NOON) => kiki.svg(settings({}, { kiki: { time } }), now)
  const day = at('day')
  const sunset = at('sunset')
  const night = at('night')
  expect(new Set([day, sunset, night]).size).toBe(3)
  // The chosen time does not depend on the clock.
  expect(at('day', local(23))).toBe(day)
  expect(at('night', local(12))).toBe(night)
  // Auto: the machine's clock and the default sun times (06:30 and 18:30), as 1.9.0 followed them with no place known.
  expect(at('auto', local(12))).toBe(day)
  expect(at('auto', local(18, 20))).toBe(sunset)
  expect(at('auto', local(23))).toBe(night)
  expect(at('auto', local(3))).toBe(night)
})

test('Kiki at night with motion light rests the shooting star and keeps the rest, so light differs from smooth and is smaller', () => {
  const smooth = kiki.svg(settings({ motion: 'smooth' }), NOON)
  const light = kiki.svg(settings({ motion: 'light' }), NOON)
  expect(light === smooth).toBe(false)
  expect(light.length < smooth.length).toBe(true)
})

test('the black hole\'s svg is the builder\'s picture for the motion and the dimming in the settings', () => {
  for (const motion of ['smooth', 'light', 'off'] as const) {
    for (const dim of [0, 30, 80]) {
      const got = blackhole.svg(settings({ wallpaper: 'blackhole', motion, dim }), NOON)
      expect([motion, dim, got === blackholeSvg({ motion, dim })]).toEqual([motion, dim, true])
    }
  }
  // The clock does not matter to it.
  expect(blackhole.svg(settings({ wallpaper: 'blackhole' }), local(3))).toBe(blackhole.svg(settings({ wallpaper: 'blackhole' }), local(15)))
})
