// The black hole wallpaper: an ASCII black hole drawn on the GPU.
//
// A thin disc seen almost edge-on round a black hole (Schwarzschild, mass M = 1). Each ray from the
// screen is followed round the hole (its path in its own plane obeys u'' + u = 3 u^2, u = 1/r), and
// where it crosses the disc's plane gives what is seen there: the first crossing is the direct image
// (the arc over the top and the band across the middle), the second the arc underneath, the second
// and third the thin ring round the shadow. That is traced once, in M units, into `lens`.
//
// Passes, in order:
//   lens   once, 192 by 320 texels over the screen in M units: the radius of the first three crossings
//          (it reads no value, so the hole's size and place are applied when it is looked up); every
//          texel's fourth lane is 1, the mark that it ran
//   state  4 texels, read back each frame: the geometry the picture is drawn with (latched), the
//          picture's light (it fades out, waits and fades in round every change of geometry, and at
//          the start), the flow's clock, and the frames-a-second readout (smoothed, and held)
//   geo    a texel a character cell: what of the disc each cell sees (radius, angle, brightness, kind),
//          six rays a cell, from the latched geometry; worked out again only when that changes (texel
//          0,0 keeps what it was worked out for), else copied
//   flow   a texel a character cell, read back each frame: the brightness the cell is drawn at, eased,
//          which carries the moving streaks, clumps and infall; and the glyph, which follows them
//          through a quicker copy, a margin each way and a hold of at least HOLD seconds between
//          changes, and fades from one glyph to the next
//   look   a texel a character cell: the two glyphs, how far the fade is, the colour (faded by the light)
//   art    the picture: which cell, which dot of its glyph, what colour; nothing (alpha 0) if the lens
//          table ever reads empty
//
// The flow: two layers of streaks, each carried round (Kepler: faster inside, so they shear and wind)
// and inward for FLOW_T seconds, fading in and out half a period apart; each new layer starts from new
// streaks (seeded by the count of periods), so the picture never repeats, and it never jumps, as a
// layer is at nought when it starts again. Three hot clumps orbit the inner disc, a few seconds a turn,
// on angles kept exact by the same count. Outside the disc, matter falls in: heads with fading tails
// on curved paths that close in faster and stretch near the hole, from a lattice over labels that the
// clock slides, so each spot is crossed only now and then. A spot's light turns round well under three
// times a second (tools/flash.mjs measures it).
//
// Everything is drawn on its own near-black ground, opaque, so nothing under the shader shows through.
import {
  abs, atan, buffer, clamp, composer, cos, dt, exp, first, floor, fract, int, max, min, mix, mod,
  picture, pow, px, res, shader, signed, sin, size, smoothstep, sqrt, table, values, vec2, vec4, PI,
} from 'claude-code/shader'
import type { Buffer as Buf } from 'claude-code/shader'

const v = values({ dim: [0, 0.8], speed: [0, 1], fps: [0, 1], calm: [0, 1], size: [0.6, 1.4] })

// ---------------------------------------------------------------- the grid and the font

const CELL_W = 6
const CELL_H = 10

// 5 by 7 dots a glyph, 7 rows (top first) of 5 bits (the left dot is the high bit).
// 0-11 the ramp from dim to bright: space . : ; t S X % 8 # $ @
// 12-21 the digits 0-9; 22-24 the letters f p s (for the frames-a-second readout)
const FONT = table([
  0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 12, 12,
  0, 12, 12, 0, 12, 12, 0,
  0, 12, 12, 0, 12, 4, 8,
  8, 8, 28, 8, 8, 9, 6,
  15, 16, 16, 14, 1, 1, 30,
  17, 17, 10, 4, 10, 17, 17,
  24, 25, 2, 4, 8, 19, 3,
  14, 17, 17, 14, 17, 17, 14,
  10, 10, 31, 10, 31, 10, 10,
  4, 15, 20, 14, 5, 30, 4,
  14, 17, 23, 21, 23, 16, 15,
  14, 17, 17, 17, 17, 17, 14,
  4, 12, 4, 4, 4, 4, 14,
  14, 17, 1, 6, 8, 16, 31,
  30, 1, 1, 14, 1, 1, 30,
  18, 18, 18, 31, 2, 2, 2,
  31, 16, 30, 1, 1, 17, 14,
  14, 16, 16, 30, 17, 17, 14,
  31, 1, 2, 4, 4, 4, 4,
  14, 17, 17, 14, 17, 17, 14,
  14, 17, 17, 15, 1, 1, 14,
  6, 9, 8, 28, 8, 8, 8,
  0, 0, 30, 17, 30, 16, 16,
  0, 0, 14, 16, 14, 1, 30,
], 'int')
const TOP_LEVEL = 11 // '@'
const DIGIT0 = 12
const LETTER_F = 22

// ---------------------------------------------------------------- the hole

