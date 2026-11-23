// Shared helpers for the black hole's stability tests (blackhole-geometry*.test.mjs, blackhole-stability.test.mjs).
// Not a test file: Node's runner only picks up *.test.mjs, and tools/tests/index.js does not import it.
//
// WHAT THE TESTS ASSUME ABOUT tools/render.mjs (nothing has to be added to it): a run can change the inputs
// between the frames of one Renderer by writing what the Renderer and the stand-in already keep in plain,
// public fields. `drive()` below does exactly this, before frame f is run:
//   - the window in points:   `r.pw = ..; r.ph = ..; S.setVec(S.size, pw, ph)`   (S is re-exported by render.mjs;
//     runFrame reads this.pw and this.ph for `px`, every cell's point and the buffers' fit, so the next frame
//     is drawn for the new window; the pixel size `res` stays what it was at construction)
//   - the prompt box:         `S.setVec(S.composer, left, bottom, right, top)`
//   - the values:             `S.state.values = { ... }`  (the stand-in's values() reads state.values at each use)
//   - the frame time:         `r.fps = n` (runFrame sets dt = 1 / this.fps and time = f / this.fps on every frame; the
//     shader reads only dt, so alternating fps between two numbers alternates the frame time)
// If the tool ever grows a method for these, `drive()` is the one place to change.
//
// A run whose window changes keeps `res` fixed at the LARGEST window, so the picture's samples never change
// shape (the flash estimator needs that); while the window is smaller than `res` a sample is a little under
// a point wide, which makes any area measured in samples a little over what it is in points (conservative).
import { GROUND, loadShader, Renderer, S } from '../render.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const SHADER = path.join(ROOT, 'hooks', 'wallpapers', 'blackhole', 'shader.ts')
export const PROMPT = [0.2, 0.05, 0.8, 0.15]
export const BASE = { dim: 0, speed: 1, fps: 0, calm: 0, size: 1 }
export const SIZE_RANGE = [0.6, 1.4]

const lin = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
export const GROUND_LUM = 0.2126 * lin(GROUND[0] / 255) + 0.7152 * lin(GROUND[1] / 255) + 0.0722 * lin(GROUND[2] / 255)
export const excess = v => Math.max(0, v - GROUND_LUM)
export const held = (range, v) => {
  const [lo, hi] = range
  const c = Math.min(Math.max(v, lo), hi)
  return lo + (Math.round(((c - lo) / (hi - lo)) * 1023) / 1023) * (hi - lo)
}

/** The contract's (v2) W, centre and R, in points with y up. A box under 80 points wide counts as none. */
export function geometry(points, composer, sizeValue = 1) {
  const [sx, sy] = points
  const [l, , rt] = composer
  const none = composer.every(v => v === 0) || (rt - l) * sx < 80
  const W = none ? 0.6 * sx : (rt - l) * sx
  const cx = none ? sx / 2 : ((l + rt) / 2) * sx
  const cy = none ? sy / 2 : 0.57 * sy
  const R = sizeValue * Math.min(Math.min(Math.max(0.16 * W, 48), 150), 0.18 * sy)
  return { W, cx, cy, R, size: sizeValue }
}

/** Mean excess luminance (above the ground) over the disc's box about the centre: |x - cx| <= 0.575 W, |y - cy| <= 0.35 W, clipped to the picture (the lit disc's extent follows W, not `size`). `lum` is top row first, one pixel to the point. */
export function discMean(lum, w, h, g) {
  const s = 1
  const x0 = Math.max(0, Math.floor(g.cx - 0.575 * g.W * s))
  const x1 = Math.min(w - 1, Math.ceil(g.cx + 0.575 * g.W * s))
  const y0 = Math.max(0, Math.floor(g.cy - 0.35 * g.W * s))
  const y1 = Math.min(h - 1, Math.ceil(g.cy + 0.35 * g.W * s))
  let sum = 0
  let n = 0
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      sum += excess(lum[(h - 1 - y) * w + x])
      n++
    }
  }
  return n ? sum / n : 0
}

