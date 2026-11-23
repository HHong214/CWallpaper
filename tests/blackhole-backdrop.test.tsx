// Tests for the black hole inside the mod: hooks/register.tsx, hooks/wallpapers/blackhole/index.ts. Same harness as
// backdrop.test.tsx (mock clock, a stubbed theme.set, the Backdrop mounted), rewritten for the shader black hole:
// the wallpaper is of kind 'shader', and the Backdrop answers a `Shader` element over one `Svg`. What 1.9.0's
// thirty SVG frames were tested for (their text, loop, cost and field) is gone with them; so is the 'light plays
// more slowly' check. See core-backdrop.test.tsx for how the harness drives options and what the mod writes with
// `$.config.set`.
//
// THE CONTRACT these tests pin (blackhole-contract.md):
//
//   With the option `wallpaper` = 'blackhole' the theme.set carries `backdrop.scene === 'blackhole'`, with the
//   black hole's own colors, and the Backdrop answers ONE `Shader` element whose only child is ONE `Svg`:
//     * the Shader's `module` is './shader.ts' (the harness shows the engine's reading of it: the path
//       'hooks/wallpapers/blackhole/shader.ts', and this file accepts either spelling);
//     * its `values` hold exactly the five names calm, dim, fps, size and speed, each a number inside its range
//       (dim 0 to 0.8, speed 0 to 1, fps 0 to 1, calm 0 to 1, size 0.6 to 1.4), following the options: dim is the
//       option over 100 (30 gives 0.3), motion light gives speed 0.5 (smooth 1), Show FPS gives fps 1, the option
//       `blackholeCalm` gives calm 1, the option `blackholeSize` small, medium and large give size 0.8, 1, 1.25;
//     * the Svg's source is the still picture: at most 124,000 characters, no animation, and the SAME string under
//       the shader and alone.
//   With motion off the Backdrop answers a bare `Svg` and no `Shader` at all.
//   `/cwallpaper blackhole`, `black-hole` and `hole` write the option `wallpaper`; `/cwallpaper size large` and
//   `/cwallpaper calm on` write `blackholeSize` and `blackholeCalm` while the black hole is on; while Kiki is on they
//   are errors that say whose they are ("Size belongs to Black hole. The wallpaper is Kiki.").
//   The pane with the black hole on shows its two own rows (buttons `blackholeSize:small|medium|large` and
//   `blackholeCalm:<opposite>`) and no row of Kiki's, and with Show FPS on the note "Drawn at the top left of the chat." (not "cannot be measured").
//   The colors are a dark set with an amber accent that the app will paint. Another mod's backdrop of that name is
//   still left to it.
//
// WHAT THE HARNESS SHOWS OF THE SHADER: the mounted tree as plain data, with the element's `type` ('Shader'),
// its `props` (`module`, `values`) and its `children` (the Svg), as the engine validated them (one Shader at most,
// over exactly one Svg, in a Backdrop). It does NOT show the shader file's code, whether the file compiles, what the
// GPU draws, the cost `claude plugin validate` reports, or how the app falls back to the Svg: those are the Node
// tests' (tools/tests) and the owner's eyes.
//
// (after a command) tests assume the mod keeps its own copy of what it wrote, as core-backdrop.test.tsx explains.
import { expect, mock, test } from 'claude-code/testing'

import { checkColors } from '../hooks/make-colors.js'

