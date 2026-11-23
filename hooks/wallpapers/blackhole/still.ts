// The black hole's still picture: what shows alone with motion off, under Reduce Motion, on the phone,
// and wherever the shader is not played (it is the Svg under the Shader). A real frame of ./shader.ts,
// cell by cell (./still-data.ts, written by tools/make-still.mjs), drawn as text: one <text> a row, top
// first, every character on the shader's own grid of 6 by 10 points, in the shader's own colours.
// Pure, no engine import: settings in, an SVG string out, the same string for the same settings.
import { STILL_COLOURS, STILL_GRID, STILL_INKS, STILL_ROWS } from './still-data.ts'

/** What the still reads of the settings: the dimming (0 to 80) and the hole's size. Everything is optional. */
export type StillSettings = {
  dim?: unknown
  own?: unknown
}

export const STILL_ALT =
  'An ASCII-art black hole: a dark middle in a thin gold ring, the far side of its glowing disc bent over the top ' +
  'and under it, the front of the disc a band across the middle, brighter on the left, and matter falling in.'

const GROUND = '#060409'
const FONT_SIZE = 9.6
// One character's own advance in the monospace fonts named below: about 0.55 of the font size.
const ADVANCE = FONT_SIZE * 0.55
const SIZES: Record<string, number> = { small: 0.8, medium: 1, large: 1.25 }

const num = (v: number): string => String(Math.round(v * 100) / 100)

function sizeOf(s: StillSettings | undefined): number {
  const own = s && typeof s === 'object' && s.own && typeof s.own === 'object' ? (s.own as Record<string, unknown>).blackhole : undefined
  const size = own && typeof own === 'object' ? (own as Record<string, unknown>).size : undefined
  // its own keys only: `in` would also take inherited names such as toString
  return typeof size === 'string' && Object.prototype.hasOwnProperty.call(SIZES, size) ? (SIZES[size] ?? 1) : 1
}
function dimOf(s: StillSettings | undefined): number {
  const d = s && typeof s === 'object' ? s.dim : undefined
  return typeof d === 'number' && Number.isFinite(d) ? Math.min(80, Math.max(0, Math.round(d))) : 30
}

/** The ink used most, which the rows take by default; the others go in a <tspan> each run. */
function commonInk(): string {
  const count = new Map<string, number>()
  for (const row of STILL_COLOURS) for (const ch of row) if (ch !== ' ') count.set(ch, (count.get(ch) ?? 0) + 1)
  let best = 'a'
  let most = -1
  for (const [ch, n] of count) {
    if (n > most) {
      best = ch
      most = n
    }
  }
  return best
}

/** One row as a <text>: its characters with its spaces kept, each run of another ink in a <tspan>. */
function rowText(chars: string, inks: string, k: number, common: string): string {
  let body = ''
  let i = 0
  while (i < chars.length) {
    const ink = inks[i] ?? ' '
    if (ink === ' ' || ink === common) {
      body += chars[i]
      i += 1
      continue
    }
    // a run of this ink, carrying spaces inside it, ending at its last character of the ink
    let end = i
    let j = i + 1
    while (j < chars.length) {
      const next = inks[j] ?? ' '
      if (next === ink) end = j
      else if (next !== ' ') break
      j += 1
    }
    body += `<tspan class="${ink}">${chars.slice(i, end + 1)}</tspan>`
    i = end + 1
  }
  const y = (STILL_GRID.firstRow + k) * STILL_GRID.cellH + STILL_GRID.cellH * 0.8
  const fit = chars.length > 1 ? ` textLength="${num((chars.length - 1) * STILL_GRID.cellW + ADVANCE)}"` : ''
  return `<text y="${num(y)}"${fit}>${body}</text>`
}

const made = new Map<string, string>()

/** The still as one SVG string, at most 124,000 characters, nothing that moves. */
export function stillSvg(settings?: StillSettings): string {
  const size = sizeOf(settings)
  const dim = dimOf(settings)
  const key = `${size}|${dim}`
  const kept = made.get(key)
  if (kept !== undefined) return kept
  const { width: W, height: H } = STILL_GRID
  const common = commonInk()
  const letters = 'abcdefghijkl'
  const inkCss = STILL_INKS.map((c, i) => (letters[i] === common ? '' : `.${letters[i]}{fill:${c}}`)).join('')
  const css =
    `text{font:bold ${num(FONT_SIZE)}px Consolas,'Cascadia Mono','Courier New',monospace;white-space:pre;` +
    `fill:${STILL_INKS[letters.indexOf(common)] ?? '#e06020'}}${inkCss}`
  let body = ''
  STILL_ROWS.forEach((row, k) => {
    body += rowText(row, STILL_COLOURS[k] ?? '', k, common)
  })
  // the hole's size, about the middle of the picture, where the hole is
  const cx = num(W / 2)
  const cy = num(H / 2)
  const group = size === 1 ? `<g>${body}</g>` : `<g transform="translate(${cx} ${cy}) scale(${size}) translate(-${cx} -${cy})">${body}</g>`
  const veil = dim > 0 ? `<rect width="${W}" height="${H}" fill="#000" opacity="${num(dim / 100)}"/>` : ''
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" xml:space="preserve">` +
    `<style>${css}</style><rect width="${W}" height="${H}" fill="${GROUND}"/>${group}${veil}</svg>`
  made.set(key, svg)
  return svg
}
