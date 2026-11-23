// Tests for the mod itself, hooks/register.tsx, as far as the test harness can drive it: the rules under "In the
// mod" in core-contract.md. The mod is thin wiring over hooks/core/*: it reads its options, sets the theme,
// answers the Backdrop render, runs `/wallpaper` and mounts the pane.
//
// HOW THE HARNESS HANDS THE MOD ITS OPTIONS, AND WHAT IT CAN SEE OF WHAT THE MOD WRITES (found out from the
// type file of the plugin kit, then tried):
//   * `test(name, { options: {...} }, body)` hands `register(on, options)` the manifest's `userConfig` values as
//     a real load does: the keys not given are the manifest's defaults, a given key must fit its declared type
//     (a wrong type fails the load with "<title> must be a <type>"), a string choice outside its `options` counts
//     as unset (its default), a key the manifest does not declare is taken without a word. So the options of a
//     test are the manifest's: until .claude-plugin/plugin.json declares the new keys, a test that passes one
//     is not talking to the mod at all.
//   * `$.config.set({ key, value })` made BY THE MOD reaches a hook the test registers with `on('config.set', ...)`
//     beneath every plugin. That hook sees `{ key, value }` where key is `<plugin>.<field>` (the field is the
//     manifest key: 'wallpaper.kikiTime'); `field()` below cuts it at the first dot, so this file does not depend
//     on how the engine spells the plugin's name. The hook must answer `{ value }` (or `{ deny }`).
//   * After a `config.set` the harness does NOT hand the mod new options (register ran once). So a rule that
//     says what the mod shows AFTER a command is a rule about the mod keeping its own copy of what it wrote.
//     Those tests are marked "(after a command)" and are the only ones that depend on it; the others start from
//     options.
//   * The pane is driven with `$.ui.mount` of the Pane and `press`; a Button's key is `<manifest key>:<value>`
//     ('wallpaper:blackhole', 'clear:90', 'kikiTime:night'), the one convention this file adds to the contract.
//
// This file imports no module of the new layout, so each test fails on its own assertion until the mod is
// rewritten.
import { expect, mock, test } from 'claude-code/testing'

import { checkColors } from '../hooks/make-colors.js'

