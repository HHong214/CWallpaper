// The black hole wallpaper: an ASCII black hole drawn on the GPU.
//
// A broad disc round a black hole, seen level from TILT degrees above its plane; the tilt swings slowly
// between 30 and 6 degrees and back over 60 seconds of the flow's clock. No light is traced: the parts
// are painted back to front, the far half of the disc, the far jet, the black circle with its thin
// bright ring, the near half of the disc, the near jet, and sparks. At the high angle the circle and its
// ring are drawn over the near half of the disc, so the circle is whole, the disc a broad ellipse round
// it; as the view goes low the near half fades in over them (between COVER_HI and COVER_LO degrees),
// and at the low angle the disc is a thin bright line whose near half crosses the circle's lower half,
// with long jets up and down.
//
// Passes, in order:
//   state  4 texels, read back each frame: the geometry the picture is drawn with (latched), the
//          picture's light (it fades out, waits and fades in round every change of geometry, and at
//          the start), and the flow's clock with the tilt it gives
//   geo    a texel a character cell, every frame: what the cell sees (six points a cell): the disc's
//          radius and angle in its own plane and its light, the ring, a jet, or a spark, and its kind
//   flow   a texel a character cell, read back each frame: the brightness the cell is drawn at, eased,
//          which carries the turning arcs, the waves falling in, the jets' knots and the sparks; and
//          the glyph, which follows them (dense on an arc, sparse between), with a margin each way, a
//          hold of at least HOLD seconds between changes, only the way the light is going, and a fade
//          from one glyph to the next
//   look   a texel a character cell: the two glyphs, how far the fade is, the ground's light (black in
//          the circle), and the colour (white-hot at the disc's inner edge to dark red at its rim,
//          white-gold on the ring, blue-white in the jets), faded by the picture's light
//   art    the picture: which cell, which dot of its glyph, what colour
//
// The flow: two layers of broad arcs, four round the disc, broken into streaks along the radius, each
// carried round for FLOW_T seconds at the pace of its radius (the inner disc turns fastest, the outer
// part lags, so the arcs wind into trailing spirals) and fading in and out half a period apart, with
// knots of light that the matter carries round and inward; across them broad waves fall in, one a clock
// period. Between the arcs the disc goes dark and its glyphs thin out. The jets carry knots outward.
// Sparks ride curved paths in and round, from a lattice over labels that the clock slides. Every spot's
// light rises and falls smoothly, under twice a second, so nothing flashes (tools/flash.mjs measures it).
//
// Everything is drawn on its own near-black ground, opaque, so nothing under the shader shows through.
import {
  abs, atan, buffer, clamp, composer, cos, dt, exp, first, floor, fract, int, max, min, mix, mod,
  picture, pow, px, res, shader, signed, sin, size, smoothstep, sqrt, table, values, vec2, vec4, PI,
} from 'claude-code/shader'
import type { Buffer as Buf } from 'claude-code/shader'

const v = values({ dim: [0, 0.8], speed: [0, 1], calm: [0, 1], size: [0.6, 1.4] })

// ---------------------------------------------------------------- the grid and the font

const CELL_W = 6
const CELL_H = 10

// 5 by 7 dots a glyph, 7 rows (top first) of 5 bits (the left dot is the high bit): the ramp from dim
// to bright, space . : ; t S X % 8 # $ @ (the @ heavy, the densest)
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
], 'int')
const TOP_LEVEL = 11 // '@'

// ---------------------------------------------------------------- the hole, the disc, the jets

const BC = 5.196152 // R in the disc's own unit (the disc's radius lane counts in R / BC)
const D_IN = 1.25 // the disc's inner edge, in R (it hugs the hole) ...
const D_OUT = 4.2 // ... and its outer edge (never past 0.546 W, inside the chat column)
const RING_OUT = 1.15 // the thin ring, from R out to this many R
const DOP = 0.3 // how much brighter the side coming towards us is (the side with x < cx)
const JET_BASE = 1.15 // the jets start just outside the ring (the far one behind it) ...
const JET_LEN = 3.6 // ... and both reach JET_LEN cos(tilt) R further
const JET_W = 0.28 // their half width at the base, in R (a slim bright core, JET_CORE wide, in a faint blue halo) ...
const JET_SPREAD = 0.04 // ... widening by this a unit of R along them
const JET_CORE = 0.11
const JET_LAMBDA = 2.4 // the knots along a jet: R apart ...
const JET_N = 2 // ... and this many pass a spot in a clock period (outward)