// A backdrop's props name it by `scene` (and by `id` before Claude Code 2.1.323): both are given.
const propsOf = (name: string, plugin = 'CWallpaper') => ({ id: name, scene: name, plugin, glass: false }) as never
const BACKDROP = { plugin: 'CWallpaper', component: 'Backdrop', props: propsOf('blackhole') } as const
const PANE = {
  plugin: 'CWallpaper',
  component: 'Pane',
  requestId: 'cwallpaper-settings',
  props: { title: 'Wallpaper', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const wallpaper = (args: string) => ({ command: 'cwallpaper', args }) as never
const HOLE = { options: { wallpaper: 'blackhole' } }
const CAP = 124_000

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
  on('command.register', () => ({ value: { command: 'cwallpaper' } }))
  on('theme.set', (_: unknown, e: unknown) => { looks.push(e as Look); return { value: { isDrawn: true, requestId: 'backdrop' } } })
  on('config.set', (_: unknown, e: { key: string; value: unknown }) => { written.push({ field: e.key.slice(e.key.indexOf('.') + 1), value: e.value }); return { value: e.value } })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  return { looks, written }
}

const walk = (node: unknown, visit: (el: Node) => void): void => {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach(n => walk(n, visit)); return }
  const el = node as Node
  visit(el)
  walk(el.children, visit)
  walk(el.props?.children, visit)
}
const kidsOf = (el: Node): Node[] => (Array.isArray(el.children) ? (el.children as unknown[]) : []).filter((k): k is Node => !!k && typeof k === 'object')

type Drawn = { shaders: Node[]; svgs: Record<string, unknown>[]; root: Node }
/** The Backdrop of the black hole as the surface asks for it: every Shader and every Svg of the answer. */
const drawnBy = async ($: Ctx, surface: 'desktop' | 'mobile' = 'desktop', name = 'blackhole', plugin = 'CWallpaper'): Promise<Drawn> => {
  const ui = await $.ui.mount({ ...BACKDROP, surface, props: propsOf(name, plugin) })
  const tree = await ui.drawn()
  await ui.unmount()
  const shaders: Node[] = []
  const svgs: Record<string, unknown>[] = []
  walk(tree, el => {
    if (el.type === 'Shader') shaders.push(el)
    if (el.type === 'Svg' && typeof el.props?.source === 'string') svgs.push(el.props)
  })
  return { shaders, svgs, root: tree as Node }
}
const valuesOf = (d: Drawn): Record<string, number> => (d.shaders[0]?.props?.values ?? {}) as Record<string, number>

const RANGES: Record<string, [number, number]> = { dim: [0, 0.8], speed: [0, 1], fps: [0, 1], calm: [0, 1], size: [0.6, 1.4] }

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

// ------------------------------------------------ the Shader over one Svg

test('the black hole\'s Backdrop is one Shader over one Svg, on the desktop and the phone', HOLE, async ($, on) => {
  await begin($, on)
  for (const surface of ['desktop', 'mobile'] as const) {
    const d = await drawnBy($, surface)
    expect([surface, d.shaders.length]).toEqual([surface, 1])
    expect([surface, d.svgs.length]).toEqual([surface, 1])
    const shader = d.shaders[0] as Node
    const kids = kidsOf(shader)
    expect([surface, kids.length, kids[0]?.type]).toEqual([surface, 1, 'Svg'])
    // The wallpaper writes './shader.ts'; the harness shows the engine's reading of it, the path from the
    // plugin's folder, so either spelling is the black hole's own file next to its index.ts.
    expect([surface, typeof shader.props?.module]).toEqual([surface, 'string'])
    expect([surface, /^(\.\/shader\.ts|hooks\/wallpapers\/blackhole\/shader\.ts)$/.test(String(shader.props?.module).replace(/\\/g, '/'))]).toEqual([surface, true])
    const leaf = d.svgs[0] ?? {}
    expect(leaf.isInteractive === true).toBe(false)
    expect(String(leaf.alt).length > 0).toBe(true)
  }
})

test('the Shader\'s values are exactly calm, dim, fps, size and speed, each a number inside its range', HOLE, async ($, on) => {
  await begin($, on)
  const values = valuesOf(await drawnBy($))
  expect(Object.keys(values).sort()).toEqual(['calm', 'dim', 'fps', 'size', 'speed'])
  for (const [name, [lo, hi]] of Object.entries(RANGES)) {
    const v = values[name]
    expect([name, typeof v, Number.isFinite(v)]).toEqual([name, 'number', true])
    expect([name, (v ?? -1) >= lo && (v ?? 99) <= hi]).toEqual([name, true])
  }
})

