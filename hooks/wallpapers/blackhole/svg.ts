// The black hole: ASCII art drawn by code (./field), a dark centre in
// a thin bright ring, its glowing disc bent over and under it, and everything
// round it drawn in. This file puts the field's frames in one SVG picture and
// plays them in a loop. Pure: options in, a picture out. No `$`, no JSX, no
// DOM, no Node APIs, so a preview script can import it too.
//
// Each row of a frame is one `<text>` (or a few, where a long gap splits it),
// placed at its first cell and given the run's length, so the characters sit on
// the grid whatever the font's own width is. The colour is not written per
// character: every row is filled with a radial gradient centred on the hole,
// pale gold at the ring, orange in the body and deep red at the edges, and the
// front band with a gradient of its own, hottest just left of the ring. A few
// characters a frame take a stray colour, as a real screen of ASCII art has.
// The frames take turns by opacity, in steps, never a fade.
import { COLS, FRAMES, GEOMETRY, ROWS, frame } from './field.ts'

export type BlackholeMotion = 'smooth' | 'light' | 'off'
export type BlackholeOptions = { motion: BlackholeMotion; dim?: number }

/** What the picture shows, for those who cannot see it. */
export const BLACKHOLE_ALT =
  'ASCII art of a black hole: a dark centre in a thin gold ring, its orange disc bent over and under it, with characters streaming in.'

/** A number written short: at most two decimals. */
const num = (v: number): string => String(Math.round(v * 100) / 100)

// One cell, in the picture's units: a width of 10, and a height of the field's aspect.
const CW = 10
const CH = CW * GEOMETRY.aspect
const W = COLS * CW
const H = ROWS * CH
// Frames a second, as played.
const FPS: Record<Exclude<BlackholeMotion, 'off'>, number> = { smooth: 10, light: 6 }
// A gap of this many spaces or more starts a new run.
const SPLIT = 40
const GROUND = '#060409'

// The hole's centre, in the picture's units.
const HX = (GEOMETRY.cx + 0.5) * CW
const HY = (GEOMETRY.cy + 0.5) * CH
const R = GEOMETRY.ring * CW
// What the window shows: a 16:9 view centred on the hole, the disc about half
// its width. Any other shape is cut to fit (slice), and the disc keeps clear of
// the cut from a square window to an ultra-wide one.
const VIEW_W = 1240
const VIEW_H = 700
const VIEW = `${num(HX - VIEW_W / 2)} ${num(HY - VIEW_H / 2)} ${VIEW_W} ${VIEW_H}`

// The disc and the stream: by distance from the centre, with the focus a little
// to the left so the near-left side runs hotter.
const HEAT = [
  [0, '#ffb347'],
  [0.8, '#ffd27a'],
  [0.93, '#ffeab0'],
  [1, '#fff3c4'],
  [1.06, '#ffe2a0'],
  [1.1, '#ffb44c'],
  [1.25, '#ff8c32'],
  [1.45, '#ec6426'],
  [1.65, '#d4441f'],
  [1.95, '#ac2c1c'],
  [2.4, '#7e1d14'],
  [3.4, '#561510'],
] as const
const HEAT_R = 3.4 * R
// The band, left to right, by its distance from the centre in ring radii.
const BAND = [
  [-2.55, '#a8341a'],
  [-2, '#e8661e'],
  [-1.45, '#ffc04e'],
  [-1.08, '#fff0b8'],
  [-0.6, '#ffc865'],
  [0, '#f59a35'],
  [0.85, '#ffc060'],
  [1.05, '#ffe7a6'],
  [1.4, '#f08a2a'],
  [2.1, '#a8361a'],
] as const

const DEFS =
  `<defs><radialGradient id="heat" gradientUnits="userSpaceOnUse" cx="${num(HX)}" cy="${num(HY)}" r="${num(HEAT_R)}" fx="${num(HX - 0.1 * R)}" fy="${num(HY)}">` +
  HEAT.map(([at, c]) => `<stop offset="${num(at / 3.4)}" stop-color="${c}"/>`).join('') +
  `</radialGradient><linearGradient id="band" gradientUnits="userSpaceOnUse" x1="${num(HX - 2.55 * R)}" y1="0" x2="${num(HX + 2.1 * R)}" y2="0">` +
  BAND.map(([at, c]) => `<stop offset="${num((at + 2.55) / 4.65)}" stop-color="${c}"/>`).join('') +
  '</linearGradient></defs>'

// The stray colours a few characters take, and how often.
const STRAYS = ['#4fb3a9', '#8e6bd8', '#6cbf52', '#5b8fe0'] as const
const STRAY_CSS = STRAYS.map((c, i) => `.s${i}{fill:${c}}`).join('')

const FONT_SIZE = CW * 1.4
// One character's own advance in the monospace stack: about 0.55 of the font size (Consolas, Cascadia Mono).
const ADVANCE = FONT_SIZE * 0.55
const FONT = `text{font:bold ${num(FONT_SIZE)}px Consolas,'Cascadia Mono','Courier New',monospace;white-space:pre}g{fill:url(#heat)}.b{fill:url(#band)}`

/** A steady pseudo-random number in [0, 1) from whole numbers. */
function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 2654435761) ^ Math.imul(b | 0, 1597334677) ^ Math.imul(c | 0, 3812015801)
  h = Math.imul(h ^ (h >>> 15), 2246822519)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

