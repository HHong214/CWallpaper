// The Kiki scene's hero, in pixel art: the young witch seen from behind on a
// short broom, her black cat on its front end and a little red radio
// hanging from the tip, floating as they fly off toward the town.
// One unit of the 320 x 180 viewBox (./types) is one art pixel. Pure and
// deterministic: no `$`, no DOM, no Node APIs, no clock, no randomness.
//
// Drawn as colour ROLES (one letter a pixel) into small buffers, then written
// with the colours of the phase (palette swap), each buffer as filled
// rectangles (./pixels). Sunset and night add a rim on
// the right and top edges (the low sun, the moon), computed from the pixels.
// Motion: the whole group floats and drifts on smooth CSS translations; the
// hair, bow ribbons, hem, legs, cat tail, cat ear and radio change by FRAMES:
// groups toggled with CSS visibility keyframes on step timing, frame 0 shown
// in the base state and every other frame carrying visibility="hidden".
import { bufArt } from './pixels.ts'
import type { Ask, Layer, Phase } from './types.ts'

// The group's box in the viewBox: local pixel (0,0) is (88,52).
const OX = 88
const OY = 52
const BW = 84
const BH = 58

// ------------------------------------------------------------------ pixels

type Buf = { w: number; h: number; d: Int32Array }
const NONE = -1

const buf = (): Buf => ({ w: BW, h: BH, d: new Int32Array(BW * BH).fill(NONE) })
const put = (b: Buf, x: number, y: number, c: number): void => {
  if (x >= 0 && y >= 0 && x < b.w && y < b.h) b.d[y * b.w + x] = c
}
const at = (b: Buf, x: number, y: number): number => (x >= 0 && y >= 0 && x < b.w && y < b.h ? b.d[y * b.w + x] ?? NONE : NONE)
/** Rows of role letters from (x, y); '.' and ' ' are left clear. */
const art = (b: Buf, x: number, y: number, rows: readonly string[]): void => {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i += 1) {
      const ch = row[i] ?? '.'
      if (ch !== '.' && ch !== ' ') put(b, x + i, y + j, ch.charCodeAt(0))
    }
  })
}
const dots = (b: Buf, role: string, pts: readonly (readonly [number, number])[]): void => {
  for (const [x, y] of pts) put(b, x, y, role.charCodeAt(0))
}

// ------------------------------------------------------------------ colours
// Roles: bow R r q, hair H h d, skin S s, dress N n m, satchel and strap O o p,
// shoes B b, handle W w v, straw Y y x, binding C c, cat k, radio E e g,
// string t. `*` is the rim, added at output time.

type Pal = Record<string, string>
const DAY: Pal = {
  R: '#d8383c', r: '#f2685a', q: '#9c2638',
  H: '#4a2a22', h: '#6e4232', d: '#2e1a1e',
  S: '#f6d2b4', s: '#d6a08e',
  N: '#2e3672', n: '#5252a2', m: '#18214e',
  O: '#ea8a45', o: '#f8b468', p: '#8e4a2e',
  B: '#8a3a2c', b: '#b2563c',
  W: '#a8784a', w: '#d4a86c', v: '#74503a',
  Y: '#d2c072', y: '#f4e8b4', x: '#8e8656',
  C: '#9a3a34', c: '#c85a48',
  k: '#0e0e14', l: '#22222e',
  E: '#d8403a', e: '#f47a62', g: '#6a2230', t: '#3a3348',
}
const SUNSET: Pal = {
  R: '#c8343e', r: '#ee6c58', q: '#7e2040',
  H: '#3c2226', h: '#64382e', d: '#261622',
  S: '#e6b09a', s: '#b47c88',
  N: '#2a2c62', n: '#4a4488', m: '#161e48',
  O: '#d8783e', o: '#f2a060', p: '#723830',
  B: '#743030', b: '#9e4838',
  W: '#926244', w: '#be885a', v: '#5c3c3c',
  Y: '#c09c62', y: '#e8c890', x: '#7c6a62',
  C: '#823034', c: '#ae4842',
  k: '#0c0a14', l: '#1e1828',
  E: '#c63a3a', e: '#ea6a58', g: '#581e32', t: '#2e2840',
  '*': '#ffb070', '+': '#d88a72',
}
const NIGHT: Pal = {
  R: '#a82c44', r: '#cc4e5a', q: '#621c3c',
  H: '#2a1a28', h: '#46303e', d: '#1a1220',
  S: '#b8a0b6', s: '#887296',
  N: '#23275c', n: '#3a3880', m: '#131a44',
  O: '#9e5e40', o: '#be7e52', p: '#583038',
  B: '#562a38', b: '#783c46',
  W: '#6c5248', w: '#8c6e5a', v: '#443244',
  Y: '#8a8070', y: '#aa9e86', x: '#54546a',
  C: '#622a3c', c: '#82404c',
  k: '#08080e', l: '#161626',
  E: '#982f42', e: '#be4e5a', g: '#481832', t: '#24203a',
  '*': '#8e96d8', '+': '#4e58a0',
}
const PALS: Record<Phase, Pal> = { day: DAY, sunset: SUNSET, night: NIGHT }
const RIM = '*'.charCodeAt(0)
const SOFT = '+'.charCodeAt(0)
const NO_RIM = new Set(['t'].map(c => c.charCodeAt(0)))

