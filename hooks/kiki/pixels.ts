// Pixel buffers as vector shapes on the art grid (one unit a pixel). The scene
// is filled rectangles, one path a colour, painted in order: the colour with the
// most pixels first, and each colour's rectangles may run across pixels of the
// colours painted after it, which then cover them. So a band of sky is one
// rectangle under its stars, not hundreds of short runs between them, and the
// whole scene fits in the one picture the app keeps moving.
// Filled rectangles are the cheapest shape to paint; the stroked runs used
// before (dashed for dither) were far too slow to repaint as the scene moved,
// and the app draws no image placed inside a picture, so PNG art is out too.
// Pure: no `$`, no DOM, no Node APIs, so a preview script can import it too.

/** A pixel buffer: `d[y * w + x]` is a colour key, or a negative number for clear. */
export type PixelBuf = { w: number; h: number; d: Int32Array }

type Box = { x: number; y: number; w: number; h: number }
/** A rectangle still growing down the rows; `last` is the last row it had to cover. */
type Open = Box & { last: number }
/** A row's stretch of pixels a colour may paint, and the ones it must. */
type Span = { s: number; e: number; must: number[] }

/**
 * The painted pixels of `b` as filled rectangles, one path a colour, at `ox`,
 * `oy` in the parent's units; '' when nothing is painted. `hexOf` maps a
 * pixel's key to its colour ('rrggbb', with or without '#'). Every pixel ends
 * its own colour: no rectangle touches a clear pixel or a pixel of a colour
 * painted before its own. Every edge falls on a whole unit. No crispEdges
 * (../kiki.ts says why): the edges are smoothed, which only shows when the
 * picture is scaled by a fraction.
 */
export function bufArt(b: PixelBuf, hexOf: (key: number) => string, ox = 0, oy = 0): string {
  const n = b.w * b.h
  const name = new Map<number, string>()
  const count = new Map<string, number>()
  const first = new Map<string, number>()
  const hexAt: (string | undefined)[] = new Array<string | undefined>(n)
  for (let i = 0; i < n; i += 1) {
    const key = b.d[i] ?? -1
    if (key < 0) continue
    let c = name.get(key)
    if (c === undefined) {
      c = hexOf(key).replace(/^#/, '').toLowerCase()
      name.set(key, c)
    }
    hexAt[i] = c
    count.set(c, (count.get(c) ?? 0) + 1)
    if (!first.has(c)) first.set(c, i)
  }
  // most pixels first; a tie goes to the colour met first
  const order = [...count.keys()].sort(
    (p, q) => (count.get(q) ?? 0) - (count.get(p) ?? 0) || (first.get(p) ?? 0) - (first.get(q) ?? 0),
  )
  const rankOf = new Map(order.map((c, i) => [c, i] as const))
  const rank = new Int32Array(n).fill(-1)
  for (let i = 0; i < n; i += 1) {
    const c = hexAt[i]
    if (c !== undefined) rank[i] = rankOf.get(c) ?? -1
  }
  let out = ''
  order.forEach((c, k) => {
    const boxes = cover(rank, b.w, b.h, k)
    if (boxes.length > 0) out += `<path fill="#${c}" d="${pathOf(boxes, ox, oy)}"/>`
  })
  return out
}

/**
 * Rectangles over every pixel ranked `k`, on pixels ranked `k` or later only.
 * Row by row: a rectangle from the row above carries on down while its whole
 * width may be painted; pixels it leaves bare start a new one, as wide as the
 * row allows (so the next rows can carry it on too) unless one already carries
 * on there. A rectangle ends at the last row that needed it.
 */
function cover(rank: Int32Array, w: number, h: number, k: number): Box[] {
  const ended: Open[] = []
  let open: Open[] = []
  for (let y = 0; y < h; y += 1) {
    const row = y * w
    const spans: Span[] = []
    for (let x = 0; x < w; ) {
      if ((rank[row + x] ?? -1) < k) {
        x += 1
        continue
      }
      const s = x
      const must: number[] = []
      while (x < w && (rank[row + x] ?? -1) >= k) {
        if (rank[row + x] === k) must.push(x)
        x += 1
      }
      spans.push({ s, e: x, must })
    }
    const next: Open[] = []
    const covered = new Set<number>()
    for (const box of open) {
      const span = spans.find(sp => sp.s <= box.x && box.x + box.w <= sp.e)
      if (span === undefined) {
        ended.push(box)
        continue
      }
      box.h += 1
      for (const x of span.must) {
        if (x >= box.x && x < box.x + box.w) {
          covered.add(x)
          box.last = y
        }
      }
      next.push(box)
    }
    for (const span of spans) {
      const bare = span.must.filter(x => !covered.has(x))
      const lo = bare[0]
      const hi = bare[bare.length - 1]
      if (lo === undefined || hi === undefined) continue
      const carried = next.some(box => box.y < y && span.s <= box.x && box.x + box.w <= span.e)
      const x0 = carried ? lo : span.s
      const x1 = carried ? hi + 1 : span.e
      next.push({ x: x0, y, w: x1 - x0, h: 1, last: y })
    }
    open = next
  }
  ended.push(...open)
  return ended
    .map(box => ({ x: box.x, y: box.y, w: box.w, h: box.last - box.y + 1 }))
    .sort((p, q) => p.y - q.y || p.x - q.x)
}

/** Rectangles as one path; relative moves: after `z` the pen is back at the corner it started from. */
function pathOf(list: Box[], ox: number, oy: number): string {
  let d = ''
  let px = 0
  let py = 0
  list.forEach((r, i) => {
    const x = ox + r.x
    const y = oy + r.y
    d += i === 0 ? `M${x} ${y}` : `m${x - px} ${y - py}`
    d += `h${r.w}v${r.h}h${-r.w}z`
    px = x
    py = y
  })
  return d
}
