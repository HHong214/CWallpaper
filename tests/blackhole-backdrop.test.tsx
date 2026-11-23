// Tests for the black hole inside the mod: hooks/register.tsx. Same harness as backdrop.test.tsx (mock clock, a
// stubbed theme.set, the Backdrop mounted and its `Svg` element's `source` read), rewritten for the rebuild: what
// 1.9.0 had these tests set with `/wallpaper` commands and keep in the mod's store is now the plugin's options
// (the manifest's `userConfig`, handed to the test as `{ options }`), and what a command or a button does is write
// one option through `$.config.set`, which the test sees with `on('config.set', ...)`. See core-backdrop.test.tsx
// for how the harness drives options and what it cannot see.
//
// THE CONTRACT these tests pin (the field's is in blackhole.test.ts, the builder's in blackhole-svg.test.ts):
//
//   The option `wallpaper` = 'blackhole' makes the theme.set carry `backdrop.scene === 'blackhole'`, with the black
//   hole's own colors (not "Kiki night"); the Backdrop for that scene is one `Svg` whose source is the black hole's
//   picture (not Kiki's), under 131,072 characters, with a non-empty alt, on the desktop and the phone.
//   `/wallpaper blackhole`, `/wallpaper black-hole` and `/wallpaper hole` write the option `wallpaper` =
//   'blackhole' (the answer says "The wallpaper is Black hole."); `/wallpaper kiki` writes 'kiki'.
//   `/wallpaper help` names `blackhole`; a wrong word is an error that names it and points to `/wallpaper help`.
//   The pane has a button `wallpaper:blackhole`, labelled "Black hole", beside Kiki's `wallpaper:kiki`, and pressing
//   it writes the option and nothing else.
//   The option `motion` = 'off' gives the still picture (no animation, no keyframes); smooth and light animate.
//   The colors handed to the app with it are a dark set with an amber accent: the dark `gray-900` is near-black,
//   `role-accent-fill` is amber, the label is not "Kiki night", and the mod's own checker (`checkColors` of
//   make-colors.js, as `makeColors` runs it) reports nothing that starts "Desktop won't paint".
//   Another mod's backdrop of that name is still left to it.
//
// Dropped from 1.9.0's version, with the reasons: "the choice is stored: a new session reads it back" (nothing is
// stored by the mod: a new session reads the option, and 'a saved black hole' below is that); "light plays more
// slowly than smooth" through the Backdrop (blackhole-svg.test.ts pins it on the builder, which is all the mod
// passes on); the wrong word carrying the whole help (the contract points to `/wallpaper help` instead).
import { expect, mock, test } from 'claude-code/testing'

import { checkColors } from '../hooks/make-colors.js'

// A backdrop's props name it by `scene` (and by `id` before Claude Code 2.1.323): both are given.
const propsOf = (name: string, plugin = 'wallpaper') => ({ id: name, scene: name, plugin, glass: false }) as never
const BACKDROP = { plugin: 'wallpaper', component: 'Backdrop', props: propsOf('blackhole') } as const
const PANE = {
  plugin: 'wallpaper',
  component: 'Pane',
  requestId: 'wallpaper-settings',
  props: { title: 'Wallpaper', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const wallpaper = (args: string) => ({ command: 'wallpaper', args }) as never
const HOLE = { options: { wallpaper: 'blackhole' } }

type Look = {
  backdrop?: { scene?: string }
  colors?: { label?: string; inputs?: { light?: Record<string, string>; dark?: Record<string, string> } }
}
type Node = { type?: unknown; key?: unknown; props?: Record<string, unknown>; children?: unknown }
type Written = { field: string; value: unknown }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any

/** Mocks, a stubbed theme.set that keeps every look, a config.set that keeps every write, and a started session. */
async function begin($: Ctx, on: Ctx): Promise<{ looks: Look[]; written: Written[] }> {
  mock.clock(on)
  mock.store(on)
  const looks: Look[] = []
  const written: Written[] = []
  on('command.register', () => ({ value: { command: 'wallpaper' } }))
  on('theme.set', (_: unknown, e: unknown) => { looks.push(e as Look); return { value: { isDrawn: true, requestId: 'backdrop' } } })
  on('config.set', (_: unknown, e: { key: string; value: unknown }) => { written.push({ field: e.key.slice(e.key.indexOf('.') + 1), value: e.value }); return { value: e.value } })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  return { looks, written }
}

/** Every Svg element drawn, with its props, and every node of a given type. */
const walk = (node: unknown, visit: (el: Node) => void): void => {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach(n => walk(n, visit)); return }
  const el = node as Node
  visit(el)
  walk(el.children, visit)
  walk(el.props?.children, visit)
}
const svgs = async (ui: { drawn: () => Promise<unknown> }): Promise<Record<string, unknown>[]> => {
  const out: Record<string, unknown>[] = []
  walk(await ui.drawn(), el => { if (el.type === 'Svg' && typeof el.props?.source === 'string') out.push(el.props) })
  return out
}
const drawnBy = async ($: Ctx, name: string, surface: 'desktop' | 'mobile' = 'desktop', plugin = 'wallpaper'): Promise<Record<string, unknown>[]> => {
  const ui = await $.ui.mount({ ...BACKDROP, surface, props: propsOf(name, plugin) })
  const out = await svgs(ui)
  await ui.unmount()
  return out
}
const sourceOf = async ($: Ctx, name = 'blackhole'): Promise<string> => String((await drawnBy($, name))[0]?.source ?? '')

const sheet = (s: string): string => [...s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1] ?? '').join('')
/** The longest loop in seconds, the first time in each `animation` rule. */
const loopSeconds = (s: string): number =>
  Math.max(
    0,
    ...[...sheet(s).matchAll(/animation(?:-duration)?\s*:\s*([^;}]*)/g)].flatMap(m => {
      const t = /(?:^|\s)(\d*\.?\d+)(ms|s)(?=\s|;|}|$)/.exec(m[1] ?? '')
      return t ? [Number(t[1]) / (t[2] === 'ms' ? 1000 : 1)] : []
    }),
  )