// the swing of the view: tilt = TILT_MID + TILT_SWING cos(2 PI T / (SWING_N FLOW_T)), T the clock's seconds
const TILT_MID = 18
const TILT_SWING = 12
const SWING_N = 20 // clock periods a swing (60 seconds)
// the near half of the disc crosses the circle and its ring only as the view goes low: hidden behind them
// at this tilt and above, fading in to whole at COVER_LO and below (as sines of the tilt: 20 and 12 degrees)
const COVER_HI = 0.342
const COVER_LO = 0.2079

// ---------------------------------------------------------------- the flow

const FLOW_T = 3 // seconds a layer of arcs lives before it fades out and starts again; the clock's period
const R_IN = D_IN * BC // the disc's inner edge in its own unit
const RHO1 = 15 // the disc turns at OM_CAP inside this radius ...
const OM_CAP = 1.05 // ... radians a second (an arc crosses a spot at most about every 1.5 seconds) ...
const OMEGA_POW = 3 // ... and slower as r^-3 outside, so the arcs further out lag and wind into trailing spirals
const ARCS = 4 // arcs round the disc in a layer: a whole number a quarter-turn, so they light no part more than another
const KNOT_DRIFT = 2 // the knots and streaks on the arcs fall inward with the matter, a unit of radius a second
const RINGS = 0.07 // broad waves across the disc, a unit of radius; one falls in a clock period
const RING_HALF = 2 // the hot arc on the ring: half-turns a clock period (a turn in 2 FLOW_T / RING_HALF seconds)
const GAP = 0.05 // the light between the arcs against an arc's 1.3: dark lanes
const DENS = 1.5 // the glyphs' density: DENS S^DENS_P on a crest (held under the densest glyph but one) ...
const DENS_P = 0.9
const LO_DIM = 0.05 // ... and this share of it between the arcs, where the disc is dim ...
const LO_BRIGHT = 0.06 // ... and where it is brightest
const HOT_IN = 0.35 // the white-hot inner part of the disc: whole to this share of the way out ...
const HOT_OUT = 0.6 // ... and gone by this; there a glyph rests HOT_REST seconds at least and changes only past
const HOT_REST = 0.8 // HOT_HYST more levels (its white dots turning over would be large swings in every lane)
const HOT_HYST = 0.68

// the sparks: points on curved paths, labelled by r^2.5 + SP_K t (so they close in faster near the
// hole) and by their angle less SP_CURL sqrt(r); a lattice over the labels holds a spark or none
const SP_DS = 140 // lattice spacing in r^2.5
const SP_Q = 2 // lattice cells a clock period
const SP_N = 11 // lattice cells round
const SP_P = 0.45 // the share of lattice cells that hold a spark
const SP_CURL = 0.7 // how far the paths turn
const SP_TAIL = 0.8 // a short tail, in lattice cells of r^2.5
const SP_FLAT = 0.18 // the sparks lie in a thicker plane than the disc: never flatter than this on the screen

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

/** The disc's turn rate at radius r (its own unit), radians a second. */
function omega(r: number): number {
  return OM_CAP * min(pow(RHO1 / max(r, 1), OMEGA_POW), 1)
}

/**
 * One layer of the disc's light at disc radius r and flow angle a, t seconds into its life (0 to FLOW_T),
 * 0 to 1. ARCS broad arcs round the disc, each carried round at the pace of its radius: they cross the
 * disc straight in the middle of the layer's life, ahead outside before it and behind after it (trailing
 * spirals), one brighter side to them that turns with them, broken along the radius into streaks (which
 * stay where they are on the radius, so no streak passing turns a spot round between two arcs); and
 * knots of light the arcs carry round and inward, which form, stretch and fade with the layer. The arcs
 * are smooth waves round the disc (one crest and one trough an arc), so two layers fading into each
 * other never double them.
 */
