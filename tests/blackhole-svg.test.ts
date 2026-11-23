// Tests for the black hole's SVG builder: hooks/blackhole.ts.
//
// THE CONTRACT these tests pin (the field's own contract is in blackhole.test.ts):
//
//   blackhole(opts: { motion: 'smooth' | 'light' | 'off'; dim?: number }): string
//       The whole wallpaper as one SVG string. Pure: the same opts give the same string.
//       motion 'smooth': the frames play in a loop; 'light': the same, played more slowly; 'off': one
//       still frame, no animation at all. `dim` is a darkening, 0 for none; this file only needs any
//       value (0, 30, 80) to give a valid picture, and leaves what it does to the builder.
//
// HOW IT DIFFERS FROM KIKI'S BUILDER, and what was chosen. Kiki's is `kikiScene(phase, still = false, light?)`,
// positional, giving `{ layers: [{ source, moves }], alt }`, and its darkening is not an option of it at
// all: register.tsx's `dimmed()` lays a veil inside the finished source. The brief's signature is an
// options object returning the string, and a black hole has no phase, so that signature is the contract
// here (motion 'off' is Kiki's `still`, 'light' is Kiki's `light`). If the builder returns Kiki's shape
// instead, change `build` below, the one place these tests call it, and the harness test at the bottom.
//
// A picture, as Kiki's and the video loop's are: one `<svg>` root with `viewBox` and
// `preserveAspectRatio="... slice"`; the ASCII frames as `<text>`; frame k shown by CSS `opacity` stepped
// with `steps(...)`, `step-start` or `step-end`; a `prefers-reduced-motion` rule when it animates; amber
// characters on near-black; monospace and upright (never rotated or skewed); at most 124,000 characters;
// nothing that loads or runs (no <image, data:, <script, foreignObject, @font-face, @import, <!DOCTYPE,
// <![CDATA[; url( only as a local reference, url(#name) or url('#name'); no href but a local #fragment;
// no & other than the five basic references).
//
// Frame 0 is pinned by its characters, not by whole rows: take the source, drop the <style> element and every
// tag, drop all spaces and line breaks; frame 0's lit characters, row by row in order with their spaces
// removed, then appear in what is left as one sequence. A row may be split into runs (own colour or x).
//
// Why a failing test says what it does now: hooks/blackhole.ts and hooks/blackhole/field.ts do not exist
// yet, so this file fails to load ("the file did not load"). A hooks module can only be imported with a
// plain import declaration, so each new module has its own test file.
import { expect, mock, test } from 'claude-code/testing'

import { blackhole } from '../hooks/blackhole'
import { FRAMES, frame } from '../hooks/blackhole/field'

type Motion = 'smooth' | 'light' | 'off'
const MOTIONS: Motion[] = ['smooth', 'light', 'off']
const CAP = 124_000

/** The one place the builder is called. */
const build = (motion: Motion, dim?: number): string => blackhole(dim === undefined ? { motion } : { motion, dim })

const rowsOf = (f: string[]): string[] => f.map(r => r.trim()).filter(r => r !== '')
/** The trimmed lit rows of a frame. */
const lit = (i: number): string[] => rowsOf(frame(i))
/** A frame's lit characters, row by row, spaces removed, as one string. */
const sequence = (i: number): string => frame(i).map(r => r.replace(/\s/g, '')).join('')
/** The source's text alone: no <style> content, no tags, no spaces or line breaks. */
const textOf = (s: string): string => s.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '').replace(/<[^>]*>/g, '').replace(/\s+/g, '')

const sheet = (s: string): string => [...s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1] ?? '').join('')

/** The loop's durations in seconds: the first time in each `animation` rule (or `animation-duration`). */
const durations = (s: string): number[] =>
  [...sheet(s).matchAll(/animation(?:-duration)?\s*:\s*([^;}]*)/g)]
    .map(m => /(?:^|\s)(\d*\.?\d+)(ms|s)(?=\s|;|}|$)/.exec(m[1] ?? ''))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => Number(m[1]) / (m[2] === 'ms' ? 1000 : 1))

