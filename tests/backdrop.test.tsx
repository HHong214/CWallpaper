import { expect, mock, test } from 'claude-code/testing'

import { asPlace, phaseAt, sunTimes } from '../hooks/kiki/sun'

// A backdrop's props name it by `scene` (and by `id` before Claude Code 2.1.323):
// both are given, so the test reads the same on either build.
const propsOf = (name: string, plugin = 'wallpaper') => ({ id: name, scene: name, plugin, glass: false }) as never
const BACKDROP = { plugin: 'wallpaper', component: 'Backdrop', props: propsOf('kiki') } as const
const PANE = {
  plugin: 'wallpaper',
  component: 'Pane',
  requestId: 'wallpaper-settings',
  props: { title: 'Wallpaper', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const wallpaper = (args: string) => ({ command: 'wallpaper', args }) as never
// The mod's settings as a fresh install has them.
const OPTIONS = { options: { spinner: true } }

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

test('kiki is set at the start, clear and dimmed, drawn as one image, and holds still across turns', OPTIONS, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const themes: Look[] = []
  on('command.register', () => ({ value: { command: 'wallpaper' } }))
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

  // Off: still, with no animation at all.
  const off = await $.command.run(wallpaper('motion off'))
  expect(off.text).toMatch(/motion off/)
  ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
  const stillDrawn = await sources(ui)
  // Still: one picture too, within the size a picture may have, nothing that moves.
  expect(stillDrawn.length).toBe(1)
  expect(stillDrawn.every(s => s.length < 131072)).toBe(true)
  const still = stillDrawn.join('')
  expect(still.includes('@keyframes')).toBe(false)
  expect(still.includes('<animate')).toBe(false)
  // A still scene needs no wake draws: it carries no mark.
  expect(still === bare(still)).toBe(true)
  await ui.unmount()

  // Smooth: the scene carries its own animation again.
  const smooth = await $.command.run(wallpaper('motion smooth'))
  expect(smooth.text).toMatch(/motion smooth/)
  ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
  expect((await whole(ui)).includes('@keyframes')).toBe(true)
  await ui.unmount()

  // Stepping is gone.
  const steps = await $.command.run(wallpaper('motion steps'))
  expect(steps.text).toBe('Usage: /wallpaper motion smooth|light|off')
})

test('every moving part has its rule, the sea and clouds glide, and motion light rests only the shooting star', OPTIONS, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('command.register', () => ({ value: { command: 'wallpaper' } }))
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'backdrop' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run(wallpaper('time night'))
  const picture = async (): Promise<string[]> => {
    const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
    const s = (await sources(ui)).map(bare)
    await ui.unmount()
    return s
  }
  const rects = (s: string): number => (s.match(/v\d+h-\d+z/g) ?? []).length
  // The classes a picture animates, Kiki's own (h-) or the world's.
  const animated = (s: string): Set<string> => new Set([...s.matchAll(/class="([^"]+)"/g)].flatMap(m => (m[1] ?? '').split(' ')))
  // Kiki's own group, <g class="h-fl"> to its matching </g>.
  const kikiOf = (s: string): string => {
    const start = s.indexOf('<g class="h-fl">')
    if (start < 0) return ''
    let depth = 0
    for (let i = start; i < s.length; ) {
      if (s.startsWith('</g>', i)) {
        depth -= 1
        i += 4
        if (depth === 0) return s.slice(start, i)
      } else if (s.startsWith('<g', i) && /[\s>]/.test(s[i + 2] ?? '')) {
        depth += 1
        i += 2
      } else {
        i += 1
      }
    }
    return ''
  }
  // Every class the picture animates has its rule in its sheet (a part whose
  // rule went missing, as the sea's once did, would stand still).
  const unruled = (s: string): string[] => {
    const css = [...s.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1] ?? '').join('')
    return [...animated(s)].filter(c => c !== 'h-z' && !css.includes(`.${c}{animation:`))
  }

  const smoothDrawn = await picture()
  expect(smoothDrawn.length).toBe(1)
  const [smooth = ''] = smoothDrawn
  expect(unruled(smooth)).toEqual([])
  // Smooth: the clouds drift (two strips, each drawn twice).
  expect(smooth.includes('<use')).toBe(true)
  // The rule each class runs, by its keyframes' name, and a keyframes' whole text.
  const sheetOf = (s: string): string => [...s.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1] ?? '').join('')
  const rulesOf = (s: string): Map<string, string> =>
    new Map([...sheetOf(s).matchAll(/\.([\w-]+)\{animation:([^}]*)\}/g)].map(m => [m[1] ?? '', m[2] ?? ''] as const))
  const keyframesOf = (s: string, name: string): string => {
    const css = sheetOf(s)
    const at = css.indexOf(`@keyframes ${name}{`)
    if (at < 0) return ''
    let depth = 0
    for (let i = css.indexOf('{', at); i < css.length; i += 1) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}' && (depth -= 1) === 0) return css.slice(at, i + 1)
    }
    return ''
  }
  // The sea's crests glide: three bands (far, middle, near), each a linear
  // slide over one 64-px repeat that ends where the next repeat starts, so the
  // loop has no jump, and no step-end anywhere on it: about 1.5, 2.5 and 4 art
  // pixels a second. The art px a second of each band's glide:
  const glide = (s: string): number[] =>
    [...rulesOf(s).values()].filter(r => r.startsWith('w-sw ')).map(r => {
      expect(r).toMatch(/^w-sw [\d.]+s linear infinite( -[\d.]+s)?$/)
      return 64 / Number(/^w-sw ([\d.]+)s/.exec(r)?.[1])
    })
  expect(glide(smooth).map(v => Math.round(v * 10) / 10).sort((a, b) => a - b)).toEqual([1.5, 2.5, 4])
  expect(keyframesOf(smooth, 'w-sw')).toBe('@keyframes w-sw{to{transform:translateX(64px)}}')
  // The cloud strips drift linearly, the far one over 110 s, the near one over 70 s.
  const drift = (s: string): string[] => [...rulesOf(s).values()].filter(r => r.startsWith('w-dr ')).sort()
  expect(drift(smooth)).toEqual(['w-dr 110s linear infinite', 'w-dr 70s linear infinite'])
  expect(keyframesOf(smooth, 'w-dr')).toBe('@keyframes w-dr{to{transform:translateX(320px)}}')
  // Night smooth has the beam's sweep (six frames over 4.8 s) and the shooting star.
  const flashes = (s: string): string[] => [...rulesOf(s).values()].filter(r => /^w-f6-\d 4\.8s /.test(r) || r.startsWith('w-ss '))
  expect(flashes(smooth).length).toBe(7)
  expect(keyframesOf(smooth, 'w-ss').length > 0).toBe(true)

  const said = await $.command.run(wallpaper('motion light'))
  expect(said.text).toMatch(/motion light/)
  const lightDrawn = await picture()
  expect(lightDrawn.length).toBe(1)
  const [light = ''] = lightDrawn
  expect(unruled(light)).toEqual([])
  // Light: calmer, not still. The sea's crests glide and the cloud strips
  // drift just as in smooth (the same rules, the strips each drawn twice);
  // only the shooting star rests; the lighthouse sweeps and the camera bobs as
  // in smooth. Everything it animates smooth animates too, and Kiki and the
  // cat move the same in both.
  expect(light.includes('<use')).toBe(true)
  for (const id of ['w-cf', 'w-cn']) expect(light.includes(`<use href="#${id}"/>`)).toBe(true)
  expect(glide(light).sort((a, b) => a - b)).toEqual(glide(smooth).sort((a, b) => a - b))
  expect(keyframesOf(light, 'w-sw')).toBe(keyframesOf(smooth, 'w-sw'))
  expect(drift(light)).toEqual(drift(smooth))
  expect(keyframesOf(light, 'w-dr')).toBe(keyframesOf(smooth, 'w-dr'))
  // The lighthouse: the same six-frame sweep as smooth; the shooting star alone is gone.
  const sweep = (s: string): string[] => flashes(s).filter(r => r.startsWith('w-f6-')).sort()
  expect(sweep(light).length).toBe(6)
  expect(sweep(light)).toEqual(sweep(smooth))
  expect(flashes(light).some(r => r.startsWith('w-ss '))).toBe(false)
  expect(keyframesOf(light, 'w-ss')).toBe('')
  // The camera bobs in light as in smooth, by the same rule (read in the
  // sheet's text: the reduced-motion rule reuses the camera's class).
  expect(sheetOf(smooth).includes('{animation:w-cam ')).toBe(true)
  expect(keyframesOf(light, 'w-cam')).toBe(keyframesOf(smooth, 'w-cam'))
  expect(sheetOf(light).includes('{animation:w-cam 4.2s ease-in-out infinite alternate -3.15s}')).toBe(true)
  expect([...animated(light)].every(c => animated(smooth).has(c))).toBe(true)
  expect(animated(light).size < animated(smooth).size).toBe(true)
  expect(rects(light) < rects(smooth)).toBe(true)
  expect(light.length < smooth.length).toBe(true)
  expect(kikiOf(light).length > 0 && kikiOf(light) === kikiOf(smooth)).toBe(true)
  // The beam's frames are drawn in light just as in smooth: its first frame
  // (w-f6-0 at 4.8s) sits in a group of its own that sweeps.
  const beamClass = smooth.match(/\.(w-[0-9a-z]+)\{animation:w-f6-0 4\.8s /)?.[1] ?? ''
  const beamFirst = smooth.match(new RegExp(`<g class="${beamClass}">([\\s\\S]*?)</g>`))?.[1] ?? ''
  expect(beamClass.length > 0 && beamFirst.length > 0).toBe(true)
  expect(light.includes(`>${beamFirst}</g>`)).toBe(true)

  // Stored and read back: light stays light after a reload of the settings.
  const back = await $.command.run(wallpaper(''))
  expect(back.text).toMatch(/motion light/)

  // The night sky is alive.
  // Every filled pixel of a picture's paths, with whether it lies inside an
  // animated group (one with a class; the shared defs and the sheet left out).
  // The paths are the art's own: rectangles drawn as M/m x y h w v h h -w z.
  const pixelsOf = (s: string, animatedBy?: (rule: string) => boolean): { x: number; y: number; hex: string; moving: boolean; mine: boolean }[] => {
    const rules = rulesOf(s)
    // the camera's classes, by the sheet's text (its reduced-motion rule
    // reuses the class, so the map above holds 'none' for it)
    const camera = new Set([...sheetOf(s).matchAll(/\.([\w-]+)\{animation:w-cam /g)].map(m => m[1] ?? ''))
    const body = s.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<defs>[\s\S]*?<\/defs>/g, '')
    const out: { x: number; y: number; hex: string; moving: boolean; mine: boolean }[] = []
    const stack: { moving: boolean; mine: boolean }[] = [{ moving: false, mine: false }]
    for (const m of body.matchAll(/<(\/?)(g|path)\b([^>]*?)(\/?)>/g)) {
      const top = stack[stack.length - 1] ?? { moving: false, mine: false }
      if (m[1] === '/') { stack.pop(); continue }
      if (m[2] === 'g') {
        if (m[4] === '/') continue
        const cs = (/class="([^"]+)"/.exec(m[3] ?? '')?.[1] ?? '').split(' ').filter(c => c !== '')
        const mine = cs.some(c => animatedBy?.(rules.get(c) ?? '') === true)
        // the camera's bob moves the whole world: not what makes a part move
        const own = cs.filter(c => !camera.has(c))
        stack.push({ moving: top.moving || own.length > 0, mine: top.mine || mine })
        continue
      }
      const hex = /fill="#([0-9a-f]{6})"/.exec(m[3] ?? '')?.[1] ?? ''
      const d = /d="([^"]*)"/.exec(m[3] ?? '')?.[1] ?? ''
      let px = 0
      let py = 0
      let w = 0
      for (const r of d.matchAll(/([Mm])(-?\d+) (-?\d+)h(\d+)v(\d+)h-\d+z/g)) {
        const [x0, y0] = r[1] === 'M' ? [Number(r[2]), Number(r[3])] : [px + Number(r[2]), py + Number(r[3])]
        px = x0
        py = y0
        w = Number(r[4])
        for (let y = y0; y < y0 + Number(r[5]); y += 1) for (let x = x0; x < x0 + w; x += 1) out.push({ x, y, hex, moving: top.moving, mine: top.mine })
      }
    }
    return out
  }
  // The night's star tones (bright, mid, faint).
  const STAR = new Set(['f6edc4', '8e96d8', '4b56a0'])
  for (const shown of [smooth, light]) {
    const px = pixelsOf(shown, rule => /^w-t[sw] /.test(rule))
    // No star is left in the still sky: away from the moon and the
    // lighthouse (whose shade and lamp share star tones), no still pixel above
    // the sea has a star's tone. (The cloud strips' moonlit rims share those
    // tones; both settings move them.)
    {
      const stillStars = px.filter(p => !p.moving && STAR.has(p.hex) && p.y < 106 && Math.hypot(p.x - 255, p.y - 28) > 9 && !(p.x >= 258 && p.x <= 275 && p.y >= 78))
      expect(stillStars.length).toBe(0)
    }
    // ...and the field is all there, twinkling in its groups.
    expect(px.filter(p => p.mine && STAR.has(p.hex)).length > 120).toBe(true)
    // The moon's glow breathes: two wider halos in its glow tone, each hidden
    // at first and shown in steps.
    const halos = px.filter(p => p.hex === '2e3a7a' && p.moving)
    expect(halos.length > 20).toBe(true)
    const rules = rulesOf(shown)
    expect([...rules.values()].filter(r => /^w-hb[01] [\d.]+s step-end infinite/.test(r)).length).toBe(2)
    // Curly wind: four gusts, each riding on its own rule with six frames
    // that come and go in steps; never all four at once over their shared round.
    const rides = [...rules.values()].filter(r => r.startsWith('w-qt '))
    expect(rides.length).toBe(4)
    for (let f = 0; f < 6; f += 1) expect([...rules.values()].filter(r => r.startsWith(`w-q${f} `)).length).toBe(4)
    const timing = rides.map(r => /([\d.]+)s step-end infinite (-?[\d.]+)s/.exec(r)).map(m => [Number(m?.[1]), Number(m?.[2])] as const)
    let most = 0
    for (let t = 0; t < 126; t += 0.05) {
      most = Math.max(most, timing.filter(([p, d]) => ((((t - d) % p) + p) % p) / p < 0.42).length)
    }
    expect(most).toBe(3)
    const gusts = pixelsOf(shown, rule => /^w-q\d /.test(rule)).filter(p => p.mine)
    expect(gusts.length > 300).toBe(true)
    // A group that starts hidden shows itself: its own keyframes turn it
    // visible. (A visible frame inside a group hidden for good may never
    // show, as the gusts' rides once were.)
    const sheet = [...shown.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1] ?? '').join('')
    const shows = (name: string): boolean => {
      const at = sheet.indexOf(`@keyframes ${name}{`)
      if (at < 0) return false
      let depth = 0
      for (let i = sheet.indexOf('{', at); i < sheet.length; i += 1) {
        if (sheet[i] === '{') depth += 1
        else if (sheet[i] === '}' && (depth -= 1) === 0) return sheet.slice(at, i).includes('visibility:visible')
      }
      return false
    }
    const hiddenForGood = [...shown.matchAll(/<g class="([^"]+)"[^>]*\svisibility="hidden"/g)]
      .map(m => m[1] ?? '')
      .filter(cs => !cs.split(' ').some(c => shows((rules.get(c) ?? '').split(' ')[0] ?? '')))
    expect(hiddenForGood).toEqual([])
  }

  // Still: none of it. Every gust and halo starts hidden, and a still picture
  // keeps no hidden part (nor any class).
  await $.command.run(wallpaper('motion off'))
  const [off = ''] = await picture()
  expect(off.includes('visibility="hidden"')).toBe(false)
  expect(off.includes('class="')).toBe(false)
  expect(off.length > 0 && off.length < light.length).toBe(true)
})