function layer(r: number, a: number, t: number, seed: number): number {
  const om = omega(r)
  const am = a - om * (t - 0.5 * FLOW_T) // the angle this matter had in the middle of the layer's life
  const th = (2 * PI * mod(3 * seed, 5)) / 5 // each layer a fifth of a turn of its arcs on
  const side = 0.7 + 0.3 * cos(am + 2 * PI * hash3(seed, 2, 5))
  const seg = smoothstep(0.25, 0.75, vnoise(r * 0.3, 0.5, 4096, seed + 3, 0))
  const arcs = (0.5 + 0.5 * cos(ARCS * am + th)) * side * (0.55 + 0.45 * seg)
  const rho = r + KNOT_DRIFT * t
  const knot = smoothstep(0.6, 0.9, vnoise((a - om * t) * (5 / (2 * PI)), rho * 0.35, 5, seed + 1, 0))
  return mix(arcs, 1, 0.3 * knot)
}

/** The disc's light at u, 0 at its inner edge to 1 at its outer: white-hot inside, falling outward. */
function discGlow(u: number): number {
  return 1.25 * smoothstep(-0.02, 0.03, u) * pow(max(1 - 0.82 * u, 0.05), 1.7)
}
/** How far the glyphs have thinned out at u, toward the disc's rim: 1 inside, 0 at the edge. */
function edge(u: number): number {
  return 1 - smoothstep(0.8, 1, u)
}

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
/** R, the hole's radius, in points. */
function placeR(): number {
  return max(v.size * min(clamp(0.13 * placeW(), 40, 125), 0.15 * size.y), 1)
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
//   texel 1: the picture's light (0 dark to 1), seconds the raw geometry has stood still, the latched
//            pixel's size in points, the last frame's pixel size
//   texel 2: the last frame's raw centre across and up, W, R
//   texel 3: the flow's clock (a phase of FLOW_T and a count of whole periods, so it never loops and
//            keeps its precision), and the sine and cosine of the tilt it gives
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

  // the clock (calm makes it a quarter slower, and eases each cell's light faster than it once did), and the tilt it gives: the high angle at the start
  const fresh0 = first || s3.z < 0.01
  const pace = v.speed * (1 - 0.25 * v.calm)
  let ph = fresh0 ? 0.3 : s3.x + (dtc * pace) / FLOW_T
  let n = fresh0 ? 0 : s3.y
  if (ph >= 1) {
    ph = ph - 1
    n = n + 1
  }
  const tilt = (TILT_MID + TILT_SWING * cos((2 * PI * (mod(n, SWING_N) + ph)) / SWING_N)) * (PI / 180)

  const i = p.cell.x
  if (i < 0.5) return vec4(lx, ly, lw, lr)
  if (i < 1.5) return vec4(light, still, lpx, pxNow)
  if (i < 2.5) return vec4(rx, ry, rw, rr)
  return vec4(ph, n, sin(tilt), cos(tilt))
})

// ---------------------------------------------------------------- what each cell sees

