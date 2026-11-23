// Tests for what the mod does with a change of an option: hooks/register.tsx (`refresh`, `takeOff`, `writeOption`,
// `run`, the `session.start` hook), as the review of the built core found it. Written before the fixes. Same
// harness as core-backdrop.test.tsx (read its header for how options reach the mod and what `config.set` shows);
// this file adds a session value store the test owns.
//
// THE SESSION VALUES (`$.state`). The test's `$` has no `state`, but a test can answer the mod's own `$.state.get`
// and `$.state.set` with hooks it registers (`on('state.get')`, `on('state.set')`, beneath the plugin): `begin`
// below keeps a Map of them, seeded by the test, and records every write. The keys the mod uses are the ones of
// `{ plugin: 'CWallpaper', key: ... }`: `lookSet` (true once this mod has set the look this session), `paneOpen`,
// and `pendingWrites` (to be added): a list of `{ key, value }` options still to write, saved before a first
// write and emptied (an empty list, or undefined) once all are written; a start writes what it finds there.
//
// WHAT THE HARNESS CANNOT DRIVE: a reload of the module between two writes (`register` runs once per test, so the
// order of the writes and the emptied `pendingWrites` are all that can be seen, not that the second write
// survives a reload), and a change of the options during a test (so `lookSet` is given by the seed, not made by a
// first start followed by a start with `on: false`). The tests that depend on the mod keeping its own copy of what it
// wrote are marked "(after a command)".
//
// RULES PINNED
//   1. The mod never clears a theme that is not its own: `$.theme.clear()` clears whatever theme stands. It is
//      made once on the person's ask to turn the wallpaper off (`/cwallpaper off`, the pane's on/off control while
//      on), and at a start only when `lookSet` says this mod set the look this session and the option says off.
//      With the option `on: false` any other change (a dial, motion, FPS, colors, an own option, a wallpaper
//      choice) clears nothing, and nor does a start without `lookSet`.
//   2. A write that changes nothing writes nothing: no `config.set`, no new `theme.set`; the command still
//      answers with the status line.
//   3. The mod's copy follows what the engine answers to `config.set` (`{ value }` other than the one asked for).
//   4. Choosing a wallpaper while the wallpaper is off also switches it on: the press writes `wallpaper`, then
//      `on` (core-pane.test.ts pins the control's `also`). Choosing the wallpaper that is already current while
//      off writes `on` alone.
//   5. Both writes are made, in that order, and `pendingWrites` is empty afterwards; a start that finds
//      `[{ key: 'on', value: true }]` there writes it and empties the list.
import { expect, mock, test } from 'claude-code/testing'