const propsOf = (name: string, plugin = 'wallpaper') => ({ id: name, scene: name, plugin, glass: false }) as never
const BACKDROP = { plugin: 'wallpaper', component: 'Backdrop', props: propsOf('kiki') } as const
const PANE = {
  plugin: 'wallpaper',
  component: 'Pane',
  requestId: 'wallpaper-settings',
  props: { title: 'Wallpaper', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const SPINNER = { plugin: 'wallpaper', component: 'Spinner', props: { word: 'Thinking', message: null, suffix: '…', mode: 'thinking' } } as const
const wallpaper = (args: string) => ({ command: 'wallpaper', args }) as never

type Look = {
  backdrop?: { scene?: string; glass?: { blur?: number; opacity?: number; tint?: string } }
  colors?: { label?: string; inputs?: { light?: Record<string, string>; dark?: Record<string, string> } }
}
type Written = { field: string; value: unknown }
type Node = { type?: unknown; key?: unknown; props?: Record<string, unknown>; children?: unknown }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any

/** The manifest key a `config.set` names: what follows the plugin's name and its first dot. */
const field = (key: string): string => key.slice(key.indexOf('.') + 1)

type Seen = {
  looks: Look[]
  written: Written[]
  opened: { id?: string }[]
  cleared: number
  stray: string[]
  storeWrites: string[]
  clock: ReturnType<typeof mock.clock>
}

/**
 * Mocks, a started session and what the mod did meanwhile: the looks it set, the options it wrote through
 * `config.set`, the panes it opened, any use of ffmpeg or the files (there is none now), any write to the store.
 */
async function begin($: Ctx, on: Ctx, opts: { store?: Record<string, unknown>; now?: number; start?: boolean } = {}): Promise<Seen> {
  const clock = mock.clock(on, opts.now === undefined ? undefined : { now: opts.now })
  const kept = opts.store ?? {}
  const seen: Seen = { looks: [], written: [], opened: [], cleared: 0, stray: [], storeWrites: [], clock }
  on('command.register', () => ({ value: { command: 'wallpaper' } }))
  on('theme.set', (_: unknown, e: unknown) => { seen.looks.push(e as Look); return { value: { isDrawn: true, requestId: 'backdrop' } } })
  on('theme.clear', () => { seen.cleared += 1; return { value: { isDrawn: false, reason: 'cleared' } } })
  on('config.set', (_: unknown, e: { key: string; value: unknown }) => { seen.written.push({ field: field(e.key), value: e.value }); return { value: e.value } })
  on('ui.open', (_: unknown, e: { id?: string }) => { seen.opened.push(e); return { value: { isPlaced: true } } })
  on('store.get', (_: unknown, e: { key: string }) => ({ value: kept[e.key] }))
  on('store.set', (_: unknown, e: { key: string }) => { seen.storeWrites.push(e.key); return { value: undefined } })
  on('process.run', (_: unknown, e: { argv?: string[] }) => {
    seen.stray.push(`process.run ${String(e.argv?.[0])}`)
    return { value: { exitCode: 1, stdout: '', stderr: 'no', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', (_: unknown, e: { path: string }) => { seen.stray.push(`fs.exists ${e.path}`); return { value: false } })
  on('fs.read', (_: unknown, e: { path: string }) => { seen.stray.push(`fs.read ${e.path}`); return { value: '' } })
  on('fs.write', (_: unknown, e: { path: string }) => { seen.stray.push(`fs.write ${e.path}`); return { value: undefined } })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  if (opts.start !== false) await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  return seen
}

const walk = (node: unknown, visit: (el: Node) => void): void => {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach(n => walk(n, visit)); return }
  const el = node as Node
  visit(el)
  walk(el.children, visit)
  walk(el.props?.children, visit)
}
const svgsOf = async (ui: { drawn: () => Promise<unknown> }): Promise<Record<string, unknown>[]> => {
  const out: Record<string, unknown>[] = []
  walk(await ui.drawn(), el => { if (el.type === 'Svg' && typeof el.props?.source === 'string') out.push(el.props) })
  return out
}
/** The Backdrop of one scene, as the surface asks for it: every picture drawn, with its props. */
const drawnBy = async ($: Ctx, name = 'kiki', surface: 'desktop' | 'mobile' = 'desktop', plugin = 'wallpaper'): Promise<Record<string, unknown>[]> => {
  const ui = await $.ui.mount({ ...BACKDROP, surface, props: propsOf(name, plugin) })
  const out = await svgsOf(ui)
  await ui.unmount()
  return out
}
const sourceOf = async ($: Ctx, name = 'kiki'): Promise<string> => String((await drawnBy($, name))[0]?.source ?? '')
const WAKE_MARK = /<g id="kw[0-9a-z]+"\/>/g
const bare = (source: string): string => source.replace(WAKE_MARK, '')
const local = (h: number, m = 0): number => new Date(2026, 5, 15, h, m, 0).getTime()

/** Every Button of a mounted pane, with its key and label. */
const buttonsOf = async (ui: { drawn: () => Promise<unknown> }): Promise<{ key: string; label: string }[]> => {
  const out: { key: string; label: string }[] = []
  walk(await ui.drawn(), el => { if (el.type === 'Button') out.push({ key: String(el.props?.key ?? el.key ?? ''), label: String(el.props?.label ?? '') }) })
  return out
}
/** Whether a mounted drawing shows a Text that matches. */
const shows = async (ui: { find: (q: { type: string; text: RegExp }) => Promise<unknown> }, text: RegExp): Promise<boolean> =>
  (await ui.find({ type: 'Text', text })) !== undefined

// ------------------------------------------------ the options decide everything

test('with no options the mod is on and shows Kiki, clear and unblurred, in her own colors, in one call', async ($, on) => {
  const seen = await begin($, on)
  expect(seen.looks.length).toBe(1)
  const look = seen.looks[0]
  expect(look?.backdrop?.scene).toBe('kiki')
  // Clear, and never an exact zero, which a surface may read as "not given".
  expect(look?.backdrop?.glass?.opacity).toBe(0.01)
  expect(look?.backdrop?.glass?.blur).toBe(0.1)
  expect(look?.backdrop?.glass?.tint).toBe('rgba(0,0,0,0)')
  expect(look?.colors?.label).toBe('Kiki night')
  expect(Object.keys(look?.colors?.inputs?.light ?? {}).length > 50).toBe(true)
  expect(Object.keys(look?.colors?.inputs?.dark ?? {}).length > 50).toBe(true)
  expect(seen.cleared).toBe(0)
})

test('the option `wallpaper` decides which wallpaper the look and the Backdrop are', { options: { wallpaper: 'blackhole' } }, async ($, on) => {
  const seen = await begin($, on)
  expect(seen.looks.at(-1)?.backdrop?.scene).toBe('blackhole')
  expect(seen.looks.at(-1)?.colors?.label).not.toBe('Kiki night')
  const drawn = await drawnBy($, 'blackhole')
  expect(drawn.length).toBe(1)
  // The black hole's still picture under its shader, not Kiki's pixel art (the Shader itself is
  // blackhole-backdrop.test.tsx's).
  const source = String(drawn[0]?.source)
  expect(source.startsWith('<svg')).toBe(true)
  expect(source.includes('viewBox="0 0 320 180"')).toBe(false)
  expect(String(drawn[0]?.alt).length > 0).toBe(true)
})

test('the options `clear` and `blur` decide the glass: 40% clear is 0.6 opaque, and the blur is as given', { options: { clear: 40, blur: 12 } }, async ($, on) => {
  const seen = await begin($, on)
  expect(seen.looks.at(-1)?.backdrop?.glass?.opacity).toBe(0.6)
  expect(seen.looks.at(-1)?.backdrop?.glass?.blur).toBe(12)
  expect(seen.looks.at(-1)?.backdrop?.glass?.tint).toBeUndefined()
})

test('the option `colors` off leaves the app its own colors', { options: { colors: false } }, async ($, on) => {
  const seen = await begin($, on)
  expect(seen.looks.length).toBe(1)
  expect(seen.looks[0]?.backdrop?.scene).toBe('kiki')
  expect(seen.looks[0]?.colors).toBeUndefined()
})

test('the option `motion` off gives a still Kiki, light and smooth a moving one', { options: { motion: 'off' } }, async ($, on) => {
  await begin($, on)
  const drawn = await drawnBy($)
  expect(drawn.length).toBe(1)
  const still = String(drawn[0]?.source)
  expect(still.startsWith('<svg')).toBe(true)
  expect(still.includes('@keyframes')).toBe(false)
  expect(still.includes('<animate')).toBe(false)
  // A still scene needs no wake draws: it carries no mark.
  expect(still === bare(still)).toBe(true)
})

test('the option `motion` off gives the still black hole', { options: { wallpaper: 'blackhole', motion: 'off' } }, async ($, on) => {
  await begin($, on)
  const still = await sourceOf($, 'blackhole')
  expect(still.startsWith('<svg')).toBe(true)
  expect(still.includes('@keyframes')).toBe(false)
  expect(still.includes('animation')).toBe(false)
})

test('the option `motion` light gives a moving Kiki', { options: { motion: 'light' } }, async ($, on) => {
  await begin($, on)
  expect((await sourceOf($)).includes('@keyframes')).toBe(true)
})

test('the option `dim` decides the veil laid inside Kiki\'s picture: 0 is none, 80 is the darkest', { options: { dim: 80 } }, async ($, on) => {
  await begin($, on)
  expect(bare(await sourceOf($)).endsWith('<rect width="100%" height="100%" fill="#000" opacity="0.8"/></svg>')).toBe(true)
})

test('the option `dim` 0 lays no veil', { options: { dim: 0 } }, async ($, on) => {
  await begin($, on)
  expect((await sourceOf($)).includes('fill="#000" opacity')).toBe(false)
})

test('the option `on` off sets no look at the start', { options: { on: false } }, async ($, on) => {
  const seen = await begin($, on)
  expect(seen.looks.length).toBe(0)
  expect(String((await $.command.run(wallpaper(''))).text)).toMatch(/The wallpaper is off/)
})

test('no setting is read from the store: an old store of 1.9.0\'s settings changes nothing, and nothing is written there', async ($, on) => {
  const seen = await begin($, on, {
    store: { settings: { theme: 'blackhole', isOn: false, clear: 40, blur: 12, dim: 0, colors: false, motion: 'off', kikiTime: 'day', picture: 'user/p.svg', film: '' } },
  })
  expect(seen.looks.length).toBe(1)
  expect(seen.looks[0]?.backdrop?.scene).toBe('kiki')
  expect(seen.looks[0]?.backdrop?.glass?.opacity).toBe(0.01)
  expect(seen.looks[0]?.colors?.label).toBe('Kiki night')
  expect((await sourceOf($)).includes('@keyframes')).toBe(true)
  await $.command.run(wallpaper('clear 40'))
  await $.command.run(wallpaper('off'))
  expect(seen.storeWrites).toEqual([])
})

for (const name of ['picture', 'video', 'my-picture', 'my-video']) {
  test(`options that name \`${name}\` show Kiki`, { options: { wallpaper: name } }, async ($, on) => {
    const seen = await begin($, on)
    expect(seen.looks.at(-1)?.backdrop?.scene).toBe('kiki')
    expect(seen.looks.at(-1)?.colors?.label).toBe('Kiki night')
    expect((await sourceOf($)).includes('viewBox="0 0 320 180"')).toBe(true)
    expect(seen.stray).toEqual([])
  })
}

// ------------------------------------------------ what `/wallpaper` writes

/** Commands that write one option through `$.config.set`, and what they write; the wallpaper is Kiki and on. */
const WRITES: [string, string, unknown][] = [
  ['blackhole', 'wallpaper', 'blackhole'],
  ['black-hole', 'wallpaper', 'blackhole'],
  ['hole', 'wallpaper', 'blackhole'],
  ['kiki', 'wallpaper', 'kiki'],
  ['off', 'on', false],
  ['motion light', 'motion', 'light'],
  ['motion off', 'motion', 'off'],
  ['clear 40', 'clear', 40],
  ['blur 12', 'blur', 12],
  ['dim 0', 'dim', 0],
  ['dim 80', 'dim', 80],
  ['colors off', 'colors', false],
  ['fps on', 'fps', true],
  ['time night', 'kikiTime', 'night'],
  ['spinner off', 'kikiSpinner', false],
]
for (const [text, key, value] of WRITES) {
  test(`/wallpaper ${text} writes the option ${key} through config.set, and answers with the status line`, async ($, on) => {
    const seen = await begin($, on)
    const answer = await $.command.run(wallpaper(text))
    expect(seen.written).toEqual([{ field: key, value }])
    expect(typeof answer.text).toBe('string')
    expect(String(answer.text)).toMatch(/The wallpaper is/)
    expect(seen.storeWrites).toEqual([])
    expect(seen.stray).toEqual([])
  })
}

test('/wallpaper on, while the look is off, writes `on`', { options: { on: false } }, async ($, on) => {
  const seen = await begin($, on)
  await $.command.run(wallpaper('on'))
  expect(seen.written).toEqual([{ field: 'on', value: true }])
})

test('a wallpaper\'s name while the look is off writes the wallpaper, then `on`', { options: { on: false } }, async ($, on) => {
  const seen = await begin($, on)
  await $.command.run(wallpaper('blackhole'))
  expect(seen.written).toEqual([{ field: 'wallpaper', value: 'blackhole' }, { field: 'on', value: true }])
})

test('/wallpaper blackhole while the look is on writes the wallpaper alone', { options: { wallpaper: 'blackhole' } }, async ($, on) => {
  const seen = await begin($, on)
  await $.command.run(wallpaper('kiki'))
  expect(seen.written).toEqual([{ field: 'wallpaper', value: 'kiki' }])
})

test('a command that is wrong writes nothing, answers with its error, and runs nothing outside', async ($, on) => {
  const seen = await begin($, on)
  const say = async (text: string): Promise<string> => String((await $.command.run(wallpaper(text))).text)
  // A number outside its range, or not a whole number: the range is named.
  for (const [text, hi] of [['clear 101', 100], ['clear -1', 100], ['blur 41', 40], ['dim 81', 80], ['dim 12.5', 80], ['clear abc', 100]] as const) {
    const said = await say(text)
    expect([text, new RegExp(`\\b0\\b\\D+\\b${hi}\\b`).test(said)]).toEqual([text, true])
  }
  expect(await say('motion steps')).toMatch(/motion/)
  expect(await say('moonbase')).toMatch(/moonbase/)
  expect(await say('moonbase')).toMatch(/\/wallpaper help/)
  expect(await say('time dusk')).toMatch(/time/)
  // The loaders are gone: no ffmpeg, no file, only the words.
  for (const text of ['picture C:/Pictures/harbour.png', 'video C:/Videos/waves.mp4']) {
    const said = await say(text)
    expect([text, /removed/i.test(said) && /repository/i.test(said)]).toEqual([text, true])
  }
  expect(seen.written).toEqual([])
  expect(seen.stray).toEqual([])
  expect(seen.looks.length).toBe(1)
})

test('an option of another wallpaper is refused with whose it is and which wallpaper is on', { options: { wallpaper: 'blackhole' } }, async ($, on) => {
  const seen = await begin($, on)
  expect((await $.command.run(wallpaper('time night'))).text).toBe('Time of day belongs to Kiki. The wallpaper is Black hole.')
  expect((await $.command.run(wallpaper('spinner off'))).text).toBe('Cat spinner belongs to Kiki. The wallpaper is Black hole.')
  expect(seen.written).toEqual([])
})

test('the status line says the wallpaper and its options as the mod was given them, in one or two lines', { options: { wallpaper: 'blackhole', clear: 40, blur: 12, dim: 0, motion: 'light' } }, async ($, on) => {
  await begin($, on)
  const text = String((await $.command.run(wallpaper(''))).text)
  expect(text).toMatch(/The wallpaper is Black hole\./)
  expect(text).toMatch(/Panels 40% clear, blur 12, scene dimmed 0%/)
  expect(text).toMatch(/motion light/)
  expect(/Kiki time|picture|video/i.test(text)).toBe(false)
  expect(text.split('\n').filter(l => l.trim() !== '').length <= 2).toBe(true)
})

test('the status line of Kiki holds her time of day', { options: { kikiTime: 'night' } }, async ($, on) => {
  await begin($, on)
  expect(String((await $.command.run(wallpaper(''))).text)).toMatch(/Kiki time: night/)
})

test('/wallpaper help lists the commands and the wallpapers, and says nothing of a picture or a video', async ($, on) => {
  await begin($, on)
  const help = String((await $.command.run(wallpaper('help'))).text)
  for (const word of ['settings', 'kiki', 'blackhole', 'motion', 'clear', 'blur', 'dim', 'colors', 'fps', 'time', 'spinner']) {
    expect([word, help.includes(word)]).toEqual([word, true])
  }
  expect(/picture|video|ffmpeg/i.test(help)).toBe(false)
  expect(/valley|weather/i.test(help)).toBe(false)
})

test('/wallpaper settings opens the pane', async ($, on) => {
  const seen = await begin($, on)
  const answer = await $.command.run(wallpaper('settings'))
  expect(seen.opened.length).toBe(1)
  expect(seen.opened[0]?.id).toBe('wallpaper-settings')
  expect(String(answer.text)).toMatch(/open/i)
  expect(seen.written).toEqual([])
})

// ------------------------------------------------ after a command (the mod keeps its own copy of what it wrote)

test('the status line after a command says the new value (after a command)', async ($, on) => {
  await begin($, on)
  expect(String((await $.command.run(wallpaper('motion off'))).text)).toMatch(/motion off/)
  expect(String((await $.command.run(wallpaper('clear 40'))).text)).toMatch(/Panels 40% clear/)
  expect(String((await $.command.run(wallpaper('blackhole'))).text)).toMatch(/The wallpaper is Black hole\./)
})

test('the look follows a command at once: the wallpaper, the motion, the dials, off and on (after a command)', async ($, on) => {
  const seen = await begin($, on)
  await $.command.run(wallpaper('motion off'))
  expect((await sourceOf($)).includes('@keyframes')).toBe(false)
  await $.command.run(wallpaper('motion smooth'))
  expect((await sourceOf($)).includes('@keyframes')).toBe(true)
  await $.command.run(wallpaper('clear 40'))
  expect(seen.looks.at(-1)?.backdrop?.glass?.opacity).toBe(0.6)
  await $.command.run(wallpaper('blackhole'))
  expect(seen.looks.at(-1)?.backdrop?.scene).toBe('blackhole')
  expect((await sourceOf($, 'blackhole')).startsWith('<svg')).toBe(true)
  await $.command.run(wallpaper('off'))
  expect(seen.cleared).toBe(1)
  const before = seen.looks.length
  await $.command.run(wallpaper('on'))
  expect(seen.looks.length > before).toBe(true)
  expect(seen.looks.at(-1)?.backdrop?.scene).toBe('blackhole')
})

// ------------------------------------------------ the cat spinner

const spinnerSuffixes = async ($: Ctx, on: Ctx): Promise<string[]> => {
  const seen: string[] = []
  on('ui.render', { component: 'Spinner' }, ($: Ctx, e: { props: { suffix?: unknown } }) => {
    seen.push(String(e.props.suffix))
    const { Text } = $.ui.resolve(e)
    return <Text>spinning</Text>
  })
  await begin($, on)
  const ui = await $.ui.mount({ ...SPINNER, surface: 'desktop' })
  await ui.unmount()
  return seen
}
const FACE = /=\^.\^=/

test('the option `kikiSpinner` is on by default: Kiki\'s cat face goes on the spinner', async ($, on) => {
  const seen = await spinnerSuffixes($, on)
  expect(seen.length).toBe(1)
  expect(FACE.test(seen[0] ?? '')).toBe(true)
})

test('the option `kikiSpinner` off leaves the spinner as the app draws it', { options: { kikiSpinner: false } }, async ($, on) => {
  const seen = await spinnerSuffixes($, on)
  expect(seen).toEqual(['…'])
})

test('the cat face belongs to Kiki: with the black hole, or with the look off, the spinner is the app\'s', { options: { wallpaper: 'blackhole' } }, async ($, on) => {
  const seen = await spinnerSuffixes($, on)
  expect(seen).toEqual(['…'])
})

test('with the look off the spinner is the app\'s too', { options: { on: false } }, async ($, on) => {
  const seen = await spinnerSuffixes($, on)
  expect(seen).toEqual(['…'])
})

// ------------------------------------------------ the pane

test('the pane shows a button for each wallpaper, on, motion, the numbers, colors and Show FPS, on every surface', async ($, on) => {
  await begin($, on)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const keys = (await buttonsOf(ui)).map(b => b.key)
    for (const key of [
      'wallpaper:kiki', 'wallpaper:blackhole', 'on:false', 'motion:smooth', 'motion:light', 'motion:off',
      'clear:90', 'clear:100', 'blur:0', 'blur:4', 'dim:20', 'dim:40', 'colors:false', 'fps:true',
    ]) {
      expect([surface, key, keys.includes(key)]).toEqual([surface, key, true])
    }
    await ui.unmount()
  }
})

test('with Kiki on, the pane shows Kiki\'s time and spinner and no other wallpaper\'s options', async ($, on) => {
  await begin($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const keys = (await buttonsOf(ui)).map(b => b.key)
  for (const key of ['kikiTime:auto', 'kikiTime:day', 'kikiTime:sunset', 'kikiTime:night', 'kikiSpinner:false']) expect([key, keys.includes(key)]).toEqual([key, true])
  expect(keys.some(k => k.startsWith('blackhole'))).toBe(false)
  expect(await shows(ui, /Kiki/)).toBe(true)
  await ui.unmount()
})

test('with the black hole on, the pane shows no Kiki row', { options: { wallpaper: 'blackhole' } }, async ($, on) => {
  await begin($, on)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const keys = (await buttonsOf(ui)).map(b => b.key)
    expect([surface, keys.includes('wallpaper:blackhole'), keys.includes('wallpaper:kiki')]).toEqual([surface, true, true])
    expect([surface, keys.some(k => k.startsWith('kiki'))]).toEqual([surface, false])
    await ui.unmount()
  }
})

test('the two wallpaper buttons are neighbours in one row, labelled by their names', { options: { wallpaper: 'blackhole' } }, async ($, on) => {
  await begin($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  let neighbours = false
  const labels: string[] = []
  walk(await ui.drawn(), el => {
    const kids = Array.isArray(el.children) ? (el.children as Node[]) : []
    const keys = kids.map(k => String(k?.props?.key ?? ''))
    const at = keys.indexOf('wallpaper:kiki')
    const to = keys.indexOf('wallpaper:blackhole')
    if (at >= 0 && to >= 0) {
      neighbours = Math.abs(at - to) === 1
      labels.push(String(kids[at]?.props?.label ?? ''), String(kids[to]?.props?.label ?? ''))
    }
  })
  expect(neighbours).toBe(true)
  expect(labels).toEqual(['Kiki', 'Black hole'])
  await ui.unmount()
})

test('with Show FPS on, an svg wallpaper\'s pane says its frame rate cannot be measured; with it off, nothing', { options: { fps: true } }, async ($, on) => {
  await begin($, on)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect([surface, await shows(ui, /frame rate/i)]).toEqual([surface, true])
    expect([surface, (await buttonsOf(ui)).map(b => b.key).includes('fps:false')]).toEqual([surface, true])
    await ui.unmount()
  }
})

test('with Show FPS on and the black hole on, there is no note: a shader draws its own frame rate', { options: { fps: true, wallpaper: 'blackhole' } }, async ($, on) => {
  await begin($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await shows(ui, /cannot be measured/i)).toBe(false)
  expect(await shows(ui, /frame rate/i)).toBe(false)
  await ui.unmount()
})

test('with Show FPS off there is no note', async ($, on) => {
  await begin($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await shows(ui, /frame rate/i)).toBe(false)
  await ui.unmount()
})

/** Buttons of the pane that are pressed, and the one option each writes. */
const PRESSES: [string, string, unknown][] = [
  ['wallpaper:blackhole', 'wallpaper', 'blackhole'],
  ['wallpaper:kiki', 'wallpaper', 'kiki'],
  ['on:false', 'on', false],
  ['motion:off', 'motion', 'off'],
  ['motion:light', 'motion', 'light'],
  ['clear:90', 'clear', 90],
  ['blur:4', 'blur', 4],
  ['dim:40', 'dim', 40],
  ['dim:20', 'dim', 20],
  ['colors:false', 'colors', false],
  ['fps:true', 'fps', true],
  ['kikiTime:night', 'kikiTime', 'night'],
  ['kikiSpinner:false', 'kikiSpinner', false],
]
for (const [key, option, value] of PRESSES) {
  test(`pressing ${key} in the pane writes the option ${option} = ${String(value)} and nothing else`, async ($, on) => {
    const seen = await begin($, on)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key })
    await ui.unmount()
    expect(seen.written).toEqual([{ field: option, value }])
    expect(seen.storeWrites).toEqual([])
  })
}

test('pressing a wallpaper in the pane while the look is off writes the wallpaper alone', { options: { on: false } }, async ($, on) => {
  const seen = await begin($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'wallpaper:blackhole' })
  await ui.unmount()
  expect(seen.written).toEqual([{ field: 'wallpaper', value: 'blackhole' }])
})

// ------------------------------------------------ colors and the others' backdrops

test('the black hole\'s colors are a dark set with an amber accent the app will paint', { options: { wallpaper: 'blackhole' } }, async ($, on) => {
  const seen = await begin($, on)
  const colors = seen.looks.at(-1)?.colors
  expect(colors).toBeDefined()
  const dark = colors?.inputs?.dark ?? {}
  expect(Object.keys(dark).length > 50).toBe(true)
  expect(/^#[0-9a-f]{6}$/i.test(dark['role-accent-fill'] ?? '')).toBe(true)
  expect(checkColors(colors).filter((line: string) => line.startsWith("Desktop won't paint"))).toEqual([])
})

test('a backdrop of another mod with a name of ours is left to it, while ours is drawn', { options: { wallpaper: 'blackhole' } }, async ($, on) => {
  on('ui.render', ($: Ctx, e: unknown) => {
    const { Text } = $.ui.resolve(e)
    return <Text>theirs</Text>
  })
  await begin($, on)
  expect((await drawnBy($, 'blackhole')).length).toBe(1)
  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop', props: propsOf('blackhole', 'other') })
  expect((await ui.find({ type: 'Text', text: /theirs/ }))?.text).toBe('theirs')
  expect((await svgsOf(ui)).length).toBe(0)
  await ui.unmount()
})