test('the sea keeps no glitter column, the small clouds are round underneath, and the camera bobs the world but not Kiki', OPTIONS, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('command.register', () => ({ value: { command: 'wallpaper' } }))
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'backdrop' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const picture = async (): Promise<string> => {
    const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
    const s = (await sources(ui)).map(bare).join('')
    await ui.unmount()
    return s
  }
  const sheetOf = (s: string): string => [...s.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1] ?? '').join('')
  // The rules a class runs, the reduced-motion overrides left out.
  const REDUCED = /@media \(prefers-reduced-motion:reduce\)\{(?:[^{}]*\{[^}]*\})*\}/g
  const rulesOf = (s: string): Map<string, string> =>
    new Map([...sheetOf(s).replace(REDUCED, '').matchAll(/\.([\w-]+)\{animation:([^}]*)\}/g)].map(m => [m[1] ?? '', m[2] ?? ''] as const))
  // The painted pixels of some markup's paths, with their colour (M/m x y h w v h h -w z rectangles).
  const paint = (markup: string): { x: number; y: number; hex: string }[] => {
    const out: { x: number; y: number; hex: string }[] = []
    for (const m of markup.matchAll(/<path fill="#([0-9a-f]{6})" d="([^"]*)"/g)) {
      let px = 0
      let py = 0
      for (const r of (m[2] ?? '').matchAll(/([Mm])(-?\d+) (-?\d+)h(\d+)v(\d+)h-\d+z/g)) {
        px = r[1] === 'M' ? Number(r[2]) : px + Number(r[2])
        py = r[1] === 'M' ? Number(r[3]) : py + Number(r[3])
        for (let y = py; y < py + Number(r[5]); y += 1) for (let x = px; x < px + Number(r[4]); x += 1) out.push({ x, y, hex: m[1] ?? '' })
      }
    }
    return out
  }
  const bodyOf = (s: string): string => s.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<defs>[\s\S]*?<\/defs>/g, '')
  /** Where each group whose class runs a matching rule opens and closes, and how many such groups hold it. */
  const groupsRunning = (s: string, test: (rule: string) => boolean): { open: number; close: number; depth: number }[] => {
    const rules = rulesOf(s)
    const out: { open: number; close: number; depth: number }[] = []
    const stack: { at: number; mine: boolean; depth: number }[] = []
    let inside = 0
    for (const m of s.matchAll(/<(\/?)g\b([^>]*?)(\/?)>/g)) {
      if (m[3] === '/') continue
      if (m[1] === '/') {
        const top = stack.pop()
        if (top?.mine) {
          out.push({ open: top.at, close: m.index ?? 0, depth: top.depth })
          inside -= 1
        }
        continue
      }
      const cs = (/class="([^"]+)"/.exec(m[2] ?? '')?.[1] ?? '').split(' ')
      const mine = cs.some(c => test(rules.get(c) ?? ''))
      if (mine) inside += 1
      stack.push({ at: m.index ?? 0, mine, depth: inside })
    }
    return out
  }
  const isCam = (rule: string): boolean => rule.startsWith('w-cam ')

  // The glints of each phase's water (world.ts wG and wG2): below the first
  // rows of the sea nothing else wears them.
  const GLINT: Record<string, readonly string[]> = { day: ['ffffff', 'c3dcf7'], sunset: ['ffe0a0', 'f2a06a'], night: ['dcd2a6', '8e96d8'] }
  for (const phase of ['day', 'sunset', 'night'] as const) {
    await $.command.run(wallpaper(`time ${phase}`))
    for (const motion of ['smooth', 'light', 'off'] as const) {
      await $.command.run(wallpaper(`motion ${motion}`))
      const s = await picture()
      const body = bodyOf(s)
      // No long column of light on the sea under the sun or moon (it read as a
      // stripe painted down the picture): every glint frame together, no
      // 20-px wide column holds glints in more than a dozen rows (the old
      // column held them in 60), and only a handful of glints in all.
      const glints = paint(body).filter(p => p.y >= 116 && (GLINT[phase] ?? []).includes(p.hex))
      let most = 0
      for (let a = 0; a < 320; a += 2) most = Math.max(most, new Set(glints.filter(p => p.x >= a && p.x < a + 20).map(p => p.y)).size)
      expect(most <= 12).toBe(true)
      expect(glints.length < 120).toBe(true)

      if (motion === 'off') {
        // Still: no camera, nothing that moves.
        expect(s.includes('w-cam')).toBe(false)
        expect(s.includes('class="')).toBe(false)
        continue
      }
      const rules = rulesOf(s)
      const cams = [...rules.values()].filter(isCam)
      {
        // Smooth and light alike (the bob was asked for, and light only rests
        // the beam and the shooting star). The camera: one rule, on Kiki's own float's beat (hero.ts h-fl: 4.2 s
        // each way, -2.1 s) and an eighth of a round ahead of her, so the two
        // never drift apart; translateY only, three quarters of a pixel each way.
        expect(cams).toEqual(['w-cam 4.2s ease-in-out infinite alternate -3.15s'])
        expect(sheetOf(s).includes('h-fl 4.2s ease-in-out -2.1s infinite alternate')).toBe(true)
        expect(sheetOf(s).includes('@keyframes w-cam{from{transform:translateY(-0.75px)}to{transform:translateY(0.75px)}}')).toBe(true)
        // ...and it rests for those who ask for less motion, as Kiki's float does.
        const camClass = [...rules.entries()].find(([, r]) => isCam(r))?.[0] ?? ''
        expect(sheetOf(s).includes(`@media (prefers-reduced-motion:reduce){.${camClass}{animation:none}}`)).toBe(true)
        // Two camera groups, one inside the other (the near layers bob a
        // pixel and a half each way, the sky half that), and Kiki's group outside both.
        const groups = groupsRunning(s, isCam)
        const outer = groups.filter(g => g.depth === 1)
        const inner = groups.filter(g => g.depth === 2)
        expect(outer.length >= 1 && inner.length >= 1).toBe(true)
        expect(inner.every(i => outer.some(o => o.open < i.open && i.close < o.close))).toBe(true)
        const kiki = s.indexOf('<g class="h-fl">')
        expect(kiki > 0).toBe(true)
        expect(groups.every(g => kiki < g.open || kiki > g.close)).toBe(true)
        // The sky sits in the outer group alone, ahead of the inner one.
        expect(s.indexOf('<path', outer[0]?.open ?? 0) < (inner[0]?.open ?? 0)).toBe(true)
      }
      // Overscan: the picture is painted on past its top and bottom edges by
      // more than the camera moves (a pixel and a half), all the way across, so no
      // empty edge shows as it bobs.
      const px = paint(body)
      for (const y of [-3, -2, -1, 180, 181, 182]) {
        const xs = new Set(px.filter(p => p.y === y).map(p => p.x))
        expect([...Array(320).keys()].every(x => xs.has(x))).toBe(true)
      }
      if (motion === 'smooth' && phase === 'day') {
        // The small drifting clouds are round underneath, never cut flat: in
        // each cloud of the two strips the last row is narrower than its
        // widest row by a good margin.
        for (const id of ['w-cf', 'w-cn']) {
          const strip = new RegExp(`<g id="${id}">([\\s\\S]*?)</g>`).exec(s)?.[1] ?? ''
          const cloud = paint(strip)
          expect(cloud.length > 100).toBe(true)
          const key = (x: number, y: number): string => `${x},${y}`
          const left = new Map(cloud.map(p => [key(p.x, p.y), p] as const))
          let clouds = 0
          for (const start of cloud) {
            if (!left.has(key(start.x, start.y))) continue
            left.delete(key(start.x, start.y))
            const todo = [start]
            const rows = new Map<number, number>()
            for (let p = todo.pop(); p !== undefined; p = todo.pop()) {
              rows.set(p.y, (rows.get(p.y) ?? 0) + 1)
              for (let dy = -1; dy <= 1; dy += 1) {
                for (let dx = -1; dx <= 1; dx += 1) {
                  const q = left.get(key(p.x + dx, p.y + dy))
                  if (q === undefined) continue
                  left.delete(key(q.x, q.y))
                  todo.push(q)
                }
              }
            }
            const bottom = rows.get(Math.max(...rows.keys())) ?? 0
            const widest = Math.max(...rows.values())
            expect(bottom * 10 <= widest * 6).toBe(true)
            clouds += 1
          }
          expect(clouds >= 3).toBe(true)
        }
      }
    }
  }
})

