// Tests for the option model: hooks/core/options.ts (pure: no engine import, no clock, no store, never throws;
// junk in gives the default out). Written before the code, to the contract in core-contract.md.
//
// NAMES THIS FILE PINS, with their signatures:
//
//   type OptionSpec = {
//     key: string                                  the manifest key ('motion', 'kikiTime'); a wallpaper's own option
//                                                  keeps its SHORT key ('time') in `Wallpaper.options`
//     title: string; description: string           plain strings, title as /config shows it
//     type: 'boolean' | 'choice' | 'number'        a choice is `type: 'string'` with `options` in the manifest only
//     default: boolean | string | number
//     choices?: readonly string[]                  a choice only
//     min?: number; max?: number                   a number only
//   }
//   COMMON: readonly OptionSpec[]                  the seven common options, in this order: wallpaper, on, motion,
//                                                  clear, blur, dim, colors (there is no `fps`: the frames-a-second
//                                                  count was removed). `wallpaper` has type 'choice' and
//                                                  default 'kiki'; the registered ids are its `choices` only in
//                                                  optionSpecs' answer (COMMON itself does not know the registry).
//   optionSpecs(wallpapers: readonly { id: string; label: string; options: readonly OptionSpec[] }[]): OptionSpec[]
//                                                  common first, then each wallpaper's own, in the order given. A
//                                                  wallpaper's own option becomes key `<id><Key>` (kiki + time =
//                                                  kikiTime) and a title that starts with `<label>: `. The common
//                                                  `wallpaper` option gets `choices` = the ids, in order. COMMON is
//                                                  never changed by a call.
//   readSettings(options: unknown, wallpapers: readonly { id: string; options: readonly OptionSpec[] }[]): Settings
//     Settings = { on: boolean; wallpaper: string; motion: 'smooth' | 'light' | 'off'; clear: number;
//                  blur: number; dim: number; colors: boolean;      (no `fps`, whatever an old stored option holds)
//                  own: Record<wallpaperId, Record<shortKey, boolean | string | number>> }
//     reads the manifest keys of `options` (the object the engine hands `register(on, options)`). A missing,
//     mistyped or unknown value reads as its default; a finite number is rounded to a whole number and clamped
//     into its range (NaN and the infinities are junk: the default); an unknown wallpaper id reads as 'kiki'.
//     `own` has one entry per wallpaper id (an empty one when it has no options). Never throws, never changes
//     what it is given.
//
// Stand-in wallpapers are built here, so this file needs only hooks/core/options (until it exists, the file
// fails to load as a whole).
import { expect, test } from 'claude-code/testing'

import { COMMON, optionSpecs, readSettings } from '../hooks/core/options'

const noop = () => undefined
const KIKI = {
  id: 'kiki',
  label: 'Kiki',
  aliases: ['witch'],
  kind: 'svg',
  options: [
    { key: 'time', title: 'Kiki: time of day', description: 'Which part of the day Kiki shows.', type: 'choice', default: 'auto', choices: ['auto', 'day', 'sunset', 'night'] },
    { key: 'spinner', title: 'Kiki: cat spinner', description: 'A cat face on the spinner.', type: 'boolean', default: true },
  ],
  colors: noop,
  svg: noop,
  moves: noop,
} as never
const HOLE = {
  id: 'blackhole',
  label: 'Black hole',
  aliases: ['hole'],
  kind: 'svg',
  options: [{ key: 'speed', title: 'Black hole: speed', description: 'How fast it turns.', type: 'number', default: 5, min: 1, max: 9 }],
  colors: noop,
  svg: noop,
  moves: noop,
} as never
const WALLPAPERS = [KIKI, HOLE] as never

const DEFAULTS = {
  on: true,
  wallpaper: 'kiki',
  motion: 'smooth',
  clear: 100,
  blur: 0,
  dim: 30,
  colors: true,
  own: { kiki: { time: 'auto', spinner: true }, blackhole: { speed: 5 } },
}

const read = (options: unknown) => readSettings(options as never, WALLPAPERS)

// ------------------------------------------------------------------ COMMON

