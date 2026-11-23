// Tests for the black hole inside the mod: hooks/register.tsx. Same harness as backdrop.test.tsx (mock clock
// and store, a stubbed theme.set, the Backdrop mounted and its `Svg` element's `source` read).
//
// THE CONTRACT these tests pin (the field's is in blackhole.test.ts, the builder's in blackhole-svg.test.ts):
//
//   Theme key `blackhole`, label "Black hole". `/wallpaper blackhole`, `/wallpaper black-hole` and
//   `/wallpaper hole` choose it (the answer says "The wallpaper is Black hole."), and the choice is stored:
//   a new session reads it back. `/wallpaper kiki` brings Kiki back.
//   The theme.set carries `backdrop.scene === 'blackhole'`; the Backdrop for that scene is one `Svg` whose
//   source is the black hole's picture (not Kiki's), under 131,072 characters, with a non-empty alt.
//   `/wallpaper help` names `blackhole`. The settings pane has a button keyed `theme-blackhole`, labelled
//   "Black hole", right beside Kiki's (`theme-kiki`), and pressing it picks the theme.
//   `/wallpaper motion off` gives the still picture (no animation, no keyframes); `light` animates more
//   slowly than `smooth`.
//   The colours handed to the app with it are a dark set with an amber accent: the dark `gray-900` is
//   near-black, `role-accent-fill` is amber, the label is not "Kiki night", and the mod's own checker
//   (`checkColors` of make-colors.js, as `makeColors` runs it) reports nothing that starts "Desktop won't paint".
//   Another mod's backdrop of that name is still left to it.
//
// This file imports no new module: until register.tsx knows the theme, each test below fails on its own
// assertion (a word that is "no command", a pane without the button, no Svg drawn).
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
const OPTIONS = { options: { spinner: true } }

type Look = {
  backdrop?: { scene?: string }
  colors?: { label?: string; inputs?: { light?: Record<string, string>; dark?: Record<string, string> } }
}
type Node = { type?: unknown; key?: unknown; props?: Record<string, unknown>; children?: unknown }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any

