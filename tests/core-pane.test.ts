// Tests for which rows the settings pane shows: hooks/core/pane.ts (pure: never throws). Written before the
// code, to the contract in core-contract.md. The contract names the rows but not their data, so the shape below is
// this file's own and is what the builder works to.
//
// NAMES THIS FILE PINS, with their signatures:
//
//   type Control = {
//     key: string                          the MANIFEST key it writes ('wallpaper', 'motion', 'clear', 'kikiTime', ...)
//     value: boolean | string | number     the value pressing it writes (for a toggle, the opposite of today's)
//     label: string                        what the button says
//     current?: boolean                    true on the button whose value is the setting's today (choices only)
//     also?: { key: 'on'; value: true }    on a WALLPAPER's control only, and only while settings.on is false: the
//                                          second write a press makes (`wallpaper` first, then `on`), as the command
//                                          does; absent on every other control and whenever settings.on is true
//   }
//   type PaneRow =
//     | { kind: 'controls'; label: string; controls: Control[] }     a row of buttons, left to right
//     | { kind: 'heading'; text: string }
//     | { kind: 'note'; text: string }
//   paneRows(settings: Settings, wallpapers: readonly Wallpaper[]): PaneRow[]
//     plain data (JSON-safe), in this order:
//       1. one control per wallpaper (key 'wallpaper', value its id, label its label); only the current one is
//          `current`; each carries `also` while the wallpaper is off
//       2. on/off: ONE control, key 'on', value = !settings.on
//       3. motion: three controls, values smooth, light, off; the setting's is `current`
//       4. clear, 5. blur, 6. dim: two controls each, [minus, plus], labelled '-' and '+', with the value they would
//          write: the setting less / plus 1.9.0's step (clear 10, blur 4, dim 10), held inside the range (0-100,
//          0-40, 0-80), so at an end the button writes the end again
//       7. app colors: ONE control, key 'colors', value = !settings.colors
//       (there is no Show FPS row and no note row about the frame rate: the frames-a-second count was removed)
//      10. a heading whose text holds the current wallpaper's label (always, even when it has no options)
//      11. the current wallpaper's own options only, in its order, each one row under its manifest key
//          (`<id><Key>`): a choice is one control per choice with the setting's `current`; a boolean is one toggle
//          (value = !today's). No row of any other wallpaper's options.
//   An unknown settings.wallpaper reads as the first wallpaper (Kiki).
//
// The Button's key in the mod is `<key>:<value>` ('wallpaper:blackhole', 'clear:90'): core-backdrop.test.tsx pins it.
// A stand-in shader wallpaper with a choice option is built here. Until hooks/core/pane.ts and
// hooks/core/registry.ts exist this file fails to load as a whole.
import { expect, test } from 'claude-code/testing'

import { paneRows } from '../hooks/core/pane'
import { WALLPAPERS } from '../hooks/core/registry'

type Over = Record<string, unknown>
type Control = { key: string; value: unknown; label: string; current?: boolean }
type Row = { kind: string; label?: string; text?: string; controls?: Control[] }

const noop = () => undefined
const STAND = {
  id: 'stand',
  label: 'Stand',
  aliases: [],
  kind: 'shader',
  options: [
    { key: 'mood', title: 'Stand: mood', description: 'How it feels.', type: 'choice', default: 'calm', choices: ['calm', 'wild'] },
    { key: 'glow', title: 'Stand: glow', description: 'Whether it glows.', type: 'boolean', default: false },
  ],
  colors: noop,
  svg: noop,
  moves: noop,
} as never
const ALL = [...WALLPAPERS, STAND] as never

/** `over.hole`, when given, holds the black hole's own settings (size, calm). */
const settings = (over: Over = {}, kiki: Over = {}, stand: Over = {}) => {
  const { hole, ...top } = over as Over & { hole?: Over }
  return {
    on: true,
    wallpaper: 'kiki',
    motion: 'smooth',
    clear: 100,
    blur: 0,
    dim: 30,
    colors: true,
    ...top,
    own: { kiki: { time: 'auto', spinner: true, ...kiki }, blackhole: { size: 'medium', calm: false, ...hole }, stand: { mood: 'calm', glow: false, ...stand } },
  } as never
}