test('COMMON lists the seven common options in order, with the titles and kinds the contract gives', () => {
  expect(COMMON.map(o => o.key)).toEqual(['wallpaper', 'on', 'motion', 'clear', 'blur', 'dim', 'colors'])
  expect(COMMON.length).toBe(7)
  expect(COMMON.map(o => o.type)).toEqual(['choice', 'boolean', 'choice', 'number', 'number', 'number', 'boolean'])
  expect(COMMON.map(o => o.title)).toEqual([
    'Wallpaper',
    'Wallpaper: on',
    'Motion',
    'Panels: how clear',
    'Panels: blur',
    'Scene: dim',
    'App colors follow the wallpaper',
  ])
  for (const o of COMMON) {
    expect(typeof o.description).toBe('string')
    expect(o.description.length > 0).toBe(true)
  }
})

test('the fps option is gone, and no description names /wallpaper or the frames a second', () => {
  expect(COMMON.find(o => o.key === 'fps')).toBeUndefined()
  expect(COMMON.some(o => o.title === 'Show FPS')).toBe(false)
  expect(optionSpecs(WALLPAPERS).find(s => s.key === 'fps')).toBeUndefined()
  for (const s of optionSpecs(WALLPAPERS)) expect([s.key, /fps|frames a second|frame rate/i.test(`${s.title} ${s.description}`)]).toEqual([s.key, false])
  for (const o of COMMON) expect([o.key, o.description.includes('/wallpaper')]).toEqual([o.key, false])
  for (const s of optionSpecs(WALLPAPERS)) expect([s.key, s.description.includes('/wallpaper')]).toEqual([s.key, false])
})

test('COMMON holds 1.9.0\'s defaults, the motion choices and the three ranges', () => {
  const by = (key: string) => COMMON.find(o => o.key === key)
  expect(COMMON.map(o => o.default)).toEqual(['kiki', true, 'smooth', 100, 0, 30, true])
  expect(by('motion')?.choices).toEqual(['smooth', 'light', 'off'])
  expect([by('clear')?.min, by('clear')?.max]).toEqual([0, 100])
  expect([by('blur')?.min, by('blur')?.max]).toEqual([0, 40])
  expect([by('dim')?.min, by('dim')?.max]).toEqual([0, 80])
  // Only a choice has choices (the wallpaper's are the registry's to give), only a number has a range.
  for (const o of COMMON) {
    if (o.key !== 'wallpaper') expect([o.key, o.choices !== undefined]).toEqual([o.key, o.type === 'choice'])
    expect([o.key, o.min !== undefined && o.max !== undefined]).toEqual([o.key, o.type === 'number'])
  }
})

// ------------------------------------------------------------- optionSpecs

test('optionSpecs lists the common options first, then each wallpaper\'s own under `<id><Key>`, in order', () => {
  const specs = optionSpecs(WALLPAPERS)
  expect(specs.map(s => s.key)).toEqual([...COMMON.map(o => o.key), 'kikiTime', 'kikiSpinner', 'blackholeSpeed'])
  // The common options are COMMON's, except that `wallpaper` knows the registered ids.
  for (const [i, o] of COMMON.entries()) {
    expect(specs[i]).toMatchObject({ key: o.key, title: o.title, type: o.type, default: o.default })
  }
  expect(specs[0]?.choices).toEqual(['kiki', 'blackhole'])
})

test('optionSpecs gives a wallpaper\'s own options a title that starts with its label and a colon, and keeps their kinds', () => {
  const specs = optionSpecs(WALLPAPERS)
  const own = (key: string) => specs.find(s => s.key === key)
  expect(own('kikiTime')).toMatchObject({ type: 'choice', default: 'auto', choices: ['auto', 'day', 'sunset', 'night'] })
  expect(own('kikiSpinner')).toMatchObject({ type: 'boolean', default: true })
  expect(own('blackholeSpeed')).toMatchObject({ type: 'number', default: 5, min: 1, max: 9 })
  expect(own('kikiTime')?.title).toMatch(/^Kiki: /)
  expect(own('kikiSpinner')?.title).toMatch(/^Kiki: /)
  expect(own('blackholeSpeed')?.title).toMatch(/^Black hole: /)
  for (const key of ['kikiTime', 'kikiSpinner', 'blackholeSpeed']) {
    expect(typeof own(key)?.description).toBe('string')
    expect((own(key)?.description ?? '').length > 0).toBe(true)
  }
})

