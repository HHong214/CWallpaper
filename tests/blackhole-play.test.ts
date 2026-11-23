// Tests for how the black hole PLAYS and LAYS OUT its frames: hooks/wallpapers/blackhole/svg.ts (`blackhole(opts)`;
// it was hooks/blackhole.ts before the rebuild, and the contents of this file are as they were).
// Added after a review found four faults the first tests did not cover. Each test pins one of them.
//
//   1. No gap: in `smooth` and `light`, at every instant of the loop at least one frame is visible, never
//      more than two, and two are visible together for under 1 ms at each boundary.
//   2. At time 0 exactly one frame is visible, and it is frame 0.
//   3. With the animation taken away by other means than the media rule (every `animation*` declaration
//      and every @keyframes block deleted), frame 0 is visible and every other frame is hidden.
//   4. The grid: a run of n characters starting at column c is placed with a `textLength` of at most
//      (n - 1) cells plus one character's advance (advance 0.5 to 0.65 of the font size), and at least
//      (n - 1) cells plus 0.5 of the font size, so its last character starts at column c + n - 1.
//
// THE FORM RELIED ON, read from the SVG string alone (no browser):
//   - Frames are the top-level `<g class="...">` elements that hold `<text`, in document order; the first is
//     frame 0. Their number must be FRAMES (from hooks/blackhole/field).
//   - All `<style>` content is read as CSS. Rules are `selector{declarations}` with simple selectors (a tag
//     and/or classes: `.f`, `.f3`, `g.f`, a comma list); a rule with a combinator is ignored. Specificity is
//     the number of classes, then source order. `@media` blocks are left out whole (the sampling is of a
//     viewer who has not asked for less motion).
//   - A frame's animation comes from `animation` (shorthand: name, a duration, a delay, a timing function,
//     `infinite`) and the longhands `animation-name`, `-duration`, `-delay`, `-timing-function`, resolved by
//     the cascade. Every frame's animation runs forever from time 0, forwards, with a negative delay
//     starting it part-way in. Times are read with spaces and units (`s`, `ms`) tolerated.
//   - A named `@keyframes` holds stops (`0%`, `3.34%`, `from`, `to`, comma lists) each with `opacity`.
//     Between two stops the timing function decides: `step-end` or `steps(1)` holds the earlier stop's value
//     to the next stop, `step-start` takes the later one at once, `steps(n[, start|end])` in n steps, any
//     other timing linearly. A stop missing at 0% or 100% is the frame's own opacity without animation.
//   - A frame's own opacity is, in order of strength: its inline `style="opacity:..."`; the rule with the
//     highest specificity, the latest on a tie; its `opacity="..."` attribute; else 1.
//   - "Visible" is an opacity above 0. The loop is as long as the longest animation duration.
//   - For test 4: the font size is the first `font-size: Npx` (or the `Npx` of a `font:` shorthand) in the
//     style sheet, or a `font-size="N"` attribute; the cell width is the first `<rect>` with a plain number
//     `width`, which is the ground and so COLS cells wide, divided by COLS (from hooks/blackhole/field).
//     The characters of a run are the text of its `<text>` with the tags (for example `<tspan>`) removed.
//     Runs of one character carry no textLength and are not checked; every longer run must have one.
import { expect, test } from 'claude-code/testing'

import { blackhole } from '../hooks/wallpapers/blackhole/svg'
import { COLS, FRAMES } from '../hooks/wallpapers/blackhole/field'

const MOTIONS = ['smooth', 'light'] as const

// ---------------------------------------------------------------- reading the SVG

type Decls = Record<string, string>
type Rule = { selector: string; classes: string[]; tag: string; spec: number; order: number; decls: Decls }
type Stop = { at: number; opacity: number | undefined }
type Anim = { name: string; duration: number; delay: number; timing: string }
type Frame = { classes: string[]; inline: string; attr: string }

