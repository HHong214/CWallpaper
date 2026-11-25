// Tests for the option `rest` and the review's fixes (CONTRACT-wallpaper.md, W1 to W8, done-when W-d1 to W-d9, with
// the precision of WORKED.md part 3). Written before the code: each test named W-d<n> fails until it is built, except
// the ones that pin behaviour of today that must stay (they say so).
//
// THE HARNESS, as the other files use it (core-backdrop.test.tsx explains how options reach the mod):
//   * `mock.clock(on, { now })` and `clock.advance` / `clock.set` move the time the mod reads and fire its timers.
//   * a hook beneath the plugin on `ui.invalidate` counts the redraws the mod asks for.
//   * hooks on `state.get` / `state.set` answer the mod's session values from a Map this file owns, so a test can
//     hand a second load the values a first load left (`HANDED` below: the harness runs `register` once per test,
//     so "a second load" is the next test, started from those values, at a later time).
//   * `$.prompt.submit`, `$.turn.start` and `$.turn.complete` raise the events the mod hears.
//   * an inline plugin (`plugins: [...]`) makes a `$.theme.set` of its own, so `next.origin.plugin` names it, and
//     a probe in the `prepend` tier reads `next.trace` to list which plugins' `ui.render` hooks a Spinner passed.
//
// NAMES THIS FILE ASSUMES (for the builder):
//   * the option `rest`: a choice of 'off', '5', '15' (strings), default '5', right after `motion` in COMMON and in
//     the manifest; `readSettings` gives it as `Settings.rest`; the pane has a row of three buttons `rest:off`,
//     `rest:5`, `rest:15` right after the motion row.
//   * the session values that carry a running turn and the last activity across a reload are replayed whole
//     (whatever keys the mod writes under `{ plugin: 'CWallpaper' }`). core-writes.test.ts lists the keys allowed
//     there: `lastActive` and `turnRunning` beside the three of today.
//   * W3 (the fallback) is not tested here: the kit cannot make the mod's own `$.theme.set` fail. It is tested in
//     core-look.test.ts as the pure function `setLook(io, look)` of hooks/core/look.ts (WORKED.md part 3).
import { expect, mock, test } from 'claude-code/testing'

import { COMMON, readSettings } from '../hooks/core/options'
import { paneRows } from '../hooks/core/pane'
import { WALLPAPERS } from '../hooks/core/registry'
import { sceneFor } from '../hooks/core/scene'
import { register } from '../hooks/register'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any
type Name = 'kiki' | 'blackhole'
type Glass = { blur?: number; opacity?: number; tint?: string } | false
type Look = {
  backdrop?: { scene?: string; id?: string; glass?: Glass }
  colors?: { label?: string }
  overrideColorScheme?: string
}
type Node = { type?: unknown; key?: unknown; text?: unknown; props?: Record<string, unknown>; children?: unknown }