/**
 * The shadow's centre and R off a frame's luminance, read from the UPPER half of the circle only (the tilted look's front band
 * crosses the lower half). Needs pitch 1. The picture is made of character cells (6 by 10 points, on a fixed grid from the
 * window's corner) whose dots light only part of a cell, so the shadow's edge is read in whole cells: a cell is dark when the
 * mean excess luminance over its block is under 0.01 (a cell counts as lit by where its centre is, so this puts the edge at
 * the circle, not up to a cell inside it). Four chords, the rows of cells at 0.35, 0.5, 0.65 and 0.8 R above the expected
 * centre, each the run of dark cells walked out from the expected centre column; the top edge, the run of dark cells up that
 * column; and a circle fitted (least squares, algebraic) through the chords' ends and the top edge. The closed form from two
 * chords at heights y1, y2 with half-lengths L1, L2, cy = (y1 + y2) / 2 - (L1^2 - L2^2) / (2 (y2 - y1)) and
 * R = sqrt(L1^2 + (y1 - cy)^2), is the same fit with two chords; more chords keep one cell's error from moving the centre.
 * Gives { cx, cy, R }; null when the middle is not dark at the expected centre.
 */
export function measureShadow(L, w, h, g) {
  const CW = 6
  const CH = 10
  const T = 0.01
  const cellDark = (c, r) => {
    let s = 0
    let n = 0
    for (let y = r * CH; y < Math.min(h, (r + 1) * CH); y++) {
      for (let x = c * CW; x < Math.min(w, (c + 1) * CW); x++) {
        s += excess(L[(h - 1 - y) * w + x])
        n++
      }
    }
    return n > 0 && s / n < T
  }
  const cols = Math.ceil(w / CW)
  const rows = Math.ceil(h / CH)
  const c0 = Math.min(cols - 1, Math.floor(g.cx / CW))
  const pts = []
  for (const k of [0.35, 0.5, 0.65, 0.8]) {
    const r = Math.floor((g.cy + k * g.R) / CH)
    if (r < 0 || r >= rows || !cellDark(c0, r)) return null
    let a = c0
    let b = c0
    while (a - 1 >= 0 && cellDark(a - 1, r)) a--
    while (b + 1 < cols && cellDark(b + 1, r)) b++
    const y = (r + 0.5) * CH
    pts.push([a * CW, y], [(b + 1) * CW, y])
  }
  const mid = pts.reduce((s, p) => s + p[0], 0) / pts.length
  // the top edge: up the column of cells through the chords' middle
  const cm = Math.min(cols - 1, Math.max(0, Math.floor(mid / CW)))
  let top = Math.floor((g.cy + 0.8 * g.R) / CH)
  if (top >= rows || !cellDark(cm, top)) return null
  while (top + 1 < rows && cellDark(cm, top + 1)) top++
  pts.push([mid, (top + 1) * CH])
  // circle fit: minimise the sum of (x^2 + y^2 + D x + E y + F)^2 about the points' mean
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length
  const my = pts.reduce((s, p) => s + p[1], 0) / pts.length
  let sxx = 0
  let sxy = 0
  let syy = 0
  let sx = 0
  let sy = 0
  let sxz = 0
  let syz = 0
  let sz = 0
  for (const [px, py] of pts) {
    const x = px - mx
    const y = py - my
    const z = x * x + y * y
    sxx += x * x
    sxy += x * y
    syy += y * y
    sx += x
    sy += y
    sxz += x * z
    syz += y * z
    sz += z
  }
  const n = pts.length
  // normal equations for (D, E, F): [sxx sxy sx; sxy syy sy; sx sy n] (D, E, F) = -(sxz, syz, sz)
  const M = [[sxx, sxy, sx, -sxz], [sxy, syy, sy, -syz], [sx, sy, n, -sz]]
  for (let c = 0; c < 3; c++) {
    let p = c
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    ;[M[c], M[p]] = [M[p], M[c]]
    if (Math.abs(M[c][c]) < 1e-9) return null
    for (let r = 0; r < 3; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k]
    }
  }
  const D = M[0][3] / M[0][0]
  const E = M[1][3] / M[1][1]
  const F = M[2][3] / M[2][2]
  const R2 = (D * D + E * E) / 4 - F
  if (!(R2 > 0)) return null
  return { cx: mx - D / 2, cy: my - E / 2, R: Math.sqrt(R2) }
}

