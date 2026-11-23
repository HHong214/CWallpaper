// The black hole wallpaper: an ASCII black hole drawn on the GPU.
//
// A thin disc round a black hole (Schwarzschild, mass M = 1), seen from TILT degrees above its plane and
// rolled ROLL degrees on the screen. Each ray from the screen is followed round the hole (its path in its
// own plane obeys u'' + u = 3 u^2, u = 1/r), and where it crosses the disc's plane gives what is seen
// there: the first crossing is the direct image (the far side arching over the top of the shadow, the
// near side a curved band across its lower half), the second the thin arc underneath, the second and
// third the thin ring round the shadow. That is traced once, in M units, into `lens`.
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
//          which carries the turning arcs, the waves falling in and the infall; and the glyph, which
//          follows them (dense on an arc, sparse between), with a margin each way, a hold of at least
//          HOLD seconds between changes, only the way the light is going, and a fade from one to the next
//   look   a texel a character cell: the two glyphs, how far the fade is, the ground's light (black in
//          the middle of the shadow), the colour (faded by the light), and the readout's characters
//   art    the picture: which cell, which dot of its glyph, what colour; the readout at twice the size;
//          nothing (alpha 0) if the lens table ever reads empty
//
// The flow: two layers of broad arcs, four round the disc, broken into streaks along the radius, each
// carried round for FLOW_T seconds at the pace of its radius (the inner disc turns fastest, the outer
// part lags, so the arcs wind into trailing spirals) and fading in and out half a period apart, with
// knots of light that the matter carries round and inward; across them broad waves fall in, one a clock
// period. Between the arcs the disc goes dark and its glyphs thin out. Outside the disc, matter falls in:
// heads with fading tails on curved paths that close in faster and stretch near the hole, from a lattice
// over labels that the clock slides, so each spot is crossed only now and then. Every spot's light rises
// and falls smoothly, under twice a second, so nothing flashes (tools/flash.mjs measures it).
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
// 0-11 the ramp from dim to bright: space . : ; t S X % 8 # $ @ (the @ heavy, the densest)
// 12-21 the digits 0-9; 22-24 the letters F P S (for the frames-a-second readout)
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
  14, 27, 23, 21, 23, 24, 15,
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
  31, 16, 16, 30, 16, 16, 16,
  30, 17, 17, 30, 16, 16, 16,
  15, 16, 16, 14, 1, 1, 30,
], 'int')
const TOP_LEVEL = 11 // '@'
const DIGIT0 = 12
const LETTER_F = 22
const LETTER_P = 23
const LETTER_S = 24

// ---------------------------------------------------------------- the hole

const BC = 5.196152 // the shadow's radius on the screen, 3 sqrt(3) M

// The view: the camera is TILT degrees above the disc's plane, so the front of the disc is a curved band
// across the lower shadow and the far side arches over the top; the picture is rolled ROLL degrees
// (counter-clockwise). Three candidates for the owner to choose from:
//   A: TILT 12, ROLL 10      B: TILT 20, ROLL 12      C: TILT 28, ROLL 14
const TILT = 20
const ROLL = 12
const SIN_I = cos((TILT * PI) / 180) // the disc's axis is 90 - TILT degrees from the line of sight
const COS_I = sin((TILT * PI) / 180)
const COS_R = cos((ROLL * PI) / 180)
const SIN_R = sin((ROLL * PI) / 180)
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

const FLOW_T = 3 // seconds a layer of arcs lives before it fades out and starts again; the clock's period
const OMEGA0 = 2.81 // the disc's turn rate, radians a second, is OMEGA0 (R_IN / r)^OMEGA_POW ...
const OMEGA_POW = 2 // ... falling off outside, so the arcs further out lag and wind into trailing spirals ...
const OM_CAP = 1.05 // ... and held at this inside r = 10, so an arc crosses a spot at most about every 1.5 seconds
const ARCS = 4 // arcs round the disc in a layer: a whole number a quarter-turn, so they light no part more than another
const KNOT_DRIFT = 2 // the knots on the arcs fall inward with the matter, M a second
const RINGS = 0.07 // broad waves across the disc, a unit of radius; one falls in a clock period (4.8 M a second)
const RING_HALF = 2 // the hot arc on the ring: half-turns a clock period (a turn in 2 FLOW_T / RING_HALF seconds)
const GAP = 0.05 // the light between the arcs against an arc's 1.3: dark lanes
const DENS = 1.5 // the glyphs' density: DENS (S g)^DENS_P on a crest (held under the densest glyph but one) ...
const DENS_P = 0.9
const LO_DIM = 0.1 // ... and this share of it between the arcs, where the disc is dim ...
const LO_BRIGHT = 0.25 // ... and where it is brightest