/** One row's characters as runs: where each starts and what it holds. */
function runs(row: string): { at: number; text: string }[] {
  const out: { at: number; text: string }[] = []
  let x = 0
  while (x < row.length) {
    if (row[x] === ' ') { x += 1; continue }
    let end = x
    let gap = 0
    let y = x + 1
    for (; y < row.length; y += 1) {
      if (row[y] === ' ') {
        gap += 1
        if (gap >= SPLIT) break
      } else {
        gap = 0
        end = y
      }
    }
    out.push({ at: x, text: row.slice(x, end + 1) })
    x = end + 1
  }
  return out
}

/** A run's characters, with any stray ones wrapped in their colour. */
function inked(text: string, x0: number, y: number, k: number): string {
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? ' '
    const pick = ch === ' ' ? 1 : hash(x0 + i, y, k)
    out += pick < 0.004 ? `<tspan class="s${Math.floor(pick * 1000) % STRAYS.length}">${ch}</tspan>` : ch
  }
  return out
}

/** Frame k as text rows, in a group of the given class. */
function group(k: number, cls: string): string {
  const rows = frame(k)
  let body = ''
  rows.forEach((row, y) => {
    const isBand = y >= GEOMETRY.band.from && y <= GEOMETRY.band.to
    for (const run of runs(row)) {
      const len = run.text.length
      // The browser spreads the extra room between the characters, none after the
      // last: (n - 1) cells and one character's own advance put each on its column.
      const fit = len > 1 ? ` textLength="${num((len - 1) * CW + ADVANCE)}"` : ''
      body += `<text${isBand ? ' class="b"' : ''} x="${run.at * CW}" y="${Math.round(y * CH + CH * 0.8)}"${fit}>${inked(run.text, run.at, y, k)}</text>`
    }
  })
  return `<g class="${cls}">${body}</g>`
}

// How early each frame comes in before the one it follows leaves, in seconds:
// a hair of overlap, so no instant of the loop is left with no frame shown.
const OVERLAP = 0.0004

/** A time or a share written exactly enough that the frames' turns meet: six decimals. */
const fine = (v: number): string => String(Math.round(v * 1e6) / 1e6)

/**
 * The loop's style. Frame k shows from k turns less OVERLAP to k + 1 turns, so
 * each turn starts a hair before the last one ends and at time 0 frame 0 shows
 * alone. Frame 0 is visible by default and every other frame hidden, so with
 * the animation gone by any means the picture is frame 0; its own animation
 * hides it outside its turn. Reduced motion stops them all on frame 0.
 *
 * A frame out of its turn is hidden by visibility as well as opacity, in the
 * base rules and in every keyframe stop: drawn as an image, a frame at opacity
 * 0 whose opacity is animated is still painted, so every step would paint all
 * thirty frames' text; hidden by visibility, only the frame showing is painted.
 */
function playing(seconds: number): string {
  const turn = seconds / FRAMES
  // Rounded down, so a frame's turn ends at or a hair before the next turn's
  // start, never after it: at time 0 the last frame has already gone.
  const share = Math.floor(((turn + OVERLAP) / seconds) * 1e8) / 1e6
  const shown = 'opacity:1;visibility:visible'
  const hidden = 'opacity:0;visibility:hidden'
  let css = `.f{${hidden};animation:p ${fine(seconds)}s step-end infinite}@keyframes p{0%{${shown}}${fine(share)}%{${hidden}}100%{${hidden}}}`
  css += `.f0{${shown};animation-delay:-${fine(OVERLAP)}s}`
  for (let k = 1; k < FRAMES; k += 1) css += `.f${k}{animation-delay:-${fine(seconds - k * turn + OVERLAP)}s}`
  return `${css}@media (prefers-reduced-motion: reduce){.f{animation:none}}`
}

const made = new Map<string, string>()

/**
 * The whole wallpaper as one SVG: `smooth` plays the loop, `light` plays it
 * more slowly, `off` is frame 0 alone and still. `dim` darkens it, 0 to 100.
 * Never throws: anything unknown is read as the nearest sensible thing.
 */
export function blackhole(opts: BlackholeOptions): string {
  const motion: BlackholeMotion = opts?.motion === 'light' || opts?.motion === 'off' ? opts.motion : 'smooth'
  const raw = Number(opts?.dim ?? 0)
  const dim = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0
  const key = `${motion}|${dim}`
  const kept = made.get(key)
  if (kept !== undefined) return kept
  let css = FONT + STRAY_CSS
  let body = ''
  if (motion === 'off') {
    body = group(0, 'f0')
  } else {
    css += playing(FRAMES / FPS[motion])
    for (let k = 0; k < FRAMES; k += 1) body += group(k, `f f${k}`)
  }
  const veil = dim > 0 ? `<rect width="${W}" height="${num(H)}" fill="#000" opacity="${num(dim / 100)}"/>` : ''
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="${VIEW}" preserveAspectRatio="xMidYMid slice" xml:space="preserve">` +
    `${DEFS}<style>${css}</style><rect width="${W}" height="${num(H)}" fill="${GROUND}"/>${body}${veil}</svg>`
  made.set(key, svg)
  return svg
}