const MIN = 60_000
const local = (h: number, m = 0, s = 0): number => new Date(2026, 5, 15, h, m, s).getTime()
const NOON = local(12)
const propsOf = (name: string, plugin = 'CWallpaper') => ({ id: name, scene: name, plugin, glass: false }) as never
const PANE = {
  plugin: 'CWallpaper',
  component: 'Pane',
  requestId: 'cwallpaper-settings',
  props: { title: 'Wallpaper', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const SPINNER = { plugin: 'CWallpaper', component: 'Spinner', props: { word: 'Thinking', message: null, suffix: '…', mode: 'thinking' } } as const
const wallpaper = (args: string) => ({ command: 'cwallpaper', args }) as never
const WAKE_MARK = /<g id="kw[0-9a-z]+"\/>/g
const bare = (source: string): string => source.replace(WAKE_MARK, '')

type Rig = {
  clock: ReturnType<typeof mock.clock>
  looks: Look[]
  toasts: string[]
  written: { key: string; value: unknown }[]
  storeWrites: string[]
  stateWrites: [string, unknown][]
  kv: Map<string, unknown>
  redraws: () => number
}

type Begin = {
  now?: number
  state?: Record<string, unknown>
  /** Answers the n-th theme.set (1 first); by default every set is drawn at once. */
  theme?: (e: Look, n: number) => unknown
  start?: boolean
}

/** Mocks, the session values in a Map, every redraw counted, and a started session (a load of the module). */
async function begin($: Ctx, on: Ctx, opts: Begin = {}): Promise<Rig> {
  const clock = mock.clock(on, { now: opts.now ?? NOON })
  const kv = new Map<string, unknown>(Object.entries(opts.state ?? {}))
  let redraws = 0
  const rig: Rig = { clock, looks: [], toasts: [], written: [], storeWrites: [], stateWrites: [], kv, redraws: () => redraws }
  on('command.register', () => ({ value: { command: 'cwallpaper' } }))
  on('theme.set', async (_: unknown, e: Look) => {
    rig.looks.push(e)
    if (opts.theme) return opts.theme(e, rig.looks.length)
    return { value: { isDrawn: true, requestId: 'backdrop' } }
  })
  on('theme.clear', () => ({ value: { isDrawn: false, reason: 'cleared' } }))
  on('config.set', (_: unknown, e: { key: string; value: unknown }) => { rig.written.push({ key: e.key, value: e.value }); return { value: e.value } })
  on('store.get', () => ({ value: undefined }))
  on('store.set', (_: unknown, e: { key: string }) => { rig.storeWrites.push(e.key); return { value: undefined } })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.invalidate', () => { redraws += 1; return { value: undefined } })
  on('ui.toast', (_: unknown, e: unknown) => { rig.toasts.push(JSON.stringify(e)); return { value: undefined } })
  on('state.get', (_: unknown, e: { plugin?: string; key: string }) => ({ value: { value: e.plugin === 'CWallpaper' ? kv.get(e.key) : undefined, version: 1 } }))
  on('state.set', (_: unknown, e: { plugin?: string; key: string; value: unknown }) => {
    rig.stateWrites.push([e.key, e.value])
    if (e.plugin === 'CWallpaper') kv.set(e.key, e.value)
    return { value: { version: 2 } }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: { answer?: string }) => ({ text: String(e.answer ?? '') }))
  if (opts.start !== false) await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  return rig
}

const walk = (node: unknown, visit: (el: Node) => void): void => {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach(n => walk(n, visit)); return }
  const el = node as Node
  visit(el)
  walk(el.children, visit)
  walk(el.props?.children, visit)
}

type Drawn = { shader: boolean; source: string }
/** One draw of the Backdrop on the desktop: whether it holds a Shader, and its picture's source. */
async function draw($: Ctx, name: Name): Promise<Drawn> {
  const ui = await $.ui.mount({ plugin: 'CWallpaper', component: 'Backdrop', surface: 'desktop', props: propsOf(name) })
  const tree = await ui.drawn()
  await ui.unmount()
  let shader = false
  const sources: string[] = []
  walk(tree, el => {
    if (el.type === 'Shader') shader = true
    if (el.type === 'Svg' && typeof el.props?.source === 'string') sources.push(el.props.source)
  })
  return { shader, source: sources[0] ?? '' }
}

/** The still scene: what `motion: off` gives for the same settings at that time. */
const stillOf = (name: Name, options: Record<string, unknown>, now: number): string =>
  String((sceneFor(readSettings({ ...options, wallpaper: name, motion: 'off' } as never, WALLPAPERS as never), WALLPAPERS as never, now) as { source?: string }).source)

const isMoving = (d: Drawn, name: Name): boolean => (name === 'blackhole' ? d.shader : bare(d.source).includes('@keyframes'))
/** At rest: no Shader, and exactly the still source. */
const isRested = (d: Drawn, name: Name, options: Record<string, unknown>, now: number): boolean => !d.shader && d.source === stillOf(name, options, now)

const turnStart = ($: Ctx, turnId: string) => $.turn.start({ text: 'hello', turnId })
const turnComplete = ($: Ctx, turnId: string) => $.turn.complete({ answer: 'hi', durationMs: 10, isAborted: false, turnId, reason: 'answer' })

// ================================================================ W-d1: rest

const CASES: [Name, Record<string, unknown>][] = [
  ['blackhole', { wallpaper: 'blackhole', rest: '5' }],
  // Kiki at a fixed time of day, so the minute timer has no new picture to ask for.
  ['kiki', { wallpaper: 'kiki', kikiTime: 'day', rest: '5' }],
]

for (const [name, options] of CASES) {
  test(`W-d1: ${name} rests five minutes after a turn completes, wakes at a prompt, and rests again five minutes after it`, { options: options as never }, async ($, on) => {
    const rig = await begin($, on)
    const { clock } = rig
    expect(isMoving(await draw($, name), name)).toBe(true)
    await clock.advance(30_000)
    await turnStart($, 't1')
    await clock.advance(MIN)
    await turnComplete($, 't1')
    const done = clock.now()

    // The draw just before the rest time still moves, and no redraw is asked for up to it.
    await clock.set(done + 5 * MIN - 1000)
    expect(isMoving(await draw($, name), name)).toBe(true)
    const before = rig.redraws()
    await clock.set(done + 5 * MIN - 1)
    expect(rig.redraws()).toBe(before)
    // At the rest time: exactly one redraw, and every draw from then on is the still scene.
    await clock.set(done + 5 * MIN)
    expect(['redraws at the rest time', rig.redraws() - before]).toEqual(['redraws at the rest time', 1])
    expect(['still at the rest time', isRested(await draw($, name), name, options, clock.now())]).toEqual(['still at the rest time', true])
    // While it rests nothing more is asked for: no wake draw left pending, no minute-timer redraw.
    await clock.advance(3 * MIN)
    expect(rig.redraws()).toBe(before + 1)
    expect(isRested(await draw($, name), name, options, clock.now())).toBe(true)

    // A prompt wakes it: one redraw at once, and the moving scene again.
    await $.prompt.submit({ text: 'hello' } as never)
    await clock.settle()
    const prompted = clock.now()
    expect(rig.redraws()).toBe(before + 2)
    expect(isMoving(await draw($, name), name)).toBe(true)
    await clock.advance(3100)
    // With Kiki the usual wake draws follow (3 and 12 seconds on); with the black hole none do.
    expect(rig.redraws()).toBe(before + (name === 'kiki' ? 3 : 2))
    await clock.advance(9000)
    expect(rig.redraws()).toBe(before + (name === 'kiki' ? 4 : 2))

    // The count starts again from the prompt.
    await clock.set(prompted + 5 * MIN - 1000)
    expect(isMoving(await draw($, name), name)).toBe(true)
    const again = rig.redraws()
    await clock.set(prompted + 5 * MIN)
    expect(rig.redraws()).toBe(again + 1)
    expect(isRested(await draw($, name), name, options, clock.now())).toBe(true)

    // Nothing about rest is written to the options or the store.
    expect(rig.written).toEqual([])
    expect(rig.storeWrites).toEqual([])
  })

  test(`W-d1: ${name} never rests while a turn runs, and counts five minutes from the turn's end`, { options: options as never }, async ($, on) => {
    const rig = await begin($, on)
    const { clock } = rig
    const loaded = clock.now()
    await draw($, name)
    // A turn that starts before the rest time and runs past it.
    await clock.set(loaded + 4 * MIN)
    await turnStart($, 't1')
    const before = rig.redraws()
    for (const at of [5, 9, 12, 20]) {
      await clock.set(loaded + at * MIN)
      expect([at, isMoving(await draw($, name), name)]).toEqual([at, true])
    }
    if (name === 'blackhole') expect(rig.redraws()).toBe(before)
    await turnComplete($, 't1')
    const done = clock.now()
    await clock.set(done + 5 * MIN - 1000)
    expect(isMoving(await draw($, name), name)).toBe(true)
    const mark = rig.redraws()
    await clock.set(done + 5 * MIN)
    expect(rig.redraws()).toBe(mark + 1)
    expect(isRested(await draw($, name), name, options, clock.now())).toBe(true)
  })

  // A turn the person interrupts. The engine's types (TurnCompleteFields, TurnCompleteReason): it ends with
  // `turn.complete` carrying `isAborted: true` and `reason: 'aborted'`, and a hook that heard the turn's start hears
  // that end too. The event `turn.abort` is a plugin's own `$.turn.abort`, heard only by the hooks above it.
  if (name === 'blackhole') {
    test('W-d1: blackhole counts a turn the person interrupts (turn.complete, isAborted) as ended, and rests five minutes after it with one redraw', { options: options as never }, async ($, on) => {
      const rig = await begin($, on)
      const { clock } = rig
      await draw($, name)
      await clock.advance(30_000)
      await turnStart($, 't1')
      await clock.advance(2 * MIN)
      await $.turn.complete({ answer: '', durationMs: 2 * MIN, isAborted: true, turnId: 't1', reason: 'aborted' } as never)
      const done = clock.now()
      // Five minutes are counted from the interruption, not from the load or the turn's start.
      await clock.set(done + 5 * MIN - 1000)
      expect(['moving just before', isMoving(await draw($, name), name)]).toEqual(['moving just before', true])
      const before = rig.redraws()
      await clock.set(done + 5 * MIN)
      expect(['redraws at the rest time', rig.redraws() - before]).toEqual(['redraws at the rest time', 1])
      expect(['still at the rest time', isRested(await draw($, name), name, options, clock.now())]).toEqual(['still at the rest time', true])
    })

    // A subagent's turn also comes as turn.start and turn.complete, with its agentId and its own turnId. A turn runs
    // from its start to its end, whichever agent it belongs to, and the backdrop rests only when none runs.
    const subStart = ($: Ctx, turnId: string) => $.turn.start({ text: 'sub', turnId, agentId: 'a1' } as never)
    const subComplete = ($: Ctx, turnId: string) =>
      $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId, reason: 'answer', agentId: 'a1' } as never)

    test('W-d1: blackhole does not rest while the main turn runs after a subagent\'s turn has ended, and rests five minutes after the main turn ends', { options: options as never }, async ($, on) => {
      const rig = await begin($, on)
      const { clock } = rig
      await draw($, name)
      await clock.advance(30_000)
      await turnStart($, 't1')
      await clock.advance(MIN)
      await subStart($, 's1')
      await clock.advance(MIN)
      await subComplete($, 's1')
      const subDone = clock.now()
      const before = rig.redraws()
      for (const at of [6, 10]) {
        await clock.set(subDone + at * MIN)
        expect([`moving ${at} min after the subagent's end`, isMoving(await draw($, name), name)]).toEqual([`moving ${at} min after the subagent's end`, true])
        expect([`redraws ${at} min after the subagent's end`, rig.redraws() - before]).toEqual([`redraws ${at} min after the subagent's end`, 0])
      }
      await turnComplete($, 't1')
      const done = clock.now()
      await clock.set(done + 5 * MIN - 1000)
      expect(['moving just before', isMoving(await draw($, name), name)]).toEqual(['moving just before', true])
      const mark = rig.redraws()
      await clock.set(done + 5 * MIN)
      expect(['redraws at the rest time', rig.redraws() - mark]).toEqual(['redraws at the rest time', 1])
      expect(['still at the rest time', isRested(await draw($, name), name, options, clock.now())]).toEqual(['still at the rest time', true])
    })

    test('W-d1: blackhole does not rest while a subagent\'s turn runs after the main turn has ended, and rests five minutes after the subagent\'s end', { options: options as never }, async ($, on) => {
      const rig = await begin($, on)
      const { clock } = rig
      await draw($, name)
      await clock.advance(30_000)
      await turnStart($, 't1')
      await clock.advance(30_000)
      await subStart($, 's1')
      await clock.advance(MIN)
      await turnComplete($, 't1')
      const mainDone = clock.now()
      await clock.set(mainDone + 6 * MIN)
      expect(['moving 6 min after the main turn\'s end', isMoving(await draw($, name), name)]).toEqual(['moving 6 min after the main turn\'s end', true])
      await subComplete($, 's1')
      const done = clock.now()
      await clock.set(done + 5 * MIN - 1000)
      expect(['moving just before', isMoving(await draw($, name), name)]).toEqual(['moving just before', true])
      const mark = rig.redraws()
      await clock.set(done + 5 * MIN)
      expect(['redraws at the rest time', rig.redraws() - mark]).toEqual(['redraws at the rest time', 1])
      expect(['still at the rest time', isRested(await draw($, name), name, options, clock.now())]).toEqual(['still at the rest time', true])
    })
  }

  // The rest moment always asks for the still scene, and cancels pending wake draws: a redraw the mod asked for a
  // moment earlier (here the wake draw 12 s after the first show, a second before the rest) does not stand in for it.
  if (name === 'kiki') {
    test('W-d1: kiki at a rest moment a second after a wake draw asks for one redraw, draws the still scene, and asks for nothing in the next 15 seconds', { options: options as never }, async ($, on) => {
      const rig = await begin($, on)
      const { clock } = rig
      const loaded = clock.now()
      const restAt = loaded + 5 * MIN
      // The first show 13 s before the rest: its wake draws fall 10 s and 1 s before it.
      await clock.set(restAt - 13_000)
      expect(isMoving(await draw($, name), name)).toBe(true)
      const shown = rig.redraws()
      await clock.set(restAt - 1)
      expect(['wake draws before the rest', rig.redraws() - shown]).toEqual(['wake draws before the rest', 2])
      const before = rig.redraws()
      await clock.set(restAt)
      expect(['redraws at the rest time', rig.redraws() - before]).toEqual(['redraws at the rest time', 1])
      expect(['still at the rest time', isRested(await draw($, name), name, options, clock.now())]).toEqual(['still at the rest time', true])
      await clock.advance(15_000)
      expect(['redraws in the 15 s after', rig.redraws() - before]).toEqual(['redraws in the 15 s after', 1])
    })
  }

  test(`W-d1: ${name} with rest at 15 rests fifteen minutes after the last activity, not five`, { options: { ...options, rest: '15' } as never }, async ($, on) => {
    const rig = await begin($, on)
    const { clock } = rig
    await draw($, name)
    await turnStart($, 't1')
    await clock.advance(10_000)
    await turnComplete($, 't1')
    const done = clock.now()
    await clock.set(done + 5 * MIN)
    expect(isMoving(await draw($, name), name)).toBe(true)
    await clock.set(done + 15 * MIN - 1000)
    expect(isMoving(await draw($, name), name)).toBe(true)
    const before = rig.redraws()
    await clock.set(done + 15 * MIN)
    expect(rig.redraws()).toBe(before + 1)
    expect(isRested(await draw($, name), name, { ...options, rest: '15' }, clock.now())).toBe(true)
  })

  test(`W-d1: ${name} with rest off never rests (pins today)`, { options: { ...options, rest: 'off' } as never }, async ($, on) => {
    const rig = await begin($, on)
    const { clock } = rig
    await draw($, name)
    await turnStart($, 't1')
    await clock.advance(10_000)
    await turnComplete($, 't1')
    for (const at of [5, 15, 16, 60]) {
      await clock.set(local(12) + at * MIN + 10_000)
      expect([at, isMoving(await draw($, name), name)]).toEqual([at, true])
    }
  })

  test(`W-d1: ${name} with no rest option rests after the default five minutes`, { options: Object.fromEntries(Object.entries(options).filter(([k]) => k !== 'rest')) as never }, async ($, on) => {
    const rig = await begin($, on)
    const loaded = rig.clock.now()
    await draw($, name)
    // A load of the module is activity: five minutes after it, with no turn, it rests.
    await rig.clock.set(loaded + 5 * MIN - 1000)
    expect(isMoving(await draw($, name), name)).toBe(true)
    await rig.clock.set(loaded + 5 * MIN)
    expect(isRested(await draw($, name), name, options, rig.clock.now())).toBe(true)
  })
}