// the infall: matter on curved paths, labelled by r^2.5 + FALL_K t (so it closes in faster near the
// hole) and by its angle less FALL_CURL sqrt(r); a lattice over the labels holds a head or none
const FALL_DS = 105 // lattice spacing in r^2.5
const FALL_Q = 2 // lattice cells a clock period: FALL_K = FALL_Q * FALL_DS / FLOW_T = 70
const FALL_N = 11 // lattice cells round
const FALL_P = 0.85 // the share of lattice cells that hold a head
const FALL_CURL = 0.66 // how far the paths turn
const FALL_TAIL = 1.8 // tail length, in lattice cells of r^2.5 (longer in r near the hole)
const FALL_B = 1.25 // a head's brightness

const FADE = 0.3 // seconds one glyph takes to fade into the next
const HYST = 0.8 // levels the brightness must move past a glyph's own before it changes
const HOLD = 0.5 // seconds a cell keeps a glyph at least (longer where it is bright), so no dot turns over fast
const ON_AT = 0.035 // a blank cell takes a glyph above this light ...
const OFF_AT = 0.015 // ... and a lit one goes blank below this

// changes of geometry and the start: out, settle, in
const GEO_TOL = 0.4 // points the raw geometry may differ from the latched one (float noise) before it counts
const FADE_OUT = 0.27 // seconds to fade to the ground
const SETTLE = 0.17 // seconds the raw geometry must stand still, once dark, before it is latched
const FADE_IN = 0.9 // seconds to fade back in

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

/** The disc's turn rate at radius r, radians a second. */
function omega(r: number): number {
  return min(OMEGA0 * pow(R_IN / max(r, R_IN - 0.5), OMEGA_POW), OM_CAP)
}

/**
 * One layer of the disc's light at disc radius r and flow angle a, t seconds into its life (0 to FLOW_T),
 * 0 to 1. ARCS broad arcs round the disc, each carried round at the pace of its radius: they cross the
 * disc straight in the middle of the layer's life, ahead outside before it and behind after it (trailing
 * spirals), one brighter side to them that turns with them; and knots of light the arcs carry round and
 * inward, which form, stretch and fade with the layer. The arcs are smooth waves round the disc (one
 * crest and one trough an arc), and consecutive layers have them where the last ones were in the outer
 * disc, so two layers fading into each other never double them.
 */
