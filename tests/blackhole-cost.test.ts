// Tests for what the black hole's motion COSTS: hooks/wallpapers/blackhole/svg.ts (`blackhole(opts)`; it was
// hooks/blackhole.ts before the rebuild, and the contents of this file are as they were).
//
// The fault: a frame that is not showing is hidden by `opacity:0` alone. When the app draws the SVG as an
// image, an element at opacity 0 whose opacity is animated is still painted, so each step paints all of
// the frames' text. Hidden by `visibility:hidden` as well (written together with opacity 0, in the base
// rules and in every keyframe stop), only the frame that shows is painted, and the look is the same.
//
// Pinned, for `smooth` and for `light`:
//   1. Outside any @media, every frame but frame 0 is `visibility:hidden` in its base style; frame 0 is
//      `visible` or sets no visibility.
//   2. In the keyframes the frames use, every stop that sets `opacity:0` also sets `visibility:hidden`,
//      every stop that sets `opacity:1` also sets `visibility:visible`, and no stop sets one without the
//      other (and no opacity but 0 or 1).
//   3. Worked out from `visibility` alone, with the no-gap test's sampling (every 0.1 ms across the loop
//      and at every stop of every frame), at every instant exactly the frames that opacity shows are the
//      frames visibility shows, so at least one frame is painted and at most two.
//   4. With every `animation*` declaration and every @keyframes block deleted, frame 0 is the only frame
//      not `visibility:hidden`.
//   5. The reduced-motion rule leaves no animation running, frame 0 visible and the others hidden by
//      `visibility`.
//
// THE FORM RELIED ON (as blackhole-play.test.ts, which this file copies its reading of the SVG from):
//   - Frames are the top-level `<g class="...">` elements holding `<text`, in order; the first is frame 0;
//     there are FRAMES of them (hooks/blackhole/field).
//   - All `<style>` content is CSS: `selector{declarations}` with simple selectors (a tag and/or classes,
//     a comma list; a rule with a combinator is ignored), specificity = number of classes then source
//     order. `@media` blocks are left out, except that the one whose condition is `prefers-reduced-motion:
//     reduce` is read for test 5, its rules coming after the others.
//   - Animation: `animation` (shorthand: name, duration, delay, timing function, `infinite`) and its
//     longhands, by the cascade; every frame's runs forever from time 0, with a delay (a negative one
//     starts it part-way in). `!important` is ignored.
//   - A named `@keyframes` holds stops (`0%`, `12.5%`, `from`, `to`, comma lists) with `opacity` and/or
//     `visibility`. Between stops `step-end`/`steps(1)` holds the earlier value, `step-start` takes the
//     later one at once, `steps(n[, start|end])` in n steps, anything else linearly (visibility then is
//     `visible` between two stops if either is). A property a stop leaves out is skipped; a missing 0% or
//     100% is the frame's own value without animation.
//   - A frame's own value is, strongest first: inline `style`, the rule of highest specificity (latest on a
//     tie), the presentation attribute, else the default (opacity 1, visibility visible).
//   - "Shown by opacity" is opacity above 0; "painted" is visibility other than `hidden`.
import { expect, test } from 'claude-code/testing'

import { blackhole } from '../hooks/wallpapers/blackhole/svg'
import { FRAMES } from '../hooks/wallpapers/blackhole/field'

const MOTIONS = ['smooth', 'light'] as const

// ---------------------------------------------------------------- reading the SVG

type Decls = Record<string, string>
type Rule = { classes: string[]; tag: string; spec: number; order: number; decls: Decls }
type Stop = { at: number; decls: Decls }
type Anim = { name: string; duration: number; delay: number; timing: string }
type Frame = { classes: string[]; inline: Decls; attrs: Decls }

const sheetOf = (s: string): string =>
  [...s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1] ?? '').join('\n').replace(/\/\*[\s\S]*?\*\//g, '')

/** The text from `open` (just past a `{`) to its matching `}`, and the index after it. */
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
    out[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).replace(/!important/g, '').trim()
  }
  return out
}