/** Is a measured shadow at the formulas' place: centre within 8 points, R within the larger of 15% and 8 points? Returns '' or why not. */
export function placeProblem(m, g) {
  if (!m) return `the middle is not dark at the expected centre (${g.cx.toFixed(0)}, ${g.cy.toFixed(0)})`
  if (Math.abs(m.cx - g.cx) > 8) return `centre across ${m.cx.toFixed(1)}, formula ${g.cx.toFixed(1)}`
  if (Math.abs(m.cy - g.cy) > 8) return `centre up ${m.cy.toFixed(1)}, formula ${g.cy.toFixed(1)}`
  if (Math.abs(m.R - g.R) > Math.max(0.15 * g.R, 8)) return `R ${m.R.toFixed(1)}, formula ${g.R.toFixed(1)}`
  return ''
}

/** The renderer's buffers by name: lens (the `once` buffer), state (4 by 1 texels), geo, flow and look (the buffers drawn at a texel a cell, in pass order). Needs frame 0 to have run. */
export function findBuffers(r) {
  const bs = r.shader.passes.filter(b => b.kind === 'buffer' && b.data)
  const cells = bs.filter(b => b.options.scale !== undefined)
  const found = { lens: bs.find(b => b.once), state: bs.find(b => b.w === 4 && b.h === 1), geo: cells[0], flow: cells[1], look: cells[2] }
  for (const k of Object.keys(found)) if (!found[k]) throw new Error(`blackhole-kit: no ${k} buffer found in the shader's passes`)
  return found
}

/**
 * Runs the shader frame by frame.
 *   res, points, composer, values: as the Renderer takes them (values over BASE); shader: a shader file (default the one under hooks/)
 *   frames: how many frames to run (0 to frames - 1)
 *   draw(f): whether frame f's picture is wanted (undrawn frames are only stepped, which is cheap)
 *   tweak(f, api): called before frame f; api = { setWindow([pw, ph]), setComposer([l, b, r, t]), setValues(obj), setFps(n),
 *     buffers(), snapshot(buf), clearBuffer(buf), restoreBuffer(buf, copy) }
 *   onFrame(f, pic, r): called for each drawn frame with the premultiplied picture (y up) and the renderer
 * Returns the renderer's count of non-finite values.
 */
export async function drive({ res, points = res, composer = PROMPT, values = {}, frames, draw, tweak, onFrame, fps, shader: shaderFile = SHADER }) {
  const shader = await loadShader(shaderFile)
  const r = new Renderer(shader, { res, points, composer, values: { ...BASE, ...values }, fps })
  const api = {
    setWindow: ([pw, ph]) => {
      r.pw = pw
      r.ph = ph
      S.setVec(S.size, pw, ph)
    },
    setComposer: c => S.setVec(S.composer, ...c),
    setValues: v => {
      S.state.values = { ...BASE, ...v }
    },
    setFps: n => {
      r.fps = n
    },
    // The renderer's buffers, for a test that empties or restores one between frames (the app can lose a buffer's
    // contents, say at a resize). `buffers()` finds them in the shader's pass list once frame 0 has run:
    // lens (the `once` buffer), state (4 by 1 texels) and geo (the first buffer drawn at a texel a cell).
    // `snapshot` copies what a buffer holds, `clearBuffer` zeroes it (what the next frame reads), `restoreBuffer` puts a copy back.
    buffers: () => findBuffers(r),
    snapshot: b => new Float32Array(b.data),
    clearBuffer: b => {
      b.data.fill(0)
      b.next.fill(0)
    },
    restoreBuffer: (b, copy) => {
      b.data.set(copy)
    },
  }
  for (let f = 0; f < frames; f++) {
    if (tweak) tweak(f, api)
    const { pic } = r.runFrame(f, draw(f))
    if (pic && onFrame) onFrame(f, pic, r)
  }
  return r.badValues()
}