test('every scene is drawn as images, and drawn afresh a few seconds after it first shows', OPTIONS, async ($, on) => {
  // Local noon: the kiki scene follows the clock, and noon is day everywhere.
  const clock = mock.clock(on, { now: new Date(2026, 5, 15, 12, 0, 0).getTime() })
  mock.store(on)
  let redraws = 0
  on('command.register', () => ({ value: { command: 'wallpaper' } }))
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

  // /wallpaper with no words draws it afresh and says how it was drawn.
  const said = await $.command.run(wallpaper(''))
  expect(said.text).toMatch(/Last draw: kiki, an SVG image of \d+ characters, on desktop\. Wake draws so far: 4\./)
  expect(String(said.text).includes('Fresh frames')).toBe(false)
  expect(redraws).toBe(before + 5)

  // Never crisp edges in a scene: the desktop app would not animate it.
  expect(firstSource.includes('shape-rendering')).toBe(false)
})

test('a first draw that comes late, after the early wake draws, is still drawn afresh twice', OPTIONS, async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 5, 15, 12, 0, 0).getTime() })
  mock.store(on)
  let redraws = 0
  on('command.register', () => ({ value: { command: 'wallpaper' } }))
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

test('/wallpaper time picks the time of day the kiki scene shows, each one stable', OPTIONS, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  on('command.register', () => ({ value: { command: 'wallpaper' } }))
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'backdrop' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  // One drawing of the kiki backdrop, as images, without the marks of wake draws.
  const draw = async (): Promise<string> => {
    const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
    const drawn = await svgs(ui)
    await ui.unmount()
    expect(drawn.length > 0).toBe(true)
    expect(drawn.some(d => d.isInteractive === true)).toBe(false)
    return bare(drawn.map(d => String(d.source)).join(''))
  }

  const night = await $.command.run(wallpaper('time night'))
  expect(night.text).toMatch(/Kiki time: night, always; the scene shows the night now/)
  const atNight = await draw()
  expect(atNight.includes('viewBox="0 0 320 180"')).toBe(true)
  // Stable across redraws, a turn and time passing.
  expect(await draw()).toBe(atNight)
  await $.turn.start({ text: 'hello', turnId: 't1' })
  expect(await draw()).toBe(atNight)
  await clock.advance(3100)
  expect(await draw()).toBe(atNight)

  const day = await $.command.run(wallpaper('time day'))
  expect(day.text).toMatch(/Kiki time: day, always; the scene shows the day now/)
  const atDay = await draw()
  expect(atDay === atNight).toBe(false)
  expect(await draw()).toBe(atDay)
  await clock.advance(3100)
  expect(await draw()).toBe(atDay)

  const sunset = await $.command.run(wallpaper('time sunset'))
  expect(sunset.text).toMatch(/the scene shows the sunset now/)
  const atSunset = await draw()
  expect(atSunset === atDay || atSunset === atNight).toBe(false)
  expect(await draw()).toBe(atSunset)

  // A word that is not a time of day changes nothing.
  const dusk = await $.command.run(wallpaper('time dusk'))
  expect(dusk.text).toBe('Usage: /wallpaper time auto|day|sunset|night')
  expect(await draw()).toBe(atSunset)

  // Still: no animation in any phase.
  await $.command.run(wallpaper('motion off'))
  for (const phase of ['day', 'sunset', 'night'] as const) {
    await $.command.run(wallpaper(`time ${phase}`))
    const still = await draw()
    expect(still.includes('@keyframes')).toBe(false)
    expect(still.includes('<animate')).toBe(false)
    expect(await draw()).toBe(still)
  }
  await $.command.run(wallpaper('motion smooth'))

  // Auto follows the sun where you are; with no place known, the machine's
  // clock and the default sun times (06:30 and 18:30).
  const auto = await $.command.run(wallpaper('time auto'))
  expect(auto.text).toMatch(/Kiki time: auto/)
  const localMidnight = (ms: number): number => {
    const d = new Date(ms)
    return ms - (((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000 + d.getMilliseconds())
  }
  const midnight = localMidnight(clock.now()) + 86_400_000
  // The scene's minute timer ticks while it follows the clock: jump the clock
  // with the look off, so hours pass without hundreds of ticks, then turn it on.
  const jump = async (ms: number): Promise<void> => {
    await $.command.run(wallpaper('off'))
    await clock.set(ms)
    await $.command.run(wallpaper('on'))
  }
  await jump(midnight + 12 * 3_600_000)
  expect(await draw()).toBe(atDay)
  await jump(midnight + 18 * 3_600_000 + 20 * 60_000)
  expect(await draw()).toBe(atSunset)
  await jump(midnight + 23 * 3_600_000)
  expect(await draw()).toBe(atNight)
  expect((await $.command.run(wallpaper(''))).text).toMatch(/Kiki time: auto, following the clock, with sunrise at 06:30 and sunset at 18:30; the scene shows the night now/)
})

test('the kiki day turns with the sun: the default times with no place, the sun where you are with one', async () => {
  const at = (h: number, m = 0): number => Date.UTC(2026, 10, 15, h, m)
  // No place: sunrise 06:30, sunset 18:30. Sunset from 40 minutes before
  // sunrise to 30 after, and from an hour before sunset to 30 after.
  expect(sunTimes(at(12), 0)).toEqual({ sunrise: 390, sunset: 1110 })
  expect(phaseAt(at(5, 40), 0)).toBe('night')
  expect(phaseAt(at(6, 0), 0)).toBe('sunset')
  expect(phaseAt(at(12), 0)).toBe('day')
  expect(phaseAt(at(18, 20), 0)).toBe('sunset')
  expect(phaseAt(at(19, 0), 0)).toBe('night')
  // The same hours read an hour ahead of UTC.
  expect(phaseAt(at(5, 0), 3600)).toBe('sunset')
  expect(phaseAt(at(17, 20), 3600)).toBe('sunset')

  // Birmingham in mid-November: the weather service gave sunrise 07:29 and
  // sunset 16:14; the estimate keeps within ten minutes of them.
  const home = asPlace({ lat: 52.48, lon: -1.9, name: 'Birmingham, United Kingdom', source: 'ip', at: 0 })
  expect(home?.name).toBe('Birmingham, United Kingdom')
  const sun = sunTimes(at(12), 0, home)
  expect(Math.abs(sun.sunrise - 449) <= 10).toBe(true)
  expect(Math.abs(sun.sunset - 974) <= 10).toBe(true)
  expect(phaseAt(at(7, 0), 0, home)).toBe('sunset')
  expect(phaseAt(at(12), 0, home)).toBe('day')
  expect(phaseAt(at(16, 0), 0, home)).toBe('sunset')
  expect(phaseAt(at(17, 0), 0, home)).toBe('night')

  // What is not a place is none.
  expect(asPlace(undefined)).toBeUndefined()
  expect(asPlace({ lat: 'north', lon: 2 })).toBeUndefined()
  expect(asPlace({ lat: 95, lon: 2 })).toBeUndefined()
  expect(asPlace({ lat: 10, lon: 20 })?.name).toBe('10, 20')
})

test('the pixel valley is gone: a saved valley theme draws Kiki, and its saved place still times her day', OPTIONS, async ($, on) => {
  mock.clock(on)
  mock.store(on, {
    settings: { theme: 'pixel-valley', isOn: true, clear: 100, blur: 0, dim: 30, colors: true, motion: 'light', kikiTime: 'auto', picture: '', film: '' },
    'valley.location': { lat: 52.48, lon: -1.9, name: 'Birmingham, United Kingdom', source: 'ip', at: 0 },
  })
  const themes: Look[] = []
  on('command.register', () => ({ value: { command: 'wallpaper' } }))
  on('theme.set', (_, e) => { themes.push(e as Look); return { value: { isDrawn: true, requestId: 'backdrop' } } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(themes.at(-1)?.backdrop?.scene).toBe('kiki')
  expect(themes.at(-1)?.colors?.label).toBe('Kiki night')
  const said = await $.command.run(wallpaper(''))
  expect(said.text).toMatch(/The wallpaper is Kiki\./)
  expect(said.text).toMatch(/motion light/)
  expect(said.text).toMatch(/Kiki time: auto, following the sun in Birmingham, United Kingdom; the scene shows the (day|sunset|night) now/)
  // Asked for by name, the old valley is a backdrop of nobody's: left to the app.
  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop', props: propsOf('pixel-valley') })
  expect((await sources(ui)).length).toBe(0)
  await ui.unmount()

  // Its words are no longer commands, and the help names none of them.
  for (const word of ['valley', 'pixel-valley', 'city Birmingham', 'auto', 'refresh', 'preview night']) {
    const answer = await $.command.run(wallpaper(word))
    expect(answer.text).toMatch(new RegExp(`^There is no "${word.split(' ')[0]}"`))
  }
  const help = String((await $.command.run(wallpaper('help'))).text)
  expect(/valley|weather|city/i.test(help)).toBe(false)
})

test('the settings pane picks the kiki time', OPTIONS, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('command.register', () => ({ value: { command: 'wallpaper' } }))
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'backdrop' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const t of ['auto', 'day', 'sunset', 'night']) expect(await ui.find({ key: `time-${t}` })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'time-sunset' })
  await ui.unmount()
  expect((await $.command.run(wallpaper(''))).text).toMatch(/Kiki time: sunset, always/)
})