// ------------------------------------------------------------------ drawing
// Coordinates below are local pixels (x + 88, y + 52 in the viewBox).
// Broom: tip x 4, handle to x 45 on rows 40-41 (highlight on top), binding
// x 46-47, straw x 48-63. Kiki: bow top y 9, seat on the handle, shoes to y 49,
// spine near x 33, head x 28-39. Cat: x 10-20, y 28-39 on the handle, its tail
// hanging over the near side of it.

const role = (s: string): number => s.charCodeAt(0)

function broom(b: Buf): void {
  for (let x = 5; x <= 45; x += 1) { put(b, x, 40, role('w')); put(b, x, 41, role('W')) }
  art(b, 3, 40, ['vW', '.v'])
  art(b, 46, 38, ['cc', 'cC', 'CC', 'CC', 'qq'])
  // the bundle fans from 5 rows at the binding to 9 at the end, its streaks
  // running the whole length, the end broken into separate bristle tips
  art(b, 48, 36, [
    '........yyyyyyy.',
    '....yyyyyyYYYYYy',
    'yyyyYYYYYYYYYYY.',
    'YYYYYYYYYYYYYYYY',
    'YYYYYxxxxxxxxxx.',
    'YYYYYYYYYYYYYYYx',
    'xxxxxYYYYYYYYYY.',
    '...xxxxxxxxxxxxx',
    '........xxxxxxx.',
  ])
}