/** Mocks, a stubbed theme.set that keeps every look, and a started session. */
async function begin($: Ctx, on: Ctx, seed?: Record<string, unknown>): Promise<Look[]> {
  mock.clock(on)
  mock.store(on, seed)
  const themes: Look[] = []
  on('command.register', () => ({ value: { command: 'wallpaper' } }))
  on('theme.set', (_: unknown, e: unknown) => { themes.push(e as Look); return { value: { isDrawn: true, requestId: 'backdrop' } } })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  return themes
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

test('/wallpaper blackhole, black-hole and hole each choose the black hole, and the choice is stored', OPTIONS, async ($, on) => {
  const themes = await begin($, on)
  for (const word of ['blackhole', 'black-hole', 'hole']) {
    // From somewhere else each time, so it is the word that does the choosing.
    await $.command.run(wallpaper('kiki'))
    expect([word, themes.at(-1)?.backdrop?.scene]).toEqual([word, 'kiki'])
    const said = await $.command.run(wallpaper(word))
    expect(String(said.text)).toMatch(/The wallpaper is Black hole\./)
    expect([word, themes.at(-1)?.backdrop?.scene]).toEqual([word, 'blackhole'])
    // Stored: a new session reads it back and sets the look from it.
    const before = themes.length
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    expect([word, themes.length > before, themes.at(-1)?.backdrop?.scene]).toEqual([word, true, 'blackhole'])
  }
})

test('a saved black hole is the look at the start, with its own colors', OPTIONS, async ($, on) => {
  const themes = await begin($, on, {
    settings: { theme: 'blackhole', isOn: true, clear: 100, blur: 0, dim: 30, colors: true, motion: 'smooth', kikiTime: 'auto', picture: '', film: '' },
  })
  expect(themes.at(-1)?.backdrop?.scene).toBe('blackhole')
  expect(themes.at(-1)?.colors === undefined).toBe(false)
  expect(themes.at(-1)?.colors?.label).not.toBe('Kiki night')
})

test('the Backdrop for the black hole is one Svg of its own picture, on the desktop and the phone', OPTIONS, async ($, on) => {
  await begin($, on)
  await $.command.run(wallpaper('blackhole'))
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

test('/wallpaper kiki brings Kiki back, in her own colors', OPTIONS, async ($, on) => {
  const themes = await begin($, on)
  await $.command.run(wallpaper('hole'))
  expect(themes.at(-1)?.backdrop?.scene).toBe('blackhole')
  const kiki = await $.command.run(wallpaper('kiki'))
  expect(String(kiki.text)).toMatch(/The wallpaper is Kiki\./)
  expect(themes.at(-1)?.backdrop?.scene).toBe('kiki')
  expect(themes.at(-1)?.colors?.label).toBe('Kiki night')
  expect((await sourceOf($, 'kiki')).includes('viewBox="0 0 320 180"')).toBe(true)
  // And the black hole is still there to go back to.
  await $.command.run(wallpaper('blackhole'))
  expect(themes.at(-1)?.backdrop?.scene).toBe('blackhole')
})

test('the help names blackhole, and still names none of the old themes', OPTIONS, async ($, on) => {
  await begin($, on)
  const help = String((await $.command.run(wallpaper('help'))).text)
  expect(help.includes('blackhole')).toBe(true)
  expect(/valley|weather|city/i.test(help)).toBe(false)
  // The line a wrong word gets carries the same help.
  expect(String((await $.command.run(wallpaper('moonbase'))).text)).toMatch(/There is no "moonbase"[\s\S]*blackhole/)
})

test('the settings pane has a Black hole button beside Kiki\'s, and pressing it picks the theme', OPTIONS, async ($, on) => {
  const themes = await begin($, on)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'theme-blackhole' })).toBeDefined()
    expect(await ui.find({ key: 'theme-kiki' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // The two buttons are neighbours in one row, and the new one is labelled by the theme's name.
  let neighbours = false
  let label = ''
  walk(await ui.drawn(), el => {
    const kids = Array.isArray(el.children) ? (el.children as Node[]) : []
    const keys = kids.map(k => String(k?.props?.key ?? ''))
    const at = keys.indexOf('theme-kiki')
    const to = keys.indexOf('theme-blackhole')
    if (at >= 0 && to >= 0) {
      neighbours = Math.abs(at - to) === 1
      label = String(kids[to]?.props?.label ?? '')
    }
  })
  expect(neighbours).toBe(true)
  expect(label).toBe('Black hole')
  await ui.press({ key: 'theme-blackhole' })
  expect(themes.at(-1)?.backdrop?.scene).toBe('blackhole')
  await ui.press({ key: 'theme-kiki' })
  expect(themes.at(-1)?.backdrop?.scene).toBe('kiki')
  await ui.unmount()
})

test('/wallpaper motion off gives the still black hole, and light plays more slowly than smooth', OPTIONS, async ($, on) => {
  await begin($, on)
  await $.command.run(wallpaper('blackhole'))
  const smooth = await $.command.run(wallpaper('motion smooth'))
  expect(String(smooth.text)).toMatch(/motion smooth/)
  const moving = await sourceOf($)
  expect(moving.includes('@keyframes')).toBe(true)
  expect(loopSeconds(moving) > 0).toBe(true)

  const light = await $.command.run(wallpaper('motion light'))
  expect(String(light.text)).toMatch(/motion light/)
  const calm = await sourceOf($)
  expect(calm.includes('@keyframes')).toBe(true)
  expect(loopSeconds(calm) > loopSeconds(moving)).toBe(true)

  const off = await $.command.run(wallpaper('motion off'))
  expect(String(off.text)).toMatch(/motion off/)
  const still = await sourceOf($)
  expect(still.startsWith('<svg')).toBe(true)
  expect(still.includes('<text')).toBe(true)
  expect(still.includes('@keyframes')).toBe(false)
  expect(still.includes('animation')).toBe(false)
  expect(still.includes('<animate')).toBe(false)
  expect(still.length < moving.length).toBe(true)
})

test('the black hole\'s colors are a dark set with an amber accent that the app will paint', OPTIONS, async ($, on) => {
  const themes = await begin($, on)
  await $.command.run(wallpaper('blackhole'))
  const colors = themes.at(-1)?.colors
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
  expect(problems.filter(line => line.startsWith("Desktop won't paint"))).toEqual([])
  // Kiki keeps her own colors.
  await $.command.run(wallpaper('kiki'))
  expect(themes.at(-1)?.colors?.label).toBe('Kiki night')
})

test('a backdrop of another mod with the same name is left to it, while ours is drawn', OPTIONS, async ($, on) => {
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