test('a backdrop of another mod is left to it', OPTIONS, async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>theirs</Text>
  })
  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop', props: propsOf('lagoon', 'other') })
  expect((await ui.find({ type: 'Text', text: /theirs/ }))?.text).toBe('theirs')
  await ui.unmount()
})

test('/wallpaper switches themes, turns the dials and turns the look off', OPTIONS, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const themes: Look[] = []
  let cleared = 0
  on('command.register', () => ({ value: { command: 'wallpaper' } }))
  on('theme.set', (_, e) => { themes.push(e as Look); return { value: { isDrawn: true, requestId: 'backdrop' } } })
  on('theme.clear', () => { cleared += 1; return { value: { isDrawn: false, reason: 'cleared' } } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  // The dials: solid panels with a blur, and no dimming.
  await $.command.run(wallpaper('clear 40'))
  await $.command.run(wallpaper('blur 12'))
  const dim = await $.command.run(wallpaper('dim 0'))
  expect(dim.text).toMatch(/Panels 40% clear, blur 12, scene dimmed 0%/)
  expect(themes.at(-1)?.backdrop?.glass?.opacity).toBe(0.6)
  expect(themes.at(-1)?.backdrop?.glass?.blur).toBe(12)

  // Kiki by name, with the night colors and no veil now.
  const kiki = await $.command.run(wallpaper('kiki'))
  expect(kiki.text).toMatch(/The wallpaper is Kiki/)
  expect(themes.at(-1)?.backdrop?.scene).toBe('kiki')
  expect(themes.at(-1)?.colors?.label).toBe('Kiki night')
  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop', props: propsOf('kiki') })
  const night = await whole(ui)
  expect(night.includes('viewBox="0 0 320 180"')).toBe(true)
  expect(night.includes('fill="#000" opacity')).toBe(false)
  await ui.unmount()

  // The themes that were taken out are no longer commands.
  const gone = await $.command.run(wallpaper('delivery'))
  expect(gone.text).toMatch(/There is no "delivery"/)
  const valley = await $.command.run(wallpaper('valley'))
  expect(valley.text).toMatch(/There is no "valley"/)
  expect(themes.at(-1)?.backdrop?.scene).toBe('kiki')

  // The app's own colors again.
  await $.command.run(wallpaper('colors off'))
  expect(themes.at(-1)?.colors).toBe(undefined)

  // A theme of your own with nothing loaded falls back to kiki.
  const none = await $.command.run(wallpaper('picture'))
  expect(none.text).toMatch(/Kiki.*My picture has nothing loaded/)

  const off = await $.command.run(wallpaper('off'))
  expect(off.text).toMatch(/off/)
  expect(cleared).toBe(1)

  const bad = await $.command.run(wallpaper('moonbase'))
  expect(bad.text).toMatch(/There is no "moonbase"/)
})

test('the settings pane turns the dials and picks a theme', OPTIONS, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const themes: Look[] = []
  on('command.register', () => ({ value: { command: 'wallpaper' } }))
  on('theme.set', (_, e) => { themes.push(e as Look); return { value: { isDrawn: true, requestId: 'backdrop' } } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'theme-kiki' })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'clear-less' })
  expect(Math.round((themes.at(-1)?.backdrop?.glass?.opacity ?? 0) * 100)).toBe(10)
  await ui.press({ key: 'blur-more' })
  expect(themes.at(-1)?.backdrop?.glass?.blur).toBe(4)
  // Kiki, your picture and your video: the valley's button is gone.
  for (const t of ['kiki', 'my-picture', 'my-video']) expect(await ui.find({ key: `theme-${t}` })).toBeDefined()
  expect(await ui.find({ key: 'theme-pixel-valley' })).toBeUndefined()
  await ui.press({ key: 'theme-kiki' })
  expect(themes.at(-1)?.backdrop?.scene).toBe('kiki')
  await ui.unmount()
})

