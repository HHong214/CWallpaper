// Tests for `/wallpaper ...` text to an action: hooks/core/commands.ts (pure: never throws; junk in gives the
// default out). Written before the code, to the contract in core-contract.md.
//
// NAMES THIS FILE PINS, with their signatures:
//
//   type Action =
//     | { kind: 'status' } | { kind: 'help' } | { kind: 'pane' }
//     | { kind: 'set'; key: string; value: boolean | string | number; also?: Action | Action[] }
//     | { kind: 'error'; message: string }
//     key is the MANIFEST key ('on', 'wallpaper', 'motion', 'clear', 'blur', 'dim', 'colors', 'fps', 'kikiTime',
//     'kikiSpinner'), value a boolean, a string or a whole number (never a string for a number).
//     `also` is the second `set` a wallpaper's name brings when the wallpaper was off: a `set` of on = true, as one
//     action or a list of one. It is left out, undefined or empty when the wallpaper is already on.
//   parseCommand(text: string, settings: Settings, wallpapers: readonly Wallpaper[]): Action
//     Settings and Wallpaper are the shapes of core-options.test.ts and core-registry.test.ts. The words are
//     case-insensitive and may be separated by any spaces. Junk (undefined for the text) is the empty text.
//   statusText(settings: Settings, wallpapers: readonly Wallpaper[]): string       one or two lines
//   helpText(wallpapers: readonly Wallpaper[]): string
//
// Where the contract is silent this file keeps 1.9.0's words: "The wallpaper is Kiki.", "The wallpaper is off.",
// "Panels 40% clear, blur 12, scene dimmed 0%, app colors on, motion smooth.", "Kiki time: night". What 1.9.0 said
// from the clock and the draw ("Last draw", "following the sun") is not a pure function of the settings and is
// not pinned. A stand-in shader wallpaper is built here to show the functions work from the list they are given.
// Until hooks/core/commands.ts and hooks/core/registry.ts exist this file fails to load as a whole.
import { expect, test } from 'claude-code/testing'

import { helpText, parseCommand, statusText } from '../hooks/core/commands'
import { WALLPAPERS } from '../hooks/core/registry'

type Over = Record<string, unknown>

const settings = (over: Over = {}, kiki: Over = {}) =>
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
    own: { kiki: { time: 'auto', spinner: true, ...kiki }, blackhole: {}, stand: { mood: 'calm' } },
  }) as never

const noop = () => undefined
const STAND = {
  id: 'stand',
  label: 'Stand',
  aliases: ['st'],
  kind: 'shader',
  options: [{ key: 'mood', title: 'Stand: mood', description: 'How it feels.', type: 'choice', default: 'calm', choices: ['calm', 'wild'] }],
  colors: noop,
  svg: noop,
  moves: noop,
} as never
const ALL = [...WALLPAPERS, STAND] as never

const run = (text: unknown, over: Over = {}, kiki: Over = {}, wallpapers: unknown = WALLPAPERS) =>
  parseCommand(text as never, settings(over, kiki), wallpapers as never) as unknown as Record<string, unknown>
const alsoOf = (a: Record<string, unknown>): unknown[] => [a.also ?? []].flat()
const ON = { kind: 'set', key: 'on', value: true }

// ------------------------------------------------------- the plain words

test('no words is the status, help is the help, settings is the pane, in any case and spacing', () => {
  for (const text of ['', ' ', '   ', undefined, null]) expect([text, run(text)]).toEqual([text, { kind: 'status' }])
  for (const text of ['help', 'HELP', ' Help ']) expect([text, run(text)]).toEqual([text, { kind: 'help' }])
  for (const text of ['settings', 'Settings', '  SETTINGS']) expect([text, run(text)]).toEqual([text, { kind: 'pane' }])
})

test('on and off set the option `on`', () => {
  expect(run('on')).toEqual({ kind: 'set', key: 'on', value: true })
  expect(run('off')).toEqual({ kind: 'set', key: 'on', value: false })
  expect(run('  ON ')).toEqual({ kind: 'set', key: 'on', value: true })
  expect(run('Off', { on: false })).toEqual({ kind: 'set', key: 'on', value: false })
  // Words after them are not part of the command.
  expect(run('on now').kind).toBe('error')
  expect(run('off please').kind).toBe('error')
})

// ------------------------------------------------------- the wallpapers