const sheetOf = (s: string): string =>
  [...s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1] ?? '').join('\n').replace(/\/\*[\s\S]*?\*\//g, '')

/** The text from `open` (just past a `{`) to its matching `}`; the index after it. */
const block = (css: string, open: number): { body: string; next: number } => {
  let depth = 1
  let i = open
  for (; i < css.length && depth > 0; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') depth -= 1
  }
  return { body: css.slice(open, i - 1), next: i }
}

const declsOf = (body: string): Decls => {
  const out: Decls = {}
  for (const part of body.split(';')) {
    const at = part.indexOf(':')
    if (at < 0) continue
    out[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim()
  }
  return out
}

/** The CSS outside every @media: its rules in order, and its @keyframes by name. */
function readCss(css: string): { rules: Rule[]; keyframes: Map<string, Stop[]> } {
  const rules: Rule[] = []
  const keyframes = new Map<string, Stop[]>()
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open < 0) break
    const head = css.slice(i, open).trim()
    const { body, next } = block(css, open + 1)
    i = next
    if (head.startsWith('@keyframes') || head.startsWith('@-webkit-keyframes')) {
      const name = head.replace(/^@\S+\s+/, '').trim()
      const stops: Stop[] = []
      let j = 0
      while (j < body.length) {
        const o = body.indexOf('{', j)
        if (o < 0) break
        const sel = body.slice(j, o)
        const inner = block(body, o + 1)
        j = inner.next
        const opacity = declsOf(inner.body).opacity
        for (const part of sel.split(',')) {
          const t = part.trim().toLowerCase()
          const at = t === 'from' ? 0 : t === 'to' ? 100 : Number.parseFloat(t)
          if (Number.isFinite(at)) stops.push({ at, opacity: opacity === undefined ? undefined : Number(opacity) })
        }
      }
      keyframes.set(name, stops.sort((a, b) => a.at - b.at))
    } else if (!head.startsWith('@')) {
      const decls = declsOf(body)
      head.split(',').forEach(sel => {
        const s = sel.trim()
        if (s === '' || /[\s>+~[:]/.test(s)) return
        const tag = /^[A-Za-z][\w-]*/.exec(s)?.[0] ?? ''
        const classes = [...s.matchAll(/\.([\w-]+)/g)].map(m => m[1] ?? '')
        rules.push({ selector: s, classes, tag, spec: classes.length * 10 + (tag === '' ? 0 : 1), order: rules.length, decls })
      })
    }
  }
  return { rules, keyframes }
}

/** The top-level `<g>` elements that hold text, in order: the frames. */
function framesOf(svg: string): Frame[] {
  const body = svg.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '').replace(/<defs>[\s\S]*?<\/defs>/g, '')
  const out: Frame[] = []
  let depth = 0
  let start = -1
  let tag = ''
  for (const m of body.matchAll(/<(\/?)g\b([^>]*?)(\/?)>/g)) {
    if (m[3] === '/') continue
    if (m[1] === '') {
      if (depth === 0) { start = (m.index ?? 0) + m[0].length; tag = m[2] ?? '' }
      depth += 1
    } else {
      depth -= 1
      if (depth === 0 && body.slice(start, m.index ?? 0).includes('<text')) {
        const get = (name: string): string => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag)?.slice(1).find(v => v !== undefined) ?? ''
        out.push({ classes: get('class').split(/\s+/).filter(c => c !== ''), inline: get('style'), attr: get('opacity') })
      }
    }
  }
  return out
}