/** The rules and @keyframes outside every @media; `media` gets the bodies of the @media blocks, by condition. */
function readCss(css: string, media?: { condition: string; body: string }[]): { rules: Rule[]; keyframes: Map<string, Stop[]> } {
  const rules: Rule[] = []
  const keyframes = new Map<string, Stop[]>()
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open < 0) break
    const head = css.slice(i, open).trim()
    const { body, next } = block(css, open + 1)
    i = next
    if (/^@(-webkit-)?keyframes/.test(head)) {
      const name = head.replace(/^@\S+\s+/, '').trim()
      const stops: Stop[] = []
      let j = 0
      while (j < body.length) {
        const o = body.indexOf('{', j)
        if (o < 0) break
        const sel = body.slice(j, o)
        const inner = block(body, o + 1)
        j = inner.next
        for (const part of sel.split(',')) {
          const t = part.trim().toLowerCase()
          const at = t === 'from' ? 0 : t === 'to' ? 100 : Number.parseFloat(t)
          if (Number.isFinite(at)) stops.push({ at, decls: declsOf(inner.body) })
        }
      }
      keyframes.set(name, stops.sort((a, b) => a.at - b.at))
    } else if (head.startsWith('@media')) {
      media?.push({ condition: head.replace(/\s+/g, '').toLowerCase(), body })
    } else if (!head.startsWith('@')) {
      const decls = declsOf(body)
      for (const sel of head.split(',')) {
        const s = sel.trim()
        if (s === '' || /[\s>+~[:]/.test(s)) continue
        const tag = /^[A-Za-z][\w-]*/.exec(s)?.[0] ?? ''
        const classes = [...s.matchAll(/\.([\w-]+)/g)].map(m => m[1] ?? '')
        rules.push({ classes, tag, spec: classes.length * 10 + (tag === '' ? 0 : 1), order: rules.length, decls })
      }
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
        out.push({
          classes: get('class').split(/\s+/).filter(c => c !== ''),
          inline: declsOf(get('style')),
          attrs: { opacity: get('opacity'), visibility: get('visibility') },
        })
      }
    }
  }
  return out
}

const timeOf = (t: string): number | undefined => {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(ms|s)$/.exec(t)
  return m ? Number(m[1]) / (m[2] === 'ms' ? 1000 : 1) : undefined
}
const TIMING = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end']
const KEYWORDS = new Set([...TIMING, 'infinite', 'normal', 'reverse', 'alternate', 'alternate-reverse', 'forwards', 'backwards', 'both', 'running', 'paused'])
const tokens = (v: string): string[] => v.replace(/\s*,\s*/g, ',').match(/(?:[^\s(]|\([^)]*\))+/g) ?? []

const matching = (frame: Frame, rules: Rule[]): Rule[] =>
  rules
    .filter(r => (r.tag === '' || r.tag === 'g') && r.classes.every(c => frame.classes.includes(c)))
    .sort((a, b) => a.spec - b.spec || a.order - b.order)