const REDUCED = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/

/** Every colour written as #rgb, #rrggbb or rgb(r,g,b), as [r, g, b]. */
const colours = (s: string): [number, number, number][] => {
  const out: [number, number, number][] = []
  for (const m of s.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g)) {
    const h = m[1] ?? ''
    const w = h.length === 3 ? [...h].map(c => c + c).join('') : h
    out.push([parseInt(w.slice(0, 2), 16), parseInt(w.slice(2, 4), 16), parseInt(w.slice(4, 6), 16)])
  }
  for (const m of s.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) out.push([Number(m[1]), Number(m[2]), Number(m[3])])
  return out
}
const hue = ([r, g, b]: [number, number, number]): number => {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return 0
  const d = max - min
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}
const isAmber = (c: [number, number, number]): boolean => {
  const max = Math.max(...c)
  const min = Math.min(...c)
  return max >= 153 && (max - min) / max >= 0.6 && hue(c) >= 28 && hue(c) <= 52
}
const isNearBlack = (c: [number, number, number]): boolean => Math.max(...c) <= 34

test('every motion and dim gives one valid SVG under the size cap, rooted like Kiki\'s', () => {
  for (const motion of MOTIONS) {
    for (const dim of [undefined, 0, 30, 80]) {
      const s = build(motion, dim)
      expect(typeof s).toBe('string')
      expect(s.startsWith('<svg')).toBe(true)
      expect(s.trimEnd().endsWith('</svg>')).toBe(true)
      expect(s.length <= CAP).toBe(true)
      const root = /^<svg\b[^>]*>/.exec(s)?.[0] ?? ''
      expect(root.includes('xmlns="http://www.w3.org/2000/svg"')).toBe(true)
      expect(/\sviewBox="\s*-?[\d.]+[ ,]+-?[\d.]+[ ,]+[\d.]+[ ,]+[\d.]+\s*"/.test(root)).toBe(true)
      expect(/\spreserveAspectRatio="[^"]*\bslice"/.test(root)).toBe(true)
      // Well formed: every tag closes (comments, declarations and self-closing tags set aside).
      const stack: string[] = []
      for (const m of s.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([A-Za-z][\w:-]*)\b[^>]*?(\/?)>/g)) {
        if (m[3] === '/') continue
        if (m[1] === '/') expect(stack.pop()).toBe(m[2])
        else stack.push(m[2] ?? '')
      }
      expect(stack).toEqual([])
    }
  }
})

test('the same options give the same picture, and the three motions differ', () => {
  for (const motion of MOTIONS) expect(build(motion, 30) === build(motion, 30)).toBe(true)
  expect(new Set(MOTIONS.map(m => build(m))).size).toBe(3)
})

test('it holds frame 0\'s lit characters as text, row by row in order, in every motion', () => {
  const want = sequence(0)
  expect(lit(0).length > 5).toBe(true)
  for (const motion of MOTIONS) {
    const s = build(motion)
    expect(s.includes('<text')).toBe(true)
    expect([motion, textOf(s).includes(want)]).toEqual([motion, true])
  }
})

