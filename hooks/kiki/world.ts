// The world of the Kiki wallpaper, in pixel art: a dithered sky, a tall
// cumulus and a low cloud bank on the horizon, small round clouds drifting, a
// calm sea with stepped wavelets, and a seaside town on a hill with a clock
// tower, a harbour and a lighthouse on its rocks. The same drawing is palette-swapped for day,
// sunset and night. No characters (hero.ts draws those over `back`).
//
// One unit of the 320 x 180 viewBox is one art pixel. Everything is painted into
// role buffers (each pixel holds a colour ROLE, not a colour), and the roles are
// mapped to the phase's hex values only when the buffer is written out, as
// filled rectangles (./pixels). Motion is either a smooth drift (CSS translate) or frames
// (groups toggled with stepped visibility, frame 0 visible in the base state),
// all of it inside the camera's slow bob (see the camera, at the end).
//
// Pure and deterministic: scatter comes from a seeded generator, so the same Ask
// always gives the same markup. Ids, classes and @keyframes all start with `w-`.
// When `ask.still` is set there is no CSS and no SMIL, and the markup equals the
// animated version's base state (frame 0 everywhere, motion-only things left out).
import { bufArt } from './pixels'
import type { Ask, World } from './types'

const W = 320
const H = 180
const HZ = 112 // first row of the sea

// ----------------------------------------------------------------- palette
// role: [day, sunset, night]
const PAL = {
  // Roles share hex values within a phase on purpose: each phase keeps to a
  // small palette (about 30 colours) while every pixel keeps its role.
  // sky bands, top to horizon, and the haze line
  s0: ['3f6fd6', '2e2f6b', '070a1f'],
  s1: ['4f86e6', '5b3f86', '0c1233'],
  s2: ['63a0f2', 'a4527f', '0e1640'],
  s3: ['7db8f8', 'e0705e', '141c4a'],
  s4: ['92c6fa', 'f6a35a', '212a63'],
  s5: ['a3d3fb', 'ffd27f', '2f3474'],
  hz: ['c3dcf7', 'ffe0a0', '3a4688'],
  // stars and sparkles
  st0: ['ffffff', 'fff1b5', 'f6edc4'],
  st1: ['e6f3ff', 'ffd3a0', '8e96d8'],
  st2: ['a3d3fb', '7e5a8e', '4b56a0'],
  // sun (sunset) or moon (night): core, mid, edge, glow
  o0: ['fff1b5', 'fff1b5', 'f6edc4'],
  o1: ['ffd67a', 'ffd67a', 'dcd2a6'],
  o2: ['ff9f5a', 'ff9f5a', 'b3ab88'],
  og0: ['ffe0a0', 'ffe0a0', '3a4688'],
  og1: ['ffd67a', 'ffd67a', '2e3a7a'],
  // clouds: moon-near rim, rim, light to deep (night: lavender rims, as moonlit
  // cumulus read in a cozy night; the body a step lighter than the sky behind)
  cM: ['ffffff', 'ffe0a0', 'c9b3e3'],
  cR: ['ffffff', 'ffe0a0', '8f86c9'],
  c0: ['ffffff', 'ffd3a0', '5b5ea0'],
  c1: ['e6f3ff', 'f7a982', '474b8a'],
  c2: ['c3dcf7', 'c97a8c', '363b74'],
  c3: ['98bdeb', '7e5a8e', '272c5f'],
  c4: ['7da7e2', '4e4677', '1d2250'],
  // the big cumulus: highlight, lit body, body, shade, deep shade. By day white
  // with a lavender-grey shade, greyer than the sky so the underside still
  // reads; at sunset rose and mauve under golden edges toward the sun; at night
  // moonlit lavender over a dusky body
  qH: ['ffffff', 'ffe0a0', 'c9b3e3'],
  qL: ['eef5ff', 'ffb48a', '8f86c9'],
  qB: ['d6e2f6', 'd98a8c', '5b5ea0'],
  qS: ['b9c3e6', 'a4527f', '474b8a'],
  qD: ['9fa9d6', '7e5a8e', '363b74'],
  // sea bands, trough, crests, reflection, glitter
  w0: ['5a96ea', '5b4a8e', '0e1640'],
  w1: ['4b88e0', '4f4285', '0c1233'],
  w2: ['3f7ad8', '43397a', '0a1032'],
  w3: ['2f62c4', '2f2a5c', '070a1f'],
  wD: ['2b58b4', '2c2544', '05081c'],
  wC: ['e0f2ff', 'c97a8c', '4b56a0'],
  wC2: ['a3d3fb', '7e5a8e', '212a63'],
  wR: ['7db8f8', '3e3358', '141c4a'],
  wG: ['ffffff', 'ffe0a0', 'dcd2a6'],
  wG2: ['c3dcf7', 'f2a06a', '8e96d8'],
  // town
  k0: ['f4e6cc', '4a3d66', '1b2150'],
  k1: ['e2c8a0', '4a3d66', '1b2150'],
  kS: ['b89a7c', '3e3358', '141a40'],
  rR: ['d9573f', '573a5c', '262a5c'],
  rRs: ['b5413a', '3e3358', '212a63'],
  rB: ['5f86c0', '4e4677', '262a5c'],
  rBs: ['4a6aa8', '3e3358', '1b2150'],
  win: ['34477a', '2c2544', '0c1233'],
  h0: ['79a85c', '3e3358', '141a40'],
  h1: ['5d8a4a', '2f2a5c', '10153a'],
  hD: ['456f3c', '2c2544', '0c1233'],
  rim: ['f4e6cc', 'f2a06a', '3a4688'],
  clk: ['ffffff', 'ffd27f', 'ffd27a'],
  lit: ['ffd27a', 'ffd27f', 'ffd27a'],
  lit2: ['ffb85c', 'f6a35a', 'ffb85c'],
  lgl: ['7a5a3a', 'a4527f', '7a5a3a'],
  // lighthouse
  lw: ['ffffff', '4a3d66', 'd8d4e6'],
  lwS: ['c3dcf7', '3e3358', '8e96d8'],
  lr: ['d9573f', '573a5c', '8f3a4c'],
  lrS: ['b5413a', '3e3358', '6c2c40'],
  lamp: ['a3d3fb', 'ffd27f', 'f6edc4'],
  // the rocks the lighthouse stands on: lit top, face, and the waterline (by
  // day a warm brown-grey, darker than the cloud's shade behind them)
  rk0: ['9c8670', '6e5470', '2e3570'],
  rk1: ['6f5f55', '3e3358', '1b2150'],
  rk2: ['463b3e', '2c2544', '10153a'],
  // boats
  bh: ['b5413a', '3e3358', '1b2150'],
  bhS: ['7e3036', '2c2544', '10153a'],
  bc: ['f4e6cc', '4a3d66', '262a5c'],
  bm: ['34477a', '2c2544', '0c1233'],
  // gulls, airship, wind, smoke, beam, lanterns
  g0: ['ffffff', '3e3358', '1b2150'],
  g1: ['98bdeb', '2c2544', '141a40'],
  // airship: lit top, envelope, belly band, fins, gondola, its window
  a0: ['f4e6cc', 'f2a06a', '3a4688'],
  a1: ['e2c8a0', '573a5c', '262a5c'],
  a2: ['b89a7c', '3e3358', '1b2150'],
  af: ['d9573f', '2c2544', '8f3a4c'],
  ag: ['34477a', '2c2544', '0c1233'],
  aw: ['e2c8a0', 'ffd27f', 'ffd27a'],
  wi: ['ffffff', 'ffe0a0', '8e96d8'],
  // a gust's fainter tail end, and a gust breaking up
  wi2: ['e6f3ff', 'ffd3a0', '4b56a0'],
  sm0: ['e6f3ff', 'c97a8c', '2a3270'],
  sm1: ['c3dcf7', '7e5a8e', '212a63'],
  bm0: ['fff1b5', 'fff1b5', 'f6edc4'],
  bm1: ['ffd67a', 'ffd67a', 'ffd27a'],
  ln0: ['34477a', 'ffd27f', 'ffd27a'],
  ln1: ['34477a', 'e0705e', '7a5a3a'],
} as const satisfies Record<string, readonly [string, string, string]>

type Role = keyof typeof PAL
const ROLES = Object.keys(PAL) as Role[]
const R = {} as Record<Role, number>
ROLES.forEach((r, i) => { R[r] = i })

// ------------------------------------------------------------------ pixels

// A buffer reaches PX columns and PY rows past each edge of the picture: the
// camera bobs the world up and down (see the camera below), so the sky and the
// sea are drawn on past the top and bottom edges, and no empty edge shows
// (with "slice" a window narrower than 16:9 shows the top and bottom rows in
// full). The cloud range sways out past the sides into the extra columns.
// Only what is painted there costs any markup.
const PX = 4
const PY = 4
/** `px`, `py`: how far the buffer reaches past the left and top edges. */
type Buf = { w: number; h: number; px: number; py: number; d: Int32Array }
const NONE = -1