/** The animation a frame ends up with by the cascade, or undefined when it has none. */
function animOf(frame: Frame, rules: Rule[]): Anim | undefined {
  let a: Anim | undefined
  for (const { decls } of matching(frame, rules)) {
    for (const [prop, value] of Object.entries(decls)) {
      if (prop === 'animation') {
        let name = ''
        const times: number[] = []
        let timing = 'ease'
        for (const t of tokens(value)) {
          const time = timeOf(t)
          if (time !== undefined) times.push(time)
          else if (/^(steps|cubic-bezier)\(/.test(t) || TIMING.includes(t)) timing = t
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

const DEFAULT: Record<string, string> = { opacity: '1', visibility: 'visible' }
/** A frame's own value of a property, animation aside. */
function restOf(frame: Frame, rules: Rule[], prop: 'opacity' | 'visibility'): string {
  const inline = frame.inline[prop]
  if (inline !== undefined) return inline
  const last = matching(frame, rules).filter(r => r.decls[prop] !== undefined).at(-1)
  if (last) return last.decls[prop] ?? DEFAULT[prop] ?? ''
  return frame.attrs[prop] !== '' && frame.attrs[prop] !== undefined ? (frame.attrs[prop] ?? '') : (DEFAULT[prop] ?? '')
}

/** The value of a property a frame shows at time t seconds, the animation running from 0. */
function valueAt(t: number, rest: string, anim: Anim | undefined, keyframes: Map<string, Stop[]>, prop: 'opacity' | 'visibility'): string {
  if (!anim || !(anim.duration > 0) || t < anim.delay) return rest
  const own = (keyframes.get(anim.name) ?? []).filter(s => s.decls[prop] !== undefined)
  if (own.length === 0) return rest
  const local = (((t - anim.delay) % anim.duration) + anim.duration) % anim.duration
  const p = Math.round((local / anim.duration) * 100 * 1e9) / 1e9
  const stops = own.map(s => ({ at: s.at, v: s.decls[prop] ?? rest }))
  if (stops[0] && stops[0].at > 0) stops.unshift({ at: 0, v: rest })
  if ((stops[stops.length - 1]?.at ?? 0) < 100) stops.push({ at: 100, v: rest })
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
    if (prop === 'opacity') return String(Number(a.v) + (Number(b.v) - Number(a.v)) * f)
    // visibility: discrete; between two stops on a smooth curve it is visible if either end is.
    if (timing === 'step-end' || timing === 'step-start' || timing.startsWith('steps(')) return f < 0.5 ? a.v : b.v
    return a.v === 'visible' || b.v === 'visible' ? 'visible' : a.v
  }
  return stops[stops.length - 1]?.v ?? rest
}

type Play = {
  frames: Frame[]
  rules: Rule[]
  keyframes: Map<string, Stop[]>
  anims: (Anim | undefined)[]
  restOpacity: string[]
  restVisibility: string[]
  loop: number
  reduced: Rule[]
}

function playOf(svg: string): Play {
  const media: { condition: string; body: string }[] = []
  const { rules, keyframes } = readCss(sheetOf(svg), media)
  const frames = framesOf(svg)
  // The rules of the reduced-motion block, as they come after the others.
  const reduced: Rule[] = []
  for (const m of media) {
    if (!/prefers-reduced-motion:reduce/.test(m.condition)) continue
    for (const r of readCss(m.body).rules) reduced.push({ ...r, order: rules.length + reduced.length })
  }
  const anims = frames.map(f => animOf(f, rules))
  return {
    frames,
    rules,
    keyframes,
    anims,
    restOpacity: frames.map(f => restOf(f, rules, 'opacity')),
    restVisibility: frames.map(f => restOf(f, rules, 'visibility')),
    loop: Math.max(0, ...anims.map(a => a?.duration ?? 0)),
    reduced,
  }
}

const shown = (play: Play, t: number): number[] =>
  play.frames.flatMap((_, k) => (Number(valueAt(t, play.restOpacity[k] ?? '1', play.anims[k], play.keyframes, 'opacity')) > 0 ? [k] : []))
const painted = (play: Play, t: number): number[] =>
  play.frames.flatMap((_, k) => (valueAt(t, play.restVisibility[k] ?? 'visible', play.anims[k], play.keyframes, 'visibility') !== 'hidden' ? [k] : []))

// ---------------------------------------------------------------- the tests

test('outside any @media, every frame but frame 0 is visibility:hidden in its base style, and frame 0 is visible', () => {
  for (const motion of MOTIONS) {
    const play = playOf(blackhole({ motion }))
    expect([motion, play.frames.length]).toEqual([motion, FRAMES])
    expect([motion, play.restVisibility.map((v, k) => (k === 0 ? v !== 'hidden' : v === 'hidden'))]).toEqual([motion, play.frames.map(() => true)])
  }
})

test('in the keyframes the frames use, opacity 0 comes with visibility hidden, opacity 1 with visible, never one alone', () => {
  for (const motion of MOTIONS) {
    const play = playOf(blackhole({ motion }))
    const names = new Set(play.anims.flatMap(a => (a ? [a.name] : [])))
    expect([motion, names.size > 0]).toEqual([motion, true])
    const bad: string[] = []
    for (const name of names) {
      const stops = play.keyframes.get(name) ?? []
      if (stops.length === 0) bad.push(`${name}: no stops`)
      for (const s of stops) {
        const o = s.decls.opacity
        const v = s.decls.visibility
        const at = `${name} ${s.at}%`
        if ((o === undefined) !== (v === undefined)) bad.push(`${at}: sets only one of opacity and visibility`)
        else if (o === '0' && v !== 'hidden') bad.push(`${at}: opacity 0 without visibility hidden`)
        else if (o === '1' && v !== 'visible') bad.push(`${at}: opacity 1 without visibility visible`)
        else if (o !== undefined && o !== '0' && o !== '1') bad.push(`${at}: opacity ${o}`)
      }
    }
    expect([motion, bad]).toEqual([motion, []])
  }
})

test('worked out from visibility alone, at every instant the frames painted are the frames opacity shows: one or two', () => {
  for (const motion of MOTIONS) {
    const play = playOf(blackhole({ motion }))
    const L = play.loop
    expect([motion, L > 0]).toEqual([motion, true])
    // Every 0.1 ms across the loop, and at, and a hair either side of, every stop of every frame.
    const times: number[] = []
    const step = 1e-4
    const n = Math.round(L / step)
    for (let i = 0; i < n; i += 1) times.push(i * step)
    play.frames.forEach((_, k) => {
      const a = play.anims[k]
      for (const s of play.keyframes.get(a?.name ?? '') ?? []) {
        const at = ((((a?.delay ?? 0) + (s.at / 100) * (a?.duration ?? 0)) % L) + L) % L
        for (const d of [-1e-7, 0, 1e-7]) times.push((((at + d) % L) + L) % L)
      }
    })
    const disagree: string[] = []
    const counts: string[] = []
    for (const t of times) {
      const p = painted(play, t)
      if (p.join() !== shown(play, t).join() && disagree.length < 5) disagree.push(`${t.toFixed(4)}s: painted [${p}] opacity shows [${shown(play, t)}]`)
      if ((p.length < 1 || p.length > 2) && counts.length < 5) counts.push(`${t.toFixed(4)}s: ${p.length} painted`)
    }
    expect([motion, 'visibility and opacity disagree at', disagree]).toEqual([motion, 'visibility and opacity disagree at', []])
    expect([motion, 'painted count wrong at', counts]).toEqual([motion, 'painted count wrong at', []])
  }
})

test('with the animation taken away, frame 0 is the only frame not visibility:hidden', () => {
  for (const motion of MOTIONS) {
    // Delete every animation declaration and every @keyframes block.
    const svg = blackhole({ motion }).replace(/<style([^>]*)>([\s\S]*?)<\/style>/g, (_, attrs: string, css: string) => {
      const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
      let out = ''
      let i = 0
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
    const notHidden = frames.flatMap((f, k) => (restOf(f, rules, 'visibility') !== 'hidden' ? [k] : []))
    expect([motion, notHidden]).toEqual([motion, [0]])
  }
})

test('the reduced-motion rule leaves no animation, frame 0 visible and the others hidden by visibility', () => {
  for (const motion of MOTIONS) {
    const play = playOf(blackhole({ motion }))
    expect([motion, 'a reduced-motion rule exists', play.reduced.length > 0]).toEqual([motion, 'a reduced-motion rule exists', true])
    const all = [...play.rules, ...play.reduced]
    // No frame still animates under it, whatever the base rules said.
    expect([motion, play.frames.map(f => animOf(f, all) === undefined)]).toEqual([motion, play.frames.map(() => true)])
    const visibility = play.frames.map(f => restOf(f, all, 'visibility'))
    expect([motion, visibility.map((v, k) => (k === 0 ? v !== 'hidden' : v === 'hidden'))]).toEqual([motion, play.frames.map(() => true)])
  }
})