test('a wallpaper\'s id or alias sets `wallpaper` to its id, whatever the case', () => {
  for (const [word, id] of [['kiki', 'kiki'], ['KIKI', 'kiki'], ['witch', 'kiki'], ['night', 'kiki'], ['blackhole', 'blackhole'], ['black-hole', 'blackhole'], ['Black-Hole', 'blackhole'], ['hole', 'blackhole']] as const) {
    expect(run(word)).toMatchObject({ kind: 'set', key: 'wallpaper', value: id })
  }
})

test('a wallpaper\'s name also switches the wallpaper on when it was off, and only then', () => {
  expect(alsoOf(run('blackhole', { on: false }))).toEqual([ON])
  expect(alsoOf(run('kiki', { on: false, wallpaper: 'blackhole' }))).toEqual([ON])
  expect(alsoOf(run('hole', { on: false }))).toEqual([ON])
  expect(alsoOf(run('blackhole', { on: true }))).toEqual([])
  expect(alsoOf(run('kiki', { on: true }))).toEqual([])
  // The first action is the wallpaper's own, the second is the switch.
  expect(run('blackhole', { on: false })).toMatchObject({ kind: 'set', key: 'wallpaper', value: 'blackhole' })
})

test('a wallpaper\'s name with words after it is an error', () => {
  expect(run('kiki now').kind).toBe('error')
  expect(run('blackhole please').kind).toBe('error')
})

test('the functions work from the list of wallpapers they are given', () => {
  expect(run('stand', {}, {}, ALL)).toMatchObject({ kind: 'set', key: 'wallpaper', value: 'stand' })
  expect(run('st', {}, {}, ALL)).toMatchObject({ kind: 'set', key: 'wallpaper', value: 'stand' })
  expect(run('stand', {}, {}, WALLPAPERS).kind).toBe('error')
  expect(run('mood wild', { wallpaper: 'stand' }, {}, ALL)).toEqual({ kind: 'set', key: 'standMood', value: 'wild' })
  expect(run('mood wild', { wallpaper: 'stand' }, {}, WALLPAPERS).kind).toBe('error')
})

// ------------------------------------------------------- the common settings

test('motion sets `motion` to smooth, light or off, and nothing else', () => {
  for (const motion of ['smooth', 'light', 'off']) {
    expect([motion, run(`motion ${motion}`)]).toEqual([motion, { kind: 'set', key: 'motion', value: motion }])
  }
  expect(run('MOTION  Light')).toEqual({ kind: 'set', key: 'motion', value: 'light' })
  for (const bad of ['motion', 'motion steps', 'motion smooth light', 'motion 1', 'motion on']) {
    const a = run(bad)
    expect([bad, a.kind]).toEqual([bad, 'error'])
    expect([bad, String(a.message)]).toEqual([bad, expect.stringMatching(/motion/)])
  }
})

test('clear, blur and dim set a whole number inside their range, as a number', () => {
  const dials = [['clear', 0, 100], ['blur', 0, 40], ['dim', 0, 80]] as const
  for (const [key, lo, hi] of dials) {
    expect([key, run(`${key} ${lo}`)]).toEqual([key, { kind: 'set', key, value: lo }])
    expect([key, run(`${key} ${hi}`)]).toEqual([key, { kind: 'set', key, value: hi }])
    expect([key, run(`${key} 12`)]).toEqual([key, { kind: 'set', key, value: 12 }])
    expect([key, typeof run(`${key} 12`).value]).toEqual([key, 'number'])
    expect([key, run(`  ${key.toUpperCase()}   7 `)]).toEqual([key, { kind: 'set', key, value: 7 }])
  }
})

test('a number outside its range, or not a whole number, is an error that names the range', () => {
  const dials = [['clear', 100], ['blur', 40], ['dim', 80]] as const
  for (const [key, hi] of dials) {
    for (const bad of [`${key} ${hi + 1}`, `${key} -1`, `${key} 1000`, `${key} 12.5`, `${key} 0.5`, `${key} abc`, `${key} NaN`, `${key} Infinity`, key, `${key} 10 20`, `${key} ''`]) {
      const a = run(bad)
      expect([bad, a.kind]).toEqual([bad, 'error'])
      expect([bad, typeof a.message]).toEqual([bad, 'string'])
      expect([bad, String(a.message)]).toEqual([bad, expect.stringContaining(key)])
      expect([bad, new RegExp(`\\b0\\b\\D+\\b${hi}\\b`).test(String(a.message))]).toEqual([bad, true])
    }
  }
})

