// Tests for Kiki inside the mod: hooks/register.tsx and what the Backdrop shows, rewritten for the rebuild (see
// core-contract.md). What 1.9.0 had these tests set with `/cwallpaper` commands and keep in the mod's store is now
// the plugin's options (the manifest's `userConfig`, handed to the test as `{ options }`): see
// core-backdrop.test.tsx for how the harness drives options and what the mod writes with `$.config.set`.
//
// This file imports no module of the new layout, so each test fails on its own assertion until the mod is
// rewritten. It was split four ways for that reason (a file that imports a module that does not exist fails to
// load as a whole): the two long tests of Kiki's own picture are kiki-look.test.ts, the sun's are kiki-sun.test.ts,
// and the time-of-day tests that compare the Backdrop with the core's `sceneFor` are backdrop-time.test.tsx.
//
// WHAT WAS DROPPED, and why:
//   * "motion off / smooth / steps" at the end of the first test, "light stays light after a reload of the
//     settings", the old valley's saved place, the status line's "Last draw" and "Wake draws so far" and its
//     "following the clock, with sunrise at..." lines, and the command usage line ("Usage: /cwallpaper motion ...")
//     are gone: the contract's status is a pure function of the settings and its errors are core-commands.test.ts's.
//     The motion option's still picture is pinned in core-backdrop.test.tsx.
//   * The picture and video loaders' test is deleted with the loaders.
import { expect, mock, test } from 'claude-code/testing'

// A backdrop's props name it by `scene` (and by `id` before Claude Code 2.1.323):
// both are given, so the test reads the same on either build.
const propsOf = (name: string, plugin = 'CWallpaper') => ({ id: name, scene: name, plugin, glass: false }) as never
const BACKDROP = { plugin: 'CWallpaper', component: 'Backdrop', props: propsOf('kiki') } as const
const PANE = {
  plugin: 'CWallpaper',
  component: 'Pane',
  requestId: 'cwallpaper-settings',
  props: { title: 'Wallpaper', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const wallpaper = (args: string) => ({ command: 'cwallpaper', args }) as never
// Local noon: Kiki follows the clock, and noon is day everywhere.
const local = (h: number, m = 0): number => new Date(2026, 5, 15, h, m, 0).getTime()
const NOON = local(12)

type Look = {
  backdrop?: { scene?: string; glass?: { blur?: number; opacity?: number; tint?: string }; image?: { source?: string } }
  colors?: { label?: string; inputs?: { light?: object; dark?: object } }
}

// Every Svg element drawn, with its props.
const svgs = async (ui: { drawn: () => Promise<unknown> }): Promise<Record<string, unknown>[]> => {
  const out: Record<string, unknown>[] = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    const el = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown }
    if (el.type === 'Svg' && typeof el.props?.source === 'string') out.push(el.props)
    walk(el.children)
    walk(el.props?.children)
  }
  walk(await ui.drawn())
  return out
}

const sources = async (ui: { drawn: () => Promise<unknown> }): Promise<string[]> => (await svgs(ui)).map(p => String(p.source))
// Every picture of a drawing, bottom to top, as one string. Each scene is one
// picture now; joining keeps a comparison honest should a drawing ever hold more.
const whole = async (ui: { drawn: () => Promise<unknown> }): Promise<string> => (await sources(ui)).join('')

// A source without the invisible mark a wake draw adds, so the app builds a new image.
const WAKE_MARK = /<g id="kw[0-9a-z]+"\/>/g
const bare = (source: string): string => source.replace(WAKE_MARK, '')