// x: the disc's radius (in R / BC; 0 where the cell sees none), y: its angle in the disc's plane (on a
// jet: its height in R, signed), z: its light, w: kind (order + 4 ring + 8 spark + 16 jet + 32 dither;
// order 1 the far half of the disc, 2 the near half)
const geo: Buf = buffer({ scale: 1 / CELL_W, float: 32, filter: 'nearest' }, p => {
  const col = p.cell.x
  const row = p.cell.y
  if (row * CELL_H > size.y + CELL_H) return vec4(0, 0, 0, 0)
  const s0 = state.at(vec2(0, 0)) // drawn with the latched geometry, never the raw one
  const ck = state.at(vec2(3, 0))
  const R = max(s0.w, 1)
  const cxs = s0.x
  const cys = s0.y
  const W = max(s0.z, 1)
  const sT = max(ck.z, 0.05)
  const cT = ck.w
  const m = R / BC // points a unit of the disc's radius
  const rin = D_IN * R
  const rout = max(min(D_OUT * R, 0.546 * W), rin + 4)
  const xC = (col + 0.5) * CELL_W
  const yC = (row + 0.5) * CELL_H
  const dq = floor(hash3(col, row, 3) * 16)
  const lean = min(sqrt(0.5 / sT), 2.2)
  const ringFade = 0.15 + 0.85 * smoothstep(0.12, 0.45, sT)
  // how far the near half of the disc is in front of the circle and its ring (0 high, 1 low)
  const cover = smoothstep(COVER_HI, COVER_LO, sT)

  // six points of the cell, painted back to front: the far half of the disc, the near half outside the
  // circle and its ring, the black circle, its ring, and the near half over them as the view goes low
  let sum = 0
  let best = 0
  let sumR = 0
  let sumC = 0
  let sumS = 0
  let ringSum = 0
  let nearSum = 0
  let order = 0
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 2; i++) {
      const dx = xC + (i - 0.5) * 3 - cxs
      const dy = yC + (j - 1) * 3.3 - cys
      const Y = dy / sT // across the disc's plane, away from us above the centre
      const rho = sqrt(dx * dx + Y * Y)
      const d = sqrt(dx * dx + dy * dy)
      const inDisc = rho >= rin && rho <= rout
      const near = inDisc && Y < 0
      const overHole = d < RING_OUT * R
      // the disc's share of the point: the far half and the near half outside the circle and its ring
      // whole, the near half over them as far as it covers them, the far half there none
      const wDisc = inDisc ? (overHole ? (near ? cover : 0) : 1) : 0
      // the ring's share: whole, less what the near half of the disc covers
      const wRing = d >= R && overHole ? (near ? 1 - cover : 1) : 0
      let eD = 0
      let eR = 0
      if (wDisc > 0) {
        // the disc: brightest at its inner edge, and on the side coming towards us
        const u = (rho - rin) / (rout - rin)
        const dop = clamp(1 - DOP * (dx / max(rho, 1)) * cT * sqrt(rin / max(rho, 1)), 0.3, 1.7)
        // seen nearer edge-on, the disc's light is packed into a thinner band, so it is the brighter
        eD = wDisc * discGlow(u) * (0.35 + 0.65 * dop * dop) * lean
        sumR = sumR + (eD * rho) / m
        sumC = sumC + (eD * dx) / max(rho, 1)
        sumS = sumS + (eD * Y) / max(rho, 1)
        nearSum = nearSum + (near ? eD : 0)
      }
      if (wRing > 0) {
        // the thin ring: bright all round, a little brighter on the side coming towards us, and fainter
        // as the view turns edge-on (where the disc's own line is the bright thing)
        eR = wRing * 1.25 * (0.9 - 0.15 * (dx / max(d, 1)) * cT) * ringFade
        ringSum = ringSum + eR
      }
      const e = eD + eR
      sum = sum + e
      if (e > best) {
        best = e
        order = eR > eD ? 0 : near ? 2 : 1
      }
    }
  }
  const S = max(sum / 6, 0.65 * best)
  const discSum = sum - ringSum
  const ring = ringSum > 0.5 * sum && sum > 0 ? 1 : 0

  // the jets, slim, straight up and down along the disc's axis: the upper one is in front of everything,
  // the lower one behind the circle, its ring and the near half of the disc. A bright core, fainter at
  // the sides, fading out toward the tip
  const dxc = xC - cxs
  const dyc = yC - cys
  const h = abs(dyc) / R
  const upper = dyc > 0
  const hTop = JET_BASE + JET_LEN * cT
  const jw = (JET_W + JET_SPREAD * max(h - JET_BASE, 0)) * R
  const inJet = h >= (upper ? JET_BASE : RING_OUT) && h <= hTop && abs(dxc) < jw + 0.5 * CELL_W && (upper || nearSum <= 0)
  if (inJet) {
    const across = 0.65 * (1 - smoothstep(0, JET_CORE * R + 0.5 * CELL_W, abs(dxc))) + 0.35 * (1 - smoothstep(JET_CORE * R, jw + 0.5 * CELL_W, abs(dxc)))
    // brightest where it leaves the hole, fading out toward the tip
    const along = (1 + 0.5 * (1 - smoothstep(JET_BASE, JET_BASE + 1.2, h))) * (1 - smoothstep(JET_BASE + 0.25 * (hTop - JET_BASE), hTop, h))
    return vec4(0, upper ? h : -h, 1.6 * across * along, 16 + 32 * dq)
  }

  // sparks: round the disc and over the space beside it (not on the disc, the ring or in the circle),
  // in a plane a little thicker than the disc's, drifting in on curved paths
  if (sum <= 0) {
    const Ys = dyc / max(sT, SP_FLAT)
    const rs = sqrt(dxc * dxc + Ys * Ys) / m
    const rmax = (1.6 * rout) / m
    const xmax = 0.575 * W - 8
    const zone = smoothstep(1.4 * BC, 2 * BC, rs) * (1 - smoothstep(0.75 * rmax, rmax, rs)) * (1 - smoothstep(0.85 * xmax, xmax, abs(dxc)))
    if (zone > 0.001 && sqrt(dxc * dxc + dyc * dyc) > 1.3 * R) {
      const pw = pow(rs, 1.5)
      const s = (pw * rs) / SP_DS + SP_Q * ck.x // the label, in lattice cells, less SP_Q * the count
      const th = atan(Ys, dxc) + SP_CURL * sqrt(rs)
      const uu = th * (SP_N / (2 * PI))
      const iu = mod(floor(uu), SP_N)
      const is0 = floor(s)
      const off = SP_Q * ck.y
      const head = (5 * 2.5 * pw) / (SP_DS * m) // lattice cells of the label in 5 points along the path
      let sp = 0
      // the lattice cell the point is in, the one behind it and the one ahead (whose spark may already
      // reach back over it), so no spark appears all at once
      for (let k = -1; k < 2; k++) {
        const cs = is0 - k
        if (hash3(cs + off, iu, 211) < SP_P) {
          const sh = cs + 0.2 + 0.6 * hash3(cs + off, iu, 223)
          const tc = (iu + 0.2 + 0.6 * hash3(cs + off, iu, 227)) * ((2 * PI) / SP_N)
          const a = s - sh // behind the head (its tail) above 0
          const hf = exp(-(a / head) * (a / head))
          const tf = a > 0 ? 0.5 * max(1 - a / SP_TAIL, 0) : 0
          const dd = (mod(th - tc + PI, 2 * PI) - PI) * rs * m
          sp = max(sp, max(hf, tf) * exp(-(dd / 4) * (dd / 4)) * (0.6 + 0.8 * hash3(cs + off, iu, 229)))
        }
      }
      const lit = sp * zone
      if (lit > 0.06) return vec4(0, 0, lit, 8 + 32 * dq)
    }
  }
  return vec4(discSum > 0 ? sumR / max(discSum, 0.000001) : 0, atan(sumS, sumC), S, order + 4 * ring + 32 * dq)
})