const timeOf = (t: string): number | undefined => {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(ms|s)$/.exec(t)
  return m ? Number(m[1]) / (m[2] === 'ms' ? 1000 : 1) : undefined
}
const KEYWORDS = new Set(['infinite', 'normal', 'reverse', 'alternate', 'alternate-reverse', 'forwards', 'backwards', 'both', 'running', 'paused', 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end'])
/** Tokens split on spaces outside parentheses. */
const tokens = (v: string): string[] => v.replace(/\s*,\s*/g, ',').match(/(?:[^\s(]|\([^)]*\))+/g) ?? []

/** The animation a frame ends up with by the cascade, or undefined when it has none. */
function animOf(frame: Frame, rules: Rule[]): Anim | undefined {
  const hits = rules
    .filter(r => (r.tag === '' || r.tag === 'g') && r.classes.every(c => frame.classes.includes(c)))
    .sort((a, b) => a.spec - b.spec || a.order - b.order)
  let a: Anim | undefined
  for (const { decls } of hits) {
    for (const [prop, value] of Object.entries(decls)) {
      if (prop === 'animation') {
        const toks = tokens(value)
        let name = ''
        const times: number[] = []
        let timing = 'ease'
        for (const t of toks) {
          const time = timeOf(t)
          if (time !== undefined) times.push(time)
          else if (/^(steps|cubic-bezier)\(/.test(t) || ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end'].includes(t)) timing = t
          else if (!KEYWORDS.has(t) && !/^\d+$/.test(t) && name === '') name = t
        }
        a = name === '' || name === 'none' ? undefined : { name, duration: times[0] ?? 0, delay: times[1] ?? 0, timing }
      } else if (a && prop === 'animation-name') a = { ...a, name: value }
      else if (a && prop === 'animation-duration') a = { ...a, duration: timeOf(value) ?? a.duration }
      else if (a && prop === 'animation-delay') a = { ...a, delay: timeOf(value) ?? a.delay }
      else if (a && prop === 'animation-timing-function') a = { ...a, timing: value.replace(/\s+/g, '') }
    }
  }
  return a
}

/** A frame's own opacity, animation aside: inline style, then the cascade, then the attribute, else 1. */
function restOf(frame: Frame, rules: Rule[]): number {
  const inline = declsOf(frame.inline).opacity
  if (inline !== undefined) return Number(inline)
  const hits = rules
    .filter(r => (r.tag === '' || r.tag === 'g') && r.classes.every(c => frame.classes.includes(c)) && r.decls.opacity !== undefined)
    .sort((a, b) => a.spec - b.spec || a.order - b.order)
  const last = hits.at(-1)
  if (last) return Number(last.decls.opacity)
  return frame.attr !== '' ? Number(frame.attr) : 1
}

/** The opacity a frame shows at time t seconds, the animation running from 0. */
function opacityAt(t: number, rest: number, anim: Anim | undefined, keyframes: Map<string, Stop[]>): number {
  if (!anim || !(anim.duration > 0)) return rest
  const raw = keyframes.get(anim.name)
  if (!raw || raw.length === 0) return rest
  if (t < anim.delay) return rest
  const local = (((t - anim.delay) % anim.duration) + anim.duration) % anim.duration
  // Progress in percent, rounded so a boundary reached by arithmetic is a boundary.
  const p = Math.round((local / anim.duration) * 100 * 1e9) / 1e9
  const stops: { at: number; v: number }[] = raw.map(s => ({ at: s.at, v: s.opacity ?? rest }))
  if (stops[0] && stops[0].at > 0) stops.unshift({ at: 0, v: rest })
  if (stops[stops.length - 1] && (stops[stops.length - 1]?.at ?? 0) < 100) stops.push({ at: 100, v: rest })
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i]
    const b = stops[i + 1]
    if (!a || !b || p < a.at || p >= b.at) continue
    const u = (p - a.at) / (b.at - a.at)
    const timing = anim.timing
    let f = u
    if (timing === 'step-end') f = 0
    else if (timing === 'step-start') f = 1
    else if (timing.startsWith('steps(')) {
      const parts = timing.slice(6, -1).split(',')
      const n = Math.max(1, Number.parseInt(parts[0] ?? '1', 10))
      f = /start|jump-start|jump-both/.test(parts[1] ?? '') ? Math.min(1, Math.ceil(u * n) / n) : Math.floor(u * n) / n
    }
    return a.v + (b.v - a.v) * f
  }
  return stops[stops.length - 1]?.v ?? rest
}

/** Everything the sampling needs about one picture. */
function playOf(svg: string): { frames: Frame[]; rules: Rule[]; keyframes: Map<string, Stop[]>; anims: (Anim | undefined)[]; rests: number[]; loop: number } {
  const { rules, keyframes } = readCss(sheetOf(svg))
  const frames = framesOf(svg)
  const anims = frames.map(f => animOf(f, rules))
  const rests = frames.map(f => restOf(f, rules))
  const loop = Math.max(0, ...anims.map(a => a?.duration ?? 0))
  return { frames, rules, keyframes, anims, rests, loop }
}

const visibleAt = (play: ReturnType<typeof playOf>, t: number): number[] =>
  play.frames.flatMap((_, k) => (opacityAt(t, play.rests[k] ?? 1, play.anims[k], play.keyframes) > 0 ? [k] : []))

// ---------------------------------------------------------------- the tests

test('no gap: at every instant of the loop one frame is showing, never more than two, two for under 1 ms at a boundary', () => {
  for (const motion of MOTIONS) {
    const play = playOf(blackhole({ motion }))
    expect([motion, play.frames.length]).toEqual([motion, FRAMES])
    expect([motion, play.loop > 0]).toEqual([motion, true])
    const L = play.loop
    // Every 0.1 ms across the loop, and exactly at, and a hair either side of, every frame's stops.
    const times: number[] = []
    const step = 1e-4
    const n = Math.round(L / step)
    for (let i = 0; i < n; i += 1) times.push(i * step)
    play.frames.forEach((_, k) => {
      const a = play.anims[k]
      for (const s of play.keyframes.get(a?.name ?? '') ?? []) {
        const at = (((((a?.delay ?? 0) + (s.at / 100) * (a?.duration ?? 0)) % L) + L) % L)
        for (const d of [-1e-7, 0, 1e-7]) times.push((((at + d) % L) + L) % L)
      }
    })
    const gaps: string[] = []
    let most = 0
    for (const t of times) {
      const seen = visibleAt(play, t).length
      most = Math.max(most, seen)
      if (seen === 0 && gaps.length < 5) gaps.push(`${t.toFixed(4)}s`)
    }
    expect([motion, 'nothing visible at', gaps]).toEqual([motion, 'nothing visible at', []])
    expect([motion, 'most at once', most <= 2]).toEqual([motion, 'most at once', true])
    // Two at once: each stretch of the 0.1 ms grid with two showing is under 1 ms.
    let run = 0
    let longest = 0
    for (let i = 0; i < n; i += 1) {
      if (visibleAt(play, i * step).length >= 2) { run += 1; longest = Math.max(longest, run) } else run = 0
    }
    expect([motion, 'longest overlap in ms', longest * step * 1000 < 1]).toEqual([motion, 'longest overlap in ms', true])
  }
})

test('at time 0 exactly one frame is visible, and it is frame 0', () => {
  for (const motion of MOTIONS) {
    const play = playOf(blackhole({ motion }))
    expect([motion, visibleAt(play, 0)]).toEqual([motion, [0]])
  }
})

test('with the animation taken away, frame 0 is visible and every other frame is hidden', () => {
  for (const motion of MOTIONS) {
    // Delete every animation declaration and every @keyframes block; what is left is the still picture.
    const svg = blackhole({ motion })
      .replace(/<style([^>]*)>([\s\S]*?)<\/style>/g, (_, attrs: string, css: string) => {
        let out = ''
        let i = 0
        const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
        while (i < text.length) {
          const at = text.indexOf('@keyframes', i)
          if (at < 0) { out += text.slice(i); break }
          out += text.slice(i, at)
          const open = text.indexOf('{', at)
          i = open < 0 ? text.length : block(text, open + 1).next
        }
        return `<style${attrs}>${out.replace(/animation[\w-]*\s*:[^;}]*;?/g, '')}</style>`
      })
    expect([motion, svg.includes('animation'), svg.includes('@keyframes')]).toEqual([motion, false, false])
    const { rules } = readCss(sheetOf(svg))
    const frames = framesOf(svg)
    expect([motion, frames.length]).toEqual([motion, FRAMES])
    const shown = frames.flatMap((f, k) => (restOf(f, rules) > 0 ? [k] : []))
    expect([motion, shown]).toEqual([motion, [0]])
  }
})

test('the grid: each run\'s textLength puts its last character on its own cell, within one character\'s advance of (n - 1) cells', () => {
  for (const motion of MOTIONS) {
    const svg = blackhole({ motion })
    const css = sheetOf(svg)
    const size =
      Number.parseFloat(/font-size\s*:\s*([\d.]+)px/.exec(css)?.[1] ?? '') ||
      Number.parseFloat(/font\s*:[^;}]*?\b([\d.]+)px/.exec(css)?.[1] ?? '') ||
      Number.parseFloat(/font-size\s*=\s*"([\d.]+)/.exec(svg)?.[1] ?? '')
    const ground = Number.parseFloat(/<rect\b[^>]*\bwidth="([\d.]+)"/.exec(svg)?.[1] ?? '')
    expect([motion, 'font size read', size > 0]).toEqual([motion, 'font size read', true])
    expect([motion, 'ground width read', ground > 0]).toEqual([motion, 'ground width read', true])
    const cell = ground / COLS
    const eps = 1e-6
    const bad: string[] = []
    let checked = 0
    for (const m of svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
      const n = (m[2] ?? '').replace(/<[^>]*>/g, '').length
      if (n < 2) continue
      checked += 1
      const length = Number.parseFloat(/\btextLength\s*=\s*"([\d.]+)"/.exec(m[1] ?? '')?.[1] ?? '')
      const low = (n - 1) * cell + 0.5 * size
      const high = (n - 1) * cell + 0.65 * size
      if (!(length >= low - eps && length <= high + eps) && bad.length < 5) bad.push(`n=${n} textLength=${length} not in ${low}..${high}`)
    }
    expect([motion, 'runs checked', checked > 100]).toEqual([motion, 'runs checked', true])
    expect([motion, bad]).toEqual([motion, []])
  }
})