/** One lane (0 red, 1 green, 2 blue) of a premultiplied picture drawn over the ground, 0 to 1 encoded (not luminance), y up. */
export function lane(pic, k) {
  const out = new Float32Array(pic.length / 4)
  for (let i = 0; i < out.length; i++) out[i] = pic[i * 4 + k] + (GROUND[k] / 255) * (1 - pic[i * 4 + 3])
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// Contract v4 (the look): measuring a rendered frame. `lum` is the tool's luminance, top row first; one pixel to the
// point (res = points); (x, y) below are in points, y up, a sample's centre at (i + 0.5, j + 0.5).

/** The luminance of the sample at column i, row j counted from the bottom. */
export const lumAt = (lum, w, h, i, j) => lum[(h - 1 - j) * w + i]

/** Calls fn(i, j, x, y, value) for every sample whose centre is in the disc's box (|x - cx| <= 0.575 W, |y - cy| <= 0.35 W). */
export function eachInDiscBox(lum, w, h, g, fn) {
  const x0 = Math.max(0, Math.floor(g.cx - 0.575 * g.W))
  const x1 = Math.min(w - 1, Math.ceil(g.cx + 0.575 * g.W))
  const y0 = Math.max(0, Math.floor(g.cy - 0.35 * g.W))
  const y1 = Math.min(h - 1, Math.ceil(g.cy + 0.35 * g.W))
  for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) fn(i, j, i + 0.5, j + 0.5, lum[(h - 1 - j) * w + i])
}

/**
 * The roll: the angle (degrees, counter-clockwise from the horizontal, y up, in (-90, 90]) of the principal axis of the
 * luminance above the ground over the disc's box: the weights are the excess luminance, the axis is that of the
 * second moments about the weighted centroid.
 */
export function rollDegrees(lum, w, h, g) {
  let sw = 0
  let sx = 0
  let sy = 0
  eachInDiscBox(lum, w, h, g, (_i, _j, x, y, v) => {
    const e = excess(v)
    sw += e
    sx += e * x
    sy += e * y
  })
  if (sw <= 0) return NaN
  const mx = sx / sw
  const my = sy / sw
  let cxx = 0
  let cyy = 0
  let cxy = 0
  eachInDiscBox(lum, w, h, g, (_i, _j, x, y, v) => {
    const e = excess(v)
    cxx += e * (x - mx) ** 2
    cyy += e * (y - my) ** 2
    cxy += e * (x - mx) * (y - my)
  })
  return (0.5 * Math.atan2(2 * cxy, cxx - cyy) * 180) / Math.PI
}

/** u along the long axis (rolled by phi degrees), v across it, v up the window, about the centre. */
export function toUV(x, y, g, phiDeg) {
  const p = (phiDeg * Math.PI) / 180
  const dx = x - g.cx
  const dy = y - g.cy
  return { u: dx * Math.cos(p) + dy * Math.sin(p), v: -dx * Math.sin(p) + dy * Math.cos(p) }
}

/**
 * Item 2 (reworded 2026-11-23): the front band. In the strip |u| <= 0.15 R, among the samples with v between -0.9 R and
 * -0.1 R, the lit ones (excess luminance over 0.03) span (highest v minus lowest) at least 0.25 R, and at least 30% of the
 * samples between the highest and the lowest lit one are lit. Gives { n (lit samples), span (R), fraction (lit among the
 * samples between the highest and lowest lit one) }.
 */
export function frontBand(lum, w, h, g, phiDeg) {
  const samples = []
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const { u, v } = toUV(i + 0.5, j + 0.5, g, phiDeg)
      if (Math.abs(u) > 0.15 * g.R || v > -0.1 * g.R || v < -0.9 * g.R) continue
      samples.push([v, excess(lum[(h - 1 - j) * w + i]) > 0.03])
    }
  }
  let lo = Infinity
  let hi = -Infinity
  let n = 0
  for (const [v, lit] of samples) {
    if (!lit) continue
    n++
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  if (!n) return { n: 0, span: 0, fraction: 0 }
  let between = 0
  let litBetween = 0
  for (const [v, lit] of samples) {
    if (v < lo || v > hi) continue
    between++
    if (lit) litBetween++
  }
  return { n, span: (hi - lo) / g.R, fraction: litBetween / between }
}


/** Mean excess luminance over the samples whose (u, v) satisfy test(u, v) (units of R). */
export function meanInUV(lum, w, h, g, phiDeg, test) {
  let s = 0
  let n = 0
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const { u, v } = toUV(i + 0.5, j + 0.5, g, phiDeg)
      if (test(u / g.R, v / g.R)) {
        s += excess(lum[(h - 1 - j) * w + i])
        n++
      }
    }
  }
  return { mean: n ? s / n : 0, n }
}