function kiki(b: Buf): void {
  // left arm: upper arm down the side, forearm forward to the handle
  const arm: [number, number][] = [[28, 26], [29, 26], [30, 26], [31, 25], [32, 25], [33, 25], [34, 24], [35, 24], [36, 24], [37, 23], [38, 23]]
  for (const [y, x] of arm) { put(b, x, y, role('s')); put(b, x + 1, y, role('S')) }
  art(b, 22, 39, ['sSS', 'sSS'])
  // right arm, its hand on the handle beyond the satchel
  for (let y = 28; y <= 33; y += 1) { put(b, 40, y, role('s')); put(b, 41, y, role('S')) }
  for (let y = 34; y <= 38; y += 1) { put(b, 41, y, role('s')); put(b, 42, y, role('S')) }
  // hair, a rounded bob: the crown narrows under the bow, the ends flip out on
  // rows 21-22 (only row 22 on the left, where the loose strand flicks), a lit
  // band curves across the upper right, the nape shows between the ends
  art(b, 27, 14, [
    '....HHHhhH....',
    '...dHHHHhhH...',
    '..dHHHHHHhhH..',
    '.ddHHHHHHHHhH.',
    '.ddHHdHHHHHHH.',
    '.dHdHHHHHdHHH.',
    '.dHdHHHHHdHHH.',
    '.dHdHHHHHdHHHH',
    'dddHdHHHdHHdHH',
    '.ddHdHHHdHHdd.',
    '...dddsSdddd..',
  ])
  // the bow: two loops and the knot (its ribbon tails are frames)
  art(b, 27, 9, [
    '.RRR......RRR.',
    'RRRrR....RRRrR',
    'RRRRRqRrqRRRRr',
    'qRRRRqRRqRRRRR',
    '.qqRRqqqqRRqq.',
    '...qq....qq...',
  ])
  // nape and dress: shoulders 10, waist 7, the skirt over the handle,
  // spreading to the right where her knees turn toward the town
  art(b, 32, 25, ['sSSS'])
  art(b, 27, 26, [
    '..mNNNNNNNNn.....',
    '.mmNNNNNNNNnn....',
    '.mmNNNNNNNNnn....',
    '..mNNNNNNNNn.....',
    '...mNNNNNNn......',
    '...mNNNNNNn......',
    '...mmNNNNnp......',
    '...mNNNNNnp......',
    '..mmNNNNNNn......',
    '..mNNmNNNNNn.....',
    '.mmNNmNNNNNnn....',
    '.mNNNmNNNNmNnn...',
    'mmNNNmNNNNmNNnn..',
    'mNNNmNNNNNmNNNnn.',
    'mNNNmNNNNNmNNNNn.',
    'mNNNmNNNNNmNNNNnn',
  ])
  // satchel strap across the back, the satchel on the right hip
  dots(b, 'p', [[30, 26], [31, 27], [32, 27], [33, 28], [34, 29], [35, 29], [36, 30], [37, 31], [38, 31]])
  art(b, 38, 32, [
    'ppooo',
    'ooooO',
    'OOpOO',
    'OOOOp',
    '.ppp.',
  ])
  art(b, 42, 39, ['SS', 'sS'])
}

function cat(b: Buf): void {
  // round head with soft 2 px ear tips (the right ear is a frame), a 7 px neck
  // widening to the seat like the mascot's pear, a sheen down the right edge
  art(b, 10, 28, [
    '.kk........',
    '.kkk.......',
    '.kkkkkkkkl.',
    'kkkkkkkkkkl',
    'kkkkkkkkkkl',
    'kkkkkkkkkkl',
    '.kkkkkkkkl.',
    '..kkkkkkl..',
    '..kkkkkkl..',
    '.kkkkkkkkl.',
    'kkkkkkkkkkl',
    'kkkkkkkkkkkl',
  ])
}

// ------------------------------------------------------------------ frames

type Draw = (b: Buf) => void
type FrameSet = { id: string; dur: number; seq: readonly number[]; frames: readonly Draw[] }