const rows = (over: Over = {}, kiki: Over = {}, stand: Over = {}, wallpapers: unknown = WALLPAPERS): Row[] =>
  paneRows(settings(over, kiki, stand), wallpapers as never) as unknown as Row[]
/** The row's name: its controls' key, else its kind. */
const nameOf = (r: Row): string => (r.kind === 'controls' ? (r.controls?.[0]?.key ?? 'controls') : r.kind)
const names = (list: Row[]): string[] => list.map(nameOf)
const controlsOf = (list: Row[], key: string): Control[] => list.find(r => r.kind === 'controls' && nameOf(r) === key)?.controls ?? []
const allControls = (list: Row[]): Control[] => list.flatMap(r => r.controls ?? [])

const COMMON_ROWS = ['wallpaper', 'on', 'motion', 'clear', 'blur', 'dim', 'colors']

test('the rows run in order: wallpapers, on, motion, the three numbers, colors, a heading, the wallpaper\'s own options', () => {
  expect(names(rows())).toEqual([...COMMON_ROWS, 'heading', 'kikiTime', 'kikiSpinner'])
  // Every row of controls is one key, and every control has a key, a value and a label.
  for (const r of rows()) {
    if (r.kind !== 'controls') continue
    expect(Array.isArray(r.controls) && (r.controls?.length ?? 0) > 0).toBe(true)
    expect(new Set(r.controls?.map(c => c.key)).size).toBe(1)
    for (const c of r.controls ?? []) {
      expect(typeof c.key).toBe('string')
      expect(['boolean', 'string', 'number'].includes(typeof c.value)).toBe(true)
      expect(typeof c.label).toBe('string')
      expect(c.label.length > 0).toBe(true)
    }
  }
})

test('while the wallpaper is off every wallpaper button also switches it on; while it is on none does', () => {
  const ON = { key: 'on', value: true }
  for (const wallpaper of ['kiki', 'blackhole']) {
    const off = controlsOf(rows({ on: false, wallpaper }), 'wallpaper') as (Control & { also?: unknown })[]
    expect([wallpaper, off.length]).toEqual([wallpaper, 2])
    for (const c of off) expect([wallpaper, c.value, c.also]).toEqual([wallpaper, c.value, ON])
    const live = controlsOf(rows({ on: true, wallpaper }), 'wallpaper') as (Control & { also?: unknown })[]
    for (const c of live) expect([wallpaper, c.value, c.also]).toEqual([wallpaper, c.value, undefined])
  }
  // From the list the pane is given, whichever wallpaper is on.
  const all = controlsOf(rows({ on: false, wallpaper: 'stand' }, {}, {}, ALL), 'wallpaper') as (Control & { also?: unknown })[]
  expect(all.map(c => c.also)).toEqual([ON, ON, ON])
  // Nothing else carries one, off or on.
  for (const on of [true, false]) {
    for (const c of allControls(rows({ on, wallpaper: 'blackhole' }))) {
      if (c.key !== 'wallpaper') expect([on, c.key, c.value, (c as { also?: unknown }).also]).toEqual([on, c.key, c.value, undefined])
    }
  }
  // And the control itself keeps what it was: its key and value are the wallpaper's own.
  expect(controlsOf(rows({ on: false }), 'wallpaper').map(c => [c.key, c.value, c.current === true])).toEqual([['wallpaper', 'kiki', true], ['wallpaper', 'blackhole', false]])
})

test('there is one button per wallpaper, and only the current one is marked', () => {
  const kiki = controlsOf(rows(), 'wallpaper')
  expect(kiki.map(c => c.value)).toEqual(['kiki', 'blackhole'])
  expect(kiki.map(c => c.label)).toEqual(['Kiki', 'Black hole'])
  expect(kiki.map(c => c.current === true)).toEqual([true, false])
  const hole = controlsOf(rows({ wallpaper: 'blackhole' }), 'wallpaper')
  expect(hole.map(c => c.current === true)).toEqual([false, true])
  // From the list the pane is given, in its order.
  const all = controlsOf(rows({ wallpaper: 'stand' }, {}, {}, ALL), 'wallpaper')
  expect(all.map(c => c.value)).toEqual(['kiki', 'blackhole', 'stand'])
  expect(all.map(c => c.current === true)).toEqual([false, false, true])
  // An unknown wallpaper is Kiki.
  expect(controlsOf(rows({ wallpaper: 'picture' }), 'wallpaper').map(c => c.current === true)).toEqual([true, false])
})

