// Tests for the black hole wallpaper's field: hooks/wallpapers/blackhole/field.ts (pure, no engine imports, never
// throws). The file moved from hooks/blackhole/field.ts with the rebuild; its contents are as they were.
//
// THE CONTRACT these tests pin (written before the code; the builder works to it):
//
//   COLS: number                  the grid's width in characters, 80 to 140.
//   ROWS: number                  the grid's height in rows, 36 to 70.
//   RAMP: string | string[]       the characters, dimmest first. RAMP[0] is a space (not lit); at least 8,
//                                 all different, printable ASCII, none of  < > & " '  or a backslash.
//   FRAMES: number                frames in one loop, 12 to 48.
//   frame(i: number): string[]    frame i as ROWS strings of exactly COLS characters, all from RAMP. Pure:
//                                 the same i gives equal frames, and the caller may change what it gets.
//                                 frame(i + FRAMES) equals frame(i); i is read as floor(i), wrapped, so
//                                 frame(-1) is the last frame and frame(2.7) is frame(2). Never throws, even
//                                 for NaN or Infinity (those give some valid frame).
//   GEOMETRY: {                   where things are, in cells. A cell at column x, row y lies at
//     cx, cy,                       dx = x - cx   and   dy = (y - cy) * aspect   (both in cell widths)
//     aspect,                     from the hole's centre, at a distance r = hypot(dx, dy) cell widths.
//     shadow,                     aspect: the height of one cell divided by its width (1 to 3).
//     ring,                       shadow: nothing is lit closer than this, the band's rows apart.
//     band: { from, to }          ring: the radius of the thin bright ring round the shadow.
//   }                             band: the rows (from..to, both included) the disc's front band may cross.
//   flowAt(r): { inward, turn }   how far a lit feature at radius r moves inward (cell widths per frame) and
//                                 turns (radians per frame, the direction is the picture's own).
//
// A cell is "lit" when its character is in RAMP but not RAMP[0]. "The band's rows apart" means: the cells in
// GEOMETRY.band's rows are left out of that check.
//
// Why a failing test says what it does now: the field does not exist yet, so this whole file fails to load
// ("the file did not load"). A hooks module can only be imported with a plain import declaration, so a
// missing module cannot be caught inside a test; each new module has its own test file for that reason.
import { expect, test } from 'claude-code/testing'

import { COLS, FRAMES, GEOMETRY, RAMP, ROWS, flowAt, frame } from '../hooks/wallpapers/blackhole/field'

const ramp: string[] = [...(RAMP as unknown as string)]
const idx = (ch: string | undefined): number => ramp.indexOf(ch ?? ' ')
const isLit = (ch: string | undefined): boolean => idx(ch) > 0
const { cx, cy, aspect, shadow, ring, band } = GEOMETRY
const inBand = (y: number): boolean => y >= band.from && y <= band.to

type Cell = { x: number; y: number; r: number; angle: number; dx: number; dyw: number; index: number }
/** The lit cells of a frame, each with its place round the centre. */
const litCells = (f: string[]): Cell[] => {
  const out: Cell[] = []
  for (let y = 0; y < ROWS; y += 1) {
    const row = f[y] ?? ''
    for (let x = 0; x < COLS; x += 1) {
      const index = idx(row[x])
      if (index <= 0) continue
      const dx = x - cx
      const dyw = (y - cy) * aspect
      out.push({ x, y, r: Math.hypot(dx, dyw), angle: Math.atan2(dyw, dx), dx, dyw, index })
    }
  }
  return out
}

let made: string[][] | undefined
/** Every frame of the loop, built once. */
const all = (): string[][] => (made ??= Array.from({ length: FRAMES }, (_, i) => frame(i)))

test('the grid, the ramp and the loop are the size the contract says', () => {
  expect(Number.isInteger(COLS) && COLS >= 80 && COLS <= 140).toBe(true)
  expect(Number.isInteger(ROWS) && ROWS >= 36 && ROWS <= 70).toBe(true)
  expect(Number.isInteger(FRAMES) && FRAMES >= 12 && FRAMES <= 48).toBe(true)
  expect(ramp.length >= 8).toBe(true)
  expect(ramp[0]).toBe(' ')
  expect(ramp.every(c => c.length === 1)).toBe(true)
  expect(new Set(ramp).size).toBe(ramp.length)
  for (const c of ramp) {
    const code = c.charCodeAt(0)
    expect(code >= 0x20 && code <= 0x7e).toBe(true)
    expect('<>&"\'\\'.includes(c)).toBe(false)
  }
})

test('every frame is ROWS strings of COLS characters, all from the ramp', () => {
  for (const f of all()) {
    expect(Array.isArray(f)).toBe(true)
    expect(f.length).toBe(ROWS)
    for (const row of f) {
      expect(typeof row).toBe('string')
      expect(row.length).toBe(COLS)
      for (const ch of row) expect(ramp.includes(ch)).toBe(true)
    }
  }
})

