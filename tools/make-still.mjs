// Writes hooks/wallpapers/blackhole/still-data.ts, the black hole's still picture, from a real frame of
// its shader: the shader is run under the preview's stand-in (tools/render.mjs) on a window with no prompt
// box, so the hole sits in the middle, and each character cell's glyph and colour are read from the
// shader's own per-cell buffer (`look`, the last buffer before the picture). hooks/wallpapers/blackhole/
// still.ts builds the SVG from that data. Run it again whenever the shader changes:
//   node tools/make-still.mjs            (writes the file)
//   node tools/make-still.mjs --check    (only says whether the file is what the shader gives now)
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadShader, Renderer } from './render.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHADER = path.join(ROOT, 'hooks', 'wallpapers', 'blackhole', 'shader.ts')
const OUT = path.join(ROOT, 'hooks', 'wallpapers', 'blackhole', 'still-data.ts')

// The frame: a window of 2016 by 1260 points (16:10, the shader's 6 by 10 cells, 336 by 126 of them: as
// fine a grid as keeps the SVG well under 124,000 characters), no prompt box (the moment is chosen below).
const WIDTH = 2016
const HEIGHT = 1260
// The hole as large in the picture as on a 1512 by 945 window (R is held to 125 points: size makes up the rest).
const SIZE = 0.94

const FPS = 30
const CELL_W = 6
const CELL_H = 10
// The shader's glyphs 0 to 11, as characters.
const RAMP = ' .:;tSX%8#$@'

// The inks: the shader's own colours (its `look` pass): the disc's heat from its white-hot inner edge to
// its dark red rim, at full light and at half, then the ring's white-gold and the jets' blue and
// blue-white. Each cell takes the nearest.
const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}
function heat(k, lvl) {
  return [
    (0.55 + 0.45 * smooth(0, 0.45, k) - 0.05 * smooth(0.75, 1, k)) * lvl,
    (0.08 + 0.3 * smooth(0.15, 0.55, k) + 0.5 * smooth(0.45, 1, k)) * lvl,
    (0.03 + 0.25 * smooth(0.3, 0.65, k) + 0.42 * smooth(0.55, 0.95, k)) * lvl,
  ]
}
const INKS = [
  ...[1, 0.8, 0.6, 0.4, 0.2, 0].map(k => heat(k, 1)),
  ...[0.8, 0.4, 0.1].map(k => heat(k, 0.5)),
  [1, 0.86, 0.62],
  [0.26, 0.42, 0.8],
  [0.78, 0.88, 1],
]
const hex = c => '#' + c.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')
const LETTERS = 'abcdefghijkl'

const shader = await loadShader(SHADER)
const r = new Renderer(shader, {
  res: [WIDTH, HEIGHT],
  points: [WIDTH, HEIGHT],
  composer: [0, 0, 0, 0],
  values: { dim: 0, speed: 1, calm: 0, size: SIZE },
  fps: FPS,
})
const at = shader.passes.findIndex(p => p.kind === 'picture')
const look = shader.passes[at - 1]
if (!look || look.kind !== 'buffer') throw new Error('the shader has no per-cell buffer before its picture')

const cols = Math.ceil(WIDTH / CELL_W)
const rowsAll = Math.ceil(HEIGHT / CELL_H)

// Which frame: the high angle, at the start of the view's swing. The arcs, the hot arc on the ring and the
// sparks move, so frames differ in how plainly they show the ring round the hole: of the frames every half
// second from FIRST to LAST seconds (the picture faded in, the view still within a degree of its highest),
// the one with the most lit characters in the upper half of the ring's annulus (0.9 R to 1.25 R).
const FIRST = 1.5
const LAST = 3.5
const lit = ch => ch !== ' '
/** The glyph a cell shows, from the look buffer's code (glyph, glyph before, fade, ground: see the shader). */
function glyphOf(code) {
  const fade = (Math.floor(code / 1024) % 32) / 31
  return fade >= 0.5 ? code % 32 : Math.floor(code / 32) % 32
}
/** The picture's rows as characters, top first, read from the buffer as it is now. */
function charRows() {
  const out = []
  for (let k = 0; k < rowsAll; k++) {
    const row = rowsAll - 1 - k
    let s = ''
    for (let c = 0; c < cols; c++) {
      const code = look.data[(Math.min(row, look.h - 1) * look.w + Math.min(c, look.w - 1)) * 4]
      s += RAMP[glyphOf(code)] ?? ' '
    }
    out.push(s.trimEnd())
  }
  return out
}
// the hole's centre and R on this window (no prompt box: the middle; W is 0.6 of the width)
const R_STILL = SIZE * Math.min(Math.min(Math.max(0.13 * 0.6 * WIDTH, 40), 125), 0.15 * HEIGHT)
/** How plainly a frame shows the ring: its lit characters in the upper half of the annulus. */
function score(rows) {
  let n = 0
  rows.forEach((s, k) => {
    const y = HEIGHT - (k + 0.5) * CELL_H
    if (y <= HEIGHT / 2) return
    for (let c = 0; c < s.length; c++) {
      const d = Math.hypot((c + 0.5) * CELL_W - WIDTH / 2, y - HEIGHT / 2)
      if (d >= 0.9 * R_STILL && d <= 1.25 * R_STILL && lit(s[c])) n++
    }
  })
  return n
}
let SECONDS = FIRST
let bestScore = -1
for (let f = 0; f <= LAST * FPS; f++) {
  r.runFrame(f, false)
  if (f >= FIRST * FPS && f % (FPS / 2) === 0) {
    const s = score(charRows())
    if (s > bestScore) {
      bestScore = s
      SECONDS = f / FPS
    }
  }
}
// run again to the chosen frame (the stand-in steps from the start)
const shader2 = await loadShader(SHADER)
const look2 = shader2.passes[shader2.passes.findIndex(p => p.kind === 'picture') - 1]
const r2 = new Renderer(shader2, {
  res: [WIDTH, HEIGHT],
  points: [WIDTH, HEIGHT],
  composer: [0, 0, 0, 0],
  values: { dim: 0, speed: 1, calm: 0, size: SIZE },
  fps: FPS,
})
for (let f = 0; f <= SECONDS * FPS; f++) r2.runFrame(f, false)