test('with the options at their defaults the values are dim 0.3, speed 1, fps 0, calm 0, size 1', HOLE, async ($, on) => {
  await begin($, on)
  expect(valuesOf(await drawnBy($))).toEqual({ dim: 0.3, speed: 1, fps: 0, calm: 0, size: 1 })
})

const FOLLOW: [string, Record<string, unknown>, Record<string, number>][] = [
  ['dim 0', { dim: 0 }, { dim: 0 }],
  ['dim 80', { dim: 80 }, { dim: 0.8 }],
  ['dim 55', { dim: 55 }, { dim: 0.55 }],
  ['motion light', { motion: 'light' }, { speed: 0.5 }],
  ['motion smooth', { motion: 'smooth' }, { speed: 1 }],
  ['Show FPS', { fps: true }, { fps: 1 }],
  ['calm on', { blackholeCalm: true }, { calm: 1 }],
  ['calm off', { blackholeCalm: false }, { calm: 0 }],
  ['size small', { blackholeSize: 'small' }, { size: 0.8 }],
  ['size medium', { blackholeSize: 'medium' }, { size: 1 }],
  ['size large', { blackholeSize: 'large' }, { size: 1.25 }],
]
for (const [label, options, expected] of FOLLOW) {
  test(`the Shader's values follow the options: ${label}`, { options: { wallpaper: 'blackhole', ...options } as never }, async ($, on) => {
    await begin($, on)
    const d = await drawnBy($)
    expect(d.shaders.length).toBe(1)
    expect(valuesOf(d)).toMatchObject(expected)
    expect(Object.keys(valuesOf(d)).sort()).toEqual(['calm', 'dim', 'fps', 'size', 'speed'])
  })
}

test('the Shader\'s values at the other ends: everything on at once', { options: { wallpaper: 'blackhole', motion: 'light', fps: true, dim: 80, blackholeCalm: true, blackholeSize: 'large' } as never }, async ($, on) => {
  await begin($, on)
  expect(valuesOf(await drawnBy($))).toEqual({ dim: 0.8, speed: 0.5, fps: 1, calm: 1, size: 1.25 })
})

// ------------------------------------------------ the still picture, under the shader and alone

const stills: Record<string, string> = {}

test('under the Shader the Svg is the still picture: under the size cap, no animation', { options: { wallpaper: 'blackhole', motion: 'smooth' } }, async ($, on) => {
  await begin($, on)
  const d = await drawnBy($)
  const source = String(d.svgs[0]?.source)
  stills.shader = source
  expect(source.startsWith('<svg')).toBe(true)
  expect(source.length <= CAP).toBe(true)
  expect(source.includes('@keyframes')).toBe(false)
  expect(source.includes('<animate')).toBe(false)
  expect(source.includes('animation')).toBe(false)
})

test('with motion off the Backdrop is a bare Svg and no Shader, and its picture has no animation', { options: { wallpaper: 'blackhole', motion: 'off' } }, async ($, on) => {
  await begin($, on)
  for (const surface of ['desktop', 'mobile'] as const) {
    const d = await drawnBy($, surface)
    expect([surface, d.shaders.length]).toEqual([surface, 0])
    expect([surface, d.svgs.length]).toEqual([surface, 1])
    expect([surface, d.root.type]).toEqual([surface, 'Svg'])
    const source = String(d.svgs[0]?.source)
    stills.alone = source
    expect(source.startsWith('<svg')).toBe(true)
    expect(source.length <= CAP).toBe(true)
    expect(source.includes('@keyframes')).toBe(false)
    expect(source.includes('<animate')).toBe(false)
    expect(source.includes('animation')).toBe(false)
  }
})

test('the Svg is the same string under the shader and alone (the two tests above)', () => {
  expect(typeof stills.shader).toBe('string')
  expect(typeof stills.alone).toBe('string')
  expect(stills.alone === stills.shader).toBe(true)
})

// ------------------------------------------------ choosing it