test('kiki is set at the start, clear and dimmed, drawn as one image, and holds still across turns', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const themes: Look[] = []
  on('command.register', () => ({ value: { command: 'cwallpaper' } }))
  on('theme.set', (_, e) => { themes.push(e as Look); return { value: { isDrawn: true, requestId: 'backdrop' } } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // One call carries the whole look: the scene, clear glass and the app's colors in both modes.
  expect(themes.length).toBe(1)
  expect(themes[0]?.backdrop?.scene).toBe('kiki')
  // Clear, and never an exact zero, which a surface may read as "not given".
  expect(themes[0]?.backdrop?.glass?.opacity).toBe(0.01)
  expect(themes[0]?.backdrop?.glass?.blur).toBe(0.1)
  expect(themes[0]?.backdrop?.glass?.tint).toBe('rgba(0,0,0,0)')
  expect(Object.keys(themes[0]?.colors?.inputs?.light ?? {}).length > 50).toBe(true)
  expect(Object.keys(themes[0]?.colors?.inputs?.dark ?? {}).length > 50).toBe(true)

  let first = ''
  for (const surface of ['desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BACKDROP, surface })
    const drawn = await svgs(ui)
    // The scene as one picture for the whole window, the dimming inside it: the
    // desktop app stood a stack of pictures still while one picture moved. An
    // image (not a frame) within the size an Svg takes.
    expect(drawn.length).toBe(1)
    for (const leaf of drawn) {
      expect(leaf.isInteractive === true).toBe(false)
      expect(String(leaf.source).startsWith('<svg')).toBe(true)
      expect(String(leaf.source).length < 131072).toBe(true)
    }
    // The whole answer also stays well inside the app's budget for one drawing (262144).
    expect(drawn.reduce((n, d) => n + String(d.source).length + String(d.alt).length, 0) < 200_000).toBe(true)
    // It moves, so it carries its animation.
    expect(String(drawn[0]?.source ?? '').includes('@keyframes')).toBe(true)
    // Pixel art as filled rectangles: no strokes (too slow to
    // repaint), no images placed inside (the app does not draw them); and motion
    // by transforms and stepped visibility, never a fade.
    const idle = drawn.map(d => String(d.source)).join('')
    expect(idle.includes('viewBox="0 0 320 180"')).toBe(true)
    // Never crisp edges: the desktop app stops animating a picture that sets them.
    expect(idle.includes('shape-rendering')).toBe(false)
    expect(idle.includes('<path fill="#')).toBe(true)
    expect(idle.includes('stroke')).toBe(false)
    expect(idle.includes('<image')).toBe(false)
    // No keyframes animate opacity (read in the style sheets alone: the veil's opacity is a still attribute).
    const css = [...idle.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1] ?? '').join('')
    expect(css.length > 0).toBe(true)
    expect(css.includes('opacity')).toBe(false)
    // Dimmed by the default 30%, painted last inside the picture, over all of it.
    expect(bare(idle).endsWith('<rect width="100%" height="100%" fill="#000" opacity="0.3"/></svg>')).toBe(true)
    first = idle
    await ui.unmount()
  }

  // The same source through a turn and after time passes: nothing new to draw.
  await $.turn.start({ text: 'hello', turnId: 't1' })
  let ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
  expect((await whole(ui)) === first).toBe(true)
  await ui.unmount()
  await $.turn.complete({ answer: 'hi', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
  expect((await whole(ui)) === first).toBe(true)
  await ui.unmount()
  // A few seconds on, a wake draw: the same picture under a fresh invisible mark.
  await clock.advance(3100)
  ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
  const woke = await whole(ui)
  expect(woke === first).toBe(false)
  expect(bare(woke) === first).toBe(true)
  await ui.unmount()

})

test('every scene is drawn as images, and drawn afresh a few seconds after it first shows', async ($, on) => {
  // Local noon: the kiki scene follows the clock, and noon is day everywhere.
  const clock = mock.clock(on, { now: new Date(2026, 5, 15, 12, 0, 0).getTime() })
  mock.store(on)
  let redraws = 0
  on('command.register', () => ({ value: { command: 'cwallpaper' } }))
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'backdrop' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.invalidate', () => { redraws += 1; return { value: undefined } })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // One drawing: every picture's source joined, the first one's label, how many.
  const draw = async (name = 'kiki'): Promise<{ source: string; alt: string; framed: boolean; n: number }> => {
    const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop', props: propsOf(name) })
    const drawn = await svgs(ui)
    await ui.unmount()
    return { source: drawn.map(d => String(d.source)).join(''), alt: String(drawn[0]?.alt ?? ''), framed: drawn.some(d => d.isInteractive === true), n: drawn.length }
  }
  const first = await draw()
  const firstSource = first.source
  expect(first.n).toBe(1)
  expect(first.framed).toBe(false)
  expect(first.alt.length > 0).toBe(true)
  expect(firstSource === bare(firstSource)).toBe(true)

  // Two wake draws after the first draw, at about 3 and 12 seconds: each asks
  // for a redraw, and draws the same picture under the same label with a fresh
  // mark, so the app builds a new image while the backdrop shows.
  const before = redraws
  await clock.advance(1600)
  expect(redraws).toBe(before)
  expect((await draw()).source === firstSource).toBe(true)
  await clock.advance(1500)
  expect(redraws).toBe(before + 1)
  const woke1 = await draw()
  const woke1Source = woke1.source
  expect(woke1Source === firstSource).toBe(false)
  expect(bare(woke1Source) === firstSource).toBe(true)
  expect(woke1.alt === first.alt).toBe(true)
  await clock.advance(9000)
  expect(redraws).toBe(before + 2)
  const woke2Source = (await draw()).source
  expect(woke2Source === woke1Source).toBe(false)
  expect(bare(woke2Source) === firstSource).toBe(true)

  // Then it holds: a minute on (one tick of the time-of-day timer, the same
  // phase), nothing asks for a redraw.
  await clock.advance(60_000)
  expect(redraws).toBe(before + 2)

  // A draw the mod did not ask for (the app drew the backdrop afresh) shows the
  // same source, and is followed by wake draws of its own at 3 and 12 seconds.
  const appDraw = (await draw()).source
  expect(appDraw === woke2Source).toBe(true)
  await clock.advance(3100)
  expect(redraws).toBe(before + 3)
  expect(bare((await draw()).source) === firstSource).toBe(true)
  await clock.advance(9000)
  expect(redraws).toBe(before + 4)

  // Another such draw within two minutes of that one brings no more of them.
  await clock.advance(60_000)
  await draw()
  await clock.advance(13_000)
  expect(redraws).toBe(before + 4)

  // /cwallpaper with no words draws it afresh and answers with the status line.
  const said = await $.command.run(wallpaper(''))
  expect(said.text).toMatch(/The wallpaper is Kiki\./)
  expect(String(said.text).includes('Fresh frames')).toBe(false)
  expect(redraws).toBe(before + 5)

  // Never crisp edges in a scene: the desktop app would not animate it.
  expect(firstSource.includes('shape-rendering')).toBe(false)
})

test('a first draw that comes late, after the early wake draws, is still drawn afresh twice', async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 5, 15, 12, 0, 0).getTime() })
  mock.store(on)
  let redraws = 0
  on('command.register', () => ({ value: { command: 'cwallpaper' } }))
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'backdrop' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.invalidate', () => { redraws += 1; return { value: undefined } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const draw = async (): Promise<string> => {
    const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
    const source = await whole(ui)
    await ui.unmount()
    return source
  }

  // The app is slow to show the backdrop: the wake draws counted from the
  // start come and go before its first draw, which lands just after the last.
  await clock.advance(13_000)
  const start = redraws
  const late = await draw()
  await clock.advance(3100)
  expect(redraws).toBe(start + 1)
  const woke = await draw()
  expect(woke === late).toBe(false)
  expect(bare(woke) === bare(late)).toBe(true)
  await clock.advance(9000)
  expect(redraws).toBe(start + 2)
  // Every wake mark is new.
  expect((await draw()) === woke).toBe(false)
})