const rows = []
const inks = []
for (let k = 0; k < rowsAll; k++) {
  const row = rowsAll - 1 - k // the buffer's rows count up from the bottom; the picture's from the top
  let chars = ''
  let ink = ''
  for (let c = 0; c < cols; c++) {
    const i = (Math.min(row, look2.h - 1) * look2.w + Math.min(c, look2.w - 1)) * 4
    const g = glyphOf(look2.data[i])
    const ch = g >= 0 && g < RAMP.length ? RAMP[g] : ' '
    chars += ch
    if (ch === ' ') {
      ink += ' '
      continue
    }
    const rgb = [look2.data[i + 1], look2.data[i + 2], look2.data[i + 3]]
    let best = 0
    let bestD = Infinity
    INKS.forEach((p, j) => {
      const d = (p[0] - rgb[0]) ** 2 + (p[1] - rgb[1]) ** 2 + (p[2] - rgb[2]) ** 2
      if (d < bestD) {
        bestD = d
        best = j
      }
    })
    ink += LETTERS[best]
  }
  rows.push(chars.trimEnd())
  inks.push(ink.slice(0, chars.trimEnd().length))
}
// leave out the blank rows at the top and the bottom
let first = 0
while (first < rows.length && rows[first] === '') first++
let last = rows.length - 1
while (last > first && rows[last] === '') last--

const q = s => JSON.stringify(s)
const text =
  `// Written by tools/make-still.mjs from ./shader.ts: a frame ${SECONDS} seconds in, on a window of ${WIDTH} by ${HEIGHT}\n` +
  `// points with no prompt box, read cell by cell from the shader's own buffer. Not edited by hand: run\n` +
  `// \`node tools/make-still.mjs\` again when the shader changes. ./still.ts draws it.\n\n` +
  `/** The frame's window, its cells, and the first row kept (the blank rows above it and below the last are left out). */\n` +
  `export const STILL_GRID = { width: ${WIDTH}, height: ${HEIGHT}, cellW: ${CELL_W}, cellH: ${CELL_H}, firstRow: ${first} } as const\n\n` +
  `/** The inks: the disc's heat at full and half light, then the ring's white-gold and the jets' blue and blue-white. */\n` +
  `export const STILL_INKS: readonly string[] = [${INKS.map(c => q(hex(c))).join(', ')}]\n\n` +
  `/** The characters, a row each from the top (from firstRow), with trailing blanks left off. */\n` +
  `export const STILL_ROWS: readonly string[] = [\n${rows.slice(first, last + 1).map(s => `  ${q(s)},`).join('\n')}\n]\n\n` +
  `/** Each character's ink, a letter each (a for the first ink), a space where the character is blank. */\n` +
  `export const STILL_COLOURS: readonly string[] = [\n${inks.slice(first, last + 1).map(s => `  ${q(s)},`).join('\n')}\n]\n`

if (process.argv.includes('--check')) {
  let old = ''
  try {
    old = readFileSync(OUT, 'utf8')
  } catch {
    old = ''
  }
  if (old.replace(/\r\n/g, '\n') !== text) {
    console.error(`${path.relative(ROOT, OUT)} is not what the shader gives now: run node tools/make-still.mjs`)
    process.exit(1)
  }
  console.log(`${path.relative(ROOT, OUT)} is in step with the shader.`)
} else {
  writeFileSync(OUT, text)
  const lit = rows.reduce((n, s) => n + [...s].filter(ch => ch !== ' ').length, 0)
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${last - first + 1} rows of up to ${cols} cells, ${lit} lit`)
}