test('on and app colors are toggles that write the opposite of today\'s value', () => {
  for (const key of ['on', 'colors']) {
    for (const today of [true, false]) {
      const list = controlsOf(rows({ [key]: today }), key)
      expect([key, today, list.length]).toEqual([key, today, 1])
      expect([key, today, list[0]?.key, list[0]?.value]).toEqual([key, today, key, !today])
    }
  }
})

test('motion has a button for smooth, light and off, the setting\'s marked', () => {
  for (const motion of ['smooth', 'light', 'off']) {
    const list = controlsOf(rows({ motion }), 'motion')
    expect(list.map(c => c.value)).toEqual(['smooth', 'light', 'off'])
    expect([motion, list.map(c => c.current === true)]).toEqual([motion, ['smooth', 'light', 'off'].map(m => m === motion)])
  }
})

test('clear, blur and dim have a minus and a plus, one step each way, held inside the range', () => {
  const steps = [
    ['clear', 10, 0, 100],
    ['blur', 4, 0, 40],
    ['dim', 10, 0, 80],
  ] as const
  for (const [key, step, lo, hi] of steps) {
    for (const today of [lo, lo + 1, 12, 33, 45, hi - 3, hi - 1, hi].filter(v => v <= hi)) {
      const list = controlsOf(rows({ [key]: today }), key)
      expect([key, today, list.map(c => c.label)]).toEqual([key, today, ['-', '+']])
      expect([key, today, list.map(c => c.value)]).toEqual([key, today, [Math.max(lo, today - step), Math.min(hi, today + step)]])
      expect([key, today, list.every(c => c.key === key)]).toEqual([key, today, true])
    }
  }
  // The ends, as 1.9.0's pane has them.
  expect(controlsOf(rows({ clear: 100 }), 'clear').map(c => c.value)).toEqual([90, 100])
  expect(controlsOf(rows({ blur: 0 }), 'blur').map(c => c.value)).toEqual([0, 4])
  expect(controlsOf(rows({ dim: 80 }), 'dim').map(c => c.value)).toEqual([70, 80])
})

test('Kiki\'s rows show Kiki\'s time and spinner under their manifest keys, the setting\'s marked', () => {
  for (const time of ['auto', 'day', 'sunset', 'night']) {
    const list = controlsOf(rows({}, { time }), 'kikiTime')
    expect(list.map(c => c.value)).toEqual(['auto', 'day', 'sunset', 'night'])
    expect([time, list.map(c => c.current === true)]).toEqual([time, ['auto', 'day', 'sunset', 'night'].map(t => t === time)])
  }
  for (const today of [true, false]) {
    const list = controlsOf(rows({}, { spinner: today }), 'kikiSpinner')
    expect([today, list.length, list[0]?.value]).toEqual([today, 1, !today])
  }
})

test('the heading holds the current wallpaper\'s label, before its own options', () => {
  const list = rows()
  const heading = list.find(r => r.kind === 'heading')
  expect(heading?.text).toMatch(/Kiki/)
  expect(list.indexOf(heading as Row) < list.findIndex(r => nameOf(r) === 'kikiTime')).toBe(true)
  const hole = rows({ wallpaper: 'blackhole' })
  expect(hole.find(r => r.kind === 'heading')?.text).toMatch(/Black hole/)
})

test('no Kiki row shows while the black hole is on; its own rows are its size and its calm', () => {
  const hole = rows({ wallpaper: 'blackhole' })
  expect(names(hole)).toEqual([...COMMON_ROWS, 'heading', 'blackholeSize', 'blackholeCalm'])
  expect(allControls(hole).some(c => c.key.startsWith('kiki'))).toBe(false)
  for (const size of ['small', 'medium', 'large']) {
    const list = controlsOf(rows({ wallpaper: 'blackhole', hole: { size } }), 'blackholeSize')
    expect(list.map(c => c.value)).toEqual(['small', 'medium', 'large'])
    expect([size, list.map(c => c.current === true)]).toEqual([size, ['small', 'medium', 'large'].map(v => v === size)])
  }
  for (const today of [true, false]) {
    const list = controlsOf(rows({ wallpaper: 'blackhole', hole: { calm: today } }), 'blackholeCalm')
    expect([today, list.length, list[0]?.value]).toEqual([today, 1, !today])
  }
  // And the other way round: nothing of the black hole's or a stand-in's shows with Kiki.
  const kiki = rows()
  expect(allControls(kiki).some(c => c.key.startsWith('blackhole') || c.key.startsWith('stand'))).toBe(false)
})