test('W-d1: the /cwallpaper command and a press in the settings pane each wake a resting backdrop', { options: { wallpaper: 'blackhole', rest: '5' } as never }, async ($, on) => {
  const rig = await begin($, on)
  const { clock } = rig
  await draw($, 'blackhole')
  await clock.advance(5 * MIN)
  expect((await draw($, 'blackhole')).shader).toBe(false)
  await $.command.run(wallpaper(''))
  expect((await draw($, 'blackhole')).shader).toBe(true)
  await clock.advance(5 * MIN)
  expect((await draw($, 'blackhole')).shader).toBe(false)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'clear:90' })
  await ui.unmount()
  expect((await draw($, 'blackhole')).shader).toBe(true)
})

// A second load of the module in the middle of a turn. The first test leaves the session values; the second starts
// from them, two minutes on, as the reload after a change of option would.
const T0 = local(12)
const HANDED: Record<string, unknown> = {}

test('W-d1: a first load sees a turn start (hands its session values to the next test)', { options: { wallpaper: 'blackhole', rest: '5' } as never }, async ($, on) => {
  const rig = await begin($, on, { now: T0 })
  await draw($, 'blackhole')
  await rig.clock.advance(MIN)
  await turnStart($, 't9')
  await rig.clock.advance(MIN)
  for (const [key, value] of rig.kv) HANDED[key] = value
  expect(rig.kv.size > 0).toBe(true)
})