const buf = (): Buf => ({ w: W + 2 * PX, h: H + 2 * PY, px: PX, py: PY, d: new Int32Array((W + 2 * PX) * (H + 2 * PY)).fill(NONE) })
const put = (b: Buf, x: number, y: number, c: number): void => {
  const i = x + b.px
  const j = y + b.py
  if (i >= 0 && j >= 0 && i < b.w && j < b.h) b.d[j * b.w + i] = c
}
/** put, wrapping x around the picture's width (for the drifting cloud strips). */
const putW = (b: Buf, x: number, y: number, c: number): void => put(b, ((x % W) + W) % W, y, c)
const at = (b: Buf, x: number, y: number): number => {
  const i = x + b.px
  const j = y + b.py
  return i >= 0 && j >= 0 && i < b.w && j < b.h ? b.d[j * b.w + i] ?? NONE : NONE
}
const rect = (b: Buf, x: number, y: number, w: number, h: number, c: number): void => {
  for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) put(b, x + i, y + j, c)
}
const disc = (b: Buf, cx: number, cy: number, r: number, c: number): void => {
  for (let y = -r; y <= r; y += 1) for (let x = -r; x <= r; x += 1) if (x * x + y * y <= r * r + r * 0.6) put(b, cx + x, cy + y, c)
}
/** Fills a polygon, row by row. */
const poly = (b: Buf, pts: readonly (readonly [number, number])[], c: number): void => {
  const ys = pts.map(p => p[1])
  for (let y = Math.min(...ys); y <= Math.max(...ys); y += 1) {
    const xs: number[] = []
    pts.forEach(([ax, ay], i) => {
      const [bx, by] = pts[(i + 1) % pts.length] ?? [ax, ay]
      if (ay === by) return
      if (y >= Math.min(ay, by) && y < Math.max(ay, by)) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay))
    })
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.round(xs[k] ?? 0); x <= Math.round(xs[k + 1] ?? 0); x += 1) put(b, x, y, c)
  }
}
/** Rows of letters, each letter a role of `map`; any other character is left clear. */
const art = (b: Buf, x: number, y: number, rows: readonly string[], map: Record<string, number>): void => {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i += 1) {
      const c = map[row[i] ?? '']
      if (c !== undefined) put(b, x + i, y + j, c)
    }
  })
}
/** Copies every set pixel of `src` over `dst`. */
const over = (dst: Buf, src: Buf): void => {
  for (let i = 0; i < src.d.length; i += 1) { const c = src.d[i] ?? NONE; if (c !== NONE) dst.d[i] = c }
}
// The same scatter every time: a small linear congruential generator.
const lcg = (seed: number): (() => number) => {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}
// 4 x 4 ordered dither: th(x, y) < density places the pixel.
const BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
const th = (x: number, y: number): number => ((BAY[(y & 3) * 4 + (x & 3)] ?? 0) + 0.5) / 16
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))
/** A glow ring: inner and outer radius, role, dither density. */
type Ring = readonly [number, number, number, number]
/** A dithered ring between radius r0 and r1 at the given density. */
const ring = (b: Buf, cx: number, cy: number, r0: number, r1: number, c: number, dens: number): void => {
  const e = Math.ceil(r1)
  for (let y = -e; y <= e; y += 1) {
    for (let x = -e; x <= e; x += 1) {
      const d = Math.sqrt(x * x + y * y)
      if (d <= r0 || d > r1 + 0.3 || th(cx + x, cy + y) >= dens) continue
      put(b, cx + x, cy + y, c)
    }
  }
}

// ----------------------------------------------------------------- writing

/**
 * A buffer as filled rectangles on the pixel grid (roles mapped to the phase's
 * hex); in a group carrying `attrs` when there are any. See ./pixels for why.
 */
const grp = (b: Buf, pi: number, attrs = ''): string => {
  const s = bufArt(b, r => PAL[ROLES[r] ?? 's0'][pi] ?? '000000', -b.px, -b.py)
  return s === '' ? '' : attrs === '' ? s : `<g${attrs}>${s}</g>`
}

const n2 = (v: number): string => String(Math.round(v * 100) / 100)
const sec = (v: number): string => `${n2(v)}s`

// ------------------------------------------------------------------ clouds

/** A round puff: centre x, centre y, radius. */
type Puff = readonly [number, number, number]

/**
 * A cumulus standing on the horizon: round puffs of very different sizes,
 * given back first, the upper ones behind and the lower ones in front, so the
 * lit caps of the nearer puffs overlap the ones behind and the heads read as
 * heaped, like a cauliflower. Five tones: qH highlight, qL lit body, qB body,
 * qS shade, qD deep shade. `light` is the direction the light comes from (x
 * right, y down). The outline toward the light catches the highlight. No sky
 * is left shut inside, and the base thins into the haze over the last rows
 * above the horizon. `far` keeps a distant bank softer: no shade darker than
 * the body, and the highlight on its outline only.
 */
function cumulus(b: Buf, puffs: readonly Puff[], light: readonly [number, number], far = false): void {
  const x0 = Math.floor(Math.min(...puffs.map(p => p[0] - p[2]))) - 1
  const x1 = Math.ceil(Math.max(...puffs.map(p => p[0] + p[2]))) + 1
  const y0 = Math.floor(Math.min(...puffs.map(p => p[1] - p[2]))) - 1
  const cw = x1 - x0 + 1
  // rows y0 to the horizon: the sea covers the rest
  const own = new Int32Array(cw * (HZ - y0)).fill(-1)
  const idx = (x: number, y: number): number => (x < x0 || x > x1 || y < y0 || y >= HZ ? -1 : (y - y0) * cw + (x - x0))
  const ownAt = (x: number, y: number): number => { const i = idx(x, y); return i < 0 ? -1 : own[i] ?? -1 }
  // which puff a pixel shows: the nearest one holding it
  puffs.forEach(([cx, cy, r], k) => {
    for (let y = y0; y < HZ; y += 1) for (let x = x0; x <= x1; x += 1) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + r * 0.6) own[idx(x, y)] = k
  })
  // no sky shut inside: what the open sky around cannot reach is cloud too,
  // shown by the puff whose edge is nearest
  const open = new Uint8Array(own.length)
  const todo: number[] = []
  const reach = (x: number, y: number): void => {
    const i = idx(x, y)
    if (i < 0 || open[i] === 1 || (own[i] ?? -1) !== -1) return
    open[i] = 1
    todo.push(i)
  }
  for (let x = x0; x <= x1; x += 1) reach(x, y0)
  for (let y = y0; y < HZ; y += 1) { reach(x0, y); reach(x1, y) }
  while (todo.length > 0) {
    const i = todo.pop() ?? 0
    const x = x0 + (i % cw)
    const y = y0 + Math.floor(i / cw)
    reach(x - 1, y); reach(x + 1, y); reach(x, y - 1); reach(x, y + 1)
  }
  for (let i = 0; i < own.length; i += 1) {
    if ((own[i] ?? -1) !== -1 || open[i] === 1) continue
    const x = x0 + (i % cw)
    const y = y0 + Math.floor(i / cw)
    let best = 0
    let gap = Infinity
    puffs.forEach(([cx, cy, r], k) => { const d = Math.hypot(x - cx, y - cy) - r; if (d < gap) { gap = d; best = k } })
    own[i] = best
  }
  let mTop = HZ
  for (let i = 0; i < own.length; i += 1) if ((own[i] ?? -1) !== -1) { mTop = y0 + Math.floor(i / cw); break }
  // the light, as a unit direction in the picture (x right, y down)
  const ln = Math.hypot(light[0], light[1]) || 1
  const lx = light[0] / ln
  const ly = light[1] / ln
  // inside the cloud, or the sea under it (so its foot has no lit edge)
  const solid = (x: number, y: number): boolean => (y >= HZ ? x >= x0 && x <= x1 : ownAt(x, y) !== -1)
  /** How many cloud pixels lie from (x, y) away from the light before the sky, up to 8. */
  const away = (x: number, y: number): number => {
    let d = 0
    while (d < 8 && solid(Math.round(x - lx * (d + 1)), Math.round(y - ly * (d + 1)))) d += 1
    return d
  }
  const T = [R.qH, R.qL, R.qB, R.qS, R.qD] as const
  for (let y = y0; y < HZ; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const k = ownAt(x, y)
      const p = puffs[k]
      if (p === undefined) continue
      // Each puff shows a lit cap on its side toward the light over the body
      // tone (the caps of the nearer puffs, overlapping, are what make the
      // heads read as heaped). The dark tones come from the mass as a whole
      // only: a band along its side away from the light, wider lower down,
      // and its base (each puff shaded dark on its own far side read as a
      // bunch of balloons; a dark line or hollow along each puff's edge, as
      // bubbles drawn in outline or as drips).
      const v = clamp((y - mTop) / Math.max(1, HZ - 1 - mTop), 0, 1)
      const e = away(x, y) + (th(x, y) - 0.5) * 0.9
      let g = 0
      if (e < 1.5 + 2.5 * v) g = 1
      if (e < 0.8 + 1.5 * v && v > 0.3) g = 2
      if (v + (th(x, y) - 0.5) * 0.06 > 0.88) g = Math.max(g, 1)
      if (!far && v > 0.7 && e < 1.5) g = 3
      const lit = ((x + 0.5 - p[0]) * lx + (y + 0.5 - p[1]) * ly) / p[2] + (th(x, y) - 0.5) * 0.16
      const cap = lit > 0.7 ? 0 : lit > 0.15 ? 1 : 2
      // the outline toward the light catches it
      const sx = Math.sign(lx)
      const outline = !solid(x, y - 1) || (!solid(x + sx, y) && Math.abs(lx) > 0.3)
      let t = Math.max(far ? Math.max(1, cap) : cap, 1 + Math.min(far ? 1 : 3, g))
      if (outline && lit > 0.2 && g < 2) t = 0
      // the base thins into the haze, gone by the horizon
      if (y >= HZ - 4 && th(x, y) < (y - HZ + 5) / 5) continue
      put(b, x, y, T[t] ?? R.qB)
    }
  }
}

// ------------------------------------------------------------------ the scene

