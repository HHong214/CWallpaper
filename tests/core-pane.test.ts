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
//   }
//   type PaneRow =
//     | { kind: 'controls'; label: string; controls: Control[] }     a row of buttons, left to right
//     | { kind: 'heading'; text: string }
//     | { kind: 'note'; text: string }
//   paneRows(settings: Settings, wallpapers: readonly Wallpaper[]): PaneRow[]
//     plain data (JSON-safe), in this order:
//       1. one control per wallpaper (key 'wallpaper', value its id, label its label); only the current one is `current`
//       2. on/off: ONE control, key 'on', value = !settings.on
//       3. motion: three controls, values smooth, light, off; the setting's is `current`
//       4. clear, 5. blur, 6. dim: two controls each, [minus, plus], labelled '-' and '+', with the value they would
//          write: the setting less / plus 1.9.0's step (clear 10, blur 4, dim 10), held inside the range (0-100,
//          0-40, 0-80), so at an end the button writes the end again
//       7. app colors: ONE control, key 'colors', value = !settings.colors
//       8. Show FPS: ONE control, key 'fps', value = !settings.fps
//       9. a note row, only when the current wallpaper's kind is 'svg' and Show FPS is on: its text says the frame
//          rate of this wallpaper cannot be measured; it follows the Show FPS row at once
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
    fps: false,
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

const COMMON_ROWS = ['wallpaper', 'on', 'motion', 'clear', 'blur', 'dim', 'colors', 'fps']

test('the rows run in order: wallpapers, on, motion, the three numbers, colors, fps, a heading, the wallpaper\'s own options', () => {
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

test('on, app colors and Show FPS are toggles that write the opposite of today\'s value', () => {
  for (const key of ['on', 'colors', 'fps']) {
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

test('with Show FPS on, an svg wallpaper gets a note that its frame rate cannot be measured, straight after the FPS row', () => {
  for (const wallpaper of ['kiki']) {
    const list = rows({ wallpaper, fps: true })
    const notes = list.filter(r => r.kind === 'note')
    expect([wallpaper, notes.length]).toEqual([wallpaper, 1])
    expect([wallpaper, /frame rate/i.test(notes[0]?.text ?? '')]).toEqual([wallpaper, true])
    expect([wallpaper, /cannot be measured/i.test(notes[0]?.text ?? '')]).toEqual([wallpaper, true])
    const at = list.findIndex(r => nameOf(r) === 'fps')
    expect([wallpaper, list.indexOf(notes[0] as Row)]).toEqual([wallpaper, at + 1])
    expect([wallpaper, list[at + 2]?.kind]).toEqual([wallpaper, 'heading'])
  }
})

test('no note shows with Show FPS off, nor for a shader wallpaper, whose frame rate can be measured', () => {
  expect(rows({ fps: false }).some(r => r.kind === 'note')).toBe(false)
  expect(rows({ wallpaper: 'blackhole', fps: false }).some(r => r.kind === 'note')).toBe(false)
  // The black hole is a shader wallpaper now: it draws its own frame rate.
  expect(rows({ wallpaper: 'blackhole', fps: true }).some(r => r.kind === 'note')).toBe(false)
  expect(rows({ wallpaper: 'stand', fps: true }, {}, {}, ALL).some(r => r.kind === 'note')).toBe(false)
  expect(rows({ wallpaper: 'stand', fps: false }, {}, {}, ALL).some(r => r.kind === 'note')).toBe(false)
})

test('the pane has no row for a picture or a video of your own', () => {
  const text = JSON.stringify(paneRows(settings({ fps: true }), WALLPAPERS as never))
  expect(/picture|video|ffmpeg/i.test(text)).toBe(false)
})

test('paneRows is pure: plain data, equal for equal settings, changing nothing it is given', () => {
  const s = settings({ wallpaper: 'blackhole', clear: 40, fps: true, hole: { size: 'large' } })
  const before = JSON.stringify(s)
  const a = paneRows(s, WALLPAPERS as never)
  expect(JSON.parse(JSON.stringify(a))).toEqual(a)
  expect(paneRows(s, WALLPAPERS as never)).toEqual(a)
  expect(JSON.stringify(s)).toBe(before)
  // Changing the rows it gave leaves the next call alone.
  ;(a as unknown as Row[]).length = 0
  expect(paneRows(s, WALLPAPERS as never).length > 0).toBe(true)
})