test('optionSpecs follows the order of the wallpapers it is given, and leaves COMMON alone', () => {
  const before = JSON.stringify(COMMON)
  const flipped = optionSpecs([HOLE, KIKI] as never)
  expect(flipped.map(s => s.key).slice(7)).toEqual(['blackholeSpeed', 'kikiTime', 'kikiSpinner'])
  expect(flipped[0]?.choices).toEqual(['blackhole', 'kiki'])
  optionSpecs(WALLPAPERS)
  expect(JSON.stringify(COMMON)).toBe(before)
  // No wallpaper, no own options, no throw.
  expect(optionSpecs([] as never).map(s => s.key)).toEqual(COMMON.map(o => o.key))
})

// ------------------------------------------------------------ readSettings

test('readSettings gives 1.9.0\'s defaults for no options and for junk in place of them', () => {
  for (const junk of [undefined, null, 'text', 7, true, [], {}, () => 1]) {
    expect([junk, read(junk)]).toEqual([junk, DEFAULTS])
  }
  expect(Object.keys(read({})).sort()).toEqual(['blur', 'clear', 'colors', 'dim', 'motion', 'on', 'own', 'wallpaper'])
})

test('readSettings reads every valid value as given', () => {
  const got = read({
    wallpaper: 'blackhole', on: false, motion: 'light', clear: 40, blur: 12, dim: 0, colors: false,
    kikiTime: 'night', kikiSpinner: false, blackholeSpeed: 8,
  })
  expect(got).toEqual({
    on: false, wallpaper: 'blackhole', motion: 'light', clear: 40, blur: 12, dim: 0, colors: false,
    own: { kiki: { time: 'night', spinner: false }, blackhole: { speed: 8 } },
  })
  for (const motion of ['smooth', 'light', 'off']) expect(read({ motion }).motion).toBe(motion)
  for (const time of ['auto', 'day', 'sunset', 'night']) expect(read({ kikiTime: time }).own).toMatchObject({ kiki: { time } })
})

test('readSettings clamps a number into its range and rounds it to a whole number', () => {
  const dials = [
    ['clear', 0, 100, 100],
    ['blur', 0, 40, 0],
    ['dim', 0, 80, 30],
  ] as const
  for (const [key, lo, hi] of dials) {
    expect([key, read({ [key]: lo })[key]]).toEqual([key, lo])
    expect([key, read({ [key]: hi })[key]]).toEqual([key, hi])
    expect([key, read({ [key]: lo - 5 })[key]]).toEqual([key, lo])
    expect([key, read({ [key]: hi + 1 })[key]]).toEqual([key, hi])
    expect([key, read({ [key]: 100000 })[key]]).toEqual([key, hi])
    expect([key, read({ [key]: -100000 })[key]]).toEqual([key, lo])
  }
  expect(read({ clear: 40.4 }).clear).toBe(40)
  expect(read({ clear: 40.6 }).clear).toBe(41)
  expect(read({ blur: 12.6 }).blur).toBe(13)
  expect(read({ dim: 79.6 }).dim).toBe(80)
  expect(read({ dim: 80.4 }).dim).toBe(80)
})

test('readSettings reads a mistyped or non-finite number as the default', () => {
  const dials = [['clear', 100], ['blur', 0], ['dim', 30]] as const
  for (const [key, fallback] of dials) {
    for (const junk of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '50', '', true, null, [], {}, undefined]) {
      expect([key, junk, read({ [key]: junk })[key]]).toEqual([key, junk, fallback])
    }
  }
})

test('readSettings reads a mistyped boolean as its default (on and colors true)', () => {
  for (const junk of ['yes', 'false', 0, 1, null, [], {}]) {
    expect([junk, read({ on: junk }).on]).toEqual([junk, true])
    expect([junk, read({ colors: junk }).colors]).toEqual([junk, true])
  }
})

test('readSettings ignores an fps value still stored in old options, whatever it holds', () => {
  for (const stored of [true, false, 1, 0, 'on', 'yes', null, [], {}, 42, Number.NaN]) {
    const got = read({ fps: stored })
    expect([stored, 'fps' in got]).toEqual([stored, false])
    expect([stored, got]).toEqual([stored, DEFAULTS])
  }
  // Beside valid options it changes nothing of them.
  const mixed = read({ fps: true, motion: 'light', dim: 10, kikiTime: 'night' })
  expect('fps' in mixed).toBe(false)
  expect(mixed).toEqual({ ...DEFAULTS, motion: 'light', dim: 10, own: { kiki: { time: 'night', spinner: true }, blackhole: { speed: 5 } } })
  expect(Object.keys(mixed).sort()).toEqual(['blur', 'clear', 'colors', 'dim', 'motion', 'on', 'own', 'wallpaper'])
})