const BC = 5.196152 // the shadow's radius on the screen, 3 sqrt(3) M
const SIN_I = 0.99956 // the disc is tilted 88.3 degrees from face-on
const COS_I = 0.02967
const R_IN = 6 // the disc's inner edge (the last stable orbit) ...
const R_OUT_MAX = 17 // ... and its outer edge, held inside the chat column

// the lens table: alpha 0 to A_MAX across (the picture is mirror-symmetric), beta -B_MAX to B_MAX up
const LENS_W = 192
const LENS_H = 320
const A_MAX = 21
const B_MAX = 12
const STEPS = 64
const STEP = 0.1472622 // 3 PI / 64: three half-turns, enough for the third crossing

// ---------------------------------------------------------------- the flow

const FLOW_T = 20 // seconds a streak layer lives before it fades out and starts again; the clock's period
const OMEGA0 = 0.26 // turn rate of the streaks at the inner edge, radians a second ...
const OMEGA_POW = 1.3 // ... falling as r^-1.3 further out (a little flatter than Kepler), so the streaks shear and wind
const DRIFT = 0.15 // inward drift, M a second
const NDASH = 16 // places for a streak round the disc ...
const SEGS = 0.35 // ... in radial segments (a unit of radius) ...
const DASH_P = 0.75 // ... the share of places that hold one ...
const DASH_L = 0.5 // ... and its length, as a share of a place
const RINGS = 1.2 // thin dark rings across the streaks, a unit of radius
const GAP = 0.42 // a gap's brightness against a streak's 1.3
const NPHI = 6 // a slow, wide shimmer over the lanes: cells round ...
const KR = 0.6 // ... and a unit of radius

/**
 * A hot clump in the inner disc, seen at disc radius r and flow angle a: at radius rc, making `half`
 * half-turns a clock period (a whole number, so its angle stays exact however long it runs: the orbit is
 * 2 FLOW_T / half seconds), from `start` (a share of a turn). `turn` is the clock's phase plus its count
 * of periods, mod 2. 1 at its middle, falling off over about 2 M along its orbit and 0.75 M across.
 */
function clump(r: number, a: number, turn: number, rc: number, half: number, start: number): number {
  const at = (fract(half * 0.5 * turn + start) * 2 - 1) * PI
  const along = (mod(a - at + PI, 2 * PI) - PI) * (rc / 2.2)
  const across = (r - rc) / 0.75
  return exp(-(along * along + across * across))
}

// the infall: matter on curved paths, labelled by r^2.5 + FALL_K t (so it closes in faster near the
// hole) and by its angle less FALL_CURL sqrt(r); a lattice over the labels holds a head or none
const FALL_DS = 140 // lattice spacing in r^2.5
const FALL_Q = 10 // lattice cells a clock period: FALL_K = FALL_Q * FALL_DS / FLOW_T = 70
const FALL_N = 11 // lattice cells round
const FALL_P = 0.7 // the share of lattice cells that hold a head
const FALL_CURL = 0.66 // how far the paths turn
const FALL_TAIL = 1.1 // tail length, in lattice cells of r^2.5 (longer in r near the hole)
const FALL_B = 0.98 // a head's brightness

const FADE = 0.3 // seconds one glyph takes to fade into the next
const HYST = 0.35 // levels the brightness must move past a glyph's own before it changes
const HOLD = 0.5 // seconds a cell keeps a glyph at least (longer where it is bright), so no dot turns over fast
const ON_AT = 0.035 // a blank cell takes a glyph above this light ...
const OFF_AT = 0.015 // ... and a lit one goes blank below this

// changes of geometry and the start: out, settle, in
const GEO_TOL = 0.4 // points the raw geometry may differ from the latched one (float noise) before it counts
const FADE_OUT = 0.27 // seconds to fade to the ground
const SETTLE = 0.17 // seconds the raw geometry must stand still, once dark, before it is latched
const FADE_IN = 0.55 // seconds to fade back in

// the ground, #060409
const GR = 0.0235
const GG = 0.0157
const GB = 0.0353

// ---------------------------------------------------------------- noise

/** A hash of three whole numbers to 0..1, the same in the app (wrapping ints) and in the preview. */
function hash3(x: number, y: number, z: number): number {
  let h = int(int(x) * 73856093 + int(y) * 19349663 + int(z) * 83492791)
  h = int(h ^ (h >>> 13))
  h = int((h & 65535) * 1540483477 + (h >>> 16) * 40503)
  h = int(h ^ (h >>> 15))
  h = int((h & 65535) * 1597334677 + (h >>> 16) * 52711)
  h = int(h ^ (h >>> 16))
  return signed(h & 16777215) / 16777216
}

/** Smooth value noise, periodic every `period` cells in x, with whole cells `yoff` added in y. */
function vnoise(x: number, y: number, period: number, seed: number, yoff: number): number {
  const ix = floor(x)
  const iy = floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const x0 = mod(ix, period)
  const x1 = mod(ix + 1, period)
  const y0 = iy + yoff
  const a = hash3(x0, y0, seed)
  const b = hash3(x1, y0, seed)
  const c = hash3(x0, y0 + 1, seed)
  const d = hash3(x1, y0 + 1, seed)
  return mix(mix(a, b, ux), mix(c, d, ux), uy)
}