for (const word of ['blackhole', 'black-hole', 'hole']) {
  test(`/cwallpaper ${word} chooses the black hole: it writes the option wallpaper = blackhole`, async ($, on) => {
    const { written } = await begin($, on)
    await $.command.run(wallpaper(word))
    expect([word, written]).toEqual([word, [{ field: 'wallpaper', value: 'blackhole' }]])
  })

  test(`/cwallpaper ${word} answers that the wallpaper is Black hole (after a command)`, async ($, on) => {
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

test('/cwallpaper kiki brings Kiki back: it writes the option wallpaper = kiki', HOLE, async ($, on) => {
  const { written } = await begin($, on)
  await $.command.run(wallpaper('kiki'))
  expect(written).toEqual([{ field: 'wallpaper', value: 'kiki' }])
})

test('Kiki is the wallpaper by default: her colors and her own picture, with no Shader', async ($, on) => {
  const { looks } = await begin($, on)
  expect(looks.at(-1)?.backdrop?.scene).toBe('kiki')
  expect(looks.at(-1)?.colors?.label).toBe('Kiki night')
  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop', props: propsOf('kiki') })
  const tree = await ui.drawn()
  await ui.unmount()
  let shaders = 0
  let kiki = false
  walk(tree, el => {
    if (el.type === 'Shader') shaders += 1
    if (el.type === 'Svg' && String(el.props?.source).includes('viewBox="0 0 320 180"')) kiki = true
  })
  expect([shaders, kiki]).toEqual([0, true])
})

test('after /cwallpaper kiki the look is Kiki\'s, and the black hole is there to go back to (after a command)', HOLE, async ($, on) => {
  const { looks } = await begin($, on)
  expect(looks.at(-1)?.backdrop?.scene).toBe('blackhole')
  const kiki = await $.command.run(wallpaper('kiki'))
  expect(String(kiki.text)).toMatch(/The wallpaper is Kiki\./)
  expect(looks.at(-1)?.backdrop?.scene).toBe('kiki')
  expect(looks.at(-1)?.colors?.label).toBe('Kiki night')
  await $.command.run(wallpaper('blackhole'))
  expect(looks.at(-1)?.backdrop?.scene).toBe('blackhole')
  expect((await drawnBy($)).shaders.length).toBe(1)
})

test('the help names blackhole, its size and its calm, and still names none of the old themes; a wrong word names itself and points to the help', async ($, on) => {
  await begin($, on)
  const help = String((await $.command.run(wallpaper('help'))).text)
  for (const word of ['blackhole', 'size', 'calm']) expect([word, help.includes(word)]).toEqual([word, true])
  expect(/valley|weather/i.test(help)).toBe(false)
  const wrong = String((await $.command.run(wallpaper('moonbase'))).text)
  expect(wrong).toMatch(/moonbase/)
  expect(wrong).toMatch(/\/cwallpaper help/)
})

// ------------------------------------------------ its own options

// Each is a real change from the options it starts from (a command that asks for what already is writes nothing).
for (const [text, field, value, start] of [
  ['size small', 'blackholeSize', 'small', {}],
  ['size medium', 'blackholeSize', 'medium', { blackholeSize: 'large' }],
  ['size large', 'blackholeSize', 'large', {}],
  ['calm on', 'blackholeCalm', true, {}],
  ['calm off', 'blackholeCalm', false, { blackholeCalm: true }],
] as const) {
  test(`/cwallpaper ${text} writes the option ${field} while the black hole is on`, { options: { wallpaper: 'blackhole', ...start } as never }, async ($, on) => {
    const { written } = await begin($, on)
    const said = await $.command.run(wallpaper(text))
    expect(written).toEqual([{ field, value }])
    expect(String(said.text)).toMatch(/The wallpaper is Black hole\./)
  })
}

test('/cwallpaper size and /cwallpaper calm with a value they do not take are errors that write nothing', HOLE, async ($, on) => {
  const { written } = await begin($, on)
  for (const text of ['size huge', 'size', 'calm maybe', 'calm']) {
    const said = String((await $.command.run(wallpaper(text))).text)
    expect([text, /size|calm/.test(said)]).toEqual([text, true])
  }
  expect(written).toEqual([])
})

test('while Kiki is on, the black hole\'s options are errors that say whose they are', async ($, on) => {
  const { written } = await begin($, on)
  expect((await $.command.run(wallpaper('size large'))).text).toBe('Size belongs to Black hole. The wallpaper is Kiki.')
  expect((await $.command.run(wallpaper('calm on'))).text).toBe('Calmer motion belongs to Black hole. The wallpaper is Kiki.')
  expect(written).toEqual([])
})

test('while the black hole is on, Kiki\'s options are errors that say whose they are', HOLE, async ($, on) => {
  const { written } = await begin($, on)
  expect((await $.command.run(wallpaper('time night'))).text).toBe('Time of day belongs to Kiki. The wallpaper is Black hole.')
  expect((await $.command.run(wallpaper('spinner off'))).text).toBe('Cat spinner belongs to Kiki. The wallpaper is Black hole.')
  expect(written).toEqual([])
})

test('after /cwallpaper size large and /cwallpaper calm on the Shader is handed size 1.25 and calm 1 (after a command)', HOLE, async ($, on) => {
  await begin($, on)
  await $.command.run(wallpaper('size large'))
  expect(valuesOf(await drawnBy($)).size).toBe(1.25)
  await $.command.run(wallpaper('calm on'))
  const values = valuesOf(await drawnBy($))
  expect([values.size, values.calm]).toEqual([1.25, 1])
})

// ------------------------------------------------ the pane

test('the pane with the black hole on shows its size and calm rows, and no row of Kiki\'s', HOLE, async ($, on) => {
  await begin($, on)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const key of ['wallpaper:kiki', 'wallpaper:blackhole', 'blackholeSize:small', 'blackholeSize:medium', 'blackholeSize:large', 'blackholeCalm:true']) {
      expect([surface, key, (await ui.find({ key })) !== undefined]).toEqual([surface, key, true])
    }
    for (const key of ['kikiTime:auto', 'kikiTime:day', 'kikiTime:sunset', 'kikiTime:night', 'kikiSpinner:false']) {
      expect([surface, key, await ui.find({ key })]).toEqual([surface, key, undefined])
    }
    await ui.unmount()
  }
})

test('the pane\'s calm button writes the opposite of today\'s value', { options: { wallpaper: 'blackhole', blackholeCalm: true } }, async ($, on) => {
  await begin($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'blackholeCalm:false' })).toBeDefined()
  expect(await ui.find({ key: 'blackholeCalm:true' })).toBeUndefined()
  await ui.unmount()
})