test('readSettings reads a choice outside its choices as its default', () => {
  for (const junk of ['steps', 'Smooth', '', 5, true, null, []]) {
    expect([junk, read({ motion: junk }).motion]).toEqual([junk, 'smooth'])
    expect([junk, read({ kikiTime: junk }).own]).toEqual([junk, DEFAULTS.own])
  }
})

test('readSettings reads an unknown wallpaper as kiki (picture and video among them)', () => {
  for (const unknown of ['picture', 'video', 'my-picture', 'my-video', 'pixel-valley', 'nothing', '', 'KIKI ', 5, null, true, ['kiki']]) {
    expect([unknown, read({ wallpaper: unknown }).wallpaper]).toEqual([unknown, 'kiki'])
  }
  expect(read({ wallpaper: 'kiki' }).wallpaper).toBe('kiki')
  expect(read({ wallpaper: 'blackhole' }).wallpaper).toBe('blackhole')
  // A wallpaper that is registered is known, whatever it is called.
  const stand = { id: 'stand', label: 'Stand', aliases: [], kind: 'shader', options: [], colors: noop, svg: noop, moves: noop } as never
  expect(readSettings({ wallpaper: 'stand' } as never, [KIKI, stand] as never).wallpaper).toBe('stand')
  expect(readSettings({ wallpaper: 'blackhole' } as never, [KIKI, stand] as never).wallpaper).toBe('kiki')
})

test('readSettings reads a wallpaper\'s own options from their manifest keys, with the same rules', () => {
  expect(read({ blackholeSpeed: 1 }).own).toMatchObject({ blackhole: { speed: 1 } })
  expect(read({ blackholeSpeed: 9 }).own).toMatchObject({ blackhole: { speed: 9 } })
  expect(read({ blackholeSpeed: 0 }).own).toMatchObject({ blackhole: { speed: 1 } })
  expect(read({ blackholeSpeed: 20 }).own).toMatchObject({ blackhole: { speed: 9 } })
  expect(read({ blackholeSpeed: 4.6 }).own).toMatchObject({ blackhole: { speed: 5 } })
  expect(read({ blackholeSpeed: 2.2 }).own).toMatchObject({ blackhole: { speed: 2 } })
  for (const junk of ['fast', Number.NaN, Number.POSITIVE_INFINITY, null, true, []]) {
    expect([junk, read({ blackholeSpeed: junk }).own]).toEqual([junk, DEFAULTS.own])
  }
  // The short key alone, or another wallpaper's key, is not an option.
  expect(read({ time: 'night', speed: 9, spinner: false }).own).toEqual(DEFAULTS.own)
  expect(read({ blackholeTime: 'night' }).own).toEqual(DEFAULTS.own)
})

test('readSettings gives every wallpaper an entry in own, an empty one when it has no options', () => {
  const stand = { id: 'stand', label: 'Stand', aliases: [], kind: 'shader', options: [], colors: noop, svg: noop, moves: noop } as never
  const got = readSettings({} as never, [KIKI, stand] as never)
  expect(Object.keys(got.own)).toEqual(['kiki', 'stand'])
  expect(got.own.stand).toEqual({})
  expect(readSettings({} as never, [] as never).own).toEqual({})
})

test('readSettings is pure: the same options give equal settings, it changes nothing it is given, and each call is its own', () => {
  const given = Object.freeze({ wallpaper: 'blackhole', clear: 12.4, dim: 500, kikiTime: 'night' })
  expect(read(given)).toEqual(read(given))
  expect(given).toEqual({ wallpaper: 'blackhole', clear: 12.4, dim: 500, kikiTime: 'night' })
  const a = read({}) as { clear: number; own: { kiki: { time: string } } }
  a.clear = 5
  a.own.kiki.time = 'night'
  expect(read({})).toEqual(DEFAULTS)
})