// strands flicking back in the wind from the flipped ends on the left
const hairFrames: Draw[] = [
  b => dots(b, 'd', [[26, 22]]),
  b => dots(b, 'd', [[26, 23]]),
  b => dots(b, 'd', [[26, 22], [25, 21]]),
]
// the ribbon tails from the knot, streaming down and to the left
const tails = (b: Buf, l: readonly (readonly [number, number])[], r: readonly (readonly [number, number])[]): void => {
  dots(b, 'R', l.slice(0, -1)); dots(b, 'q', l.slice(-1))
  dots(b, 'R', r.slice(0, -1)); dots(b, 'q', r.slice(-1))
}
const bowFrames: Draw[] = [
  b => tails(b, [[33, 14], [32, 15], [32, 16]], [[34, 14], [35, 15], [35, 16]]),
  b => tails(b, [[33, 14], [32, 15], [31, 16]], [[34, 14], [34, 15], [35, 16]]),
  b => tails(b, [[33, 14], [32, 15], [31, 15]], [[34, 14], [35, 15], [36, 16]]),
]
const hemFrames: Draw[] = [
  b => art(b, 27, 42, ['mNNNmNNNNNmNNNNn', '.mm.mmmm.mmmmm..']),
  b => art(b, 26, 42, ['.mNNNmNNNNmNNNNNn', 'mm..mmmm.mmmmmm..']),
]
const leg = (b: Buf, x: number, lift: number, toe: number): void => {
  for (let y = 44; y <= 47 - lift; y += 1) { put(b, x, y, role('s')); put(b, x + 1, y, role('S')) }
  art(b, x, 48 - lift, [toe > 0 ? 'Bbb' : 'Bb', 'BBB'])
}
const legFrames: Draw[] = [
  b => { leg(b, 33, 0, 0); leg(b, 37, 0, 0) },
  b => { leg(b, 33, 1, 0); leg(b, 37, 0, 1) },
  b => { leg(b, 33, 0, 1); leg(b, 37, 0, 0) },
  b => { leg(b, 33, 0, 0); leg(b, 37, 1, 1) },
]
const tailFrames: Draw[] = [
  b => art(b, 13, 40, ['...kk', '...kk', '...kk', '...kk', '...kk', 'k..kk', 'kk.kk', '.kkk']),
  b => art(b, 13, 40, ['...kk', '...kk', '...kk', '....kk', '....kk', '.k..kk', '.kk.kk', '..kkk']),
  b => art(b, 13, 40, ['...kk', '...kk', '...kk', '...kk', '.k.kk', '.kkkk', '..kk']),
  b => art(b, 13, 40, ['...kk', '...kk', '..kk', '..kk', 'k.kk', 'kkkk', '.kk']),
]
const earFrames: Draw[] = [
  b => art(b, 17, 28, ['.kk', 'kkk']),
  b => art(b, 17, 28, ['..kk', 'kkk']),
]
const radio = (b: Buf, dx: number): void => {
  dots(b, 't', [[5, 42], [5, 43], [5 + dx, 44]])
  art(b, 3 + dx, 45, ['.ttt.', 'eeeeE', 'EggEe', 'EggEE', 'ggggg'])
}
const radioFrames: Draw[] = [b => radio(b, 0), b => radio(b, -1), b => radio(b, 1)]

const SETS: readonly FrameSet[] = [
  { id: 'd', dur: 1.6, seq: [0, 1, 2, 3], frames: legFrames },
  { id: 'c', dur: 0.6, seq: [0, 1], frames: hemFrames },
  { id: 'a', dur: 0.7, seq: [0, 1, 0, 2], frames: hairFrames },
  { id: 'b', dur: 0.5, seq: [0, 1, 2], frames: bowFrames },
  { id: 'f', dur: 6, seq: Array.from({ length: 30 }, (_, i) => (i === 26 || i === 28 ? 1 : 0)), frames: earFrames },
  { id: 'e', dur: 1.8, seq: [0, 1, 2, 3], frames: tailFrames },
  { id: 'g', dur: 1.4, seq: [0, 1, 0, 2], frames: radioFrames },
]

// ------------------------------------------------------------------ writing

const occupied = (b: Buf, x: number, y: number): boolean => at(b, x, y) !== NONE

/**
 * Rim light from the upper right: an edge pixel (open to the right or above)
 * whose outward normal, read from the empty pixels around it, faces the light.
 * Facing it squarely gives the bright rim, facing up or right the soft one.
 * Parts one or two pixels thin keep their colour. `cover` holds what may sit
 * over an edge: for a frame it never includes that frame's siblings, so every
 * frame of a set lights its own outline the same way and nothing blinks.
 */