test('smooth and light animate with opacity steps and a reduced-motion rule, and light plays more slowly', () => {
  const lengths: number[] = []
  for (const motion of ['smooth', 'light'] as const) {
    const s = build(motion)
    const css = sheet(s)
    expect(s.includes('@keyframes')).toBe(true)
    expect(/animation/.test(s)).toBe(true)
    // Frames come and go by opacity, in steps, never a fade.
    expect(/opacity/.test(css)).toBe(true)
    expect(/steps\(|step-end|step-start/.test(css)).toBe(true)
    // It rests for those who ask for less motion.
    expect(REDUCED.test(css)).toBe(true)
    const d = durations(s)
    expect(d.length > 0 && d.every(v => Number.isFinite(v) && v > 0)).toBe(true)
    lengths.push(Math.max(...d))
  }
  expect((lengths[1] ?? 0) > (lengths[0] ?? Infinity)).toBe(true)
})

test('motion off is one still frame: no animation, no keyframes, and nothing of the other frames', () => {
  const s = build('off')
  expect(s.includes('animation')).toBe(false)
  expect(s.includes('@keyframes')).toBe(false)
  expect(s.includes('<animate')).toBe(false)
  expect(s.length < build('smooth').length).toBe(true)
  // It holds frame 0's characters and not a later frame's: the middle frame's sequence is not in its text.
  const text = textOf(s)
  const mid = sequence(Math.floor(FRAMES / 2))
  expect(text.includes(sequence(0))).toBe(true)
  expect(mid !== sequence(0) && !sequence(0).includes(mid)).toBe(true)
  expect(text.includes(mid)).toBe(false)
  expect(text.length < textOf(build('smooth')).length).toBe(true)
})

test('it draws nothing that loads or runs, and keeps to the five basic & references', () => {
  const banned = ['<image', 'data:', '<script', 'foreignobject', '@font-face', '@import', '<!doctype', '<![cdata[']
  for (const motion of MOTIONS) {
    for (const dim of [undefined, 30]) {
      const s = build(motion, dim)
      const lower = s.toLowerCase()
      for (const word of banned) expect([motion, word, lower.includes(word)]).toEqual([motion, word, false])
      // url( only as a local reference: url(#name) or url('#name').
      expect([motion, /url\(\s*(?!["']?#)/i.test(s)]).toEqual([motion, false])
      // Only a local #fragment may be linked to.
      for (const m of s.matchAll(/(?:xlink:)?href\s*=\s*(["'])(.*?)\1/gi)) expect((m[2] ?? '').startsWith('#')).toBe(true)
      // Every & begins one of the five basic references.
      expect(/&(?!(?:amp|lt|gt|quot|apos);)/.test(s)).toBe(false)
    }
  }
})

test('amber characters on near-black, in a monospace font, never rotated or skewed', () => {
  for (const motion of MOTIONS) {
    const s = build(motion)
    const all = colours(s)
    expect([motion, all.some(isAmber)]).toEqual([motion, true])
    expect([motion, all.some(isNearBlack)]).toEqual([motion, true])
    expect(/monospace|consolas|courier|menlo|mono\b/i.test(s)).toBe(true)
    // Upright on a fixed grid: the frames switch, the characters never turn.
    expect(/rotate\(|skew[XY]?\(|matrix\(|\brotate\s*=/i.test(s)).toBe(false)
  }
})

// The mod's own Backdrop gives exactly what the builder makes (the harness is as backdrop.test.tsx's).
const propsOf = (name: string, plugin = 'wallpaper') => ({ id: name, scene: name, plugin, glass: false }) as never
const BACKDROP = { plugin: 'wallpaper', component: 'Backdrop', props: propsOf('blackhole') } as const
const wallpaper = (args: string) => ({ command: 'wallpaper', args }) as never
const WAKE_MARK = /<g id="kw[0-9a-z]+"\/>/g

test('/wallpaper blackhole draws exactly the builder\'s picture, in each motion', { options: { spinner: true } }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('command.register', () => ({ value: { command: 'wallpaper' } }))
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'backdrop' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run(wallpaper('blackhole'))
  // No dimming, so the picture is the builder's own whichever way the mod darkens a scene.
  await $.command.run(wallpaper('dim 0'))
  for (const motion of MOTIONS) {
    await $.command.run(wallpaper(`motion ${motion}`))
    const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
    const walk = (node: unknown, out: string[]): string[] => {
      if (!node || typeof node !== 'object') return out
      if (Array.isArray(node)) { node.forEach(n => walk(n, out)); return out }
      const el = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown }
      if (el.type === 'Svg' && typeof el.props?.source === 'string') out.push(el.props.source)
      walk(el.children, out)
      return out
    }
    const drawn = walk(await ui.drawn(), [])
    await ui.unmount()
    expect([motion, drawn.length]).toEqual([motion, 1])
    const got = (drawn[0] ?? '').replace(WAKE_MARK, '')
    expect([motion, got === build(motion, 0) || got === build(motion)]).toEqual([motion, true])
  }
})