/**
 * One layer of streaks at disc radius r and flow angle a, t seconds into the layer's life: places
 * round the disc carried at the pace of each radius (faster inside), so a streak that starts
 * straight across the disc is sheared and wound as it goes, and drifts inward; a place holds a
 * streak in some of its radial segments, bright at its head and fading back along its tail, cut by
 * thin dark rings. 0 in a gap, up to 1 on a head.
 */
function dashes(r: number, a: number, t: number, seed: number): number {
  const rd = r + DRIFT * t // where this matter started
  const ring = rd * RINGS
  const across = 1 - smoothstep(0.32, 0.48, abs(ring - floor(ring) - 0.5))
  const seg = floor(rd * SEGS)
  const om = OMEGA0 * pow(R_IN / max(r, R_IN - 0.5), OMEGA_POW)
  const u = (a - om * t) * (NDASH / (2 * PI))
  const iu = floor(u)
  const place = mod(iu, NDASH)
  const h = hash3(place, seg, seed)
  const len = DASH_L * (0.7 + 0.6 * hash3(place, seg, seed + 1))
  const c = 0.5 + (0.42 - 0.5 * len) * (2 * hash3(place, seg, seed + 2) - 1)
  const p = u - iu - c // along the streak, its head toward larger p (the way it goes)
  const on = smoothstep(-0.5 * len - 0.06, -0.5 * len + 0.12, p) * (1 - smoothstep(0.5 * len - 0.03, 0.5 * len + 0.03, p))
  const fade = 0.5 + 0.5 * clamp((p + 0.5 * len) / max(len, 0.01), 0, 1)
  return h < DASH_P ? across * on * fade : 0
}

// ---------------------------------------------------------------- the lens, traced once

/** The cubic through a and b with slopes da and db (each already times the step), at t from 0 to 1. */
function hermite(a: number, da: number, b: number, db: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + t) * da + (3 * t2 - 2 * t3) * b + (t3 - t2) * db
}

// x, y, z: the radius where the ray from (alpha, beta) crosses the disc's plane the first, second and
// third time (0 where it was swallowed or had left before then; large far away)
const lens: Buf = buffer({ size: [LENS_W, LENS_H], float: 32, filter: 'nearest', once: true }, p => {
  const al = ((p.cell.x + 0.5) / LENS_W) * A_MAX
  const be = (((p.cell.y + 0.5) / LENS_H) * 2 - 1) * B_MAX
  const b = max(sqrt(al * al + be * be), 0.001)
  const bz = (be / b) * SIN_I
  const c1 = atan(COS_I, -bz) // the first crossing, between 0 and PI along the orbit
  const c2 = c1 + PI
  const c3 = c1 + 2 * PI
  let u = 0
  let w = 1 / b
  let ph = 0
  let r1 = 0
  let r2 = 0
  let r3 = 0
  const h = STEP
  for (let s = 0; s < STEPS; s++) {
    // one Runge-Kutta step of u'' = 3 u^2 - u
    const k1u = w
    const k1w = 3 * u * u - u
    const u2 = u + 0.5 * h * k1u
    const w2 = w + 0.5 * h * k1w
    const k2w = 3 * u2 * u2 - u2
    const u3 = u + 0.5 * h * w2
    const w3 = w + 0.5 * h * k2w
    const k3w = 3 * u3 * u3 - u3
    const u4 = u + h * w3
    const w4 = w + h * k3w
    const k4w = 3 * u4 * u4 - u4
    const un = u + (h / 6) * (k1u + 2 * w2 + 2 * w3 + w4)
    const wn = w + (h / 6) * (k1w + 2 * k2w + 2 * k3w + k4w)
    const pn = ph + h
    // a crossing inside this step: u there from the cubic through both ends and their slopes
    const ta = clamp((c1 - ph) / h, 0, 1)
    const tb = clamp((c2 - ph) / h, 0, 1)
    const tc = clamp((c3 - ph) / h, 0, 1)
    if (c1 > ph && c1 <= pn) r1 = 1 / max(hermite(u, w * h, un, wn * h, ta), 0.0005)
    if (c2 > ph && c2 <= pn) r2 = 1 / max(hermite(u, w * h, un, wn * h, tb), 0.0005)
    if (c3 > ph && c3 <= pn) r3 = 1 / max(hermite(u, w * h, un, wn * h, tc), 0.0005)
    u = un
    w = wn
    ph = pn
    if (u >= 0.5 || u <= 0) break // inside the horizon, or gone
  }
  return vec4(r1, r2, r3, 1)
})

// ---------------------------------------------------------------- where the hole sits