test('colors and fps take on or off, and set a boolean', () => {
  for (const key of ['colors', 'fps']) {
    expect([key, run(`${key} on`)]).toEqual([key, { kind: 'set', key, value: true }])
    expect([key, run(`${key} off`)]).toEqual([key, { kind: 'set', key, value: false }])
    expect([key, run(`${key.toUpperCase()} ON`)]).toEqual([key, { kind: 'set', key, value: true }])
    for (const bad of [key, `${key} maybe`, `${key} on off`, `${key} 1`]) {
      const a = run(bad)
      expect([bad, a.kind]).toEqual([bad, 'error'])
      expect([bad, String(a.message)]).toEqual([bad, expect.stringContaining(key)])
    }
  }
})

// ------------------------------------------------------- a wallpaper's own options

test('the current wallpaper\'s own options are set by their short key, as their manifest key', () => {
  for (const time of ['auto', 'day', 'sunset', 'night']) {
    expect([time, run(`time ${time}`)]).toEqual([time, { kind: 'set', key: 'kikiTime', value: time }])
  }
  expect(run('Time NIGHT')).toEqual({ kind: 'set', key: 'kikiTime', value: 'night' })
  expect(run('spinner off')).toEqual({ kind: 'set', key: 'kikiSpinner', value: false })
  expect(run('spinner on', {}, { spinner: false })).toEqual({ kind: 'set', key: 'kikiSpinner', value: true })
  // While the look is off it is still the wallpaper that is current.
  expect(run('time day', { on: false })).toEqual({ kind: 'set', key: 'kikiTime', value: 'day' })
})

test('a value an own option does not take is an error naming the option', () => {
  for (const bad of ['time', 'time dusk', 'time night day', 'spinner', 'spinner maybe', 'spinner 1']) {
    const a = run(bad)
    expect([bad, a.kind]).toEqual([bad, 'error'])
    expect([bad, String(a.message)]).toEqual([bad, expect.stringMatching(/time|spinner/)])
  }
})

test('an option of another wallpaper says whose it is and which wallpaper is on', () => {
  expect(run('time night', { wallpaper: 'blackhole' })).toEqual({
    kind: 'error',
    message: 'Time of day belongs to Kiki. The wallpaper is Black hole.',
  })
  expect(run('time auto', { wallpaper: 'blackhole' }).message).toBe('Time of day belongs to Kiki. The wallpaper is Black hole.')
  expect(run('spinner off', { wallpaper: 'blackhole' }).message).toBe('Cat spinner belongs to Kiki. The wallpaper is Black hole.')
  // It names the wallpaper that is on, whichever it is.
  expect(run('time night', { wallpaper: 'stand' }, {}, ALL).message).toBe('Time of day belongs to Kiki. The wallpaper is Stand.')
  // Whatever follows the word: the option belongs to Kiki.
  expect(run('time', { wallpaper: 'blackhole' }).kind).toBe('error')
  expect(String(run('time', { wallpaper: 'blackhole' }).message)).toMatch(/belongs to Kiki/)
})

// ------------------------------------------------------- what was removed, and what is unknown

test('picture and video say they were removed and that wallpapers are now made in the repository', () => {
  for (const text of ['picture C:/Pictures/harbour.png', 'picture "C:/My Pictures/harbour at night.png"', 'video C:/Videos/waves.mp4', 'Video a.gif', 'picture', 'video']) {
    const a = run(text)
    expect([text, a.kind]).toEqual([text, 'error'])
  }
  for (const text of ['picture C:/Pictures/harbour.png', 'picture "C:/My Pictures/harbour at night.png"', 'video C:/Videos/waves.mp4', 'Video a.gif']) {
    const message = String(run(text).message)
    expect([text, /picture/i.test(message)]).toEqual([text, true])
    expect([text, /video/i.test(message)]).toEqual([text, true])
    expect([text, /removed/i.test(message)]).toEqual([text, true])
    expect([text, /repository/i.test(message)]).toEqual([text, true])
  }
})

test('anything else is an error that names what was typed and points to /wallpaper help', () => {
  for (const text of ['moonbase', 'valley', 'pixel-valley', 'delivery', 'refresh', 'auto', 'city Birmingham', 'MoonBase now']) {
    const a = run(text)
    expect([text, a.kind]).toEqual([text, 'error'])
    const message = String(a.message)
    expect([text, message.toLowerCase().includes((text.split(' ')[0] ?? '').toLowerCase())]).toEqual([text, true])
    expect([text, message.includes('/wallpaper help')]).toEqual([text, true])
  }
})