test('a saved valley is gone: options that name the old pixel valley draw Kiki, its words are no longer commands, the help names none', { options: { wallpaper: 'pixel-valley' } }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const themes: Look[] = []
  const written: unknown[] = []
  on('command.register', () => ({ value: { command: 'cwallpaper' } }))
  on('theme.set', (_, e) => { themes.push(e as Look); return { value: { isDrawn: true, requestId: 'backdrop' } } })
  on('config.set', (_, e) => { written.push(e); return { value: (e as { value: never }).value } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(themes.at(-1)?.backdrop?.scene).toBe('kiki')
  expect(themes.at(-1)?.colors?.label).toBe('Kiki night')
  const said = await $.command.run(wallpaper(''))
  expect(said.text).toMatch(/The wallpaper is Kiki\./)
  // Asked for by name, the old valley is a backdrop of nobody's: left to the app.
  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop', props: propsOf('pixel-valley') })
  expect((await sources(ui)).length).toBe(0)
  await ui.unmount()

  // Its words are no longer commands, and the help names none of them.
  for (const word of ['valley', 'pixel-valley', 'city Birmingham', 'auto', 'refresh', 'preview night']) {
    const answer = String((await $.command.run(wallpaper(word))).text)
    expect([word, answer.toLowerCase().includes((word.split(' ')[0] ?? '').toLowerCase())]).toEqual([word, true])
    expect([word, answer.includes('/cwallpaper help')]).toEqual([word, true])
  }
  expect(written).toEqual([])
  const help = String((await $.command.run(wallpaper('help'))).text)
  expect(/valley|weather/i.test(help)).toBe(false)
})

test('the settings pane picks the kiki time: it writes the option kikiTime', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const written: { key: string; value: unknown }[] = []
  on('command.register', () => ({ value: { command: 'cwallpaper' } }))
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'backdrop' } }))
  on('config.set', (_, e) => { written.push(e as { key: string; value: unknown }); return { value: (e as { value: never }).value } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const t of ['auto', 'day', 'sunset', 'night']) expect(await ui.find({ key: `kikiTime:${t}` })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'kikiTime:sunset' })
  await ui.unmount()
  expect(written.map(w => [w.key.slice(w.key.indexOf('.') + 1), w.value])).toEqual([['kikiTime', 'sunset']])
})