const propsOf = (name: string, plugin = 'CWallpaper') => ({ id: name, scene: name, plugin, glass: false }) as never
const BACKDROP = { plugin: 'CWallpaper', component: 'Backdrop', props: propsOf('kiki') } as const
const PANE = {
  plugin: 'CWallpaper',
  component: 'Pane',
  requestId: 'cwallpaper-settings',
  props: { title: 'Wallpaper', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const wallpaper = (args: string) => ({ command: 'cwallpaper', args }) as never

type Look = { backdrop?: { scene?: string } }
type Written = { field: string; value: unknown }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any

type Seen = {
  looks: Look[]
  written: Written[]
  cleared: number
  /** Every `state.set`, as `[key, value]`. */
  stateWrites: [string, unknown][]
  /** Every `state.get` and `state.set`, as `<plugin>/<key>`. */
  stateAsked: string[]
  /** The session values now. */
  kv: Map<string, unknown>
}

const field = (key: string): string => key.slice(key.indexOf('.') + 1)

/**
 * Mocks, a started session, and what the mod did meanwhile. `state` seeds the session values; `answer` is what the
 * engine answers to a `config.set` (the value asked for, by default).
 */
async function begin(
  $: Ctx,
  on: Ctx,
  opts: { state?: Record<string, unknown>; answer?: (key: string, value: unknown) => unknown; deny?: string; start?: boolean } = {},
): Promise<Seen> {
  mock.clock(on)
  mock.store(on)
  const kv = new Map<string, unknown>(Object.entries(opts.state ?? {}))
  const seen: Seen = { looks: [], written: [], cleared: 0, stateWrites: [], stateAsked: [], kv }
  on('command.register', () => ({ value: { command: 'cwallpaper' } }))
  on('theme.set', (_: unknown, e: unknown) => { seen.looks.push(e as Look); return { value: { isDrawn: true, requestId: 'backdrop' } } })
  on('theme.clear', () => { seen.cleared += 1; return { value: { isDrawn: false, reason: 'cleared' } } })
  on('config.set', (_: unknown, e: { key: string; value: unknown }) => {
    const name = field(e.key)
    seen.written.push({ field: name, value: e.value })
    if (opts.deny !== undefined) return { deny: opts.deny }
    return { value: opts.answer ? opts.answer(name, e.value) : e.value }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  // The session values are the plugin's own: `{ plugin: 'CWallpaper', key }`. A value asked for or written under
  // another plugin's name is recorded but neither found nor kept, so a mod that still says 'wallpaper' sees none.
  on('state.get', (_: unknown, e: { plugin?: string; key: string }) => {
    seen.stateAsked.push(`${String(e.plugin)}/${e.key}`)
    return { value: { value: e.plugin === 'CWallpaper' ? kv.get(e.key) : undefined, version: 1 } }
  })
  on('state.set', (_: unknown, e: { plugin?: string; key: string; value: unknown }) => {
    seen.stateAsked.push(`${String(e.plugin)}/${e.key}`)
    seen.stateWrites.push([e.key, e.value])
    if (e.plugin === 'CWallpaper') kv.set(e.key, e.value)
    return { value: { version: 2 } }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  if (opts.start !== false) await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  return seen
}

const isEmpty = (v: unknown): boolean => v === undefined || (Array.isArray(v) && v.length === 0)
const said = async ($: Ctx, text: string): Promise<string> => String(((await $.command.run(wallpaper(text))) as { text: string }).text)
const press = async ($: Ctx, key: string): Promise<void> => {
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key })
  await ui.unmount()
}

// ------------------------------------------------ 1. nothing that is not ours is cleared

test('a start with the option on off, and no look set by this mod, clears nothing', { options: { on: false } }, async ($, on) => {
  const seen = await begin($, on)
  expect(seen.cleared).toBe(0)
  expect(seen.looks.length).toBe(0)
})

test('every session value is the plugin\'s own: { plugin: \'CWallpaper\', key } with the keys paneOpen, lookSet and pendingWrites', async ($, on) => {
  const seen = await begin($, on)
  await said($, 'motion light')
  await said($, 'settings')
  expect(seen.stateAsked.length > 0).toBe(true)
  for (const asked of seen.stateAsked) expect([asked, /^CWallpaper\/(paneOpen|lookSet|pendingWrites)$/.test(asked)]).toEqual([asked, true])
  expect(seen.stateAsked.some(a => a.startsWith('wallpaper/'))).toBe(false)
})

test('a start with the option on on sets the look and notes it in the session (lookSet)', async ($, on) => {
  const seen = await begin($, on)
  expect(seen.looks.length).toBe(1)
  expect(seen.kv.get('lookSet')).toBe(true)
  expect(seen.cleared).toBe(0)
})

test('a start with the option on off, after this mod set the look this session (lookSet), takes that look off, once', { options: { on: false } }, async ($, on) => {
  const seen = await begin($, on, { state: { lookSet: true } })
  expect(seen.cleared).toBe(1)
  expect(seen.kv.get('lookSet')).toBe(false)
  expect(seen.looks.length).toBe(0)
})

for (const text of ['dim 20', 'blur 4', 'fps on', 'motion light', 'colors off', 'clear 90', 'time night', 'spinner off']) {
  test(`/cwallpaper ${text} while the wallpaper is off clears nothing`, { options: { on: false } }, async ($, on) => {
    const seen = await begin($, on)
    const answer = await said($, text)
    expect(seen.written.length).toBe(1)
    expect(seen.cleared).toBe(0)
    expect(answer).toMatch(/The wallpaper is off/)
  })
}

for (const key of ['motion:light', 'motion:off', 'clear:90', 'blur:4', 'dim:20', 'dim:40', 'colors:false', 'fps:true', 'kikiTime:night', 'kikiSpinner:false']) {
  test(`pressing ${key} in the pane while the wallpaper is off clears nothing`, { options: { on: false } }, async ($, on) => {
    const seen = await begin($, on)
    await press($, key)
    expect(seen.written.length).toBe(1)
    expect(seen.cleared).toBe(0)
  })
}

test('/cwallpaper off while the wallpaper is on clears the theme once', async ($, on) => {
  const seen = await begin($, on)
  await said($, 'off')
  expect(seen.written).toEqual([{ field: 'on', value: false }])
  expect(seen.cleared).toBe(1)
})

test('the pane\'s on/off control pressed while the wallpaper is on clears the theme once', async ($, on) => {
  const seen = await begin($, on)
  await press($, 'on:false')
  expect(seen.written).toEqual([{ field: 'on', value: false }])
  expect(seen.cleared).toBe(1)
})

test('/cwallpaper off while the wallpaper is already off clears nothing and writes nothing', { options: { on: false } }, async ($, on) => {
  const seen = await begin($, on)
  const answer = await said($, 'off')
  expect(seen.cleared).toBe(0)
  expect(seen.written).toEqual([])
  expect(answer).toMatch(/The wallpaper is off/)
})

// ------------------------------------------------ 2. a write that changes nothing writes nothing

/** Commands that ask for what already is, with the options that make it so. */
const SAME: [string, Record<string, unknown>][] = [
  ['motion smooth', {}],
  ['motion light', { motion: 'light' }],
  ['kiki', {}],
  ['blackhole', { wallpaper: 'blackhole' }],
  ['hole', { wallpaper: 'blackhole' }],
  ['clear 100', {}],
  ['clear 40', { clear: 40 }],
  ['blur 0', {}],
  ['dim 30', {}],
  ['colors on', {}],
  ['colors off', { colors: false }],
  ['fps off', {}],
  ['on', {}],
  ['time auto', {}],
  ['spinner on', {}],
  ['size medium', { wallpaper: 'blackhole' }],
  ['calm off', { wallpaper: 'blackhole' }],
]
for (const [text, options] of SAME) {
  test(`/cwallpaper ${text} when it is already so writes nothing, sets no look again, and still answers with the status`, { options: options as never }, async ($, on) => {
    const seen = await begin($, on)
    const before = seen.looks.length
    const answer = await said($, text)
    expect(seen.written).toEqual([])
    expect(seen.looks.length).toBe(before)
    expect(answer).toMatch(/The wallpaper is/)
    expect(seen.cleared).toBe(0)
  })
}

test('a command that does change a value still writes it and sets the look again (after a command)', async ($, on) => {
  const seen = await begin($, on)
  const before = seen.looks.length
  await said($, 'motion light')
  expect(seen.written).toEqual([{ field: 'motion', value: 'light' }])
  expect(seen.looks.length > before).toBe(true)
})

/** Presses that choose what already is, or move a number that is at its end of the range. */
const UNCHANGED: [string, Record<string, unknown>][] = [
  ['motion:smooth', {}],
  ['wallpaper:kiki', {}],
  ['wallpaper:blackhole', { wallpaper: 'blackhole' }],
  ['kikiTime:auto', {}],
  ['clear:100', {}],
  ['blur:0', {}],
  ['dim:0', { dim: 0 }],
  ['dim:80', { dim: 80 }],
  ['blur:40', { blur: 40 }],
  ['blackholeSize:medium', { wallpaper: 'blackhole' }],
]
for (const [key, options] of UNCHANGED) {
  test(`pressing ${key} in the pane when it changes nothing writes nothing and sets no look again`, { options: options as never }, async ($, on) => {
    const seen = await begin($, on)
    const before = seen.looks.length
    await press($, key)
    expect(seen.written).toEqual([])
    expect(seen.looks.length).toBe(before)
    expect(seen.cleared).toBe(0)
  })
}

// ------------------------------------------------ 3. the copy follows what the engine holds

const ANSWER_35 = (key: string, value: unknown): unknown => (key === 'dim' ? 35 : value)

test('when the engine answers a value other than the one asked for, the status shows the answered value (after a command)', async ($, on) => {
  const seen = await begin($, on, { answer: ANSWER_35 })
  const text = await said($, 'dim 40')
  expect(seen.written).toEqual([{ field: 'dim', value: 40 }])
  expect(text).toMatch(/scene dimmed 35%/)
  expect(text).not.toMatch(/scene dimmed 40%/)
})

test('...and the pane then steps from the answered value (after a command)', async ($, on) => {
  await begin($, on, { answer: ANSWER_35 })
  await said($, 'dim 40')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'dim:25' })).toBeDefined()
  expect(await ui.find({ key: 'dim:45' })).toBeDefined()
  expect(await ui.find({ key: 'dim:30' })).toBeUndefined()
  expect(await ui.find({ key: 'dim:50' })).toBeUndefined()
  await ui.unmount()
})

test('a press answered with another value shows the answered value in the status (after a command)', async ($, on) => {
  const seen = await begin($, on, { answer: (key, value) => (key === 'clear' ? 85 : value) })
  await press($, 'clear:90')
  expect(seen.written).toEqual([{ field: 'clear', value: 90 }])
  expect(await said($, '')).toMatch(/Panels 85% clear/)
})

test('a choice answered with another choice shows the answered one (after a command)', async ($, on) => {
  await begin($, on, { answer: (key, value) => (key === 'motion' ? 'off' : value) })
  expect(await said($, 'motion light')).toMatch(/motion off/)
})

test('a write the engine denies leaves the status as it was, and says so (after a command)', async ($, on) => {
  await begin($, on, { deny: 'managed' })
  expect(await said($, 'dim 40')).toMatch(/could not change dim/)
  expect(await said($, '')).toMatch(/scene dimmed 30%/)
})

// ------------------------------------------------ 4. choosing a wallpaper while off also switches it on

test('a press on another wallpaper while the wallpaper is off writes the wallpaper, then on', { options: { on: false } }, async ($, on) => {
  const seen = await begin($, on)
  await press($, 'wallpaper:blackhole')
  expect(seen.written).toEqual([{ field: 'wallpaper', value: 'blackhole' }, { field: 'on', value: true }])
  expect(seen.cleared).toBe(0)
})

test('a press on the wallpaper that is current while the wallpaper is off writes on alone', { options: { on: false } }, async ($, on) => {
  const seen = await begin($, on)
  await press($, 'wallpaper:kiki')
  expect(seen.written).toEqual([{ field: 'on', value: true }])
  expect(seen.cleared).toBe(0)
})

test('a press on another wallpaper while the wallpaper is on writes the wallpaper alone', async ($, on) => {
  const seen = await begin($, on)
  await press($, 'wallpaper:blackhole')
  expect(seen.written).toEqual([{ field: 'wallpaper', value: 'blackhole' }])
})

test('after that press the look is the new wallpaper\'s, set once (after a command)', { options: { on: false } }, async ($, on) => {
  const seen = await begin($, on)
  await press($, 'wallpaper:blackhole')
  expect(seen.looks.length).toBe(1)
  expect(seen.looks.at(-1)?.backdrop?.scene).toBe('blackhole')
})

// ------------------------------------------------ 5. two writes: both made, in order, nothing left pending

test('/cwallpaper blackhole while the wallpaper is off makes both writes in order and leaves no pending write', { options: { on: false } }, async ($, on) => {
  const seen = await begin($, on)
  await said($, 'blackhole')
  expect(seen.written).toEqual([{ field: 'wallpaper', value: 'blackhole' }, { field: 'on', value: true }])
  expect(isEmpty(seen.kv.get('pendingWrites'))).toBe(true)
})

test('the same press in the pane leaves no pending write', { options: { on: false } }, async ($, on) => {
  const seen = await begin($, on)
  await press($, 'wallpaper:blackhole')
  expect(isEmpty(seen.kv.get('pendingWrites'))).toBe(true)
})

test('a single write leaves no pending write either', async ($, on) => {
  const seen = await begin($, on)
  await said($, 'motion light')
  expect(isEmpty(seen.kv.get('pendingWrites'))).toBe(true)
})

test('a start that finds a pending write writes it and empties the list', { options: { on: false } }, async ($, on) => {
  const seen = await begin($, on, { state: { pendingWrites: [{ key: 'on', value: true }] } })
  expect(seen.written).toEqual([{ field: 'on', value: true }])
  expect(isEmpty(seen.kv.get('pendingWrites'))).toBe(true)
})

test('a start with nothing pending writes nothing', async ($, on) => {
  const seen = await begin($, on)
  expect(seen.written).toEqual([])
})