test('only the current wallpaper\'s own options show, from the list the pane is given', () => {
  const stand = rows({ wallpaper: 'stand' }, {}, { mood: 'wild', glow: true }, ALL)
  expect(names(stand)).toEqual([...COMMON_ROWS, 'heading', 'standMood', 'standGlow'])
  expect(stand.find(r => r.kind === 'heading')?.text).toMatch(/Stand/)
  const mood = controlsOf(stand, 'standMood')
  expect(mood.map(c => c.value)).toEqual(['calm', 'wild'])
  expect(mood.map(c => c.current === true)).toEqual([false, true])
  expect(controlsOf(stand, 'standGlow').map(c => c.value)).toEqual([false])
  expect(allControls(stand).some(c => c.key.startsWith('kiki'))).toBe(false)
  // The stand-in's rows are not Kiki's.
  expect(names(rows({}, {}, {}, ALL))).toEqual([...COMMON_ROWS, 'heading', 'kikiTime', 'kikiSpinner'])
})

test('the pane has no Show FPS row and no note about the frame rate, for any wallpaper, even with an fps value still stored', () => {
  for (const wallpaper of ['kiki', 'blackhole', 'stand']) {
    for (const fps of [true, false, 1, 'on', null]) {
      const list = rows({ wallpaper, fps }, {}, {}, ALL)
      expect([wallpaper, fps, list.some(r => r.kind === 'note')]).toEqual([wallpaper, fps, false])
      expect([wallpaper, fps, allControls(list).some(c => c.key === 'fps')]).toEqual([wallpaper, fps, false])
      expect([wallpaper, fps, names(list).includes('fps')]).toEqual([wallpaper, fps, false])
      expect([wallpaper, fps, /fps|frame rate|frames a second|top left|cannot be measured/i.test(JSON.stringify(list))]).toEqual([wallpaper, fps, false])
    }
  }
})

test('after App colors comes the heading of the current wallpaper\'s own options', () => {
  for (const [wallpaper, list] of [['kiki', rows()], ['blackhole', rows({ wallpaper: 'blackhole' })], ['stand', rows({ wallpaper: 'stand' }, {}, {}, ALL)]] as [string, Row[]][]) {
    const at = list.findIndex(r => nameOf(r) === 'colors')
    expect([wallpaper, at >= 0, list[at + 1]?.kind]).toEqual([wallpaper, true, 'heading'])
  }
})

test('no text of the pane names /wallpaper', () => {
  for (const fps of [true, false]) {
    for (const wallpaper of ['kiki', 'blackhole', 'stand']) {
      const text = JSON.stringify(paneRows(settings({ wallpaper, fps }), ALL))
      expect([wallpaper, fps, text.includes('/wallpaper')]).toEqual([wallpaper, fps, false])
    }
  }
})

test('the pane has no row for a picture or a video of your own', () => {
  const text = JSON.stringify(paneRows(settings({}), WALLPAPERS as never))
  expect(/picture|video|ffmpeg/i.test(text)).toBe(false)
})

test('paneRows is pure: plain data, equal for equal settings, changing nothing it is given', () => {
  const s = settings({ wallpaper: 'blackhole', clear: 40, hole: { size: 'large' } })
  const before = JSON.stringify(s)
  const a = paneRows(s, WALLPAPERS as never)
  expect(JSON.parse(JSON.stringify(a))).toEqual(a)
  expect(paneRows(s, WALLPAPERS as never)).toEqual(a)
  expect(JSON.stringify(s)).toBe(before)
  // Changing the rows it gave leaves the next call alone.
  ;(a as unknown as Row[]).length = 0
  expect(paneRows(s, WALLPAPERS as never).length > 0).toBe(true)
})