function layer(r: number, a: number, t: number, seed: number): number {
  const om = omega(r)
  const am = a - om * (t - 0.5 * FLOW_T) // the angle this matter had in the middle of the layer's life
  const th = (2 * PI * mod(3 * seed, 5)) / 5 // each layer a fifth of a turn of its arcs on: in step in the outer disc
  const side = 0.7 + 0.3 * cos(am + 2 * PI * hash3(seed, 2, 5))
  // broken along the radius into streaks, which the matter carries inward
  const seg = smoothstep(0.25, 0.75, vnoise((r + KNOT_DRIFT * t) * 0.3, 0.5, 4096, seed + 3, 0))
  const arcs = (0.5 + 0.5 * cos(ARCS * am + th)) * side * (0.55 + 0.45 * seg)
  const rho = r + KNOT_DRIFT * t
  const knot = smoothstep(0.6, 0.9, vnoise((a - om * t) * (5 / (2 * PI)), rho * 0.35, 5, seed + 1, 0))
  return mix(arcs, 1, 0.5 * knot)
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

// The frames-a-second readout: a box 96 by 24 points whose left edge is the chat column's (of the latched
// geometry) and whose top is 96 points below the window's top (y is up). It is kept clear of the picture
// whatever the readout shows.
const BOX_W = 96
const BOX_H = 24
/** The readout box's bottom edge, in points up from the window's bottom. */
function boxBottom(): number {
  return size.y - 96 - BOX_H
}
/** The readout's first cell across and its lower row: a character is 2 by 2 cells (12 by 20 points),
 *  set on the cell grid 6 points into the box (within 3), its dots (14 points high) in the box's middle (within 5). */
function textCol(cx: number, w: number): number {
  return floor((cx - 0.5 * w + 6) / CELL_W + 0.5)
}
function textRow(): number {
  return floor((boxBottom() + 1) / CELL_H + 0.5)
}
/** Whether the cell (col, row) lies over the readout's box grown by mg points; cx and w the latched geometry's. */
function overBox(col: number, row: number, cx: number, w: number, mg: number): boolean {
  const bx = cx - 0.5 * w
  const by = boxBottom()
  return (col + 1) * CELL_W > bx - mg && col * CELL_W < bx + BOX_W + mg && (row + 1) * CELL_H > by - mg && row * CELL_H < by + BOX_H + mg
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

/**
 * The disc's light from radius r with Doppler factor g (before the flow's texture). It has no fixed rings
 * and no fade at the outer edge (the glyphs thin out there instead), so nothing in it stands still while
 * the arcs turn.
 */
function glow(r: number, g: number): number {
  const inner = smoothstep(R_IN, R_IN + 0.7, r)
  const fall = pow(7 / max(r, R_IN), 1.5)
  const beam = clamp(g, 0.3, 1.6)
  return 1.05 * inner * fall * (0.25 + 0.95 * beam)
}
/** How far the glyphs have thinned out at radius r, toward the disc's outer edge rOut: 1 inside, 0 at the edge. */
function edge(r: number, rOut: number): number {
  return 1 - smoothstep(rOut - 2.5, rOut, r)
}

/** The thin ring at the shadow's edge, where the light that went round the hole once or more piles up. */
function ringGlow(al: number): number {
  const g = 0.735 / max(1 + 0.0603 * al * SIN_I, 0.1) // as the disc's inner part, r = 6.5
  return 0.86 + 0.4 * min(pow(clamp(g, 0.3, 1.6), 2.5), 1.5)
}

/**
 * Where the infall is drawn: a point dx, dy points from the latched centre (turned back by the roll, so
 * al runs along the disc and be across it, in M; be is stretched by 1 / 0.75 so the paths come in from
 * above and below as well), with m points a unit of M and reachP the disc's reach in points. Its
 * strength: nothing inside 1.12 shadow radii, full from 1.55 out to near the reach, nothing past it.
 * Gives (strength, al, be, distance) packed as a vec4.
 */
function infallAt(dx: number, dy: number, m: number, reachP: number) {
  const al = (dx * COS_R + dy * SIN_R) / m
  const be = (-dx * SIN_R + dy * COS_R) / m / 0.75
  const re = max(sqrt(al * al + be * be), 0.01)
  const reachM = reachP / m
  const env = smoothstep(1.12 * BC, 1.55 * BC, re) * (1 - smoothstep(0.86 * reachM, 0.99 * reachM, re))
  return vec4(abs(dx) <= reachP ? env : 0, al, be, re)
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
  const lensOk = lens.at(vec2(0, 0)).w > 0.5 // cells worked out from an empty lens table must not be kept
  if (col < 0.5 && row < 0.5) return vec4(lensOk ? R : -1, cxs, cys, W) // the stamp: what the rest was worked out for (never a match while the table reads empty)
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
      // about the centre, turned back by the roll: alpha along the disc's long axis, beta across it
      const al = ((sx - cxs) * COS_R + (sy - cys) * SIN_R) / m
      const be = (-(sx - cxs) * SIN_R + (sy - cys) * COS_R) / m
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
          // the disc's own angle where the ray crosses it (seen from above the disc, counter-clockwise)
          const phi = atan(Y, X)
          const rFlow = rr
          const g = sqrt(max(1 - 3 / rr, 0.01)) / max(1 + pow(rr, -1.5) * al * SIN_I, 0.1)
          const ring = kk > 1.5 && b < BC + 0.03 + max(ringW, 0.5) ? 1 : 0
          // the thin ring stays lit all round: Doppler dims its far side less
          // the light falls off over the disc as it shows (out to rOut), so a larger hole, whose disc is
          // cut off nearer in, is not the brighter for it
          const e = ring > 0.5 ? ringGlow(al) : glow(R_IN + ((rr - R_IN) * (R_OUT_MAX - R_IN)) / max(rOut - R_IN, 1), g)
          sum = sum + e
          // the cell reads the flow at the light-weighted mean of what its rays see, so neighbouring
          // cells read neighbouring places and an arc keeps its shape as it crosses them
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
  // stray: a few cells keep a colour of their own (1 teal, 2 violet); the cells off the disc that the
  // infall crosses are its own kind (3), drawn in the disc's colours
  const hs = hash3(col, row, 7)
  const fallsHere = sum <= 0 && infallAt(xC - cxs, yC - cys, m, reachP).x > 0.02
  const stray = hs < 0.011 ? 1 : hs < 0.019 ? 2 : fallsHere ? 3 : 0
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
  // the cells over the readout's box are kept clear, whatever it shows, and the disc and the infall keep
  // 12 points further off. The thin ring round the shadow is the one exception: on a small window it can
  // pass through the box, and there it gives way only to the readout itself (the shadow's edge is read
  // from it)
  const boxed = overBox(col, row, stamp.y, stamp.w, 0)
  const nearBox = overBox(col, row, stamp.y, stamp.w, 12)
  const S = corner ? 0 : gm.z
  const code = corner ? 0 : gm.w
  const ring = mod(floor(code / 4), 2)
  const stray = mod(floor(code / 8), 4)
  const dq = floor(code / 32)
  const calm = v.calm

  // where the cell is about the latched centre, turned back by the roll, in M
  const m = max(stamp.x, 1) / BC
  const reachP = 0.575 * stamp.w - 2
  const dxp = (col + 0.5) * CELL_W - stamp.y
  const dyp = (row + 0.5) * CELL_H - stamp.z
  const al = (dxp * COS_R + dyp * SIN_R) / m
  const be0 = (-dxp * SIN_R + dyp * COS_R) / m
  const turn = mod(ck.y, 2) + ck.x

  let target = 0 // the brightness the cell's dots are drawn at
  let drive = 0 // what picks its glyph
  if (S > 0.002 && !(ring > 0.5 ? boxed && v.fps >= 0.5 : nearBox)) {
    // the disc: two layers of arcs, each fading in and out over its life, half a period apart (so their
    // weights always sum to one), and broad waves falling in across them, one a clock period, a crest on
    // one side of the disc where the other has a trough (so the disc as a whole does not pulse)
    const r = gm.x
    const phi = gm.y
    const f0 = ck.x
    const n1 = ck.y + floor(f0 + 0.5)
    const w0 = 0.5 - 0.5 * cos(2 * PI * f0)
    const arcs = w0 * layer(r, phi, f0 * FLOW_T, 2 * ck.y) + (1 - w0) * layer(r, phi, fract(f0 + 0.5) * FLOW_T, 2 * n1 + 1)
    const wave = 0.5 + 0.5 * cos(2 * PI * (r * RINGS + f0)) * sin(phi)
    // an arc's crest is 1.3, the light between them GAP; calm narrows that. The band in front of the
    // shadow (inside its edge) never goes dark: it is seen against black
    const pat = 0.75 * arcs + 0.25 * wave
    const front = smoothstep(1.02, 0.9, sqrt(dxp * dxp + dyp * dyp) / max(stamp.x, 1))
    const lane = mix(mix(mix(GAP, 0.5, front), 0.58, calm), 1.3 - 0.2 * calm, min(pat * 1.35, 1))
    const base = (1.35 * S) / (0.32 + S) // the fixed light, eased off at the top so the arcs still show
    // the ring glows steadily, and a hot arc travels round it (the way the disc turns on the screen), a
    // turn every 2 FLOW_T / RING_HALF seconds
    const arcAt = (fract(RING_HALF * 0.5 * turn + 0.25) * 2 - 1) * PI
    const da = (mod(atan(be0, al) - arcAt + PI, 2 * PI) - PI) / 0.42
    const hot = exp(-da * da)
    target = ring > 0.5 ? base * 0.75 * (1 + 1.4 * (1 - 0.6 * calm) * hot) : base * lane
    // the glyphs follow the arcs too: dense on a crest, sparse between, denser where the disc is bright
    // and on the side coming towards us, thinning out toward the disc's outer edge; the band in front of
    // the shadow stays dense, and the ring's glyphs grow under the hot arc
    const gd = 1 / max(1 + pow(max(r, R_IN), -1.5) * al * SIN_I, 0.2)
    const rOut = clamp((reachP / m) * 0.92, 8, R_OUT_MAX)
    const lo = mix(mix(mix(LO_DIM, LO_BRIGHT, smoothstep(0.4, 0.9, S)), 0.85, front), 0.85, calm)
    const dens = min(DENS * pow(S * gd, DENS_P), 1.05) * (1 + 0.5 * front) * edge(r, rOut)
    drive = ring > 0.5 ? base * (1 + 0.5 * hot) : dens * mix(lo, 1, pat)
  }

  // the infall: heads with fading tails on curved paths, closing in faster and stretching near the
  // hole, gone at the shadow; they fall until they meet the disc, which carries them on round
  const fz = infallAt(dxp, dyp, m, reachP)
  const env = fz.x
  const be = fz.z
  const re = fz.w
  if (env > 0.001 && S <= 0.002 && !nearBox) {
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
        const tf = a > 0 ? 0.85 * pow(max(1 - a / FALL_TAIL, 0), 1.2) : 0
        const d = (mod(th - tc + PI, 2 * PI) - PI) * re * m
        fall = max(fall, max(hf, tf) * exp(-(d / 7.5) * (d / 7.5)))
      }
    }
    // brighter as it nears the hole
    const lit = fall * env * FALL_B * (1 - 0.55 * calm) * clamp(pow((2 * BC) / re, 0.8), 0.6, 1.5)
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
  } else if (
    since >= rest &&
    abs(want - gc) > 0.5 &&
    (want < 0.5 || gc < 0.5 || abs(L - gc) > 0.5 + HYST) &&
    // off the disc (the infall) a glyph only grows or goes: a tail fades in colour, not down the ramp,
    // whose glyphs would turn its dots round one after another
    (S > 0.002 || want > gc || want < 0.5) &&
    // on the disc a glyph grows only while its light rises and thins only while it falls, so a dot is
    // never turned round against the light (which would add a swing)
    (S <= 0.002 || ring > 0.5 || (want > gc ? target >= prev.y : target <= prev.y))
  ) {
    before = gc
    cur = want
    since = 0
  }
  return vec4(cur + 64 * before + 4096 * stray, shown, since + 1, slow)
})