// From the window and the prompt box's left and right only: its top and bottom move as the owner types,
// and nothing may move with them. A box under 80 points wide counts as none.
function noBox(): boolean {
  return (composer.z - composer.x) * size.x < 80
}
/** W, the chat column's width, in points. */
function placeW(): number {
  return noBox() ? 0.6 * size.x : (composer.z - composer.x) * size.x
}
/** R, the shadow's radius, in points. */
function placeR(): number {
  return max(v.size * min(clamp(0.16 * placeW(), 48, 150), 0.18 * size.y), 1)
}
/** The centre across, moved to the nearest cell's centre. */
function placeX(): number {
  const cx = noBox() ? 0.5 * size.x : 0.5 * (composer.x + composer.z) * size.x
  return (floor(cx / CELL_W) + 0.5) * CELL_W
}
/** The centre up, moved to the nearest cell's centre. */
function placeY(): number {
  const cy = noBox() ? 0.5 * size.y : 0.57 * size.y
  return (floor(cy / CELL_H) + 0.5) * CELL_H
}

// ---------------------------------------------------------------- the state: geometry, fade, clock

// The geometry the picture is drawn with (centre, W, R, and the size of a pixel in points) is latched
// here. When the window, the prompt box's left or right, or `size` gives another, the picture fades to
// the ground still drawn with the old one, stays dark while the change goes on, takes the new one once
// it has stood still, and fades back in; so no cell ever jumps to another part of the disc while it
// shows. A new pixel size (the same window drawn at another scale) moves every pixel to another point,
// so there the light is cut at once instead of faded. Empty or cleared state is the start: dark, latch,
// fade in.
//   texel 0: the latched centre across and up, W, R
//   texel 1: the picture's light (0 dark to 1; -1 when the lens table reads empty), seconds the raw
//            geometry has stood still, the latched pixel's size in points, the last frame's pixel size
//   texel 2: the last frame's raw centre across and up, W, R
//   texel 3: the flow's clock (a phase of FLOW_T and a count of whole periods, so it never loops and
//            keeps its precision), the frames a second (smoothed), and the number the readout shows
const state: Buf = buffer({ size: [4, 1], float: 32, filter: 'nearest' }, p => {
  const s0 = state.at(vec2(0, 0))
  const s1 = state.at(vec2(1, 0))
  const s2 = state.at(vec2(2, 0))
  const s3 = state.at(vec2(3, 0))
  const dtc = clamp(dt, 0, 0.1)
  const rx = placeX()
  const ry = placeY()
  const rw = placeW()
  const rr = placeR()
  const empty = first || s0.z < 0.5 || s1.z <= 0
  // the picture's pixel, in points (in a buffer `px` is the buffer's own texel)
  const pxNow = size.x / max(res.x, 1)
  const moved = abs(rx - s2.x) + abs(ry - s2.y) + abs(rw - s2.z) + abs(rr - s2.w) > 0.01 || abs(pxNow - s1.w) > 0.00001
  const still = empty || moved ? 0 : min(s1.y + dtc, 9)
  const differs =
    abs(rx - s0.x) > GEO_TOL || abs(ry - s0.y) > GEO_TOL || abs(rw - s0.z) > GEO_TOL || abs(rr - s0.w) > GEO_TOL || abs(pxNow - s1.z) > 0.001 * pxNow
  let lx = s0.x
  let ly = s0.y
  let lw = s0.z
  let lr = s0.w
  let lpx = s1.z
  let light = clamp(s1.x, 0, 1)
  if (empty) {
    lx = rx
    ly = ry
    lw = rw
    lr = rr
    lpx = pxNow
    light = 0
  } else if (differs) {
    // a new pixel size (the window drawn at another scale) moves every pixel to another point, so the
    // light is cut at once rather than faded; any other change fades out
    light = abs(pxNow - s1.z) > 0.001 * pxNow ? 0 : max(light - dtc / FADE_OUT, 0)
    if (light <= 0 && still >= SETTLE) {
      lx = rx
      ly = ry
      lw = rw
      lr = rr
      lpx = pxNow
    }
  } else {
    light = min(light + dtc / FADE_IN, 1)
  }
  // the lens table's own mark (its texels' fourth lane is 1): if it ever reads empty, draw nothing
  const shown = lens.at(vec2(0, 0)).w > 0.5 ? light : -1

  // the clock, and the frames a second: a frame with no time, or a long stall, is not a measurement
  const fresh0 = first || s3.z < 0.5
  const pace = v.speed * (1 - 0.35 * v.calm)
  let ph = fresh0 ? 0.3 : s3.x + (dtc * pace) / FLOW_T
  let n = fresh0 ? 0 : s3.y
  if (ph >= 1) {
    ph = ph - 1
    n = n + 1
  }
  const timed = dt > 0.002 && dt < 0.5
  const inst = 1 / max(dt, 0.002)
  const rate = fresh0 ? (timed ? inst : 30) : timed ? mix(s3.z, inst, 0.04) : s3.z
  // the number shown moves only when the rate has left it by most of a frame, so a rate that hovers
  // between two numbers does not flip the digits
  const digits = fresh0 || abs(rate - s3.w) > 0.8 ? floor(rate + 0.5) : s3.w

  const i = p.cell.x
  if (i < 0.5) return vec4(lx, ly, lw, lr)
  if (i < 1.5) return vec4(shown, still, lpx, pxNow)
  if (i < 2.5) return vec4(rx, ry, rw, rr)
  return vec4(ph, n, rate, digits)
})