test('frame is pure, loops, reads a negative or fractional i as its floor, and never throws', () => {
  const same = (a: string[], b: string[]): void => expect(a.join('\n') === b.join('\n')).toBe(true)
  for (const i of [0, 1, 5, FRAMES - 1]) {
    same(frame(i), frame(i))
    same(frame(i + FRAMES), frame(i))
    same(frame(i + 3 * FRAMES), frame(i))
  }
  same(frame(-1), frame(FRAMES - 1))
  same(frame(-FRAMES - 3), frame(FRAMES - 3))
  same(frame(2.7), frame(2))
  same(frame(FRAMES + 0.9), frame(0))
  same(frame(-0.5), frame(FRAMES - 1))
  same(frame(-2.2), frame(FRAMES - 3))

  // What the caller gets is its own: changing it leaves the next frame alone.
  const before = frame(0).join('\n')
  const mine = frame(0)
  mine[0] = 'x'.repeat(COLS)
  mine.length = 0
  expect(frame(0).join('\n')).toBe(before)

  // Odd input gives some valid frame, never a throw.
  for (const odd of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e15, -1e15, 0.1, -0]) {
    const f = frame(odd)
    expect(f.length).toBe(ROWS)
    expect(f.every(row => row.length === COLS)).toBe(true)
  }
})

test('GEOMETRY puts a hole, a ring and a thin band inside the grid', () => {
  for (const v of [cx, cy, aspect, shadow, ring, band.from, band.to]) expect(Number.isFinite(v)).toBe(true)
  expect(cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS).toBe(true)
  expect(aspect >= 1 && aspect <= 3).toBe(true)
  // A dark centre of some size, and a ring that is round it, not inside it.
  expect(shadow >= 2).toBe(true)
  expect(ring >= shadow).toBe(true)
  // The band is a few rows, inside the grid, and crosses the hole (not a strip far from it).
  expect(band.from >= 0 && band.to <= ROWS - 1 && band.from <= band.to).toBe(true)
  expect(band.to - band.from + 1 <= 0.25 * ROWS).toBe(true)
  expect(band.from <= cy + ring / aspect && band.to >= cy - ring / aspect).toBe(true)
})

test('nothing is lit inside the shadow (less one cell), except in the band rows, on every frame', () => {
  for (const [i, f] of all().entries()) {
    const inside = litCells(f).filter(c => !inBand(c.y) && c.r < shadow - 1)
    expect(inside.map(c => `frame ${i} (${c.x},${c.y})`)).toEqual([])
  }
})

test('a thin bright ring is lit all round the centre, except where the band crosses it, on every frame', () => {
  // 16 directions; one is left out when the ring's point in that direction falls in a band row.
  const directions = Array.from({ length: 16 }, (_, k) => (k * 2 * Math.PI) / 16).filter(
    a => !inBand(Math.round(cy + (ring * Math.sin(a)) / aspect)),
  )
  expect(directions.length >= 10).toBe(true)
  const half = Math.PI / 16 + 1e-9
  const apart = (a: number, b: number): number => {
    const d = Math.abs(a - b) % (2 * Math.PI)
    return Math.min(d, 2 * Math.PI - d)
  }
  for (const [i, f] of all().entries()) {
    const near = litCells(f).filter(c => !inBand(c.y) && Math.abs(c.r - ring) <= 1.5)
    const bare = directions.filter(a => !near.some(c => apart(c.angle, a) <= half))
    expect(bare.map(a => `frame ${i}: no ring at ${Math.round((a * 180) / Math.PI)} degrees`)).toEqual([])
  }
})

test('the far side of the disc is bent into lit arcs above and below the hole, outside the ring, on every frame', () => {
  for (const [i, f] of all().entries()) {
    const out = litCells(f).filter(c => !inBand(c.y) && c.r > ring + 1.5)
    // Straight above or below: within 45 degrees of the vertical.
    const above = out.filter(c => c.dyw < 0 && Math.abs(c.dx) <= -c.dyw).length
    const below = out.filter(c => c.dyw > 0 && Math.abs(c.dx) <= c.dyw).length
    expect([i, above >= 8]).toEqual([i, true])
    expect([i, below >= 8]).toEqual([i, true])
  }
})

