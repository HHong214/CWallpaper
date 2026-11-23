// The black hole as ASCII art: a field of characters on a fixed grid, one
// frame at a time. Pure: a frame number in, rows of characters out. No `$`, no
// JSX, no DOM, no Node APIs, so a preview script can import it too.
//
// The picture: a dark centre in a thin bright ring; round it the disc's far
// side, bent over the top in a full, thick arc and under the bottom in a
// thinner one; across the middle the disc's front band, reaching past the ring
// on both sides, longer and brighter on the left. Outside the disc a sparse
// field of dim characters streams in.
//
// The pull: everything lit moves with one flow (`flowAt`), inward and round,
// faster near the ring. A feature carried by the flow keeps two numbers: u, the
// time it has fallen (s(r), less the frame), and w, its angle less the turn it
// has made (q(r)). The disc's brightness is a sum of waves in u and w, so each
// arm and clump is carried along the flow, and as every wave's step in u is a
// whole number of turns over FRAMES frames, frame FRAMES is frame 0: the loop
// closes with no jump. The outer stream is points of fixed u and w, each with a
// short tail behind it along its own curved path. The band's clumps run in
// along it from both ends the same way; the ring shimmers in place.

/** The grid's width in characters. */
export const COLS = 140
/** The grid's height in rows. */
export const ROWS = 56
/** The characters, dimmest first; a space is not lit. */
export const RAMP = ' .:;tSX%$8#@'
/** Frames in one loop. */
export const FRAMES = 30

/**
 * Where things are, in cell widths from the hole's centre: a cell at column x,
 * row y lies at dx = x - cx, dy = (y - cy) * aspect. `aspect` is a cell's height
 * over its width, so in these units a circle is round on screen.
 */
export const GEOMETRY = {
  cx: 70,
  cy: 27,
  aspect: 1.5,
  shadow: 11.5,
  ring: 12.4,
  band: { from: 26, to: 28 },
} as const

const { cx: CX, cy: CY, aspect: ASPECT, ring: RING, band: BAND } = GEOMETRY
const TOP = RAMP.length - 1
const TAU = Math.PI * 2

// Everything lit stays in this box, centred on the grid.
const BOX = { x0: 39, x1: 101, y0: 7, y1: 47 }
// The disc's front band: how far it reaches each way, in ring radii.
const BAND_LEFT = 2.5
const BAND_RIGHT = 2.05
// The dark gap between the ring and the disc's far side: a column at the sides, a row above and below.
const discIn = (theta: number): number => RING + 1.15 + 0.9 * Math.abs(Math.sin(theta))
// The flow tables reach this far out.
const RMAX = 50

/**
 * The flow at radius r: how far a feature moves inward (cell widths per
 * frame) and how far it turns (radians per frame, clockwise on screen). Both
 * fall with r: things speed up as they near the ring.
 */
export function flowAt(r: number): { inward: number; turn: number } {
  const at = Number.isFinite(r) ? Math.max(RING, Math.min(r, 1e6)) : RING
  return { inward: 0.18 + 1.8 / (at - RING + 2), turn: 0.07 * Math.pow(RING / at, 1.5) }
}

// s(r): frames a feature takes to fall from RMAX to r; q(r): radians it turns on
// the way. Tabled from the ring outward, read between steps.
const STEP = 0.05
const tables = ((): { s: Float64Array; q: Float64Array } => {
  const n = Math.ceil((RMAX - RING) / STEP) + 1
  const s = new Float64Array(n)
  const q = new Float64Array(n)
  for (let j = n - 2; j >= 0; j -= 1) {
    const f = flowAt(RING + (j + 0.5) * STEP)
    s[j] = (s[j + 1] ?? 0) + STEP / f.inward
    q[j] = (q[j + 1] ?? 0) + (STEP * f.turn) / f.inward
  }
  return { s, q }
})()

function lookup(a: Float64Array, r: number): number {
  const t = Math.max(0, (r - RING) / STEP)
  const last = a.length - 1
  if (t >= last) {
    // Past the table: on at the outermost pace.
    const f = flowAt(RMAX)
    return (a[last] ?? 0) - ((r - RMAX) * (a === tables.s ? 1 : f.turn)) / f.inward
  }
  const i = Math.floor(t)
  const lo = a[i] ?? 0
  return lo + ((a[i + 1] ?? lo) - lo) * (t - i)
}
const fallen = (r: number): number => lookup(tables.s, r)
const turned = (r: number): number => lookup(tables.q, r)