test('W-d1: a second load in the middle of that turn does not rest while it runs, and rests five minutes after it ends', { options: { wallpaper: 'blackhole', rest: '5' } as never }, async ($, on) => {
  if (Object.keys(HANDED).length === 0) throw new Error('HANDED is empty: run this test after the first-load test before it, which hands it the session values')
  const rig = await begin($, on, { now: T0 + 2 * MIN, state: { ...HANDED } })
  const { clock } = rig
  expect((await draw($, 'blackhole')).shader).toBe(true)
  await clock.set(T0 + 8 * MIN)
  expect((await draw($, 'blackhole')).shader).toBe(true)
  await clock.set(T0 + 12 * MIN)
  expect((await draw($, 'blackhole')).shader).toBe(true)
  await turnComplete($, 't9')
  const done = clock.now()
  await clock.set(done + 5 * MIN - 1000)
  expect((await draw($, 'blackhole')).shader).toBe(true)
  const before = rig.redraws()
  await clock.set(done + 5 * MIN)
  expect(rig.redraws()).toBe(before + 1)
  expect(isRested(await draw($, 'blackhole'), 'blackhole', { rest: '5' }, clock.now())).toBe(true)
})

test('W-d1: Kiki in auto, resting, is redrawn once at the tick where the still picture changes, to the still scene for the new time, with no wake draws', { options: { rest: '5' } as never }, async ($, on) => {
  // Kiki in auto turns from day to sunset at 17:30 (the default sun times). The first draw starts the minute timer,
  // so the ticks fall at start + n minutes; a prompt half a minute on puts the rest at 17:27:30, between two ticks.
  const options = { rest: '5' }
  const start = local(17, 22)
  const rig = await begin($, on, { now: start })
  const { clock } = rig
  await draw($, 'kiki')
  await clock.advance(30_000)
  await $.prompt.submit({ text: 'hello' } as never)
  await clock.settle()
  const restAt = clock.now() + 5 * MIN
  // The first tick after the rest whose still picture differs from the still drawn at the rest.
  const restStill = stillOf('kiki', options, restAt)
  let tick = start + 6 * MIN
  while (stillOf('kiki', options, tick) === restStill && tick - start <= 12 * MIN) tick += MIN
  expect(['the still picture changes within 12 minutes', tick - start <= 12 * MIN]).toEqual(['the still picture changes within 12 minutes', true])
  // At the rest: one redraw, and the app draws the still scene.
  const woke = rig.redraws()
  await clock.set(restAt)
  expect(['redraws at the rest time', rig.redraws() - woke]).toEqual(['redraws at the rest time', 1])
  expect(['still at the rest time', isRested(await draw($, 'kiki'), 'kiki', options, restAt)]).toEqual(['still at the rest time', true])
  // Up to the tick before the change, nothing is asked for: the still for now is the one drawn.
  const before = rig.redraws()
  await clock.set(tick - 1)
  expect(['redraws before the tick', rig.redraws() - before]).toEqual(['redraws before the tick', 0])
  // The tick asks for exactly one redraw, and the draw after it is the still scene for the new time.
  await clock.set(tick)
  expect(['redraws at the tick', rig.redraws() - before]).toEqual(['redraws at the tick', 1])
  const drawn = await draw($, 'kiki')
  expect(['no shader', drawn.shader]).toEqual(['no shader', false])
  expect(['the still for the new time', bare(drawn.source) === stillOf('kiki', options, tick)]).toEqual(['the still for the new time', true])
  // While it rests no wake draws follow.
  await clock.advance(3100)
  expect(['3 s after', rig.redraws() - before]).toEqual(['3 s after', 1])
  await clock.advance(9000)
  expect(['12 s after', rig.redraws() - before]).toEqual(['12 s after', 1])
})