/** Item 4: the means of the disc's box for u < 0 and u > 0. */
export function sideMeans(lum, w, h, g, phiDeg) {
  let l = 0
  let nl = 0
  let r = 0
  let nr = 0
  eachInDiscBox(lum, w, h, g, (_i, _j, x, y, v) => {
    const { u } = toUV(x, y, g, phiDeg)
    if (u < 0) {
      l += excess(v)
      nl++
    } else {
      r += excess(v)
      nr++
    }
  })
  return { left: nl ? l / nl : 0, right: nr ? r / nr : 0 }
}

/** Item 8: the mean of colour lane `k` (0 red, 2 blue) of the picture over the circle of radius 0.35 R centred 0.4 R above the centre along v. */
export function coreLane(pic, w, h, g, phiDeg, k) {
  const p = (phiDeg * Math.PI) / 180
  const ccx = g.cx - 0.4 * g.R * Math.sin(p)
  const ccy = g.cy + 0.4 * g.R * Math.cos(p)
  const L = lane(pic, k) // y up, row 0 at the bottom
  let s = 0
  let n = 0
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (Math.hypot(i + 0.5 - ccx, j + 0.5 - ccy) <= 0.35 * g.R) {
        s += L[j * w + i]
        n++
      }
    }
  }
  return n ? s / n : NaN
}

/** Item 9: the median distance from the centre (in R) of the brightest 0.5% of the samples. */
export function brightestMedian(lum, w, h, g) {
  const sorted = Float32Array.from(lum).sort()
  const thr = sorted[Math.max(0, Math.ceil(sorted.length * 0.995) - 1)]
  const d = []
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (lum[(h - 1 - j) * w + i] >= thr) d.push(Math.hypot(i + 0.5 - g.cx, j + 0.5 - g.cy) / g.R)
    }
  }
  d.sort((a, b) => a - b)
  return { median: d[Math.floor(d.length / 2)], count: d.length }
}

// ---------------------------------------------------------------------------------------------------------------
// What the eye can see of the motion and the texture (blackhole-visible.test.mjs): one run of a shader file, measured.

const GLYPH_BASE = 64 // flow.x = glyph shown + 64 * glyph before + 4096 * stray colour

/**
 * Runs `shaderFile` (default: the shader under hooks/) on 600 by 378 points with the standard prompt box, dim 0, speed 1,
 * calm 0, size 1, frames 0 to 164 (frames 60 to 164 drawn), and measures:
 *   M: the mean over frames 60 to 149 of the mean over the disc's box of |L(t + 15) - L(t)| (luminance), divided by the mean
 *      over frames 60 to 164 of the mean over the disc's box of the luminance above the ground
 *   glyphs (frame 90): over the cells that see the disc (geo.x > 0, not ring, not stray) and are lit (glyph above 0): { cells,
 *      top (the commonest glyph's share), common (the number of glyphs holding 4% or more each) }
 *   lanes (frame 90): the cells that see the disc in the middle third by radius, their brightness (flow.y) by angle in bins
 *      of 10 degrees: { spread: (90th percentile - 10th) / mean of the bins' means }
 *   changed: over frames 60 to 164, the share of the lit disc cells (lit at frame 90) that change their glyph at least once
 *   mostIn1s: the most glyph changes any such cell makes in any 30 consecutive frames (29 steps)
 *   strays: for frames 60, 90, 120 and 150, the cells of kind stray (geo.w, floor(w / 8) % 4 above 0) whose brightness drawn
 *      (flow.y) is 0.15 or more, counted over the whole window
 */