function rim(layer: Buf, ctx: Buf, cover: Buf): Buf {
  const out: Buf = { w: BW, h: BH, d: new Int32Array(layer.d) }
  for (let y = 0; y < BH; y += 1) for (let x = 0; x < BW; x += 1) {
    const c = at(layer, x, y)
    if (c === NONE || NO_RIM.has(c)) continue
    const right = !occupied(cover, x + 1, y) && occupied(ctx, x - 1, y) && occupied(ctx, x - 2, y)
    const top = !occupied(cover, x, y - 1) && occupied(ctx, x, y + 1) && occupied(ctx, x, y + 2)
    if (!right && !top) continue
    let nx = 0
    let ny = 0
    for (let j = -2; j <= 2; j += 1) for (let i = -2; i <= 2; i += 1) {
      if (!occupied(ctx, x + i, y + j)) { nx += i; ny -= j }
    }
    const len = Math.hypot(nx, ny)
    if (len === 0) continue
    const dot = (nx + ny) / (len * Math.SQRT2)
    if (dot > 0.9) put(out, x, y, RIM)
    else if (dot > 0.55) put(out, x, y, SOFT)
  }
  return out
}

/** A sprite as filled rectangles in the group's local pixels. */
function sprite(b: Buf, pal: Pal): string {
  return bufArt(b, c => pal[String.fromCharCode(c)] ?? '#ff00ff')
}

const num = (n: number): string => String(Math.round(n * 1000) / 1000).replace(/^0\./, '.')

/** Visibility keyframes for frame `f` of a set: shown in the slots where seq names it. */
function keys(seq: readonly number[], f: number): string {
  let out = ''
  let prev: boolean | null = null
  seq.forEach((g, s) => {
    const v = g === f
    if (v !== prev) out += `${num((s / seq.length) * 100)}%{visibility:${v ? 'visible' : 'hidden'}}`
    prev = v
  })
  return out
}

export function hero(ask: Ask): Layer {
  const pal = PALS[ask.phase]
  const lit = ask.phase !== 'day'

  const base = buf()
  broom(base)
  cat(base)
  kiki(base)

  const drawn = SETS.map(s => s.frames.map(f => { const b = buf(); f(b); return b }))
  // base plus every frame of the sets other than `skip` (-1: of all sets)
  const union = (skip: number): Buf => {
    const u = buf()
    u.d.set(base.d)
    drawn.forEach((frames, k) => {
      if (k !== skip) for (const fb of frames) fb.d.forEach((c, i) => { if (c !== NONE) u.d[i] = c })
    })
    return u
  }
  const over = (under: Buf, layer: Buf): Buf => {
    const c = buf()
    c.d.set(under.d)
    layer.d.forEach((v, i) => { if (v !== NONE) c.d[i] = v })
    return c
  }
  const paint = (layer: Buf, ctx: Buf, cover: Buf): string => sprite(lit ? rim(layer, ctx, cover) : layer, pal)

  let inner = paint(base, base, union(-1))
  let css = ''
  SETS.forEach((s, k) => {
    const frames = drawn[k] ?? []
    const others = lit ? union(k) : base
    frames.forEach((fb, f) => {
      if (ask.still && f > 0) return
      const paths = paint(fb, over(base, fb), over(others, fb))
      if (ask.still) { inner += paths; return }
      const name = `h-${s.id}${f}`
      inner += `<g class="h-z ${name}"${f > 0 ? ' visibility="hidden"' : ''}>${paths}</g>`
      css += `.${name}{animation:${name} ${num(s.dur)}s step-end infinite}@keyframes ${name}{${keys(s.seq, f)}}`
    })
  })

  const pic = `<g transform="translate(${OX} ${OY})">${inner}</g>`
  if (ask.still) return { defs: '', css: '', body: pic }

  css += '.h-fl{animation:h-fl 4.2s ease-in-out -2.1s infinite alternate}' +
    '@keyframes h-fl{from{transform:translateY(-1.5px)}to{transform:translateY(1.5px)}}' +
    '.h-dr{animation:h-dr 7s ease-in-out -3.5s infinite alternate}' +
    '@keyframes h-dr{from{transform:translateX(-1px)}to{transform:translateX(1px)}}' +
    '@media (prefers-reduced-motion:reduce){.h-fl,.h-dr,.h-z{animation:none}}'
  return { defs: '', css, body: `<g class="h-fl"><g class="h-dr">${pic}</g></g>` }
}