test('a picture and a video of your own are traced and drawn', OPTIONS, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const themes: Look[] = []
  const ran: string[][] = []
  const written: string[] = []
  on('command.register', () => ({ value: { command: 'wallpaper' } }))
  on('theme.set', (_, e) => { themes.push(e as Look); return { value: { isDrawn: true, requestId: 'backdrop' } } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // ffmpeg stands in: every run works, and the raw pixels it "wrote" are all one color,
  // of the size the file's name asks for (work-<width>x<height>x<frames>.rgb).
  on('process.run', (_, e) => {
    ran.push([...(e as { argv: string[] }).argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', () => ({ value: true }))
  on('fs.read', (_, e) => {
    const size = /work-(\d+)x(\d+)x(\d+)\.rgb$/.exec((e as { path: string }).path)
    if (!size) return { value: '' }
    return { value: { base64: btoa('\u0010'.repeat(Number(size[1]) * Number(size[2]) * 3 * Number(size[3]))) } }
  })
  on('fs.write', (_, e) => { written.push((e as { path: string }).path); return { value: undefined } })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const picture = await $.command.run(wallpaper('picture "C:/Pictures/harbour at night.png"'))
  expect(picture.text).toMatch(/Your picture is the wallpaper/)
  expect(ran.at(-1)?.includes('C:/Pictures/harbour at night.png')).toBe(true)
  expect(written.at(-1)).toMatch(/user.picture-.*\.svg$/)
  // A scene like the others, so the see-through panels lie over it, drawn as shapes: no picture file inside.
  expect(themes.at(-1)?.backdrop?.scene).toBe('my-picture')
  expect(themes.at(-1)?.backdrop?.glass?.opacity).toBe(0.01)
  let ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop', props: propsOf('my-picture') })
  const still = (await sources(ui))[0] ?? ''
  expect(still.includes('viewBox="0 0 480 270"')).toBe(true)
  expect(still.includes('fill="#101010"')).toBe(true)
  expect(still.includes('data:')).toBe(false)
  expect(still.includes('shape-rendering')).toBe(false)
  await ui.unmount()

  const video = await $.command.run(wallpaper('video C:/Videos/waves.mp4'))
  expect(video.text).toMatch(/loop from the start of your video/)
  expect(ran.at(-1)?.some(arg => arg.includes('trim=end_frame=6'))).toBe(true)
  expect(themes.at(-1)?.backdrop?.scene).toBe('my-video')
  ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop', props: propsOf('my-video') })
  const film = (await sources(ui))[0] ?? ''
  expect(film.includes('viewBox="0 0 288 162"')).toBe(true)
  expect(film.includes('shape-rendering')).toBe(false)
  await ui.unmount()
})