// ---------------------------------------------------------------- what each cell shows

// x: glyph + 32 * glyph before + 1024 * fade (0..31) + 32768 * the ground's light (0..15), and for a
// quarter of a readout character (drawn at twice the size) 524288 * (1 + 2 * right + 4 * upper);
// y z w: the colour its dots are drawn in
const look: Buf = buffer({ scale: 1 / CELL_W, float: 32, filter: 'nearest' }, p => {
  const col = p.cell.x
  const row = p.cell.y
  const st = flow.at(p.cell)
  const code = st.x
  const gc = mod(code, 64)
  const hi = floor(code / 64)
  const gp = mod(hi, 64)
  const stray = floor(hi / 64)
  const fd = clamp((st.z - 1) / FADE, 0, 1)
  const hot = st.y
  // the picture's light: 0 at the start and while the geometry changes, 1 when settled
  const mark = state.at(vec2(1, 0)).x // -1 when the lens table reads empty
  const light = clamp(mark, 0, 1)
  // the shadow: its ground goes from the ground's colour at the edge to black in the middle (as the
  // picture's light comes up, so a fade takes it with the rest)
  const s0 = state.at(vec2(0, 0))
  const dxc = (col + 0.5) * CELL_W - s0.x
  const dyc = (row + 0.5) * CELL_H - s0.y
  const dc = sqrt(dxc * dxc + dyc * dyc) / max(s0.w, 1)
  const shade = 1 - light * (1 - smoothstep(0.4, 1, dc))

  // colour: deep red when dim, orange in the body, pale gold where it is hottest
  const t = clamp(hot, 0, 1.3)
  const lvl = 0.45 + 0.55 * smoothstep(0, 0.35, t)
  let cr = (0.3 + 0.7 * smoothstep(0, 0.55, t)) * lvl
  let cg = (0.04 + 0.3 * smoothstep(0.2, 0.65, t) + 0.25 * smoothstep(0.55, 0.9, t) + 0.34 * smoothstep(0.85, 1.25, t)) * lvl
  let cb = (0.03 + 0.08 * smoothstep(0.4, 0.8, t) + 0.25 * smoothstep(0.75, 1.05, t) + 0.36 * smoothstep(1, 1.3, t)) * lvl
  // a stray cell is teal or violet at every light (a switch of colour at some light would turn its dots
  // round each time the light crossed it)
  if (stray > 0.5 && stray < 2.5) {
    const k = min(t * 1.3, 1)
    cr = stray < 1.5 ? 0.2 * k : 0.6 * k
    cg = stray < 1.5 ? 0.74 * k : 0.38 * k
    cb = stray < 1.5 ? 0.7 * k : 0.92 * k
  }
  // dimmed, and faded toward the ground by the picture's light
  const keep = 1 - v.dim

  // the frames a second: "NN FPS" in the font at twice its size, a character 2 by 2 cells (the picture
  // draws a quarter of it in each), in the readout's box (kept clear by the flow), lit whatever the light
  const cc = col - textCol(s0.x, s0.z)
  const rc = row - textRow()
  if (v.fps >= 0.5 && cc > -0.5 && cc < 13.5 && rc > -0.5 && rc < 1.5) {
    const n = clamp(state.at(vec2(3, 0)).w, 0, 999)
    const nd = n >= 99.5 ? 3 : n >= 9.5 ? 2 : 1
    const k = floor(cc / 2)
    const e = nd - 1 - k // the digit's place: 0 for the units
    const d = mod(floor((n + 0.5) / (e > 1.5 ? 100 : e > 0.5 ? 10 : 1)), 10)
    const ch = k < nd - 0.5 ? DIGIT0 + d : k < nd + 0.5 ? 0 : k < nd + 1.5 ? LETTER_F : k < nd + 2.5 ? LETTER_P : k < nd + 3.5 ? LETTER_S : 0
    // the quarter: 1 + 2 * (right half) + 4 * (upper half), times 524288
    const lit = mark < -0.5 ? 0 : keep
    return vec4(
      mark < -0.5 ? -1 : ch + 32 * ch + 1024 * 31 + 32768 * 15 + 524288 * (1 + 2 * mod(cc, 2) + 4 * rc),
      0.98 * lit,
      0.78 * lit,
      0.5 * lit,
    )
  }
  // (the lens table reads empty: a mark the picture draws as nothing, and no colour)
  const on = mark < -0.5 ? 0 : keep
  return vec4(
    mark < -0.5 ? -1 : gc + 32 * gp + 1024 * floor(fd * 31 + 0.5) + 32768 * floor(shade * 15 + 0.5),
    (GR + (cr - GR) * light) * on,
    (GG + (cg - GG) * light) * on,
    (GB + (cb - GB) * light) * on,
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
  const keep = 1 - v.dim

  // the dot: one point square, read at the pixel's centre, so every pixel is wholly dot or wholly
  // ground (no blur); the glyph's foot sits on a pixel edge, and the cell's edges are whole points.
  // A quarter of a readout character draws its part of the glyph at twice the size.
  const q = floor(code * (1 / 524288))
  const sc = q > 0.5 ? 0.5 : 1
  const foot = floor(1.5 / max(px, 0.05) + 0.5) * px
  const dc = floor((ptx - col * CELL_W + (mod(q, 4) > 2.5 ? CELL_W : 0)) * sc)
  const dr = floor(foot + 7 - (pty - row * CELL_H + (q > 4.5 ? CELL_H : 0)) * sc)
  const gc = mod(code, 32)
  const gp = mod(floor(code * (1 / 32)), 32)
  const fd = mod(floor(code * (1 / 1024)), 32) * (1 / 31)
  const inside = dc < 4.5 && dr > -0.5 && dr < 6.5
  const rr = clamp(dr, 0, 6)
  const sh = int(4 - clamp(dc, 0, 4))
  const bc = signed((FONT.at(gc * 7 + rr) >> sh) & 1)
  const bp = signed((FONT.at(gp * 7 + rr) >> sh) & 1)
  const cov = inside ? mix(bp, bc, fd) : 0
  // the lens table read empty: nothing (the look's colours are 0 then)
  const a = code < -0.5 ? 0 : 1
  // the ground, black in the middle of the shadow (a readout quarter's level reads over 15: the full ground)
  const gl = min(floor(code * (1 / 32768)), 15) * ((keep * a) / 15)
  return vec4(GR * gl + (st.y - GR * gl) * cov, GG * gl + (st.z - GG * gl) * cov, GB * gl + (st.w - GB * gl) * cov, a)
})

export default shader({ fps: 30, passes: [lens, state, geo, flow, look, art] })