/** The disc's light from radius r with Doppler factor g (before the flow's texture). */
function glow(r: number, g: number, rOut: number): number {
  const inner = smoothstep(R_IN, R_IN + 0.7, r)
  const outer = 1 - smoothstep(rOut - 4.5, rOut, r)
  const fall = pow(7 / max(r, R_IN), 0.9)
  const lanes = 0.82 + 0.18 * cos(r * 2.6 + 0.8 * sin(r * 0.9)) // fixed lanes in the disc
  const beam = pow(clamp(g, 0.3, 1.6), 2.6)
  return 1.05 * inner * outer * fall * lanes * (0.25 + 0.95 * beam)
}

/** The thin ring at the shadow's edge, where the light that went round the hole once or more piles up. */
function ringGlow(al: number): number {
  const g = 0.735 / max(1 + 0.0603 * al * SIN_I, 0.1) // as the disc's inner part, r = 6.5
  return 0.86 + 0.4 * min(pow(clamp(g, 0.3, 1.6), 2.5), 1.5)
}

// ---------------------------------------------------------------- what each cell sees

// x: the disc radius, y: its angle, z: brightness, w: kind (order + 4 ring + 8 stray + 32 dither)
const geo: Buf = buffer({ scale: 1 / CELL_W, float: 32, filter: 'nearest' }, p => {
  const col = p.cell.x
  const row = p.cell.y
  const latched = state.at(vec2(0, 0)) // drawn with the latched geometry, never the raw one
  const R = max(latched.w, 1)
  const cxs = latched.x
  const cys = latched.y
  const W = max(latched.z, 1)
  if (col < 0.5 && row < 0.5) return vec4(R, cxs, cys, W) // the stamp: what the rest was worked out for
  if (row * CELL_H > size.y + CELL_H) return vec4(0, 0, 0, 0)
  const stamp = geo.at(vec2(0, 0))
  const same =
    !first && abs(stamp.x - R) < 0.01 && abs(stamp.y - cxs) < 0.01 && abs(stamp.z - cys) < 0.01 && abs(stamp.w - W) < 0.01
  if (same) return geo.at(p.cell)

  const m = R / BC // points a unit of M
  const reachP = 0.575 * W - 2
  const rOut = clamp((reachP / m) * 0.92, 8, R_OUT_MAX)
  const ringW = max(0.3, 4.5 / m) // the thin ring, at least about half a cell thick
  const xC = (col + 0.5) * CELL_W
  const yC = (row + 0.5) * CELL_H
  let sum = 0
  let best = 0
  let sumR = 0
  let sumC = 0
  let sumS = 0
  let ringSum = 0
  let repK = 0
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 2; i++) {
      const sx = xC + (i - 0.5) * 3
      const sy = yC + (j - 1) * 3.3
      const al = (sx - cxs) / m
      const be = (sy - cys) / m
      const aa = abs(al)
      if (aa < A_MAX && abs(be) < B_MAX && abs(sx - cxs) <= reachP) {
        const t = lens.at(vec2(floor(aa * (LENS_W / A_MAX)), floor((be / B_MAX * 0.5 + 0.5) * LENS_H)))
        let rr = 0
        let kk = 0
        if (t.x >= R_IN && t.x <= rOut) {
          rr = t.x
          kk = 1
        } else if (t.y >= R_IN && t.y <= rOut) {
          rr = t.y
          kk = 2
        } else if (t.z >= R_IN && t.z <= rOut) {
          rr = t.z
          kk = 3
        }
        const b = max(sqrt(al * al + be * be), 0.001)
        const onRing = kk < 1.5 && b > BC + 0.03 && b < BC + 0.03 + ringW ? 1 : 0
        if (onRing > 0.5 && kk < 0.5) {
          // no crossing of the disc's own here, but the edge of the shadow: the ring, at the angle it sits
          rr = R_IN + 0.5
          kk = 3
        }
        if (kk > 0) {
          const bz = (be / b) * SIN_I
          const p0 = atan(COS_I, -bz)
          const sg = kk > 1.5 && kk < 2.5 ? -1 : 1
          const X = sg * sin(p0) * (al / b)
          const Y = sg * (-cos(p0) * SIN_I + sin(p0) * (be / b) * COS_I)
          // Where the flow is read. The arcs are the far side magnified many times along them (a
          // few degrees of the disc fill a whole arc), and the band is the disc edge-on, where what
          // is brightest is its limb: read at the disc's own place, the motion would sweep across
          // the arcs far too fast to show and stand still along the band. So it is carried along
          // each at the disc's pace: the arc over the top by the screen's angle (right to left),
          // the one underneath, its mirror image, by that angle less a half-turn (left to right),
          // and the band, the front of the disc, from its left end to its right, in lanes by row.
          // They meet where the arcs join the band at its ends, at the disc's own angle there.
          const psi = atan(be, al)
          const far = kk > 1.5 || (be > 0 && Y > 0.35)
          const phi = kk > 1.5 ? psi - PI : far ? psi : 0.5 * PI * (clamp(al / (rOut + 1), -1.2, 1.2) - 1)
          const rFlow = far ? rr : 8.5 + 3 * abs(be)
          const g = sqrt(max(1 - 3 / rr, 0.01)) / max(1 + pow(rr, -1.5) * al * SIN_I, 0.1)
          const ring = kk > 1.5 && b < BC + 0.03 + max(ringW, 0.5) ? 1 : 0
          // the thin ring stays lit all round: Doppler dims its far side less
          const e = ring > 0.5 ? ringGlow(al) : glow(rr, g, rOut)
          sum = sum + e
          // the cell reads the flow at the light-weighted mean of what its rays see, so neighbouring
          // cells read neighbouring places and a streak keeps its shape as it crosses them
          sumR = sumR + e * rFlow
          sumC = sumC + e * cos(phi)
          sumS = sumS + e * sin(phi)
          ringSum = ringSum + e * ring
          if (e > best) {
            best = e
            repK = kk
          }
        }
      }
    }
  }
  const S = max(sum / 6, 0.65 * best)
  const repR = sumR / max(sum, 0.000001)
  const repPhi = atan(sumS, sumC)
  const repRing = ringSum > 0.5 * sum && sum > 0 ? 1 : 0
  const hs = hash3(col, row, 7)
  const stray = hs < 0.011 ? 1 : hs < 0.019 ? 2 : 0
  const dq = floor(hash3(col, row, 3) * 16)
  return vec4(repR, repPhi, S, repK + 4 * repRing + 8 * stray + 32 * dq)
})