test('with Show FPS on the black hole\'s pane says where the readout is drawn, and has no "cannot be measured" note', { options: { wallpaper: 'blackhole', fps: true } }, async ($, on) => {
  await begin($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Drawn at the top left of the chat\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /cannot be measured/i })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /frame rate/i })).toBeUndefined()
  expect(await ui.find({ key: 'fps:false' })).toBeDefined()
  await ui.unmount()
})

test('the pane has a Black hole button beside Kiki\'s, and pressing each writes the option wallpaper alone', async ($, on) => {
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

for (const [key, field, value] of [
  ['blackholeSize:small', 'blackholeSize', 'small'],
  ['blackholeSize:large', 'blackholeSize', 'large'],
  ['blackholeCalm:true', 'blackholeCalm', true],
] as const) {
  test(`pressing ${key} in the pane writes the option ${field} = ${String(value)} and nothing else`, HOLE, async ($, on) => {
    const { written } = await begin($, on)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key })
    await ui.unmount()
    expect(written).toEqual([{ field, value }])
  })
}

// ------------------------------------------------ colors and the others' backdrops

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
  expect((await drawnBy($)).shaders.length).toBe(1)
  // Theirs: nothing of ours is drawn, the other mod's own render is shown.
  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop', props: propsOf('blackhole', 'other') })
  expect((await ui.find({ type: 'Text', text: /theirs/ }))?.text).toBe('theirs')
  expect(await ui.find({ type: 'Shader' })).toBeUndefined()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})