// ---------------------------------------------------------------- the option itself

test('W-d1: the option rest is a choice of off, 5 and 15, default 5, right after motion', () => {
  const keys = COMMON.map(o => o.key)
  expect(keys.indexOf('rest')).toBe(keys.indexOf('motion') + 1)
  const rest = COMMON.find(o => o.key === 'rest')
  expect(rest?.type).toBe('choice')
  expect(rest?.choices).toEqual(['off', '5', '15'])
  expect(rest?.default).toBe('5')
  expect(typeof rest?.title).toBe('string')
  expect(String(rest?.description).length > 0).toBe(true)
})

test('W-d1: readSettings reads rest as given, and anything else as 5', () => {
  const read = (options: unknown) => (readSettings(options as never, WALLPAPERS as never) as unknown as { rest?: unknown }).rest
  for (const v of ['off', '5', '15']) expect([v, read({ rest: v })]).toEqual([v, v])
  for (const junk of [undefined, 5, 15, 'Off', '10', '', true, null]) expect([junk, read({ rest: junk })]).toEqual([junk, '5'])
  expect(read({})).toBe('5')
})

test('W-d1: the settings pane has a rest row of three buttons right after motion, the setting\'s marked', () => {
  for (const today of ['off', '5', '15']) {
    const rows = paneRows(readSettings({ rest: today } as never, WALLPAPERS as never), WALLPAPERS as never) as unknown as { kind: string; controls?: { key: string; value: unknown; current?: boolean }[] }[]
    const names = rows.map(r => (r.kind === 'controls' ? (r.controls?.[0]?.key ?? '') : r.kind))
    expect([today, names.indexOf('rest')]).toEqual([today, names.indexOf('motion') + 1])
    const controls = rows.find(r => r.controls?.[0]?.key === 'rest')?.controls ?? []
    expect(controls.map(c => c.value)).toEqual(['off', '5', '15'])
    expect([today, controls.map(c => c.current === true)]).toEqual([today, ['off', '5', '15'].map(v => v === today)])
  }
})