// ---------------------------------------------------------------- the flow, a cell at a time

// x: glyph shown + 64 * glyph before, y: brightness shown (eased), z: 1 + seconds since the glyph last
// changed (0: not started), w: brightness the glyph follows (slower)
const flow: Buf = buffer({ scale: 1 / CELL_W, float: 32, filter: 'nearest' }, p => {
  const col = p.cell.x
  const row = p.cell.y
  if (row * CELL_H > size.y + CELL_H) return vec4(0, 0, 0, 0)
  const gm = geo.at(p.cell)
  const prev = flow.at(p.cell)
  const ck = state.at(vec2(3, 0)) // the clock
  const st1 = state.at(vec2(1, 0)) // the picture's light
  const s0 = state.at(vec2(0, 0))
  const S = gm.z
  const code = gm.w
  const ring = mod(floor(code / 4), 2)
  const spark = mod(floor(code / 8), 2)
  const jet = mod(floor(code / 16), 2)
  const dq = floor(code / 32)
  const calm = v.calm
  const R = max(s0.w, 1)
  const m = R / BC
  const dxp = (col + 0.5) * CELL_W - s0.x
  const dyp = (row + 0.5) * CELL_H - s0.y
  const f0 = ck.x
  const turn = mod(ck.y, 2) + f0

  let target = 0 // the brightness the cell's dots are drawn at
  let drive = 0 // what picks its glyph
  let hz = 0 // how far the cell is in the disc's white-hot inner part
  if (jet > 0.5) {
    // a jet: broken into streaks that stream outward, JET_N a clock period past each spot, each column a
    // little out of step with the next
    const wave = 0.5 + 0.5 * cos(2 * PI * (abs(gm.y) / JET_LAMBDA - JET_N * f0 + 0.3 * hash3(col, 17, 5)))
    const knot = smoothstep(0.2, 0.95, wave)
    target = S * (0.25 + 0.9 * knot) * (1 - 0.4 * calm)
    drive = 1.3 * target
  } else if (spark > 0.5) {
    target = S * (1 - 0.5 * calm)
    drive = target
  } else if (S > 0.002) {
    // the disc: two layers of arcs, each fading in and out over its life, half a period apart (so their
    // weights always sum to one), and broad waves falling in across them, one a clock period, a crest on
    // one side of the disc where the other has a trough (so the disc as a whole does not pulse)
    const r = gm.x
    const phi = gm.y
    const n1 = ck.y + floor(f0 + 0.5)
    const w0 = 0.5 - 0.5 * cos(2 * PI * f0)
    const arcs = w0 * layer(r, phi, f0 * FLOW_T, 2 * ck.y) + (1 - w0) * layer(r, phi, fract(f0 + 0.5) * FLOW_T, 2 * n1 + 1)
    const wave = 0.5 + 0.5 * cos(2 * PI * (r * RINGS + f0)) * sin(phi)
    // an arc's crest is 1.3, the light between them GAP; calm narrows that. The brightest of the disc never
    // goes dark (there the arcs whiten the light), and the disc over the circle and its ring (the hole sits
    // in it like a ball in a dish) keeps some light between its arcs
    const pat = 0.75 * arcs + 0.25 * wave
    const front = smoothstep(1.3, 1.15, sqrt(dxp * dxp + dyp * dyp) / R)
    const gap = mix(mix(GAP, 0.45, smoothstep(0.9, 1.6, S)), 0.2, front)
    const lane = mix(mix(gap, 0.58, calm), 1.3 - 0.2 * calm, min(pat * 1.35, 1))
    const base = (1.35 * S) / (0.32 + S) // the fixed light, eased off at the top so the arcs still show
    // the ring glows steadily, and a hot arc travels round it (the way the disc turns), a turn every
    // 2 FLOW_T / RING_HALF seconds
    const arcAt = (fract(RING_HALF * 0.5 * turn + 0.25) * 2 - 1) * PI
    const da = (mod(atan(dyp, dxp) - arcAt + PI, 2 * PI) - PI) / 0.42
    const hot = exp(-da * da)
    target = ring > 0.5 ? base * 0.45 * (1 + 3.2 * (1 - 0.6 * calm) * hot) : base * lane
    // the glyphs follow the arcs too: dense on a crest, sparse between (less so over the circle), denser
    // where the disc is bright, thinning out toward its rim; and the ring's glyphs grow under the hot arc
    const routM = max(min(D_OUT * R, 0.546 * max(s0.z, 1)), D_IN * R + 4) / m
    const u = (r - R_IN) / (routM - R_IN)
    const lo = mix(mix(mix(LO_DIM, LO_BRIGHT, smoothstep(0.4, 0.9, S)), 0.4, front), 0.85, calm)
    const dens = min(DENS * pow(S, DENS_P), 1.05) * edge(u)
    drive = ring > 0.5 ? base * (1 + 0.5 * hot) : dens * mix(lo, 1, pat)
    hz = ring > 0.5 ? 0 : 1 - smoothstep(HOT_IN, HOT_OUT, u)
  }

  // ease what is shown; the glyph follows a copy of its own, with a margin and a rest between changes
  const dtc = clamp(dt, 0, 0.1)
  const kF = 1 - exp(-dtc / mix(0.07, 0.18, calm))
  const kS = 1 - exp(-dtc / mix(0.12, 0.45, calm))
  // a start: an empty or cleared buffer, or a picture faded to the ground (where the geometry may be
  // new): each cell takes its light and its glyph as they are, unseen
  const start = first || prev.z < 0.5 || st1.x < 0.001
  const shown = start ? target : mix(prev.y, target, kF)
  // every cell keeps a glyph at least HOLD seconds (a bright one longer: there a glyph's dots turning
  // over are a large swing), so no dot turns over more than twice a second
  const rest = mix(max(mix(HOLD, 1, smoothstep(0.45, 1, shown)), HOT_REST * hz), 1.8, calm)
  const slow = start ? drive : mix(prev.w, drive, kS)
  // the glyph's level: from the light, with a fixed offset of the cell's own (no part of it changes
  // from frame to frame by itself), and a margin each way at the blank
  const dither = (dq / 15 - 0.5) * 0.9
  const gc = mod(prev.x, 64)
  // a blank cell takes its glyph from the light as it is now, so a spark arriving shows at once
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
    (want < 0.5 || gc < 0.5 || abs(L - gc) > 0.5 + HYST + HOT_HYST * hz) &&
    // a spark's glyph only grows or goes: its tail fades in colour, not down the ramp, whose glyphs
    // would turn its dots round one after another
    (spark < 0.5 || want > gc || want < 0.5) &&
    // a glyph grows only while its light rises and thins only while it falls, so a dot is never turned
    // round against the light (which would add a swing)
    (ring > 0.5 || (want > gc ? target >= prev.y : target <= prev.y))
  ) {
    before = gc
    cur = want
    since = 0
  }
  return vec4(cur + 64 * before, shown, since + 1, slow)
})