const rgb = (hex: string | undefined): [number, number, number] | undefined => {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex ?? '')
  return m ? [parseInt((m[1] ?? '').slice(0, 2), 16), parseInt((m[1] ?? '').slice(2, 4), 16), parseInt((m[1] ?? '').slice(4, 6), 16)] : undefined
}
const hueOf = ([r, g, b]: [number, number, number]): number => {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return 0
  const d = max - min
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}

for (const word of ['blackhole', 'black-hole', 'hole']) {
  test(`/wallpaper ${word} chooses the black hole: it writes the option wallpaper = blackhole`, async ($, on) => {
    const { written } = await begin($, on)
    await $.command.run(wallpaper(word))
    expect([word, written]).toEqual([word, [{ field: 'wallpaper', value: 'blackhole' }]])
  })

  test(`/wallpaper ${word} answers that the wallpaper is Black hole (after a command)`, async ($, on) => {
    await begin($, on)
    const said = await $.command.run(wallpaper(word))
    expect([word, String(said.text)]).toEqual([word, expect.stringMatching(/The wallpaper is Black hole\./)])
  })
}

test('a saved black hole is the look at the start, with its own colors', HOLE, async ($, on) => {
  const { looks } = await begin($, on)
  expect(looks.length).toBe(1)
  expect(looks.at(-1)?.backdrop?.scene).toBe('blackhole')
  expect(looks.at(-1)?.colors === undefined).toBe(false)
  expect(looks.at(-1)?.colors?.label).not.toBe('Kiki night')
})

test('the Backdrop for the black hole is one Svg of its own picture, on the desktop and the phone', HOLE, async ($, on) => {
  await begin($, on)
  for (const surface of ['desktop', 'mobile'] as const) {
    const drawn = await drawnBy($, 'blackhole', surface)
    expect([surface, drawn.length]).toEqual([surface, 1])
    const leaf = drawn[0] ?? {}
    const source = String(leaf.source)
    expect(leaf.isInteractive === true).toBe(false)
    expect(source.startsWith('<svg')).toBe(true)
    expect(source.length < 131072).toBe(true)
    expect(source.length + String(leaf.alt).length < 200_000).toBe(true)
    expect(String(leaf.alt).length > 0).toBe(true)
    // The black hole's, not Kiki's: ASCII text frames, moving by default, in their own viewBox.
    expect(source.includes('<text')).toBe(true)
    expect(source.includes('@keyframes')).toBe(true)
    expect(source.includes('viewBox="0 0 320 180"')).toBe(false)
    expect(source.includes('<image')).toBe(false)
  }
})

test('/wallpaper kiki brings Kiki back: it writes the option wallpaper = kiki', HOLE, async ($, on) => {
  const { written } = await begin($, on)
  await $.command.run(wallpaper('kiki'))
  expect(written).toEqual([{ field: 'wallpaper', value: 'kiki' }])
})

test('Kiki is the wallpaper by default, in her own colors and her own picture', async ($, on) => {
  const { looks } = await begin($, on)
  expect(looks.at(-1)?.backdrop?.scene).toBe('kiki')
  expect(looks.at(-1)?.colors?.label).toBe('Kiki night')
  expect((await sourceOf($, 'kiki')).includes('viewBox="0 0 320 180"')).toBe(true)
})

test('after /wallpaper kiki the look is Kiki\'s, and the black hole is there to go back to (after a command)', HOLE, async ($, on) => {
  const { looks } = await begin($, on)
  expect(looks.at(-1)?.backdrop?.scene).toBe('blackhole')
  const kiki = await $.command.run(wallpaper('kiki'))
  expect(String(kiki.text)).toMatch(/The wallpaper is Kiki\./)
  expect(looks.at(-1)?.backdrop?.scene).toBe('kiki')
  expect(looks.at(-1)?.colors?.label).toBe('Kiki night')
  expect((await sourceOf($, 'kiki')).includes('viewBox="0 0 320 180"')).toBe(true)
  await $.command.run(wallpaper('blackhole'))
  expect(looks.at(-1)?.backdrop?.scene).toBe('blackhole')
})