test('W-d1: the mounted pane shows the rest buttons, and pressing one writes the option rest and nothing else', async ($, on) => {
  const rig = await begin($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const keys: string[] = []
  walk(await ui.drawn(), el => { if (el.type === 'Button') keys.push(String(el.props?.key ?? el.key ?? '')) })
  for (const key of ['rest:off', 'rest:5', 'rest:15']) expect([key, keys.includes(key)]).toEqual([key, true])
  await ui.press({ key: 'rest:15' })
  await ui.unmount()
  expect(rig.written).toEqual([{ key: 'CWallpaper.rest', value: '15' }])
})

// ================================================================ W-d2: glass at clear 0

test('W-d2: clear 0 sends the look with glass false', { options: { clear: 0, blur: 12 } }, async ($, on) => {
  const rig = await begin($, on)
  expect(rig.looks.length).toBe(1)
  expect(rig.looks[0]?.backdrop?.glass).toBe(false)
})

test('W-d2: clear 1 sends the glass of today: blur at least 0.1, opacity 0.99, no tint (pins today)', { options: { clear: 1, blur: 0 } }, async ($, on) => {
  const rig = await begin($, on)
  expect(rig.looks[0]?.backdrop?.glass).toEqual({ blur: 0.1, opacity: 0.99 })
})

test('W-d2: clear 1 with blur 12 sends blur 12 and opacity 0.99 (pins today)', { options: { clear: 1, blur: 12 } }, async ($, on) => {
  const rig = await begin($, on)
  expect(rig.looks[0]?.backdrop?.glass).toEqual({ blur: 12, opacity: 0.99 })
})

// ================================================================ W-d3: the fallback is tested in core-look.test.ts

// ================================================================ W-d4: whose theme stands

const INTRUDER = {
  name: 'intruder',
  register(on: Ctx) {
    on('command.run', { command: 'intrude' }, async ($: Ctx) => {
      await $.theme.set({ backdrop: { scene: 'aurora' } })
      return { text: 'done' }
    })
  },
}
const intrude = ($: Ctx) => $.command.run({ command: 'intrude', args: '' } as never)

/** A theme.set of this mod's own lands at once and answers a second later; any other answers at once. */
const slowOwn = (clock: () => ReturnType<typeof mock.clock> | undefined) => async (e: Look) => {
  if (e.backdrop?.scene === 'kiki' || e.backdrop?.scene === 'blackhole') await clock()?.sleep(1000)
  return { value: { isDrawn: true, requestId: 'backdrop' } }
}

test('W-d4: a theme set by another plugin clears lookSet (pins today)', { plugins: [INTRUDER] as never }, async ($, on) => {
  const rig = await begin($, on)
  expect(rig.kv.get('lookSet')).toBe(true)
  await intrude($)
  expect(rig.kv.get('lookSet')).toBe(false)
})

test('W-d4: a theme set by another plugin while one of this mod\'s own is in flight clears lookSet', { plugins: [INTRUDER] as never }, async ($, on) => {
  let clock: ReturnType<typeof mock.clock> | undefined
  const rig = await begin($, on, { theme: slowOwn(() => clock), start: false })
  clock = rig.clock
  const started = $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await rig.clock.advance(1000)
  await started
  expect(rig.kv.get('lookSet')).toBe(true)
  // This mod's own set lands, then another plugin's lands while the first has not answered yet.
  const own = $.command.run(wallpaper('clear 40'))
  await rig.clock.settle()
  expect(rig.looks.at(-1)?.backdrop?.scene).toBe('kiki')
  await intrude($)
  await rig.clock.settle()
  expect(rig.looks.at(-1)?.backdrop?.scene).toBe('aurora')
  expect(rig.kv.get('lookSet')).toBe(false)
  await rig.clock.advance(1000)
  await own
  // The other plugin's set landed last, so it still decides once this mod's own has answered.
  expect(['lookSet after the own set answers', rig.kv.get('lookSet')]).toEqual(['lookSet after the own set answers', false])
})

test('W-d4: this mod\'s own sets do not clear lookSet, also with two in flight together (pins today)', async ($, on) => {
  let clock: ReturnType<typeof mock.clock> | undefined
  const rig = await begin($, on, { theme: slowOwn(() => clock), start: false })
  clock = rig.clock
  const started = $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await rig.clock.advance(1000)
  await started
  const from = rig.stateWrites.length
  const both = Promise.all([$.command.run(wallpaper('clear 40')), $.command.run(wallpaper('blur 12'))])
  await rig.clock.settle()
  await rig.clock.advance(1000)
  await both
  await rig.clock.advance(1000)
  expect(rig.looks.length >= 3).toBe(true)
  expect(rig.stateWrites.slice(from).filter(([key, value]) => key === 'lookSet' && value !== true)).toEqual([])
  expect(rig.kv.get('lookSet')).toBe(true)
})

// ================================================================ W-d5: light rests the camera

// FNV-1a (32 bits) over the UTF-16 code units, and the length: today's smooth Kiki at noon, worked out on 2026-11-24
// from commit d244ade's source by this same function.
const fnv = (s: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
const kikiSource = (options: Record<string, unknown>): string => {
  const kiki = (WALLPAPERS as unknown as { id: string; svg: (s: unknown, now: number) => string }[]).find(w => w.id === 'kiki')
  return String(kiki?.svg(readSettings(options as never, WALLPAPERS as never), NOON))
}

test('W-d5: motion light gives a Kiki source with no camera animation, at every time of day', () => {
  for (const kikiTime of ['day', 'sunset', 'night']) {
    const light = kikiSource({ kikiTime, motion: 'light' })
    expect([kikiTime, light.includes('@keyframes')]).toEqual([kikiTime, true])
    expect([kikiTime, light.includes('w-cam')]).toEqual([kikiTime, false])
    expect([kikiTime, light.includes('translateY(-0.75px)')]).toEqual([kikiTime, false])
  }
})

test('W-d5: motion smooth is byte-identical to today\'s, camera included (pins today)', () => {
  const TODAY: Record<string, [number, string]> = { day: [84907, '58b34427'], sunset: [91555, 'a252892e'], night: [101035, '788b7c22'] }
  for (const [kikiTime, [length, hash]] of Object.entries(TODAY)) {
    const smooth = kikiSource({ kikiTime, motion: 'smooth' })
    expect([kikiTime, smooth.length, fnv(smooth)]).toEqual([kikiTime, length, hash])
    expect([kikiTime, smooth.includes('w-cam')]).toEqual([kikiTime, true])
  }
})

// ================================================================ W-d6: the Spinner hook

// Pinned at registration, not through the trace: a hook that does nothing cannot be told from no hook by what is
// drawn. Each test calls `register` itself with a recording `on` and the options of the case, and reads which
// events and filters the mod registered. The recorder answers with an object that has `catch`, since the mod
// chains `.catch` on some hooks.
type Registered = { event: unknown; filter: unknown }
function registeredWith(options: Record<string, unknown>): Registered[] {
  const calls: Registered[] = []
  const recorder = (event: unknown, ...rest: unknown[]) => {
    calls.push({ event, filter: typeof rest[0] === 'function' ? undefined : rest[0] })
    const handle: Ctx = { catch: () => handle }
    return handle
  }
  ;(register as Ctx)(recorder, options)
  return calls
}
const renderHooks = (calls: Registered[], component: string): number =>
  calls.filter(c => c.event === 'ui.render' && (c.filter as { component?: unknown } | undefined)?.component === component).length

test('W-d6: with the black hole no ui.render hook of this mod is registered on Spinner', () => {
  const calls = registeredWith({ wallpaper: 'blackhole' })
  expect(renderHooks(calls, 'Backdrop')).toBe(1)
  expect(renderHooks(calls, 'Spinner')).toBe(0)
})

test('W-d6: with Kiki and the cat spinner off no ui.render hook of this mod is registered on Spinner', () => {
  const calls = registeredWith({ kikiSpinner: false })
  expect(renderHooks(calls, 'Backdrop')).toBe(1)
  expect(renderHooks(calls, 'Spinner')).toBe(0)
})

test('W-d6: with Kiki and the wallpaper off no ui.render hook of this mod is registered on Spinner', () => {
  const calls = registeredWith({ on: false })
  expect(renderHooks(calls, 'Backdrop')).toBe(1)
  expect(renderHooks(calls, 'Spinner')).toBe(0)
})

test('W-d6: with Kiki, on, and the cat spinner on, exactly one Spinner hook is registered (pins today)', () => {
  const calls = registeredWith({})
  expect(renderHooks(calls, 'Backdrop')).toBe(1)
  expect(renderHooks(calls, 'Spinner')).toBe(1)
})

// ================================================================ W-d8: the black hole asks for the dark scheme

for (const colors of [true, false]) {
  test(`W-d8: with the black hole the look holds overrideColorScheme dark, App colors ${colors ? 'on' : 'off'}`, { options: { wallpaper: 'blackhole', colors } }, async ($, on) => {
    const rig = await begin($, on)
    expect(rig.looks.length).toBe(1)
    expect(rig.looks[0]?.overrideColorScheme).toBe('dark')
  })
  test(`W-d8: with Kiki the look names no colour scheme, App colors ${colors ? 'on' : 'off'} (pins today)`, { options: { colors } }, async ($, on) => {
    const rig = await begin($, on)
    expect(rig.looks.length).toBe(1)
    expect('overrideColorScheme' in (rig.looks[0] ?? {})).toBe(false)
  })
}

// ================================================================ W-d9: the minute timer's redraw wakes

test('W-d9: after the minute timer redraws Kiki for a new time of day, redraws follow 3 and 12 seconds later', { options: { rest: 'off' } as never }, async ($, on) => {
  // Kiki in auto turns from day to sunset at 17:30 (the default sun times); start two and a half minutes before.
  const start = local(17, 27, 30)
  const rig = await begin($, on, { now: start })
  const { clock } = rig
  const expected = (now: number): string => String((sceneFor(readSettings({} as never, WALLPAPERS as never), WALLPAPERS as never, now) as { source?: string }).source)
  const first = bare((await draw($, 'kiki')).source)
  expect(first).toBe(expected(start))
  // The ticks fall a minute apart from the first draw; find the first whose picture differs.
  let tick = start + MIN
  while (expected(tick) === first) tick += MIN
  expect(tick - start <= 4 * MIN).toBe(true)
  // "Later ticks" below holds only if the picture for the tick is also the picture of the next two ticks.
  expect(['picture at tick + 1 min is the tick\'s', expected(tick + MIN) === expected(tick)]).toEqual(['picture at tick + 1 min is the tick\'s', true])
  expect(['picture at tick + 2 min is the tick\'s', expected(tick + 2 * MIN) === expected(tick)]).toEqual(['picture at tick + 2 min is the tick\'s', true])
  // Up to the tick before it, nothing is asked for: the picture for now is the one drawn.
  await clock.advance(20_000)
  const before = rig.redraws()
  await clock.set(tick - 1)
  expect(rig.redraws()).toBe(before)
  // The tick asks for one redraw; the app draws; two wake draws follow.
  await clock.set(tick)
  expect(['at the tick', rig.redraws() - before]).toEqual(['at the tick', 1])
  const now = bare((await draw($, 'kiki')).source)
  expect(now).toBe(expected(tick))
  await clock.advance(3100)
  expect(['3 s after', rig.redraws() - before]).toEqual(['3 s after', 2])
  await clock.advance(9000)
  expect(['12 s after', rig.redraws() - before]).toEqual(['12 s after', 3])
  // The next tick has the drawn picture for now: nothing more.
  await clock.advance(2 * MIN)
  expect(['later ticks', rig.redraws() - before]).toEqual(['later ticks', 3])
})