/** The radius at which a feature has fallen for s frames (s may lie outside the table). */
function radiusAt(s: number): number {
  const { s: table } = tables
  if (s <= 0) return RMAX - s * flowAt(RMAX).inward
  if (s >= (table[0] ?? 0)) return RING
  let lo = 0
  let hi = table.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if ((table[mid] ?? 0) > s) lo = mid
    else hi = mid
  }
  const a = table[lo] ?? 0
  const b = table[hi] ?? 0
  return RING + (lo + (a === b ? 0 : (a - s) / (a - b))) * STEP
}

/** A steady pseudo-random number in [0, 1) from whole numbers. */
function hash(a: number, b: number, c = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

// The disc's waves: [steps in u over a loop, turns in w round the hole, weight, phase].
const WAVES: readonly (readonly [number, number, number, number])[] = [
  [2, 2, 1, 0],
  [3, -3, 0.8, 1.3],
  [3, 5, 0.7, 2.1],
  [1, 1, 0.45, 4],
  [4, 3, 0.4, 0.7],
]
const WAVE_SUM = WAVES.reduce((n, w) => n + w[2], 0)

/** The disc's pattern at fall u and angle w: 0 (a gap) to 1 (a clump). */
function pattern(u: number, w: number): number {
  let v = 0
  for (const [a, b, weight, phase] of WAVES) v += weight * Math.cos((TAU * a * u) / FRAMES + b * w + phase)
  return 0.5 + v / (2 * WAVE_SUM)
}

/** How far out the disc's far side reaches in direction theta (its outer rim, before fraying). */
function rimAt(theta: number): number {
  const s = Math.sin(theta)
  const side = 1 - Math.abs(s)
  const left = -Math.cos(theta)
  if (s < 0) return RING * (1.98 + 0.3 * side ** 8 + 0.1 * left * side ** 2)
  return RING * (1.43 + 0.22 * side ** 3 + 0.06 * left * side)
}

/** The index of a brightness from 0 to about 1.25 on the ramp; under `floor` is not lit. */
function level(v: number, floor: number): number {
  if (!(v > floor)) return 0
  const t = Math.min(1, (v - floor) / (1.2 - floor))
  return Math.max(1, Math.min(TOP, 1 + Math.round(t * (TOP - 1))))
}

/** A ramp index held inside the lit range. */
const clampIndex = (v: number): number => Math.max(1, Math.min(TOP, Math.round(v)))

/** The thin ring: lit where the circle runs through the cell, brightest on its line. */
function ringAt(dx: number, dyw: number, r: number, k: number): number {
  const theta = Math.atan2(dyw, dx)
  const reach = 0.5 * Math.abs(Math.cos(theta)) + 0.5 * ASPECT * Math.abs(Math.sin(theta))
  const off = Math.abs(r - RING)
  if (off > reach) return 0
  // A slow shimmer running round the ring, brightest on the left.
  const spin = Math.cos(3 * theta - (TAU * 2 * k) / FRAMES)
  return clampIndex(TOP - 1 + (spin > 0.55 ? 1 : 0) - (off > 0.75 * reach ? 1 : 0) - (Math.cos(theta) > 0.7 ? 1 : 0))
}

/** The disc's far side, bent over and under the hole: arms and clumps falling in. */
function discAt(dx: number, dyw: number, r: number, k: number): number {
  const theta = Math.atan2(dyw, dx)
  const inner = discIn(theta)
  if (r < inner) return 0
  const rim = rimAt(theta)
  const p = pattern(fallen(r) - k, theta - turned(r))
  // A ragged rim: clumps reach a little past it, gaps eat into it.
  if (r > rim + 2 * (p - 0.45)) return 0
  // The gaps between the arms.
  if (p < (dyw > 0 ? 0.3 : 0.38)) return 0
  // Brightest at the inner edge and on the left; the arms' crests a step or two up.
  const t = Math.min(1, (r - inner) / Math.max(1, rim - inner))
  const base = 9.2 - 3.4 * t - 0.9 * Math.cos(theta) * t - (dyw > 0 ? 0.6 : 0)
  return clampIndex(base + (p > 0.64 ? 1 : 0))
}

/** The front band across the hole, its clumps running in along it from both ends. */
function bandAt(dx: number, j: number, k: number): number {
  const ax = Math.abs(dx)
  const isLeft = dx < 0
  const reach = (isLeft ? BAND_LEFT : BAND_RIGHT) * RING
  if (ax > reach) return 0
  // Which of the band's rows are lit here: its middle row all along; the rows
  // above and below on its thick left, and a little on the right.
  const near = ax / RING
  let body: number
  if (j === 0) body = 1
  else if (isLeft) body = near > (j < 0 ? 0.55 : 0.75) && near < (j < 0 ? 2.15 : 1.85) ? (j < 0 ? 0.85 : 0.7) : 0
  else body = near > 1.05 && near < (j < 0 ? 1.65 : 1.35) ? 0.55 : 0
  if (body === 0) return 0
  // Hottest just left of the ring, fading to both tips; dimmer and thin over the hole.
  let heat: number
  if (near < 1) heat = isLeft ? 0.72 + 0.3 * near : 0.6 + 0.25 * near
  else if (isLeft) heat = 1.22 - 0.42 * ((near - 1) / (BAND_LEFT - 1)) ** 1.2
  else heat = 0.9 - 0.45 * ((near - 1) / (BAND_RIGHT - 1))
  // Along the band, the time to fall to the ring; over the hole, on across it.
  const s = near >= 1 ? fallen(ax) : fallen(RING) + (RING - ax) / flowAt(RING).inward
  const u = s - k
  const wave =
    0.5 +
    0.32 * Math.cos((TAU * 2 * u) / FRAMES + 0.8 * j + (isLeft ? 0 : 2)) +
    0.18 * Math.cos((TAU * 3 * u) / FRAMES + 1.7 * j + (isLeft ? 1 : 4))
  // Gaps where the wave is low, thin ones on the bright left; crests a step up.
  if (wave < (isLeft && near > 0.9 ? 0.18 : 0.32)) return 0
  return clampIndex(1 + 9.2 * heat * body + (wave > 0.7 ? 1 : wave < 0.42 ? -2 : 0))
}

// The outer stream: paths at fixed w, each with points every STREAM_GAP frames of fall.
const STREAM_PATHS = 16
const STREAM_GAP = FRAMES
const TAIL = [0, 1.3, 2.6, 3.9, 5.2] as const
const TAIL_LEVEL = [4, 3, 2, 2, 1] as const

/** Lays the outer stream for frame k into `cells`, under anything brighter. */
function stream(cells: Uint8Array, k: number): void {
  for (let p = 0; p < STREAM_PATHS; p += 1) {
    const w = (TAU * (p + 0.6 * hash(p, 7))) / STREAM_PATHS
    const offset = Math.floor(hash(p, 11) * STREAM_GAP)
    const bright = 0.75 + 0.5 * hash(p, 13)
    // Every point of this path now: fallen s = offset + k + n * STREAM_GAP, for s from the box's corner in.
    for (let s0 = offset + k - 3 * STREAM_GAP; s0 < (tables.s[0] ?? 0); s0 += STREAM_GAP) {
      TAIL.forEach((back, i) => {
        const s = s0 - back
        const r = radiusAt(s)
        const theta = w + turned(r)
        const x = Math.round(CX + r * Math.cos(theta))
        const y = Math.round(CY + (r * Math.sin(theta)) / ASPECT)
        if (x < BOX.x0 || x > BOX.x1 || y < BOX.y0 || y > BOX.y1) return
        if (y >= BAND.from && y <= BAND.to) return
        // It joins the disc at its rim and is lost in it.
        if (r < rimAt(theta) + 1) return
        const fade = Math.max(0.25, Math.min(1, (44 - r) / 22))
        const at = y * COLS + x
        const lv = Math.max(1, Math.min(4, Math.round((TAIL_LEVEL[i] ?? 1) * fade * bright)))
        if ((cells[at] ?? 0) < lv) cells[at] = lv
      })
    }
  }
}

/** Frame k (already wrapped), as ramp indices row by row. */
function build(k: number): string[] {
  const cells = new Uint8Array(COLS * ROWS)
  stream(cells, k)
  for (let y = BOX.y0; y <= BOX.y1; y += 1) {
    const isBand = y >= BAND.from && y <= BAND.to
    for (let x = BOX.x0; x <= BOX.x1; x += 1) {
      const dx = x - CX
      const dyw = (y - CY) * ASPECT
      const r = Math.hypot(dx, dyw)
      let v = ringAt(dx, dyw, r, k)
      if (isBand) v = Math.max(v, bandAt(dx, y - CY, k))
      else v = Math.max(v, discAt(dx, dyw, r, k))
      const at = y * COLS + x
      if (v > (cells[at] ?? 0)) cells[at] = v
    }
  }
  const rows: string[] = []
  for (let y = 0; y < ROWS; y += 1) {
    let row = ''
    for (let x = 0; x < COLS; x += 1) row += RAMP[cells[y * COLS + x] ?? 0] ?? ' '
    rows.push(row)
  }
  return rows
}

const made: (string[] | undefined)[] = []

/** Frame i of the loop: ROWS strings of COLS characters; i is read as floor(i), wrapped. */
export function frame(i: number): string[] {
  const n = Number.isFinite(i) ? Math.floor(i) : 0
  const k = ((n % FRAMES) + FRAMES) % FRAMES
  let rows = made[k]
  if (!rows) {
    rows = build(k)
    made[k] = rows
  }
  return rows.slice()
}