export async function visibleMetrics(shaderFile = SHADER) {
  const points = [600, 378]
  const g = geometry(points, PROMPT)
  const [w, h] = points
  const x0 = Math.max(0, Math.floor(g.cx - 0.575 * g.W))
  const x1 = Math.min(w - 1, Math.ceil(g.cx + 0.575 * g.W))
  const y0 = Math.max(0, Math.floor(g.cy - 0.35 * g.W))
  const y1 = Math.min(h - 1, Math.ceil(g.cy + 0.35 * g.W))
  const boxes = {}
  let cells = null
  let strayCells = null
  const glyphs = {}
  let lanes = null
  const strays = {}
  const bad = await drive({
    res: points,
    points,
    composer: PROMPT,
    frames: 165,
    draw: f => f >= 60,
    shader: shaderFile,
    onFrame: (f, pic, r) => {
      const lum = r.luminance(pic)
      const box = new Float32Array((x1 - x0 + 1) * (y1 - y0 + 1))
      let k = 0
      for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) box[k++] = lum[(h - 1 - j) * w + i]
      boxes[f] = box
      const b = findBuffers(r)
      if (!cells) {
        // the cells that see the disc, and the stray cells, from the first drawn frame's geo (it does not change in a run)
        const index = []
        const radius = []
        const angle = []
        for (let t = 1; t < b.geo.w * b.geo.h; t++) {
          const x = b.geo.data[t * 4]
          if (!(x > 0)) continue
          const code = b.geo.data[t * 4 + 3]
          if (Math.floor(code / 4) % 2 === 1 || Math.floor(code / 8) % 4 !== 0) continue
          index.push(t)
          radius.push(x)
          angle.push((((b.geo.data[t * 4 + 1] % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)))
        }
        cells = { index, radius, angle }
        strayCells = []
        for (let t = 1; t < b.geo.w * b.geo.h; t++) if (Math.floor(b.geo.data[t * 4 + 3] / 8) % 4 !== 0) strayCells.push(t)
      }
      glyphs[f] = Uint8Array.from(cells.index, t => b.flow.data[t * 4] % GLYPH_BASE)
      if (f === 90) {
        const order = Array.from(cells.index.keys()).sort((p, q) => cells.radius[p] - cells.radius[q])
        const mid = order.slice(Math.floor(order.length / 3), Math.floor((2 * order.length) / 3))
        const sum = new Float64Array(36)
        const cnt = new Float64Array(36)
        for (const i of mid) {
          const bin = Math.min(35, Math.floor((cells.angle[i] / (2 * Math.PI)) * 36))
          sum[bin] += b.flow.data[cells.index[i] * 4 + 1]
          cnt[bin]++
        }
        const means = []
        for (let q = 0; q < 36; q++) if (cnt[q]) means.push(sum[q] / cnt[q])
        means.sort((p, q) => p - q)
        const pick = p => means[Math.min(means.length - 1, Math.floor(p * (means.length - 1) + 0.5))]
        const mean = means.reduce((s, v) => s + v, 0) / means.length
        lanes = { spread: (pick(0.9) - pick(0.1)) / mean, bins: means.length, cells: mid.length }
      }
      if ([60, 90, 120, 150].includes(f)) {
        let n = 0
        for (const t of strayCells) if (b.flow.data[t * 4 + 1] >= 0.15) n++
        strays[f] = n
      }
    },
  })
  // M
  let num = 0
  let nn = 0
  for (let t = 60; t + 15 <= 164; t++) {
    const a = boxes[t]
    const c = boxes[t + 15]
    let s = 0
    for (let i = 0; i < a.length; i++) s += Math.abs(c[i] - a[i])
    num += s / a.length
    nn++
  }
  let den = 0
  for (let t = 60; t <= 164; t++) {
    let s = 0
    for (const v of boxes[t]) s += excess(v)
    den += s / boxes[t].length
  }
  const M = num / nn / (den / 105)
  // glyph shares at frame 90 over the lit cells
  const at90 = glyphs[90]
  const litIdx = []
  for (let i = 0; i < at90.length; i++) if (at90[i] > 0) litIdx.push(i)
  const tally = new Map()
  for (const i of litIdx) tally.set(at90[i], (tally.get(at90[i]) ?? 0) + 1)
  const shares = [...tally.values()].sort((p, q) => q - p).map(v => v / litIdx.length)
  // glyph changes over the lit cells
  let changed = 0
  let mostIn1s = 0
  for (const i of litIdx) {
    const flips = []
    for (let f = 61; f <= 164; f++) flips.push(glyphs[f][i] !== glyphs[f - 1][i] ? 1 : 0)
    if (flips.some(v => v)) changed++
    let win = flips.slice(0, 29).reduce((s, v) => s + v, 0)
    mostIn1s = Math.max(mostIn1s, win)
    for (let k = 29; k < flips.length; k++) {
      win += flips[k] - flips[k - 29]
      mostIn1s = Math.max(mostIn1s, win)
    }
  }
  return {
    bad,
    M,
    discCells: cells.index.length,
    glyphs: { cells: litIdx.length, top: shares[0] ?? 0, common: shares.filter(v => v >= 0.04).length, shares: shares.slice(0, 8) },
    lanes,
    changed: litIdx.length ? changed / litIdx.length : 0,
    mostIn1s,
    strays,
  }
}