test('a backdrop of another mod is left to it', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>theirs</Text>
  })
  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop', props: propsOf('lagoon', 'other') })
  expect((await ui.find({ type: 'Text', text: /theirs/ }))?.text).toBe('theirs')
  await ui.unmount()
})

test('the dials come from the options: panels 40% clear, blur 12, no dimming, in Kiki\'s own colors', { options: { clear: 40, blur: 12, dim: 0 } }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const themes: Look[] = []
  on('command.register', () => ({ value: { command: 'cwallpaper' } }))
  on('theme.set', (_, e) => { themes.push(e as Look); return { value: { isDrawn: true, requestId: 'backdrop' } } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  // The dials: solid panels with a blur, and no dimming.
  const dim = await $.command.run(wallpaper(''))
  expect(dim.text).toMatch(/Panels 40% clear, blur 12, scene dimmed 0%/)
  expect(themes.at(-1)?.backdrop?.glass?.opacity).toBe(0.6)
  expect(themes.at(-1)?.backdrop?.glass?.blur).toBe(12)
  // Kiki, with the night colors and no veil now.
  expect(themes.at(-1)?.backdrop?.scene).toBe('kiki')
  expect(themes.at(-1)?.colors?.label).toBe('Kiki night')
  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop', props: propsOf('kiki') })
  const night = await whole(ui)
  expect(night.includes('viewBox="0 0 320 180"')).toBe(true)
  expect(night.includes('fill="#000" opacity')).toBe(false)
  await ui.unmount()
})

test('the themes that were taken out are no longer commands, and a wrong word writes nothing', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const themes: Look[] = []
  const written: unknown[] = []
  on('command.register', () => ({ value: { command: 'cwallpaper' } }))
  on('theme.set', (_, e) => { themes.push(e as Look); return { value: { isDrawn: true, requestId: 'backdrop' } } })
  on('config.set', (_, e) => { written.push(e); return { value: (e as { value: never }).value } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const word of ['delivery', 'valley', 'moonbase']) {
    const gone = String((await $.command.run(wallpaper(word))).text)
    expect([word, gone.includes(word)]).toEqual([word, true])
  }
  expect(written).toEqual([])
  expect(themes.at(-1)?.backdrop?.scene).toBe('kiki')
})

test('the settings pane has Kiki\'s button and the black hole\'s, and none for the valley, a picture or a video', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('command.register', () => ({ value: { command: 'cwallpaper' } }))
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'backdrop' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'wallpaper:kiki' })).toBeDefined()
    expect(await ui.find({ key: 'wallpaper:blackhole' })).toBeDefined()
    // The valley's button is gone, and so are the buttons for a picture and a video of your own.
    for (const gone of ['wallpaper:pixel-valley', 'wallpaper:my-picture', 'wallpaper:my-video', 'wallpaper:picture', 'wallpaper:video', 'theme-pixel-valley', 'theme-my-picture', 'theme-my-video']) {
      expect([surface, gone, await ui.find({ key: gone })]).toEqual([surface, gone, undefined])
    }
    await ui.unmount()
  }
})

