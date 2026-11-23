// Traces small pictures into plain vector shapes. Pure: pixels in, one SVG out.
// No `$`, no JSX, no DOM, no Node APIs, so a preview script can import it too.
//
// The app does not draw a picture file placed inside a scene, so a picture or a
// video of your own is redrawn the way the pixel valley is drawn: as runs of
// flat color. The pixels arrive already cut down to a few dozen colors. A slight
// blur softens the steps between the pixels.

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`
const colorAt = (rgb: Uint8Array, i: number): number => ((rgb[i * 3] ?? 0) << 16) | ((rgb[i * 3 + 1] ?? 0) << 8) | (rgb[i * 3 + 2] ?? 0)

// No shape-rendering="crispEdges": the desktop app stops animating any picture
// that sets it (see ./kiki.ts), and a video's loop has to move.
const open = (w: number, h: number, style: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice">` +
  (style ? `<style>${style}</style>` : '') +
  `<defs><filter id="soft" x="-2%" y="-2%" width="104%" height="104%"><feGaussianBlur stdDeviation="0.55"/></filter></defs>`

/**
 * One frame as stroked runs over a ground of its commonest color. Colors are
 * painted largest area first, and each later color's strokes may run across
 * pixels that a still later color will cover, which joins many short runs into
 * few long ones.
 */
function still(rgb: Uint8Array, w: number, h: number): { ground: string; paths: string } {
  const n = w * h
  const seen = new Map<number, number>()
  const colors: number[] = []
  const counts: number[] = []
  const first = new Int32Array(n)
  for (let i = 0; i < n; i += 1) {
    const c = colorAt(rgb, i)
    let k = seen.get(c)
    if (k === undefined) {
      k = colors.length
      seen.set(c, k)
      colors.push(c)
      counts.push(0)
    }
    first[i] = k
    counts[k] = (counts[k] ?? 0) + 1
  }
  const order = colors.map((_, k) => k).sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || a - b)
  const rankOf = new Int32Array(colors.length)
  order.forEach((k, r) => { rankOf[k] = r })
  const rank = new Int32Array(n)
  for (let i = 0; i < n; i += 1) rank[i] = rankOf[first[i] ?? 0] ?? 0

  let paths = ''
  for (let r = 1; r < order.length; r += 1) {
    let d = ''
    let cx = 0
    let cy = 0
    for (let y = 0; y < h; y += 1) {
      const row = y * w
      let x = 0
      while (x < w) {
        if (rank[row + x] !== r) { x += 1; continue }
        // A run starts on this color and may cross anything painted later; it ends on this color.
        let end = x
        let reach = x + 1
        while (reach < w && (rank[row + reach] ?? 0) >= r) {
          if (rank[row + reach] === r) end = reach
          reach += 1
        }
        const len = end - x + 1
        d += d === '' ? `M${x} ${y}h${len}` : `m${x - cx} ${y - cy}h${len}`
        cx = x + len
        cy = y
        x = end + 1
      }
    }
    if (d !== '') paths += `<path stroke="${hex(colors[order[r] ?? 0] ?? 0)}" d="${d}"/>`
  }
  return { ground: hex(colors[order[0] ?? 0] ?? 0), paths }
}

/** What changed from one frame to the next, as runs in the new frame's colors. */
function change(before: Uint8Array, after: Uint8Array, w: number, h: number): string {
  const runs = new Map<number, { d: string; cx: number; cy: number }>()
  for (let y = 0; y < h; y += 1) {
    const row = y * w
    let x = 0
    while (x < w) {
      const c = colorAt(after, row + x)
      if (c === colorAt(before, row + x)) { x += 1; continue }
      // A run may cross pixels that already have its color; it ends on one that changed.
      let end = x
      let reach = x + 1
      while (reach < w && colorAt(after, row + reach) === c) {
        if (colorAt(before, row + reach) !== c) end = reach
        reach += 1
      }
      const len = end - x + 1
      const run = runs.get(c) ?? { d: '', cx: 0, cy: 0 }
      run.d += run.d === '' ? `M${x} ${y}h${len}` : `m${x - run.cx} ${y - run.cy}h${len}`
      run.cx = x + len
      run.cy = y
      runs.set(c, run)
      x = end + 1
    }
  }
  let out = ''
  for (const [c, run] of runs) out += `<path stroke="${hex(c)}" d="${run.d}"/>`
  return out
}

// Strokes one pixel tall, a touch thicker so no hairline shows between rows.
const STROKES = '<g filter="url(#soft)" fill="none" stroke-width="1.2" transform="translate(0 .5)">'

/** The pixels of an RGB picture (3 bytes each, row by row) as one SVG that fills the window. */
export function trace(rgb: Uint8Array, w: number, h: number): string {
  const { ground, paths } = still(rgb, w, h)
  return `${open(w, h, '')}<rect width="${w}" height="${h}" fill="${ground}"/>${STROKES}${paths}</g></svg>`
}

/**
 * Several frames, one after another in `rgb`, as one SVG that plays them
 * forwards and then backwards, so the loop has no jump. The first frame is drawn
 * whole; each later one is only what changed since the frame before, laid over
 * it and shown from its turn until the loop comes back past it.
 */
export function traceLoop(rgb: Uint8Array, w: number, h: number, frames: number, fps: number): string {
  const size = w * h * 3
  const frame = (k: number): Uint8Array => rgb.subarray(k * size, (k + 1) * size)
  const { ground, paths } = still(frame(0), w, h)
  const slots = 2 * (frames - 1)
  const at = (slot: number): string => `${Math.round((slot * 10000) / slots) / 100}%`
  let style = ''
  let layers = ''
  for (let k = 1; k < frames; k += 1) {
    const changed = change(frame(k - 1), frame(k), w, h)
    if (changed === '') continue
    style += `.d${k}{opacity:0;animation:d${k} ${slots / fps}s steps(1) infinite}@keyframes d${k}{0%{opacity:0}${at(k)}{opacity:1}${at(slots - k + 1)}{opacity:0}}`
    layers += `<g class="d${k}">${changed}</g>`
  }
  if (style !== '') style += '@media (prefers-reduced-motion: reduce){g{animation:none!important}}'
  return `${open(w, h, style)}<rect width="${w}" height="${h}" fill="${ground}"/>${STROKES}${paths}${layers}</g></svg>`
}