test('parseCommand is pure: it changes nothing it is given and never throws on odd input', () => {
  const s = settings({ wallpaper: 'blackhole' })
  const before = JSON.stringify(s)
  parseCommand('time night', s, WALLPAPERS as never)
  parseCommand('blackhole', s, WALLPAPERS as never)
  expect(JSON.stringify(s)).toBe(before)
  expect(run('clear 40')).toEqual(run('clear 40'))
  for (const odd of [5, {}, [], true, '\n', '\t on', 'on\n', 'x'.repeat(5000), '"', '/wallpaper on']) {
    expect([String(odd).slice(0, 12), typeof run(odd).kind]).toEqual([String(odd).slice(0, 12), 'string'])
  }
})

// ------------------------------------------------------- the status and help texts

const lines = (text: string): string[] => text.split('\n').filter(l => l.trim() !== '')

test('the status says which wallpaper, the common settings and Kiki\'s time, in one or two lines', () => {
  const text = statusText(settings({ clear: 40, blur: 12, dim: 0 }, { time: 'night' }), WALLPAPERS as never)
  expect(typeof text).toBe('string')
  expect(lines(text).length >= 1 && lines(text).length <= 2).toBe(true)
  expect(text).toMatch(/The wallpaper is Kiki\./)
  expect(text).toMatch(/Panels 40% clear, blur 12, scene dimmed 0%, app colors on, motion smooth\./)
  expect(text).toMatch(/Kiki time: night/)
  expect(statusText(settings({}, { time: 'auto' }), WALLPAPERS as never)).toMatch(/Kiki time: auto/)
})

test('the status follows the motion and the app colors, and says the wallpaper is off when it is', () => {
  for (const motion of ['smooth', 'light', 'off']) {
    expect([motion, statusText(settings({ motion }), WALLPAPERS as never)]).toEqual([motion, expect.stringMatching(new RegExp(`motion ${motion}\\b`))])
  }
  expect(statusText(settings({ colors: false }), WALLPAPERS as never)).toMatch(/app colors off/)
  const off = statusText(settings({ on: false }), WALLPAPERS as never)
  expect(off).toMatch(/The wallpaper is off/)
  expect(lines(off).length >= 1 && lines(off).length <= 2).toBe(true)
})

test('the status of the black hole names it and has no Kiki time', () => {
  const text = statusText(settings({ wallpaper: 'blackhole', clear: 90 }, { time: 'night' }), WALLPAPERS as never)
  expect(text).toMatch(/The wallpaper is Black hole\./)
  expect(text).toMatch(/Panels 90% clear/)
  expect(/Kiki time|time of day/i.test(text)).toBe(false)
  expect(lines(text).length >= 1 && lines(text).length <= 2).toBe(true)
  // Another wallpaper's own settings are shown by that wallpaper alone.
  expect(statusText(settings({ wallpaper: 'stand' }), ALL)).toMatch(/The wallpaper is Stand\./)
})

test('no status or help text speaks of a picture or a video', () => {
  const texts = [
    helpText(WALLPAPERS as never),
    helpText(ALL),
    statusText(settings(), WALLPAPERS as never),
    statusText(settings({ on: false }), WALLPAPERS as never),
    statusText(settings({ wallpaper: 'blackhole', fps: true }), WALLPAPERS as never),
  ]
  for (const text of texts) {
    expect(/picture|video|ffmpeg/i.test(text)).toBe(false)
  }
})

test('the help lists every command and the wallpapers by name', () => {
  const help = helpText(WALLPAPERS as never)
  expect(typeof help).toBe('string')
  expect(help).toMatch(/\/wallpaper/)
  for (const word of ['settings', 'help', 'kiki', 'blackhole', 'motion', 'clear', 'blur', 'dim', 'colors', 'fps', 'time', 'spinner']) {
    expect([word, help.includes(word)]).toEqual([word, true])
  }
  expect(/\bon\b/.test(help) && /\boff\b/.test(help)).toBe(true)
  expect(help.includes('black-hole') && help.includes('hole')).toBe(true)
  // The valley and its words are gone.
  expect(/valley|weather/i.test(help)).toBe(false)
})

test('the help is made from the wallpapers it is given', () => {
  const help = helpText(ALL)
  expect(help.includes('stand')).toBe(true)
  expect(help.includes('mood')).toBe(true)
  const plain = helpText(WALLPAPERS as never)
  expect(plain.includes('stand') || plain.includes('mood')).toBe(false)
})