test('the help names blackhole, and still names none of the old themes; a wrong word names itself and points to the help', async ($, on) => {
  await begin($, on)
  const help = String((await $.command.run(wallpaper('help'))).text)
  expect(help.includes('blackhole')).toBe(true)
  expect(/valley|weather/i.test(help)).toBe(false)
  const wrong = String((await $.command.run(wallpaper('moonbase'))).text)
  expect(wrong).toMatch(/moonbase/)
  expect(wrong).toMatch(/\/wallpaper help/)
})

test('the settings pane has a Black hole button beside Kiki\'s, and pressing each writes the option wallpaper alone', async ($, on) => {
  const { written } = await begin($, on)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'wallpaper:blackhole' })).toBeDefined()
    expect(await ui.find({ key: 'wallpaper:kiki' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(((await ui.find({ key: 'wallpaper:blackhole' }))?.props as { label?: string } | undefined)?.label).toBe('Black hole')
  await ui.press({ key: 'wallpaper:blackhole' })
  await ui.press({ key: 'wallpaper:kiki' })
  await ui.unmount()
  expect(written).toEqual([{ field: 'wallpaper', value: 'blackhole' }, { field: 'wallpaper', value: 'kiki' }])
})

test('the option motion smooth plays the black hole', { options: { wallpaper: 'blackhole', motion: 'smooth' } }, async ($, on) => {
  await begin($, on)
  const moving = await sourceOf($)
  expect(moving.includes('@keyframes')).toBe(true)
  expect(loopSeconds(moving) > 0).toBe(true)
})

test('the option motion light plays the black hole, calmer', { options: { wallpaper: 'blackhole', motion: 'light' } }, async ($, on) => {
  await begin($, on)
  const calm = await sourceOf($)
  expect(calm.includes('@keyframes')).toBe(true)
  expect(loopSeconds(calm) > 0).toBe(true)
})

test('the option motion off gives the still black hole', { options: { wallpaper: 'blackhole', motion: 'off' } }, async ($, on) => {
  await begin($, on)
  const still = await sourceOf($)
  expect(still.startsWith('<svg')).toBe(true)
  expect(still.includes('<text')).toBe(true)
  expect(still.includes('@keyframes')).toBe(false)
  expect(still.includes('animation')).toBe(false)
  expect(still.includes('<animate')).toBe(false)
})

test('the black hole\'s colors are a dark set with an amber accent that the app will paint', HOLE, async ($, on) => {
  const { looks } = await begin($, on)
  const colors = looks.at(-1)?.colors
  expect(colors).toBeDefined()
  expect(typeof colors?.label === 'string' && colors.label.length > 0).toBe(true)
  expect(colors?.label).not.toBe('Kiki night')
  const dark = colors?.inputs?.dark ?? {}
  expect(Object.keys(dark).length > 50).toBe(true)
  // Near-black surfaces (gray-900 is the darkest of the dark mode's grays).
  const ground = rgb(dark['gray-900'])
  expect(ground !== undefined && Math.max(...ground) <= 40).toBe(true)
  // An amber accent: orange-yellow hue, strongly colored, not dark.
  const accent = rgb(dark['role-accent-fill'])
  expect(accent !== undefined).toBe(true)
  if (accent) {
    const max = Math.max(...accent)
    const min = Math.min(...accent)
    expect(hueOf(accent) >= 28 && hueOf(accent) <= 52).toBe(true)
    expect(max >= 153 && (max - min) / max >= 0.5).toBe(true)
  }
  // The same check `makeColors` ran: nothing the desktop app would refuse to paint.
  const problems = checkColors(colors)
  expect(problems.filter((line: string) => line.startsWith("Desktop won't paint"))).toEqual([])
})

test('a backdrop of another mod with the same name is left to it, while ours is drawn', HOLE, async ($, on) => {
  // The other mod's render sits beneath this one's, and is registered before the test first uses `$`.
  on('ui.render', ($: Ctx, e: unknown) => {
    const { Text } = $.ui.resolve(e)

    return <Text>theirs</Text>
  })
  await begin($, on)
  // Ours first: the black hole is drawn for this mod's own backdrop.
  expect((await drawnBy($, 'blackhole')).length).toBe(1)
  // Theirs: nothing of ours is drawn, the other mod's own render is shown.
  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop', props: propsOf('blackhole', 'other') })
  expect((await ui.find({ type: 'Text', text: /theirs/ }))?.text).toBe('theirs')
  expect((await svgs(ui)).length).toBe(0)
  await ui.unmount()
})