export function world(ask: Ask): World {
  const pi = ask.phase === 'day' ? 0 : ask.phase === 'sunset' ? 1 : 2
  const still = ask.still
  const day = pi === 0
  const dusk = pi === 1
  const night = pi === 2
  // the lighter moving scene's switches (./types Light; all off: nothing changes)
  const lt = ask.light ?? {}
  const stillBeam = lt.stillBeam === true
  const stillShoot = lt.stillShoot === true
  const stillCam = lt.stillCam === true

  // ---- CSS bookkeeping
  const css: string[] = []
  const kfs = new Set<string>()
  const key = (name: string, body: string): void => {
    if (kfs.has(name)) return
    kfs.add(name)
    css.push(`@keyframes ${name}{${body}}`)
  }
  let uid = 0
  const classes = new Map<string, string>()
  /** A class carrying one animation rule (one class per distinct rule). */
  const cls = (rule: string): string => {
    const had = classes.get(rule)
    if (had !== undefined) return had
    uid += 1
    const c = `w-${uid.toString(36)}`
    classes.set(rule, c)
    css.push(`.${c}{animation:${rule}}`)
    return c
  }
  /**
   * Frames toggled by stepped visibility: frame 0 is the base state. Each frame
   * has its own keyframes over the whole period with no delay, so the end of
   * frame k and the start of frame k + 1 are the same percentage: exactly one
   * frame shows at any moment, with no gap and no overlap.
   */
  const pct = (k: number, n: number): string => (k >= n ? '100%' : `${n2((100 * k) / n)}%`)
  const frames = (bodies: readonly string[], period: number): string => {
    if (still) return bodies[0] ?? ''
    const n = bodies.length
    return bodies.map((s, k) => {
      const name = `w-f${n}-${k}`
      const end = k + 1 >= n ? '100%{visibility:hidden}' : `${pct(k + 1, n)},100%{visibility:hidden}`
      key(name, k === 0 ? `0%{visibility:visible}${end}` : `0%{visibility:hidden}${pct(k, n)}{visibility:visible}${end}`)
      return `<g class="${cls(`${name} ${sec(period)} step-end infinite`)}"${k > 0 ? ' visibility="hidden"' : ''}>${s}</g>`
    }).join('')
  }
  /**
   * A group with one animation (a plain group when still; nothing if it only
   * shows in motion, which its hidden base state marks). Motion is transforms
   * and stepped visibility only, never opacity: a fading group is painted
   * through a layer of its own on every frame, which the app cannot keep up.
   */
  const moving = (inner: string, rule: string, attrs = ''): string =>
    still ? (attrs.includes('visibility="hidden"') ? '' : `<g${attrs}>${inner}</g>`) : `<g class="${cls(rule)}"${attrs}>${inner}</g>`

  // ================================================================ sky
  const A = buf()
  const SKYR = [R.s0, R.s1, R.s2, R.s3, R.s4, R.s5, R.hz]
  const SKYB = [16, 36, 58, 80, 97, 108]
  /** Banded rows with `rows` dithered rows (ordered dither) between bands. */
  const band = (y: number, bounds: readonly number[], roles: readonly number[], x: number, rows = 3): number => {
    let v = 0
    let fr = 0
    for (const bk of bounds) {
      const f = clamp((y - bk + 2) / (rows + 1), 0, 1)
      if (f >= 1) v += 1
      else if (f > 0) fr = f
    }
    return roles[v + (th(x, y) < fr ? 1 : 0)] ?? roles[roles.length - 1] ?? 0
  }
  // The sky runs on past the top edge (the camera's overscan) and a few rows
  // under the sea's first row: the sea bobs a pixel further than the sky (the
  // parallax), so the sky must be there when the horizon drops.
  for (let y = -PY; y < HZ + 3; y += 1) for (let x = 0; x < W; x += 1) put(A, x, y, band(y, SKYB, SKYR, x))
  // faint cirrus wisps in the upper sky, one band lighter than where they sit
  for (const [wx, wy, wl] of [[18, 10, 34], [96, 6, 22], [196, 12, 40], [250, 20, 26], [60, 27, 18], [214, 40, 24], [150, 30, 14]] as const) {
    const under = band(wy, SKYB, SKYR, wx)
    const lighter = SKYR[SKYR.indexOf(under) + 1] ?? under
    for (let i = 0; i < wl; i += 1) {
      const edge = i < 3 || i > wl - 4
      if (!edge || th(wx + i, wy) < 0.5) put(A, wx + i, wy, lighter)
      if (i > 4 && i < wl - 8 && (!(i < 7 || i > wl - 11) || th(wx + i, wy + 1) < 0.5)) put(A, wx + i + 3, wy + 1, lighter)
    }
  }

  // stars (sunset: a few at the top; night: a field) and the moon or sun
  const MOON = [255, 28] as const
  const SUN = [240, 100] as const
  const twinkle: [number, number, number][] = [] // x, y, big: the bright twinkling ones
  // Every other star twinkles too, in field groups (see twinkles below): none
  // is painted into the still sky, so the whole field shimmers.
  const field: [number, number, number][] = [] // x, y, role
  if (night || dusk) {
    const count = night ? 150 : 26
    const maxY = night ? 104 : 24
    const sr = lcg(77)
    for (let i = 0; i < count; i += 1) {
      const x = Math.floor(sr() * W)
      const y = Math.floor(Math.pow(sr(), night ? 1.5 : 1) * maxY)
      const k = sr()
      if (night && Math.hypot(x - MOON[0], y - MOON[1]) < 17) continue
      if (i % 9 === 0 && twinkle.length < (night ? 18 : 5)) { twinkle.push([x, y, k > 0.6 ? 1 : 0]); continue }
      field.push([x, y, k > 0.93 ? R.st0 : k > 0.65 ? R.st1 : R.st2])
    }
  }
  // the moon's glow (drawn in steps: the still sky holds the narrowest halo,
  // and the glow breathes out over it; see halos below)
  const MOONG: Ring[] = [[10.6, 12, R.og1, 0.5], [8.6, 10.6, R.og1, 1], [7, 8.6, R.og0, 1]]
  const SUNG: Ring[] = [[21, 22.4, R.s5, 0.5], [18.4, 21, R.s5, 1], [17.2, 18.4, R.og1, 0.5], [15.4, 17.2, R.og1, 1], [14.4, 15.4, R.og0, 0.5], [13, 14.4, R.og0, 1]]
  if (night) {
    // glow: two solid rings and one 50% seam into the sky
    for (const [r0, r1, c, d] of MOONG) ring(A, MOON[0], MOON[1], r0, r1, c, d)
    disc(A, MOON[0], MOON[1], 7, R.o0)
    // the shaded left limb as a solid crescent, and a few soft maria
    for (let y = -7; y <= 7; y += 1) {
      for (let x = -7; x < 0; x += 1) {
        if (x * x + y * y > 49 + 4.2) continue
        if ((x - 1.7) * (x - 1.7) + y * y > 49 + 4.2) put(A, MOON[0] + x, MOON[1] + y, R.o1)
      }
    }
    art(A, MOON[0] - 3, MOON[1] - 3, ['.xx....', 'xxx..x.', '.x...xx', '.......', '..x....', '.xxx...'], { x: R.o1 })
    rect(A, MOON[0] + 2, MOON[1] + 3, 2, 1, R.o2)
  }
  if (dusk) {
    // glow: three solid rings, each joined to the next by a one-row 50% seam
    for (const [r0, r1, c, d] of SUNG) ring(A, SUN[0], SUN[1], r0, r1, c, d)
    disc(A, SUN[0], SUN[1], 13, R.o0)
  }

  // ================================================================ sea base
  // The sea, the town and its reflection are one buffer (N), drawn over the
  // cloud range; the sky (A) lies under both. No long column of glitter under
  // the sun or moon: it read as a stripe painted down the picture. The water
  // keeps its own light: the crests, the quay windows' reflections, a few
  // glints scattered over it, and a few broken dashes right under the sun or
  // moon, close to the horizon (see the sea's frames).
  const N = buf()
  const SEAR = [R.w0, R.w1, R.w2, R.w3]
  const SEAB = [120, 134, 152]
  // on past the bottom edge, for the camera's overscan
  for (let y = HZ; y < H + PY; y += 1) for (let x = 0; x < W; x += 1) put(N, x, y, band(y, SEAB, SEAR, x, 2))
  // a lighter seam just under the horizon
  for (let x = 0; x < W; x += 1) if (th(x, HZ) < 0.5) put(N, x, HZ, R.wC2)

  // ================================================================ town
  const C = buf() // the town alone (for rims and reflections)
  // hill
  poly(C, [[146, 112], [152, 105], [160, 97], [170, 90], [180, 85], [187, 82], [196, 82], [203, 85], [208, 90], [213, 96], [219, 101], [232, 104], [250, 105], [262, 108], [267, 112]], R.h0)
  for (let y = 80; y < HZ; y += 1) for (let x = 146; x < 200; x += 1) if (at(C, x, y) === R.h0 && th(x, y) < clamp((182 - x) / 18, 0, 1)) put(C, x, y, R.h1)
  // trees on the hill: round clumps and cypresses
  const tr = lcg(5)
  for (let i = 0; i < 26; i += 1) {
    const x = 150 + Math.floor(tr() * 80)
    let y = 80
    while (y < HZ && at(C, x, y) === NONE) y += 1
    if (y >= HZ - 2) continue
    if (tr() < 0.35) art(C, x, y - 6, ['.a.', 'ab.', 'ab.', 'abb', 'abb', 'abb', '.b.'], { a: R.hD, b: R.h1 })
    else art(C, x - 1, y - 2, ['.bc.', 'abcc', 'aabb'], { a: R.hD, b: R.h1, c: R.h0 })
  }

  type Win = { x: number; y: number; h: number; g: number; front: boolean }
  const wins: Win[] = []
  const chimneys: [number, number][] = []
  let hcount = 0
  const house = (x: number, base: number, w: number, h: number, roof: 'g' | 'h' | 'f', blue: boolean, chim: boolean, front: boolean): void => {
    const top = base - h
    const wall = hcount % 3 === 1 ? R.k1 : R.k0
    rect(C, x, top, w, h, wall)
    rect(C, x, top, 1, h, R.kS)
    rect(C, x + 1, top, w - 1, 1, wall === R.k0 ? R.k1 : R.kS)
    const g = hcount % 9
    hcount += 1
    for (let wy = top + 2; wy < base - 1; wy += 3) {
      for (let wx = x + 2; wx < x + w - 1; wx += 2) {
        const tall = wy + 2 < base - 1 && w > 6
        put(C, wx, wy, R.win)
        if (tall) put(C, wx, wy + 1, R.win)
        wins.push({ x: wx, y: wy, h: tall ? 2 : 1, g, front })
      }
    }
    const ra = blue ? R.rB : R.rR
    const rs = blue ? R.rBs : R.rRs
    let peak = top - 1
    if (roof === 'g') {
      const ph = Math.min(4, Math.ceil(w / 2))
      for (let i = 0; i < ph; i += 1) {
        const l = x - 1 + i
        const r = x + w - i
        if (l > r) break
        for (let xx = l; xx <= r; xx += 1) put(C, xx, top - 1 - i, xx >= (x + x + w - 1) / 2 ? ra : rs)
        peak = top - 1 - i
      }
    } else if (roof === 'h') {
      rect(C, x - 1, top - 1, w + 2, 1, rs)
      rect(C, x, top - 2, w, 1, ra)
      rect(C, x + 1, top - 3, w - 2, 1, ra)
      put(C, x, top - 2, rs)
      peak = top - 3
    } else {
      rect(C, x - 1, top - 1, w + 2, 1, rs)
      rect(C, x, top - 2, w, 1, ra)
      peak = top - 2
    }
    if (chim) {
      const cx = x + w - 2
      rect(C, cx, peak - 2, 1, 3, R.kS)
      put(C, cx + 1, peak - 2, R.k1)
      chimneys.push([cx, peak - 3])
    }
  }
  // terraces, back to front
  const hr = lcg(31)
  const row = (x0: number, x1: number, base: number, hmin: number, hmax: number, front: boolean): void => {
    let x = x0
    while (x < x1) {
      const w = 5 + Math.floor(hr() * 5)
      if (x + w > x1 + 2) break
      const h = hmin + Math.floor(hr() * (hmax - hmin + 1))
      const k = hr()
      house(x, base, w, h, k < 0.45 ? 'g' : k < 0.85 ? 'h' : 'f', hr() < 0.32, hr() < 0.3, front)
      x += w + (hr() < 0.35 ? 2 + Math.floor(hr() * 3) : 1)
    }
  }
  row(170, 186, 89, 6, 8, false)
  row(195, 210, 90, 5, 7, false)
  // the clock tower on the hilltop
  rect(C, 187, 63, 7, 26, R.k0)
  rect(C, 187, 63, 2, 26, R.kS)
  rect(C, 189, 63, 1, 26, R.k1)
  rect(C, 186, 63, 9, 1, R.k1)
  rect(C, 186, 76, 9, 1, R.k1)
  art(C, 188, 65, ['.ccc.', 'ccccc', 'ccwcc', 'cccwc', '.ccc.'], { c: R.clk, w: R.win })
  art(C, 188, 72, ['.w.w.', '.w.w.'], { w: R.win })
  art(C, 186, 54, ['....w....', '....a....', '...ba....', '...ba....', '..bbaa...', '..bbaa...', '..bbaaa..', '.bbbaaa..', 'bbbbaaaa.'], { a: R.rB, b: R.rBs, w: R.win })
  row(158, 222, 96, 6, 8, false)
  row(152, 230, 102, 6, 8, false)
  row(150, 214, 108, 6, 9, true)
  // harbour warehouses on the quay
  house(215, 108, 11, 6, 'h', false, false, true)
  house(228, 108, 8, 7, 'g', true, true, true)
  house(238, 108, 12, 5, 'h', false, false, true)
  house(252, 108, 7, 6, 'g', false, true, true)
  // quay wall
  rect(C, 146, 108, 112, 4, R.kS)
  rect(C, 146, 108, 112, 1, R.k1)
  for (let x = 148; x < 256; x += 6) put(C, x, 110, R.win)
  // The lighthouse stands at the quay's right end (further left it sat right
  // behind the broom's bristles, where Kiki flies), on a rocky outcrop the
  // quay runs into, set on a stone plinth: before, it stood on nothing, four
  // rows above a thin pier. The outcrop is a heap of boulders, back to front,
  // each lit on top and on its upper right, its face shaded, down into the water.
  // Two flat tones on the stones (lit top, shaded face) and a dark waterline
  // row; they stop a row above the sea's first crests, which would slide
  // across them.
  const boulder = (cx: number, cy: number, r: number): void => {
    for (let y = cy - r; y <= Math.min(cy + r, HZ + 1); y += 1) {
      for (let x = cx - r - 1; x <= cx + r + 1; x += 1) {
        // a little wider than tall: a worn stone
        const nx = (x - cx) / (r + 1)
        const ny = (y - cy) / r
        if (nx * nx + ny * ny > 1.05) continue
        put(C, x, y, y === HZ + 1 ? R.rk2 : nx - ny > 0.75 || ny < -0.35 ? R.rk0 : R.rk1)
      }
    }
  }
  for (const [cx, cy, r] of [[265, 110, 4], [258, 111, 3], [272, 110, 3], [252, 113, 2], [277, 112, 2], [262, 113, 2], [269, 113, 2], [282, 114, 1]] as const) boulder(cx, cy, r)
  // the plinth: two courses of dressed stone, a pixel wider than the tower's
  // foot each side, and a step at its foot; lit along the top
  rect(C, 260, 105, 10, 2, R.kS)
  rect(C, 260, 105, 10, 1, R.k1)
  rect(C, 259, 107, 12, 1, R.kS)
  // the lighthouse on the pier
  art(C, 261, 80, [
    '...ab...',
    '..aabb..',
    '.aaabbb.',
    '..LppL..',
    '..LppL..',
    '.gggggg.',
    '..SWWW..',
    '..SWWW..',
    '..SRRR..',
    '..SRRR..',
    '..SWWW..',
    '..SWWW..',
    '..SWWW..',
    '..SRRR..',
    '..SRRR..',
    '.SSWWWW.',
    '.SSWWWW.',
    '.SSWWWW.',
    '.SSRRRR.',
    '.SSRRRR.',
    '.SSWWWW.',
    '.SSWWWW.',
    '.SSWdWW.',
    '.SSWdWW.',
    'SSSSSSSS',
  ], { a: R.lrS, b: R.lr, L: R.win, p: R.lamp, g: R.win, S: R.lwS, W: R.lw, R: R.lr, d: R.win })
  // the shaded side of the red bands
  for (let y = 88; y < 104; y += 1) for (let x = 262; x < 266; x += 1) if (at(C, x, y) === R.lwS && (at(C, x + 2, y) === R.lr || at(C, x + 3, y) === R.lr)) put(C, x, y, R.lrS)
  const LAMP = [264, 84] as const
  // sunset and night: rims on the edges facing the light
  if (!day) {
    const T = buf()
    for (let y = 50; y < HZ; y += 1) {
      for (let x = 130; x < 284; x += 1) {
        const c = at(C, x, y)
        if (c === NONE || c === R.win || c === R.clk || c === R.lamp) continue
        const up = at(C, x, y - 1) === NONE
        const side = night ? at(C, x + 1, y) === NONE : (x < SUN[0] ? at(C, x + 1, y) === NONE : at(C, x - 1, y) === NONE) && Math.abs(x - SUN[0]) < 40
        if (up || (side && y < 108)) put(T, x, y, R.rim)
      }
    }
    over(C, T)
  }
  // sunset: a few windows already lit
  if (dusk) {
    const lr = lcg(12)
    for (const w of wins) if (lr() < 0.22) rect(C, w.x, w.y, 1, w.h, lr() < 0.5 ? R.lit : R.lit2)
  }
  over(N, C)
  // the town's broken reflection under the quay
  // (calm: whole rows alternate with sparse ones and the image thins out with depth)
  const darkRef = day ? R.w2 : R.wD
  for (let k = 0; k < 10; k += 1) {
    const y = HZ + k
    const sy = HZ - 1 - k * 2
    const shift = [0, 1, 0, -1][k % 4] ?? 0
    for (let x = 130; x < 268; x += 1) {
      const c = at(C, x + shift, sy)
      // (never over the rocks' own feet in the water)
      if (c === NONE || at(C, x, y) !== NONE) continue
      if (k % 2 === 1 && th(x, y) > 0.3) continue
      if (th(x + 2, y + 1) < k / 13) continue
      const light = c === R.k0 || c === R.k1 || c === R.lw || c === R.clk || c === R.rim
      put(N, x, y, light ? R.wR : darkRef)
    }
  }
  // a lick of foam where the water meets the rocks: drawn over the crests
  // (with the moored boats), so a passing crest never covers it
  const FOAM = buf()
  {
    const xs: number[] = []
    for (let x = 240; x < 292; x += 1) if (at(C, x, HZ + 1) === R.rk2) xs.push(x)
    const [xl = 250, xr = 284] = [xs[0], xs[xs.length - 1]]
    put(FOAM, xl - 1, HZ + 1, R.wC)
    put(FOAM, xl + 1, HZ + 2, R.wC)
    put(FOAM, xr + 1, HZ + 1, R.wC)
    put(FOAM, xr - 2, HZ + 2, R.wC)
  }
  // moored boats floating in front of the quay (hulls on the first sea rows)
  const MB = buf()
  for (const x of [218, 242]) {
    art(MB, x, 103, ['...m....', '...m....', '...m....', '...ms...', '...mss..', '...msss.', '...m....', '...m....', '..cc....', 'hhhhhhhh', '.HHHHHH.'], { m: R.bm, s: R.bc, c: R.bc, h: R.bh, H: R.bhS })
    rect(MB, x + 2, 114, 5, 1, R.wD)
  }

  // ================================================================ the cloud range
  // One tall cumulus on the horizon behind the lighthouse, heaped like a
  // cauliflower, and a low, distant bank on the left horizon. Behind Kiki the
  // sky is open down to the bank, well clear of her lantern and the cat as the
  // camera bobs (a big head behind her read as a wall she flew in front of),
  // and the two never mirror each other like curtains. Over the setting sun,
  // between the town and the tall head, the sky stays open.
  const moon = night ? MOON : undefined
  const SRC = night ? MOON : dusk ? SUN : null
  /** The light at a cloud: from upper right by day, from the sun or moon otherwise (and a little from above). */
  const lightAt = (x: number, y: number): readonly [number, number] => {
    if (!SRC) return [0.55, -0.75]
    const dx = SRC[0] - x
    const dy = SRC[1] - y
    const d = Math.hypot(dx, dy) || 1
    return [dx / d, dy / d - 0.55]
  }
  // each in a buffer of its own, so each sways on its own (the bank out to the
  // left, away from Kiki, the tall head to the right)
  const BL = buf()
  const BR = buf()
  // the bank: three low heads with small bumps on top, lower toward Kiki,
  // ending well left of her lantern
  cumulus(BL, [
    [0, 90, 3], [9, 89, 4], [25, 86, 4], [35, 87, 3], [47, 94, 3], [58, 97, 3],
    [4, 95, 7], [30, 91, 7], [53, 99, 5],
    [-6, 100, 8], [13, 100, 8], [22, 98, 6], [40, 99, 7], [62, 104, 5],
    [-2, 109, 9], [18, 109, 9], [37, 109, 9], [55, 110, 8], [70, 112, 6],
  ], lightAt(30, 90), true)
  // the tall head: a crown of small heads, then rows of bigger puffs down to a
  // broad base, each row in front of the one above it
  cumulus(BR, [
    [298, 56, 5], [290, 61, 4], [307, 60, 5], [316, 67, 4],
    [295, 66, 8], [308, 70, 7],
    [286, 76, 7], [301, 79, 11], [319, 79, 7],
    [281, 89, 7], [296, 92, 12], [318, 90, 9],
    [277, 102, 6], [289, 103, 8], [309, 103, 11], [331, 104, 9],
  ], lightAt(298, 70))

  // ================================================================ drifting cloud strips
  // Small cumulus, round all over: a wide oval body whose underside curves
  // down to the middle and up to rounded ends (never cut flat), with two
  // round bumps on top set well apart, so each shows (closer, they merged
  // into one loaf-like dome), and sometimes a small third at the end; or a
  // wide soft cloud, long and low, with a row of small bumps. Single-pixel
  // nubs are trimmed off. Shaded by the silhouette: the lit body, a one-pixel
  // rim along the whole lit top, the mid tone along the curved underside and
  // on the end away from the light, the shade on the underside's last rows.
  // Few, varied and unevenly spaced (an even row of near-equal clouds read as
  // polka dots). Both strips keep clear of the moon: the far one above its
  // glow, the near one below it.
  const small = (b: Buf, x: number, y: number, s: number, far: boolean, wide = false): void => {
    const j = lcg(x * 7 + y)
    const k = (): number => (j() - 0.5) * 0.24 * s
    const ex = x + k() * 0.5
    const ea = s * (wide ? 3.4 + j() * 0.4 : 1.9 + j() * 0.4)
    const eb = Math.max(2.8, s * (wide ? 0.62 : 0.85))
    // the oval's lowest row sits 0.4 px inside its edge, so that row is about
    // half as wide as the body and the underside rounds off (on a whole row
    // it came out nearly as wide: flat)
    const ey = Math.round(y + s * 0.2 + eb) + 0.4 - eb
    const bumps: Puff[] = wide
      ? [-2.2, -0.9, 0.5, 1.8].map((f, i) => [x + f * s + k(), y + s * (i % 2 === 0 ? 0.05 : -0.2), s * (i % 2 === 0 ? 0.6 : 0.72)] as const)
      : [
          [x - s * 0.8 + k() * 0.5, y - s * 0.4, s * 0.72],
          [x + s * 0.65 + k() * 0.5, y - s * 0.62, s * 0.86],
          ...(j() < 0.5 ? [[x + s * 1.55 + k() * 0.5, y + s * 0.05, s * 0.5] as const] : []),
        ]
    const inBump = (xx: number, yy: number): boolean => bumps.some(([cx, cy, r]) => (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r + r * 0.4)
    const y0 = Math.floor(y - s * 1.8)
    const y1 = Math.ceil(ey + eb) + 1
    const x0 = Math.floor(ex - ea - 1)
    const x1 = Math.ceil(ex + ea + 1)
    const cw = x1 - x0 + 1
    const M = new Uint8Array(cw * (y1 - y0 + 1))
    const ins = (xx: number, yy: number): boolean => xx >= x0 && xx <= x1 && yy >= y0 && yy <= y1 && M[(yy - y0) * cw + xx - x0] === 1
    for (let yy = y0; yy <= y1; yy += 1) for (let xx = x0; xx <= x1; xx += 1) if (((xx - ex) / ea) ** 2 + ((yy - ey) / eb) ** 2 <= 1 || inBump(xx, yy)) M[(yy - y0) * cw + xx - x0] = 1
    // trim nubs: a pixel with no neighbour on one side of its row, or of its column, both
    for (let pass = 0; pass < 2; pass += 1) {
      for (let yy = y0; yy <= y1; yy += 1) {
        for (let xx = x0; xx <= x1; xx += 1) {
          if (ins(xx, yy) && ((!ins(xx - 1, yy) && !ins(xx + 1, yy)) || (!ins(xx, yy - 1) && !ins(xx, yy + 1)))) M[(yy - y0) * cw + xx - x0] = 0
        }
      }
    }
    const T = far ? [R.c0, R.c1, R.c2] : [R.c0, R.c1, R.c2, R.c3]
    const [lx] = lightAt(x, y)
    const toward = lx >= 0 ? 1 : -1
    for (let yy = y0; yy <= y1; yy += 1) {
      for (let xx = x0; xx <= x1; xx += 1) {
        if (!ins(xx, yy)) continue
        let db = 0
        while (db < 9 && ins(xx, yy + db + 1)) db += 1
        const away = !ins(xx - toward, yy) || !ins(xx - toward * 2, yy)
        let c = T[0] ?? R.c0
        if (db === 0) c = T[T.length - 1] ?? c
        else if (db === 1 && !far) c = R.c2
        else if (db <= s * 0.4 || (away && db <= s * 0.9)) c = R.c1
        // the rim: every top edge but the far end's, and the side toward the light
        const top = !ins(xx, yy - 1) && (xx - ex) * toward > -ea * 0.75
        const side = !ins(xx + toward, yy) && db > s * 0.4
        if (c === T[0] && (top || side)) c = moon && Math.hypot(xx - moon[0], yy - moon[1]) < 46 ? R.cM : R.cR
        putW(b, xx, yy, c)
      }
    }
  }
  // Placed by hand with a seeded jitter: x, y, size (and wide), so the
  // spacing is uneven but the same every time.
  const jit = lcg(919)
  const far = buf()
  for (const [fx, fy, s, wide] of [[22, 9, 2.6, false], [84, 10, 2.4, true], [176, 8, 3, false], [262, 10, 2.5, true]] as const) small(far, fx + Math.round((jit() - 0.5) * 10), fy, s, true, wide)
  const near = buf()
  for (const [nx, ny, s, wide] of [[36, 49, 6.5, false], [146, 51, 4.6, true], [236, 48, 6, false]] as const) small(near, nx + Math.round((jit() - 0.5) * 14), ny + Math.round((jit() - 0.5) * 3), s, false, wide)

  // ================================================================ sea
  const covered = (x: number, y: number): boolean => at(MB, x, y) !== NONE || at(C, x, y) !== NONE
  // The crests travel. Each band of rows is a strip that repeats every SP
  // pixels (drawn once more to the left of the picture), and it glides to the
  // right, the way the wind blows, at an even speed over one repeat and round
  // again with no jump at the wrap (the strip then sits where it started): the
  // far rows slowly, the near rows quicker, so the water has depth.
  // On top of the travel each crest keeps its own shimmer: in each of three
  // frames a third of them dims for a beat. In a row the crests sit about a
  // pitch apart (tight near the horizon, wide near the viewer), every other
  // row offset by half a pitch, with enough jitter that no grid shows.
  const SP = 64
  type Site = { x: number; y: number; l: number; p: number; far: boolean }
  const bands: Site[][] = [[], [], []]
  const sr2 = lcg(404)
  let rowi = 0
  for (let y = HZ + 2; y < H - 1; ) {
    const t = (y - HZ) / (H - HZ)
    const n = Math.max(1, Math.round(SP / (11 + t * 16)))
    const pitch = SP / n
    const off = ((rowi % 2) * pitch) / 2 + Math.floor(sr2() * 3)
    const band = bands[t < 0.28 ? 0 : t < 0.6 ? 1 : 2] ?? []
    for (let k = 0; k < n; k += 1) {
      const x = Math.round(off + k * pitch + (sr2() * 2 - 1) * pitch * 0.3)
      const l = (t < 0.25 ? 2 : Math.round(2 + t * 5)) + Math.floor(sr2() * (1 + t * 2))
      const skip = sr2() < 0.12
      if (!skip) band.push({ x: ((x % SP) + SP) % SP, y, l, p: Math.floor(sr2() * 3), far: t < 0.18 })
    }
    y += 2 + Math.round(t * 5)
    rowi += 1
  }
  // A band's crests, every copy across the picture plus one repeat to its
  // left:
  // `dimIn` < 0 gives the bright crests and their shadow row; 0..2 gives that
  // frame's dimmed third alone, laid over them.
  const crestArt = (sites: readonly Site[], dimIn: number): string => {
    const S: Buf = { w: W + SP, h: H, px: 0, py: 0, d: new Int32Array((W + SP) * H).fill(NONE) }
    for (const s of sites) {
      const bright = s.far ? R.wC2 : R.wC
      if (dimIn >= 0 && ((dimIn + s.p) % 3 !== 2 || bright === R.wC2)) continue
      for (let x = s.x - SP; x < W; x += SP) {
        if (x + s.l <= -SP) continue
        rect(S, x + SP, s.y, s.l, 1, dimIn >= 0 ? R.wC2 : bright)
        if (dimIn < 0 && s.l > 2) rect(S, x + SP + 1, s.y + 1, s.l - 1, 1, R.wD)
      }
    }
    return bufArt(S, r => PAL[ROLES[r] ?? 's0'][pi] ?? '000000', -SP, 0)
  }
  // far, middle, near: art pixels a second, the shimmer's period, and a delay
  // that keeps the bands from crossing a pixel on the same frame
  const BANDS = [[1.5, 2.1, -0.37], [2.5, 1.8, -0.11], [4, 1.5, 0]] as const
  let crestStill = ''
  let crestMove = ''
  bands.forEach((sites, b) => {
    const base = crestArt(sites, -1)
    const dims = [0, 1, 2].map(f => crestArt(sites, f))
    crestStill += base + (dims[0] ?? '')
    if (still) return
    const [speed, shimmer, delay] = BANDS[b] ?? [2.5, 1.8, 0]
    crestMove += moving(base + frames(dims, shimmer), `w-sw ${sec(SP / speed)} linear infinite${delay ? ` ${sec(delay)}` : ''}`)
  })
  if (!still) key('w-sw', `to{transform:translateX(${SP}px)}`)
  // In place over the travelling crests, three frames of sparkle: the warm
  // wobbling reflections of the quay windows at night, by day a few white
  // glints on the right, under the light, and at sunset and night a few
  // glints scattered over the whole water, a different handful each frame.
  const seaFrames: string[] = []
  for (let f = 0; f < 3; f += 1) {
    const S = buf()
    if (day) {
      const gr = lcg(66 + f * 29)
      for (let i = 0; i < 16; i += 1) {
        const x = 176 + Math.floor(gr() * (W - 176))
        const y = HZ + 3 + Math.floor(gr() * (H - HZ - 4))
        const l = 1 + Math.floor(gr() * 2)
        if (!covered(x, y) && !covered(x + l, y)) rect(S, x, y, l, 1, R.wG)
      }
    }
    if (!day) {
      const gr = lcg(55 + f * 17)
      for (let i = 0; i < 7; i += 1) {
        // spread over the width in sevenths, so no two land together
        const x = Math.floor(((i + gr()) * W) / 7)
        const y = HZ + 4 + Math.floor(gr() * (H - HZ - 6))
        const l = y > 140 ? 2 : 1
        if (!covered(x, y) && !covered(x + l, y)) rect(S, x, y, l, 1, gr() < 0.35 ? R.wG : R.wG2)
      }
    }
    // Under the moon, or the sun on the horizon, a few broken dashes of its
    // light on the first rows of the sea, a different few each frame, so the
    // light and the water belong together (no column: just these, close in).
    if (SRC) {
      const DASH = [[-4, 2, 3], [2, 3, 2], [-1, 4, 4], [4, 5, 2], [-6, 6, 2]] as const
      DASH.forEach(([dx, dy, l], i) => {
        if ((i + f) % 3 === 0) return
        const x = SRC[0] + dx - (l >> 1)
        const y = HZ + dy
        if (!covered(x, y) && !covered(x + l - 1, y)) rect(S, x, y, l, 1, i % 2 === 0 ? R.wG : R.wG2)
      })
    }
    // night: warm reflections of the quay windows, wobbling
    if (night) {
      for (const w of wins) {
        if (!w.front || (w.x * 5 + w.y) % 3 === 0) continue
        const ry = Math.round(HZ + 1 + (HZ - 1 - w.y) / 2)
        const wob = [0, 1, -1][(f + w.x) % 3] ?? 0
        rect(S, w.x + wob, ry, 1 + ((w.x + f) % 2), 1, (w.x + f) % 4 === 0 ? R.lit : R.lit2)
        if ((w.x + f) % 2 === 0) put(S, w.x - wob, ry + 2, R.lgl)
      }
    }
    seaFrames.push(grp(S, pi))
  }
  // the moored boats float over the travelling crests
  const moored = grp(MB, pi) + grp(FOAM, pi)

  // ================================================================ boats at sea
  const boatSmall = ['......m.......', '......m...l...', '......mqqq....', '......m.......', '...ccccm......', '...cwccm......', 'hhhhhhhhhhhhhh', '.HHHHHHHHHHHH.', '..HHHHHHHHHH..']
  const boatBig = [
    '........m.........',
    '........m.........',
    '........mqqqq.....',
    '........m...l.....',
    '........m.........',
    '....ccccm.........',
    '....cwwcm.........',
    '....ccccm.........',
    'hhhhhhhhhhhhhhhhhh',
    'hhhhhhhhhhhhhhhhhh',
    '.HHHHHHHHHHHHHHHH.',
    '..HHHHHHHHHHHHHH..',
  ]
  const boats: { x: number; y: number; a: readonly string[]; lx: number; ly: number }[] = [
    { x: 104, y: 116, a: boatSmall, lx: 114, ly: 117 },
    { x: 252, y: 137, a: boatBig, lx: 264, ly: 140 },
  ]
  let boatMarkup = ''
  boats.forEach((bt, i) => {
    const B = buf()
    const wide = (bt.a[0] ?? '').length
    art(B, bt.x, bt.y, bt.a, { m: R.bm, q: R.bm, c: R.bc, w: night || dusk ? R.lit : R.win, h: R.bh, H: R.bhS, l: R.ln0 })
    rect(B, bt.x + 2, bt.y + bt.a.length, wide - 4, 1, R.wD)
    if (!day) {
      // the light catches the gunwale
      const hr0 = bt.a.findIndex(r => r.startsWith('h'))
      rect(B, bt.x + 1, bt.y + hr0, wide - 2, 1, R.rim)
    }
    let inner = grp(B, pi)
    if (!day) {
      // the lantern's core burns steady; its glow (and the glow on the water) flickers
      const core = buf()
      const glow = buf()
      const lamp = { g: R.ln1, L: R.ln0 }
      const wy = bt.y + bt.a.length
      art(core, bt.lx - 1, bt.ly - 1, ['...', '.L.', '.L.', '...'], lamp)
      art(glow, bt.lx - 1, bt.ly - 1, ['.g.', 'g.g', 'g.g', '.g.'], lamp)
      art(core, bt.lx - 2, wy + 1, ['.LL.', '....', '..L.', '....', '....'], lamp)
      art(glow, bt.lx - 2, wy + 1, ['...g', 'gg..', '...g', '....', '.gg.'], lamp)
      inner += grp(core, pi) + moving(grp(glow, pi), `w-fl ${sec(2.3 + i * 0.8)} step-end infinite ${sec(-i * 0.9)}`)
    }
    boatMarkup += moving(inner, `w-bob ${sec(2.8 + i * 0.9)} step-end infinite ${sec(-i * 1.1)}`)
  })
  key('w-bob', '50%{transform:translateY(1px)}')
  key('w-fl', '0%{visibility:visible}30%{visibility:hidden}36%{visibility:visible}70%{visibility:hidden}73%{visibility:visible}')

  // ================================================================ windows (night)
  // the underlays are still (drawn with the town); the lit panes switch off and on
  let windowUnder = ''
  let windowLit = ''
  if (night) {
    const lr = lcg(3)
    const groups: Buf[] = []
    for (let g = 0; g < 9; g += 1) groups.push(buf())
    // a dimming group fades its lit windows down onto an opaque dim warm
    // underlay (lgl), so the low state is a palette colour, not lit-on-navy
    const under: Buf[] = []
    for (let g = 0; g < 9; g += 1) under.push(buf())
    for (const w of wins) {
      if (lr() < 0.3) continue
      const G = groups[w.g]
      const U = under[w.g]
      if (!G || !U) continue
      const c = lr() < 0.55 ? R.lit : R.lit2
      for (let j = 0; j < w.h; j += 1) {
        if (at(MB, w.x, w.y + j) !== NONE) continue // behind a moored boat's mast
        put(G, w.x, w.y + j, c)
        if (w.g % 3 !== 1) put(U, w.x, w.y + j, R.lgl)
      }
    }
    const periods = [7, 11, 9, 14, 6.5, 17, 12, 8.5, 19]
    groups.forEach((G, g) => {
      const kind = g % 3 === 1 ? 'w-off' : 'w-dim'
      windowUnder += grp(under[g] ?? buf(), pi)
      windowLit += moving(grp(G, pi), `${kind} ${sec(periods[g] ?? 9)} step-end infinite ${sec(-g * 2.7)}`)
    })
    // a dimming group drops to its warm underlay for a while; an off group goes dark
    key('w-dim', '0%{visibility:visible}45%{visibility:hidden}60%{visibility:visible}')
    key('w-off', '0%{visibility:visible}72%{visibility:hidden}92%{visibility:visible}')
  }

  // ================================================================ lighthouse beam (night)
  let beamMarkup = ''
  if (night) {
    const [lx, ly] = LAMP
    // A short beam, in light tones only: the long one (46 px, its tail
    // dithered with dark haze pixels) read as smoke drifting over the cloud.
    // A pale core line, a cone of the warm lamp tone around it, and a tip
    // that thins out in a pale lavender, then is gone.
    const wedge = (dir: number, len: number, wide: number): string => {
      const O = buf()
      for (let i = 1; i <= len; i += 1) {
        const f = i / len
        const hh = Math.round((i * wide) / len)
        const x = lx + dir * (i + 1)
        for (let dy = -hh; dy <= hh; dy += 1) {
          const edge = Math.abs(dy) === hh && hh > 1
          if (f > 0.6 || edge) {
            // the tip and the cone's edges thin out, lighter, row by row
            if (th(x, ly + dy) < 1.1 - f) put(O, x, ly + dy, R.cM)
          } else put(O, x, ly + dy, dy === 0 ? R.bm0 : R.bm1)
        }
      }
      return grp(O, pi)
    }
    const flash = (): string => {
      const O = buf()
      rect(O, lx - 4, ly, 9, 1, R.cM)
      rect(O, lx, ly - 4, 1, 9, R.cM)
      rect(O, lx - 3, ly, 7, 1, R.bm0)
      rect(O, lx, ly - 3, 1, 7, R.bm0)
      rect(O, lx - 1, ly - 1, 3, 3, R.bm1)
      put(O, lx, ly, R.bm0)
      return grp(O, pi)
    }
    // the sweep goes out to sea on the right, the short one back over the harbour
    // (held still: the first frame alone)
    beamMarkup = stillBeam ? wedge(1, 12, 2) : frames([wedge(1, 12, 2), wedge(1, 8, 2), wedge(1, 5, 1), flash(), wedge(-1, 6, 1), ''], 4.8)
    const Lm = buf()
    ring(Lm, lx, ly, 1, 2, R.bm1, 0.5)
    put(Lm, lx, ly, R.bm0)
    beamMarkup += grp(Lm, pi)
  }

  // ================================================================ smoke
  const smokeAt = chimneys.slice(0, 4)
  const smokeFrames: string[] = []
  // a puff at quarter step q (0..11): x offset, bottom row (up from the
  // chimney), width, height. Three puffs four steps apart always touch or
  // overlap by a pixel, so each chimney trails one soft column.
  const PUFF: readonly (readonly [number, number, number, number])[] = [
    [0, 0, 2, 1], [0, 0, 2, 2], [0, 1, 2, 2], [0, 1, 3, 2],
    [0, 1, 3, 3], [1, 2, 3, 3], [1, 2, 3, 3], [1, 3, 4, 3],
    [2, 3, 4, 3], [2, 4, 4, 3], [3, 4, 4, 3], [3, 5, 4, 3],
  ]
  for (let f = 0; f < 4; f += 1) {
    const S = buf()
    smokeAt.forEach(([cx, cy]) => {
      for (let k = 0; k < 3; k += 1) {
        const q = f + 4 * k
        const [dx, up, w, h] = PUFF[q] ?? [0, 0, 2, 1]
        const c = q < 6 ? R.sm0 : R.sm1
        const bot = cy - up
        for (let j = 0; j < h; j += 1) {
          const round = w >= 4 && h >= 3 && j !== 1 // trim the corners of the big puffs
          rect(S, cx + dx + (round ? 1 : 0), bot - j, round ? w - 2 : w, 1, c)
        }
      }
    })
    smokeFrames.push(grp(S, pi))
  }
  const smokeMarkup = frames(smokeFrames, 2.8)

  // ================================================================ twinkles
  let twinkleMarkup = ''
  {
    const groups: Buf[] = []
    for (let g = 0; g < 5; g += 1) groups.push(buf())
    if (day || dusk) {
      const sp: [number, number, number][] = day
        ? [[100, 20, 1], [156, 12, 0], [128, 64, 1], [182, 38, 0], [92, 92, 0], [232, 64, 1], [62, 12, 0], [168, 86, 0], [210, 50, 0], [146, 44, 0]]
        : [[120, 8, 0], [176, 14, 1], [96, 18, 0], [232, 10, 0], [150, 26, 0]]
      sp.forEach(([x, y, big], i) => {
        const G = groups[i % 5]
        if (!G) return
        put(G, x, y, R.st0)
        const arm = big ? 2 : 1
        for (let k = 1; k <= arm; k += 1) {
          const c = k === arm && big ? R.st2 : R.st1
          put(G, x - k, y, c)
          put(G, x + k, y, c)
          put(G, x, y - k, c)
          put(G, x, y + k, c)
        }
      })
    }
    twinkle.forEach(([x, y, big], i) => {
      const G = groups[i % 5]
      if (!G) return
      put(G, x, y, R.st0)
      if (big) {
        put(G, x - 1, y, R.st2)
        put(G, x + 1, y, R.st2)
        put(G, x, y - 1, R.st2)
        put(G, x, y + 1, R.st2)
      }
    })
    // each group blinks to a dimmer copy of itself for a beat (core one tone
    // down, the outer arms gone), then back
    const dimmer = (b: Buf): Buf => {
      const d = buf()
      for (let i = 0; i < b.d.length; i += 1) {
        const c = b.d[i] ?? NONE
        if (c === R.st0) d.d[i] = R.st1
        else if (c === R.st1) d.d[i] = R.st2
      }
      return d
    }
    /** A group and its dimmer copy, swapped for a beat of each period. */
    const blink = (G: Buf, on: string, off: string, timing: string): string => {
      const inner = grp(G, pi)
      if (inner === '') return ''
      const dim = grp(dimmer(G), pi)
      return moving(inner, `${on} ${timing}`) + (dim === '' ? '' : moving(dim, `${off} ${timing}`, ' visibility="hidden"'))
    }
    groups.forEach((G, g) => {
      twinkleMarkup += blink(G, 'w-tw', 'w-tv', `${sec(2.6 + g * 0.7)} step-end infinite ${sec(-g * 1.3)}`)
    })
    key('w-tw', '0%{visibility:visible}40%{visibility:hidden}60%{visibility:visible}')
    key('w-tv', '0%{visibility:hidden}40%{visibility:visible}60%{visibility:hidden}')
    // The field: every other star, dealt round several groups, each with its
    // own period and phase. A field star dims one tone for a short beat (the
    // faintest go out), so the sky shimmers a few stars at a time; a dozen
    // groups at night keep each beat to a handful of stars, so no pattern
    // shows. (The deal steps by 5, which shares no factor with either count,
    // so every group gets its share.)
    if (field.length > 0) {
      const NF = night ? 12 : 6
      const fg: Buf[] = []
      for (let g = 0; g < NF; g += 1) fg.push(buf())
      field.forEach(([x, y, c], i) => put(fg[(i * 5) % NF] ?? buf(), x, y, c))
      const FP = [3.1, 4.6, 3.7, 5.3, 4.1, 5.9, 3.4, 4.9, 3.9, 5.6, 4.4, 3.3]
      fg.forEach((G, g) => {
        twinkleMarkup += blink(G, 'w-ts', 'w-tt', `${sec(FP[g] ?? 4)} step-end infinite ${sec(-g * 0.83)}`)
      })
      key('w-ts', '0%{visibility:visible}46%{visibility:hidden}60%{visibility:visible}')
      key('w-tt', '0%{visibility:hidden}46%{visibility:visible}60%{visibility:hidden}')
    }
  }

  // ================================================================ halos (night, sunset)
  // The moon's glow breathes in steps: the still sky holds the narrowest halo,
  // and one or two wider ones show over it (narrow, wider, widest, wider,
  // narrow, narrow). The disc stays round and calm. At sunset the sun's glow
  // breathes the same way, once, slower. Each wider halo holds only the
  // pixels it changes, and only where the still picture shows sky or glow
  // (never over the town, the boats or the sea).
  let haloMarkup = ''
  {
    const orb = night ? { c: MOON, rings: MOONG, grows: [1.2, 2.4], period: 7.2 } : dusk ? { c: SUN, rings: SUNG, grows: [1.4], period: 9.6 } : null
    if (orb) {
      const glowy = new Set<number>([...SKYR, R.og0, R.og1])
      const shown = buf()
      shown.d.set(A.d)
      orb.grows.forEach((g, k) => {
        const Hb = buf()
        for (const [r0, r1, c, d] of orb.rings) ring(Hb, orb.c[0], orb.c[1], r0 + g, r1 + g, c, d)
        const D = buf()
        for (let i = 0; i < Hb.d.length; i += 1) {
          const c = Hb.d[i] ?? NONE
          const s = shown.d[i] ?? NONE
          if (c !== NONE && c !== s && glowy.has(s) && Math.floor(i / shown.w) - shown.py < HZ) D.d[i] = c
        }
        over(shown, D)
        haloMarkup += moving(grp(D, pi), `w-hb${k} ${sec(orb.period)} step-end infinite`, ' visibility="hidden"')
      })
      key('w-hb0', '0%{visibility:hidden}16.67%{visibility:visible}83.33%{visibility:hidden}')
      if (orb.grows.length > 1) key('w-hb1', '0%{visibility:hidden}33.33%{visibility:visible}66.67%{visibility:hidden}')
    }
  }

  // ================================================================ gulls (day, sunset)
  let gullMarkup = ''
  if (!night) {
    const up = ['g.....g', '.gg.gg.', '...h...']
    const flat = ['.......', 'ggg.ggg', '...h...']
    const gulls: [number, number, number][] = [[98, 30, 0], [110, 37, 1], [200, 70, 2]]
    gulls.forEach(([x, y, i]) => {
      const a = buf()
      const b2 = buf()
      art(a, x, y, up, { g: R.g0, h: R.g1 })
      art(b2, x, y, flat, { g: R.g0, h: R.g1 })
      const flap = frames([grp(a, pi), grp(b2, pi)], 0.7 + i * 0.12)
      gullMarkup += moving(flap, `w-gl ${sec(46 + i * 9)} linear infinite ${sec(-i * 17 - 8)}`)
    })
    // Out of sight at the two ends of the flight: parked off the picture, not
    // hidden (the wing frames inside set their own visibility, which a hidden
    // group cannot overrule), and never faded. The flight between is the same
    // straight line at the same speed as before; the step-end keyframes jump
    // on and off the line in one frame instead of sliding across.
    key('w-gl', '0%{transform:translate(-400px,4px)}3.9%{transform:translate(-400px,4px);animation-timing-function:step-end}4%{transform:translate(-27.44px,3.68px)}96%{transform:translate(31.44px,-3.68px);animation-timing-function:step-end}96.1%{transform:translate(400px,-4px)}100%{transform:translate(400px,-4px)}')
  }

  // ================================================================ airship
  let shipMarkup = ''
  {
    const S = buf()
    art(S, 203, 25, [
      'ff....aaaaaaa......',
      'fff.aaaaaaaaaaaa...',
      '.fbbbbbbbbbbbbbbbb.',
      '..bbbbbbbbbbbbbbbbb',
      '.fddddddddddddddddd',
      'fff.dddddddddddddd.',
      'ff....dddddddd.....',
      '........e...e......',
      '........ggggg......',
      '........gwgwg......',
    ], { a: R.a0, b: R.a1, d: R.a2, f: R.af, e: R.ag, g: R.ag, w: R.aw })
    shipMarkup = moving(grp(S, pi), 'w-air 170s ease-in-out infinite -40s')
    key('w-air', '50%{transform:translateX(-34px)}')
  }

  // ================================================================ wind gusts
  // Curly gusts, the anime "~@" wind: a thin pale line with a soft wave that
  // curls into a small loop at its leading end. Each gust lives in steps: it
  // grows in from the tail, the curl forms and winds a little, then the tail
  // lets go and the curl breaks up; all the while it rides a gentle arc to the
  // right, a pixel at a time. Then it rests unseen until its turn comes round.
  /** A gust's pixels, tail to head (local: tail at 0,0); `tail` is how many belong to the tail. */
  const gustLine = (len: number, r0: number, turns: number, amp: number, flip: number): { pts: [number, number][]; tail: number } => {
    const pts: [number, number][] = []
    const add = (x: number, y: number): void => {
      const p: [number, number] = [Math.round(x), Math.round(y * flip)]
      const l = pts[pts.length - 1]
      if (!l || l[0] !== p[0] || l[1] !== p[1]) pts.push(p)
    }
    // the tail: one soft wave, rising into the curl
    for (let s = 0; s <= len; s += 0.2) add(s, -amp * Math.sin((2 * Math.PI * s) / len))
    const tail = pts.length
    // the curl: up, back over and in, its radius closing as it winds
    const end = 2 * Math.PI * turns
    for (let a = 0.05; a <= end; a += 0.04) {
      const r = r0 - (r0 - 1.6) * (a / end)
      add(len + r * Math.sin(a), -r0 + r * Math.cos(a))
    }
    // one pixel wide: drop the inside corner of every L the line steps round
    for (let i = 1; i + 1 < pts.length; ) {
      const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]]
      if (a && b && c && Math.abs(a[0] - c[0]) === 1 && Math.abs(a[1] - c[1]) === 1 && (b[0] === a[0] || b[1] === a[1])) pts.splice(i, 1)
      else i += 1
    }
    return { pts, tail: Math.min(tail, pts.length) }
  }
  // The life of a gust, frame by frame: how much of the line shows (from, to,
  // as fractions of tail and curl), and whether it is breaking up.
  const LIFE: readonly (readonly [number, number, boolean])[] = [
    [0, 0.4, false], // the tail comes in
    [0, 0.85, false],
    [0, 1.45, false], // the curl starts round
    [0, 1.8, false], // a full loop
    [0.35, 2, false], // wound in; the tail lets go
    [0.8, 2, true], // breaking up
  ]
  const ACT = 42 // a gust shows for the first 42% of its period
  const gustFrame = (g: { pts: [number, number][]; tail: number }, x0: number, y0: number, f: number, leaf: boolean): string => {
    const [a, b, broken] = LIFE[f] ?? [0, 2, false]
    const n = g.pts.length
    const idx = (v: number): number => (v <= 1 ? Math.round(v * g.tail) : Math.round(g.tail + (v - 1) * (n - g.tail)))
    const S = buf()
    for (let i = idx(a); i < Math.min(n, idx(b)); i += 1) {
      if (broken && i % 3 === 1) continue
      const p = g.pts[i]
      if (!p) continue
      // the tail's far end is fainter, and so is a gust breaking up
      put(S, x0 + p[0], y0 + p[1], broken || i < g.tail * 0.4 ? R.wi2 : R.wi)
    }
    if (leaf) {
      // a leaf off the hill riding the gust: just ahead of its head while the
      // curl forms, then tossed on ahead as the gust lets go; it tumbles
      // between two shapes from frame to frame
      const head = g.pts[Math.max(0, Math.min(n, idx(b)) - 1)] ?? [0, 0]
      const right = Math.max(...g.pts.map(q => q[0]))
      const [lx, ly] = f < 4 ? [head[0] + 2, head[1] - 2] : [right + 3 + (f - 4) * 4, -g.pts.length / 8 - 2 - (f - 4) * 2]
      const shape = f % 2 === 0 ? [[0, 0, R.h1], [1, 0, R.h0], [2, -1, R.h0]] : [[0, -1, R.h0], [1, -1, R.h0], [1, 0, R.h1]]
      for (const [dx = 0, dy = 0, c = R.h0] of shape) put(S, x0 + Math.round(lx) + dx, y0 + Math.round(ly) + dy, c)
    }
    return grp(S, pi)
  }
  // x, y (the tail's start), tail length, loop radius, turns, wave, flip,
  // period, delay, in front of Kiki. All four blow in the open sky, behind
  // her and clear of her head and the broom: a pale curl under the broom read
  // as a magic trail. A loop radius under about 3.6 closes into a point
  // instead of a round '@'.
  const GUSTS: readonly (readonly [number, number, number, number, number, number, number, number, number, boolean])[] = [
    [52, 52, 18, 3.6, 1.3, 1.6, 1, 8.4, 0, false],
    [150, 18, 16, 3.7, 1.25, 1.3, 1, 12.6, -11.2, false],
    [204, 60, 18, 3.7, 1.3, 1.4, -1, 10.5, -5.6, false],
    [100, 30, 14, 3.6, 1.25, 1.2, 1, 12.6, -4.9, false],
  ]
  // The periods share a 126 s round and the delays are picked over it so that
  // one to three gusts show at a time (two most often), never all four.
  let windBack = ''
  let windFront = ''
  if (!still) {
    GUSTS.forEach(([x, y, len, r0, turns, amp, flip, p, d, front], gi) => {
      const g = gustLine(len, r0, turns, amp, flip)
      const timing = `${sec(p)} step-end infinite ${sec(d)}`
      let inner = ''
      LIFE.forEach((_, f) => { inner += `<g class="${cls(`w-q${f} ${timing}`)}" visibility="hidden">${gustFrame(g, x, y, f, day && gi === 0)}</g>` })
      // The ride itself is never hidden: its frames hide and show themselves,
      // and a frame shown inside a hidden group may not show at all.
      const m = moving(inner, `w-qt ${timing}`)
      if (front) windFront += m
      else windBack += m
    })
    // each frame shows for one sixth of the gust's time
    LIFE.forEach((_, f) => {
      const a = n2((ACT * f) / LIFE.length)
      const b = n2((ACT * (f + 1)) / LIFE.length)
      key(`w-q${f}`, f === 0 ? `0%{visibility:visible}${b}%{visibility:hidden}` : `0%{visibility:hidden}${a}%{visibility:visible}${b}%{visibility:hidden}`)
    })
    // the ride: a pixel or two to the right at a time, along a low arc
    const STEPS = 15
    let ride = ''
    for (let i = 0; i <= STEPS; i += 1) {
      const x = Math.round(i * 1.6)
      const y = -Math.round(2.4 * Math.sin((Math.PI * i) / STEPS))
      ride += `${n2((ACT * i) / (STEPS + 1))}%{transform:translate(${x}px,${y}px)}`
    }
    key('w-qt', ride)
  }

  // ================================================================ shooting star (night)
  let shoot = ''
  if (night && !still && !stillShoot) {
    const S = buf()
    const sx = 168
    const sy = 12
    put(S, sx, sy, R.st0)
    put(S, sx + 1, sy, R.st0)
    for (let i = 1; i < 9; i += 1) put(S, sx + 1 + i * 2, sy - i, i < 3 ? R.st0 : i < 6 ? R.st1 : R.st2)
    for (let i = 1; i < 6; i += 1) put(S, sx + i * 2, sy - i, R.st2)
    shoot = moving(grp(S, pi), 'w-ss 17s linear infinite 5s', ' visibility="hidden"')
    key('w-ss', '0%{visibility:hidden;transform:translate(0,0)}0.5%{visibility:hidden}0.6%{visibility:visible}4.5%{visibility:visible}4.6%{visibility:hidden}5%{transform:translate(-44px,22px)}100%{visibility:hidden;transform:translate(-44px,22px)}')
  }

  // ================================================================ assemble
  let defs = ''
  const strip = (b: Buf, id: string, period: number, attrs: string): string => {
    const inner = grp(b, pi)
    // still: drawn once at the base position (no <use>, no defs)
    if (still) return `<g${attrs}>${inner}</g>`
    defs += `<g id="${id}">${inner}</g>`
    return moving(`<use href="#${id}"/><use href="#${id}" x="-320"/>`, `w-dr ${sec(period)} linear infinite`, attrs)
  }
  // quick enough that the drift reads as a glide within a second or two
  const farStrip = strip(far, 'w-cf', 110, '')
  const nearStrip = strip(near, 'w-cn', 70, '')
  // The bank and the tall head sway, a pixel at a time, out toward the edges
  // and back, three pixels each way (the bank to the left, the tall head to
  // the right, so nothing sways in toward Kiki): slow enough to feel like
  // breathing, wide enough to see. Moving out only (into the buffers' extra
  // columns), so no edge of the picture ever shows behind them.
  const rangeMarkup =
    moving(grp(BL, pi), 'w-bl 24s step-end infinite -4s') + moving(grp(BR, pi), 'w-br 29s step-end infinite -17s')
  const breathe = (d: number): string => [1, 2, 3, 3, 2, 1].map((k, i) => `${n2((100 * (i + 1)) / 7)}%{transform:translateX(${d * k}px)}`).join('')
  key('w-bl', breathe(-1))
  key('w-br', breathe(1))
  if (!still) key('w-dr', 'to{transform:translateX(320px)}')
  // Made before the rules are joined below, so its own rules are in them.
  // the crests, their sparkle over them, then the moored boats (still: the
  // crests at rest and the sparkle's first frame)
  const seaMarkup = (still ? crestStill : crestMove) + frames(seaFrames, 1.6) + moored

  // ================================================================ camera
  // A third-person camera following Kiki: the whole world (not Kiki, the
  // broom and the cat, which hero.ts draws over it) rises and sinks together,
  // smoothly. It runs on her own float's beat (hero.ts: 4.2 s each way,
  // starting mid-way, sinking), an eighth of a round ahead of her, as a
  // camera trailing a bobbing flyer moves: the world heaves as much as she
  // floats while she stays nearly steady against it (about a pixel). On
  // separate beats the two drifted apart and back every 42 s, swinging her
  // seven pixels against the world. With parallax: the sky, the moon or sun
  // and the stars three quarters of a pixel each way, everything nearer (the
  // cloud range and strips, the town, the sea, the boats, the gulls and the
  // wind) twice that. The near layers sit in a second camera group inside the
  // first, so the two add up, in step. None when still, none in the calmer
  // `light` setting (it moves more of the screen than anything else), and
  // none under prefers-reduced-motion (Kiki stops floating there too).
  const camRule = `w-cam ${sec(4.2)} ease-in-out infinite alternate ${sec(-3.15)}`
  const cam = (inner: string): string => (still || stillCam || inner === '' ? inner : moving(inner, camRule))
  if (!still && !stillCam) {
    key('w-cam', 'from{transform:translateY(-0.75px)}to{transform:translateY(0.75px)}')
    css.push(`@media (prefers-reduced-motion:reduce){.${cls(camRule)}{animation:none}}`)
  }
  const nearLayers =
    rangeMarkup +
    grp(N, pi) +
    windowUnder +
    seaMarkup +
    windowLit +
    beamMarkup +
    smokeMarkup +
    boatMarkup +
    shipMarkup +
    farStrip +
    nearStrip +
    gullMarkup +
    windBack

  // In drawing order, bottom to top: the sky and what lives in it (far), then
  // the range, the sea and town and all that moves on them, the cloud strips,
  // the gulls and the wind (near). The window underlays sit on the town,
  // where nothing drawn before them reaches. A beam held still (light) keeps
  // its place: its first frame drawn still.
  return {
    defs: still ? '' : defs,
    css: still ? '' : css.join(''),
    back: cam(grp(A, pi) + haloMarkup + twinkleMarkup + shoot + cam(nearLayers)),
    front: cam(cam(windFront)),
  }
}