// ---------------------------------------------------------------- what each cell shows

/** The disc's colour at heat k (1 at its inner edge, 0 at its rim): white-hot, yellow, orange, dark red. */
function heatR(k: number): number {
  return 0.55 + 0.45 * smoothstep(0, 0.45, k) - 0.05 * smoothstep(0.75, 1, k)
}
function heatG(k: number): number {
  return 0.08 + 0.3 * smoothstep(0.15, 0.55, k) + 0.5 * smoothstep(0.45, 1, k)
}
function heatB(k: number): number {
  return 0.03 + 0.25 * smoothstep(0.3, 0.65, k) + 0.42 * smoothstep(0.55, 0.95, k)
}

// x: glyph + 32 * glyph before + 1024 * fade (0..31) + 32768 * the ground's light (0..15),
// y z w: the colour its dots are drawn in
const look: Buf = buffer({ scale: 1 / CELL_W, float: 32, filter: 'nearest' }, p => {
  const col = p.cell.x
  const row = p.cell.y
  const st = flow.at(p.cell)
  const gm = geo.at(p.cell)
  const code = st.x
  const gc = mod(code, 64)
  const gp = mod(floor(code / 64), 64)
  const fd = clamp((st.z - 1) / FADE, 0, 1)
  const t = clamp(st.y, 0, 1.3)
  const kind = gm.w
  const ring = mod(floor(kind / 4), 2)
  const spark = mod(floor(kind / 8), 2)
  const jet = mod(floor(kind / 16), 2)
  // the picture's light: 0 at the start and while the geometry changes, 1 when settled
  const light = clamp(state.at(vec2(1, 0)).x, 0, 1)
  // the circle: its ground goes from the ground's colour at its edge to black inside (as the picture's
  // light comes up, so a fade takes it with the rest)
  const s0 = state.at(vec2(0, 0))
  const R = max(s0.w, 1)
  const dxc = (col + 0.5) * CELL_W - s0.x
  const dyc = (row + 0.5) * CELL_H - s0.y
  const dc = sqrt(dxc * dxc + dyc * dyc) / R
  const shade = 1 - light * (1 - smoothstep(0.8, 1.02, dc))

  // the colour: on the disc by its heat (from its radius: white-hot over its inner third, then yellow,
  // orange, and dark red at its rim; a crest a little whiter) and its light
  const m = R / BC
  const routM = max(min(D_OUT * R, 0.546 * max(s0.z, 1)), D_IN * R + 4) / m
  const k = clamp(1.6 - (1.7 * (gm.x - R_IN)) / (routM - R_IN) + 0.15 * smoothstep(0.45, 1.3, t), 0, 1)
  const lvl = 0.2 + 0.8 * smoothstep(0, 0.7, t)
  // (the red is full early, so a small rise and fall of a bright spot's light does not turn it round)
  let cr = heatR(k) * (0.2 + 0.8 * smoothstep(0, 0.4, t))
  let cg = heatG(k) * lvl
  let cb = heatB(k) * lvl
  if (ring > 0.5) {
    // the ring white-gold, whitest under the hot arc, and blue-white at its top and bottom where the jets
    // leave it
    const lr = 0.55 + 0.45 * smoothstep(0.3, 1.1, t)
    const pole = 1 - smoothstep(0.22, 0.42, abs(dxc) / R)
    cr = mix(1, 0.7, pole) * lr
    cg = mix(0.86 + 0.1 * smoothstep(0.8, 1.2, t), 0.82, pole) * lr
    cb = mix(0.62 + 0.3 * smoothstep(0.8, 1.2, t), 1, pole) * lr
  }
  if (jet > 0.5) {
    // the jets blue-white, whiter in a knot
    const wj = smoothstep(0.5, 1.1, t)
    cr = mix(0.32, 0.78, wj) * lvl
    cg = mix(0.52, 0.88, wj) * lvl
    cb = lvl
  }
  if (spark > 0.5 || (jet < 0.5 && ring < 0.5 && gm.x <= 0)) {
    // the sparks warm, a bright one near white, sinking into the ground as they fade
    const ws = smoothstep(0.5, 1.2, t)
    const ls = smoothstep(0, 0.6, t)
    cr = ls
    cg = mix(0.5, 0.85, ws) * ls
    cb = mix(0.22, 0.65, ws) * ls
  }
  // dimmed, and faded toward the ground by the picture's light
  const keep = 1 - v.dim
  return vec4(
    gc + 32 * gp + 1024 * floor(fd * 31 + 0.5) + 32768 * floor(shade * 15 + 0.5),
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
  const keep = 1 - v.dim

  // the dot: one point square, read at the pixel's centre, so every pixel is wholly dot or wholly
  // ground (no blur); the glyph's foot sits on a pixel edge, and the cell's edges are whole points
  const foot = floor(1.5 / max(px, 0.05) + 0.5) * px
  const dc = floor(ptx - col * CELL_W)
  const dr = floor(foot + 7 - (pty - row * CELL_H))
  const gc = mod(code, 32)
  const gp = mod(floor(code * (1 / 32)), 32)
  const fd = mod(floor(code * (1 / 1024)), 32) * (1 / 31)
  const inside = dc < 4.5 && dr > -0.5 && dr < 6.5
  const rr = clamp(dr, 0, 6)
  const sh = int(4 - clamp(dc, 0, 4))
  const bc = signed((FONT.at(gc * 7 + rr) >> sh) & 1)
  const bp = signed((FONT.at(gp * 7 + rr) >> sh) & 1)
  const cov = inside ? mix(bp, bc, fd) : 0
  // the ground, black in the circle
  const gl = floor(code * (1 / 32768)) * (keep / 15)
  return vec4(GR * gl + (st.y - GR * gl) * cov, GG * gl + (st.z - GG * gl) * cov, GB * gl + (st.w - GB * gl) * cov, 1)
})

export default shader({ fps: 30, passes: [state, geo, flow, look, art] })