test('the front band runs across the hole on every frame, and over all frames its left half is brighter', () => {
  let left = 0
  let right = 0
  let leftCells = 0
  let rightCells = 0
  for (const [i, f] of all().entries()) {
    const cells = litCells(f).filter(c => inBand(c.y))
    // It passes in front of the hole and reaches out beyond the ring on both sides.
    expect([i, cells.filter(c => c.dx < -ring).length >= 3]).toEqual([i, true])
    expect([i, cells.filter(c => c.dx > ring).length >= 3]).toEqual([i, true])
    for (let y = band.from; y <= band.to; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const v = idx(f[y]?.[x])
        if (x < cx) { left += v; leftCells += 1 } else if (x > cx) { right += v; rightCells += 1 }
      }
    }
  }
  expect(leftCells > 0 && rightCells > 0).toBe(true)
  // Mean RAMP index per cell of each half of the band's rows.
  expect(left / leftCells > right / rightCells).toBe(true)
})

test('everything lit fits one box, at most 45% of the width and 75% of the height, centred on the grid', () => {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const f of all()) {
    for (const c of litCells(f)) {
      minX = Math.min(minX, c.x)
      maxX = Math.max(maxX, c.x)
      minY = Math.min(minY, c.y)
      maxY = Math.max(maxY, c.y)
    }
  }
  expect(Number.isFinite(minX)).toBe(true)
  expect(maxX - minX + 1 <= 0.45 * COLS).toBe(true)
  expect(maxY - minY + 1 <= 0.75 * ROWS).toBe(true)
  expect(Math.abs((minX + maxX) / 2 - (COLS - 1) / 2) <= 3).toBe(true)
  expect(Math.abs((minY + maxY) / 2 - (ROWS - 1) / 2) <= 3).toBe(true)
})

test('it moves without flashing: each frame differs from the next, loop end included, in 3% to 60% of the lit cells', () => {
  const frames = all()
  for (let i = 0; i < FRAMES; i += 1) {
    const a = frames[i] ?? []
    const b = frames[(i + 1) % FRAMES] ?? []
    let differ = 0
    let either = 0
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const p = a[y]?.[x]
        const q = b[y]?.[x]
        if (isLit(p) || isLit(q)) either += 1
        if (p !== q) differ += 1
      }
    }
    expect(either > 0).toBe(true)
    const share = differ / either
    expect([i, share >= 0.03 && share <= 0.6]).toEqual([i, true])
  }
})

// The disc's edge: the farthest any lit character is from the centre, over the loop.
const edge = (): number => Math.max(...all().flatMap(f => litCells(f).map(c => c.r)))

test('flowAt: inward and turn are above 0 from the ring to the disc edge, larger at the ring, and never grow with r', () => {
  const far = edge()
  expect(far > ring + 3).toBe(true)
  const steps = 40
  const at = (j: number): number => ring + ((far - ring) * j) / steps
  for (const key of ['inward', 'turn'] as const) {
    let last = Infinity
    for (let j = 0; j <= steps; j += 1) {
      const v = flowAt(at(j))[key]
      expect([key, j, Number.isFinite(v) && v > 0]).toEqual([key, j, true])
      expect([key, j, v <= last + 1e-9]).toEqual([key, j, true])
      last = v
    }
    expect(flowAt(ring)[key] > flowAt(far)[key]).toBe(true)
  }
})

test('flowAt never throws and always gives numbers', () => {
  for (const r of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -5, 0, 1e-9, 1e9]) {
    const f = flowAt(r)
    expect(typeof f.inward).toBe('number')
    expect(typeof f.turn).toBe('number')
  }
})

test('the lit characters travel inward as flowAt says: the frames follow the flow forwards better than backwards', () => {
  // How well a frame, carried one step by the flow, lands on the lit cells of the next. Carried inward
  // (the claim) against carried outward (the flow played backwards); the turn is tried both ways round
  // for each, as its direction is the picture's own. The same frames played in reverse order score
  // lower inward than outward, so a field that moves outward fails this.
  const frames = all()
  const far = edge()
  const score = (list: string[][], way: 1 | -1, twist: 1 | -1): number => {
    let hit = 0
    let total = 0
    for (let i = 0; i < FRAMES; i += 1) {
      const next = list[(i + 1) % FRAMES] ?? []
      for (const c of litCells(list[i] ?? [])) {
        // The disc's body: off the ring, off the edge and out of the band's rows.
        if (inBand(c.y) || c.r < ring + 2 || c.r > far - 2) continue
        const f = flowAt(c.r)
        const r = c.r - way * f.inward
        const a = c.angle + twist * way * f.turn
        const x = Math.round(cx + r * Math.cos(a))
        const y = Math.round(cy + (r * Math.sin(a)) / aspect)
        total += 1
        if (isLit(next[y]?.[x]) && !inBand(y)) hit += 1
      }
    }
    return total === 0 ? Number.NaN : hit / total
  }
  const edgeOver = (list: string[][]): number =>
    Math.max(score(list, 1, 1), score(list, 1, -1)) - Math.max(score(list, -1, 1), score(list, -1, -1))
  const played = edgeOver(frames)
  expect(Number.isFinite(played)).toBe(true)
  expect(played > 0.05).toBe(true)
})