// ---------------------------------------------------------------- the flow, a cell at a time

// x: glyph shown + 64 * glyph before + 4096 * stray colour, y: brightness shown (eased),
// z: 1 + seconds since the glyph last changed (0: not started), w: brightness the glyph follows (slower)
const flow: Buf = buffer({ scale: 1 / CELL_W, float: 32, filter: 'nearest' }, p => {
  const col = p.cell.x
  const row = p.cell.y
  if (row * CELL_H > size.y + CELL_H) return vec4(0, 0, 0, 0)
  const stamp = geo.at(vec2(0, 0))
  const gm = geo.at(p.cell)
  const prev = flow.at(p.cell)
  const ck = state.at(vec2(3, 0)) // the clock
  const st1 = state.at(vec2(1, 0)) // the picture's light
  const corner = col < 0.5 && row < 0.5
  // the corner the frames-a-second readout uses (96 by 24 points) is kept clear, whatever it shows
  const boxed = col < 16 && row < 3
  const S = corner ? 0 : gm.z
  const code = corner ? 0 : gm.w
  const ring = mod(floor(code / 4), 2)
  const stray = mod(floor(code / 8), 4)
  const dq = floor(code / 32)
  const calm = v.calm

  let target = 0 // the brightness the cell's dots are drawn at
  let drive = 0 // what picks its glyph
  if (S > 0.002 && !boxed) {
    // the disc: two layers of streaks carried round (faster inside) and inward, each fading out
    // before it starts again with new streaks, half a period apart
    const r = gm.x
    const phi = gm.y
    const f0 = ck.x
    const f1 = fract(f0 + 0.5)
    const n1 = ck.y + floor(f0 + 0.5)
    const t0 = f0 * FLOW_T
    const t1 = f1 * FLOW_T
    const w0 = smoothstep(0.2, 0.8, 1 - abs(2 * f0 - 1))
    const w1 = smoothstep(0.2, 0.8, 1 - abs(2 * f1 - 1))
    const streak = max(w0 * dashes(r, phi, t0, 2 * ck.y), w1 * dashes(r, phi, t1, 2 * n1 + 1))
    // and a slow, wide shimmer over it all, which the ring shows alone
    const om = OMEGA0 * pow(R_IN / max(r, R_IN), OMEGA_POW)
    const k = NPHI / (2 * PI)
    const n = mix(
      vnoise((phi - om * t1) * k, r * KR, NPHI, 2 * n1 + 1, 0),
      vnoise((phi - om * t0) * k, r * KR, NPHI, 2 * ck.y, 0),
      1 - abs(2 * f0 - 1),
    )
    // the clumps, each where its orbit has brought it (the lens shows it wherever this cell sees)
    const turn = mod(ck.y, 2) + ck.x
    const hot = max(
      clump(r, phi, turn, 7.2, 10, 0.1),
      max(clump(r, phi, turn, 8.4, 8, 0.55), clump(r, phi, turn, 9.6, 6, 0.8)),
    )
    // a streak is 1.3, a gap GAP; calm narrows that and leaves out most of the clumps
    // the clumps brighten the streaks they pass over (no pulse of their own in a gap, so a spot is not
    // turned round by a clump and a streak apart)
    const lane = mix(mix(GAP, 0.58, calm), 1.3 - 0.2 * calm, streak)
    const tex = (lane + 1.2 * (1 - 0.65 * calm) * hot * streak) * (0.88 + 0.24 * n)
    const base = (1.35 * S) / (0.32 + S) // the fixed light, eased off at the top so the streaks still show
    // the ring glows steadily, a slow shimmer only
    target = ring > 0.5 ? base * (0.94 + 0.16 * (n - 0.5)) : base * tex
    // the glyph follows the streaks too, but a gap keeps a middling glyph: the light carries the
    // contrast, the glyphs the density, which follows the fixed light less eased off than the colour,
    // so the side coming towards us is the denser too
    const dense = 1.05 * pow(S, 0.7)
    drive = ring > 0.5 ? target : dense * mix(0.62 + 0.3 * lane, 0.75 + 0.25 * lane, calm)
  }

  // the infall: heads with fading tails on curved paths, closing in faster and stretching near the
  // hole, gone at the shadow; over the disc they pass in front
  const m = max(stamp.x, 1) / BC
  const reachP = 0.575 * stamp.w - 2
  const dxp = (col + 0.5) * CELL_W - stamp.y
  const dyp = (row + 0.5) * CELL_H - stamp.z
  const al = dxp / m
  const be = dyp / m / 0.75
  const re = max(sqrt(al * al + be * be), 0.01)
  const reachM = reachP / m
  const env = smoothstep(1.12 * BC, 1.55 * BC, re) * (1 - smoothstep(0.86 * reachM, 0.99 * reachM, re))
  if (env > 0.001 && abs(dxp) <= reachP && !boxed) {
    const pw = pow(re, 1.5)
    const s = (pw * re) / FALL_DS + FALL_Q * ck.x // the label, in lattice cells, less FALL_Q * the count
    const th = atan(be, al) + FALL_CURL * sqrt(re)
    const u = th * (FALL_N / (2 * PI))
    const iu = mod(floor(u), FALL_N)
    const is0 = floor(s)
    const off = FALL_Q * ck.y
    const perPoint = (2.5 * pw) / (FALL_DS * m) // lattice cells of the label a point along the path
    const head = 9 * perPoint
    let fall = 0
    for (let j = 0; j < 3; j++) {
      const cs = is0 - j
      if (hash3(cs + off, iu, 211) < FALL_P) {
        const sh = cs + 0.2 + 0.6 * hash3(cs + off, iu, 223)
        const tc = (iu + 0.3 + 0.4 * hash3(cs + off, iu, 227)) * ((2 * PI) / FALL_N)
        const a = s - sh // behind the head (its tail) above 0
        const hf = exp(-(a / head) * (a / head))
        const tf = a > 0 ? 0.8 * pow(max(1 - a / FALL_TAIL, 0), 1.7) : 0
        const d = (mod(th - tc + PI, 2 * PI) - PI) * re * m
        fall = max(fall, max(hf, tf) * exp(-(d / 5.5) * (d / 5.5)))
      }
    }
    const lit = fall * env * FALL_B * (1 - 0.55 * calm)
    target = max(target, lit)
    drive = max(drive, lit)
  }

  // ease what is shown; the glyph follows a copy of its own, with a margin and a rest between changes
  const dtc = clamp(dt, 0, 0.1)
  const kF = 1 - exp(-dtc / mix(0.07, 0.4, calm))
  const kS = 1 - exp(-dtc / mix(0.12, 1, calm))
  // a start: an empty or cleared buffer, or a picture faded to the ground (where the geometry may be
  // new): each cell takes its light and its glyph as they are, unseen
  const start = first || prev.z < 0.5 || st1.x < 0.001
  const shown = start ? target : mix(prev.y, target, kF)
  // every cell keeps a glyph at least HOLD seconds (a bright one longer: there a glyph's dots turning
  // over are a large swing), so no dot turns over more than twice a second
  const rest = mix(mix(HOLD, 1, smoothstep(0.45, 1, shown)), 1.8, calm)
  const slow = start ? drive : mix(prev.w, drive, kS)
  // the glyph's level: from the light, with a fixed offset of the cell's own (no part of it changes
  // from frame to frame by itself), and a margin each way at the blank
  const dither = (dq / 15 - 0.5) * 0.9
  const gc = mod(prev.x, 64)
  // a blank cell takes its glyph from the light as it is now, so a head arriving shows at once
  const g = gc < 0.5 ? max(slow, drive) : slow
  const lit = gc < 0.5 ? g >= ON_AT : g >= OFF_AT
  const L = lit ? clamp(0.55 + g * 10.4 + dither, 1, TOP_LEVEL + 0.49) : 0
  const want = floor(L + 0.5)
  const gp = mod(floor(prev.x / 64), 64)
  let cur = gc
  let before = gp
  let since = min(prev.z - 1 + dtc, 9)
  if (start) {
    cur = want
    before = want
    since = 9
  } else if (since >= rest && abs(want - gc) > 0.5 && (want < 0.5 || gc < 0.5 || abs(L - gc) > 0.5 + HYST)) {
    before = gc
    cur = want
    since = 0
  }
  return vec4(cur + 64 * before + 4096 * stray, shown, since + 1, slow)
})

// ---------------------------------------------------------------- what each cell shows

// x: glyph + 32 * glyph before + 1024 * fade (0..31), y z w: the colour its dots are drawn in
const look: Buf = buffer({ scale: 1 / CELL_W, float: 32, filter: 'nearest' }, p => {
  const col = p.cell.x
  const row = p.cell.y
  const st = flow.at(p.cell)
  const code = st.x
  let gc = mod(code, 64)
  const hi = floor(code / 64)
  let gp = mod(hi, 64)
  const stray = floor(hi / 64)
  let fd = clamp((st.z - 1) / FADE, 0, 1)
  let hot = st.y
  // the picture's light: 0 at the start and while the geometry changes, 1 when settled
  const mark = state.at(vec2(1, 0)).x // -1 when the lens table reads empty
  let light = clamp(mark, 0, 1)

  // the frames a second, bottom left: "NNN fps" in the second row (they stay lit through a fade)
  if (v.fps >= 0.5 && row > 0.5 && row < 1.5 && col > 0.5 && col < 7.5) {
    const n = clamp(state.at(vec2(3, 0)).w, 0, 999)
    light = 1
    const d = col < 1.5 ? floor(n / 100) : col < 2.5 ? mod(floor(n / 10), 10) : mod(n, 10)
    const blank = (col < 1.5 && n < 100) || (col < 2.5 && n < 10) || (col > 3.5 && col < 4.5)
    gc = col > 4.5 ? LETTER_F + col - 5 : blank ? 0 : DIGIT0 + d
    gp = gc
    fd = 1
    hot = 0.95
  }

  // colour: deep red when dim, orange in the body, pale gold where it is hottest
  const t = clamp(hot, 0, 1.3)
  const lvl = 0.45 + 0.55 * smoothstep(0, 0.35, t)
  let cr = (0.3 + 0.7 * smoothstep(0, 0.55, t)) * lvl
  let cg = (0.04 + 0.3 * smoothstep(0.2, 0.65, t) + 0.25 * smoothstep(0.55, 0.9, t) + 0.34 * smoothstep(0.85, 1.25, t)) * lvl
  let cb = (0.03 + 0.08 * smoothstep(0.4, 0.8, t) + 0.25 * smoothstep(0.75, 1.05, t) + 0.36 * smoothstep(1, 1.3, t)) * lvl
  if (stray > 0.5 && t > 0.25) {
    const k = min(t * 1.3, 1)
    cr = stray < 1.5 ? 0.2 * k : 0.6 * k
    cg = stray < 1.5 ? 0.74 * k : 0.38 * k
    cb = stray < 1.5 ? 0.7 * k : 0.92 * k
  }
  // dimmed, and faded toward the ground by the picture's light
  const keep = 1 - v.dim
  return vec4(
    mark < -0.5 ? -1 : gc + 32 * gp + 1024 * floor(fd * 31 + 0.5),
    (GR + (cr - GR) * light) * keep,
    (GG + (cg - GG) * light) * keep,
    (GB + (cb - GB) * light) * keep,
  )
})

// ---------------------------------------------------------------- the picture

const art = picture(p => {
  const ptx = p.point.x
  const pty = p.point.y
  const col = floor(ptx / CELL_W)
  const row = floor(pty / CELL_H)
  const st = look.at(vec2(col, row))
  const code = st.x
  const gc = mod(code, 32)
  const gp = mod(floor(code / 32), 32)
  const fd = floor(code / 1024) / 31

  // the dot: one point square, read at the pixel's centre, so every pixel is wholly dot or wholly
  // ground (no blur); the glyph's foot sits on a pixel edge, and the cell's edges are whole points
  const foot = floor(1.5 / max(px, 0.05) + 0.5) * px
  const lx = ptx - col * CELL_W
  const ly = pty - row * CELL_H
  const dc = floor(lx)
  const dr = floor(foot + 7 - ly)
  const inside = dc < 4.5 && dr > -0.5 && dr < 6.5
  const rr = clamp(dr, 0, 6)
  const sh = int(4 - clamp(dc, 0, 4))
  const bc = signed((FONT.at(gc * 7 + rr) >> sh) & 1)
  const bp = signed((FONT.at(gp * 7 + rr) >> sh) & 1)
  const cov = inside ? mix(bp, bc, fd) : 0
  const keep = 1 - v.dim
  const a = code < -0.5 ? 0 : 1 // the lens table read empty: nothing
  return vec4(
    (GR * keep + (st.y - GR * keep) * cov) * a,
    (GG * keep + (st.z - GG * keep) * cov) * a,
    (GB * keep + (st.w - GB * keep) * cov) * a,
    a,
  )
})

export default shader({ fps: 30, passes: [lens, state, geo, flow, look, art] })
