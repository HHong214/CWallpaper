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

/** The shadow's centre and R off a frame's luminance (as blackhole.test.mjs reads it: chords at 0.45 R, heights at 0.4 R). Null when the middle is not dark at the expected centre. Needs pitch 1. */
export function measureShadow(L, w, h, g) {
  const T = 0.03
  const at = (x, y) => excess(L[(h - 1 - y) * w + x])
  const band = 0.06 * g.R
  const chordAt = dy => {
    const y0 = Math.max(0, Math.round(g.cy + dy * g.R - band))
    const y1 = Math.min(h - 1, Math.round(g.cy + dy * g.R + band))
    const prof = x => {
      let s = 0
      for (let y = y0; y <= y1; y++) s += at(x, y)
      return s / (y1 - y0 + 1)
    }
    let a = Math.round(g.cx)
    let b = a
    if (prof(a) >= T) return null
    while (a - 1 >= 0 && prof(a - 1) < T) a--
    while (b + 1 < w && prof(b + 1) < T) b++
    return { lo: a, hi: b + 1 }
  }
  const heightAt = dx => {
    const x0 = Math.max(0, Math.round(g.cx + dx * g.R - band))
    const x1 = Math.min(w - 1, Math.round(g.cx + dx * g.R + band))
    const prof = y => {
      let s = 0
      for (let x = x0; x <= x1; x++) s += at(x, y)
      return s / (x1 - x0 + 1)
    }
    let up = Math.floor(g.cy + 0.5 * g.R)
    let down = Math.floor(g.cy - 0.5 * g.R)
    if (prof(up) >= T || prof(down) >= T) return null
    while (up + 1 < h && prof(up + 1) < T) up++
    while (down - 1 >= 0 && prof(down - 1) < T) down--
    return { lo: down, hi: up + 1 }
  }
  const chords = [chordAt(0.45), chordAt(-0.45)]
  const heights = [heightAt(0.4), heightAt(-0.4)]
  if (chords.includes(null) || heights.includes(null)) return null
  const mean = xs => xs.reduce((s, v) => s + v, 0) / xs.length
  return {
    cx: mean(chords.map(c => (c.lo + c.hi) / 2)),
    cy: mean(heights.map(c => (c.lo + c.hi) / 2)),
    R:
      (mean(chords.map(c => (c.hi - c.lo) / 2)) / Math.sqrt(1 - 0.45 * 0.45) +
        mean(heights.map(c => (c.hi - c.lo) / 2)) / Math.sqrt(1 - 0.4 * 0.4)) /
      2,
  }
}

/** Is a measured shadow at the formulas' place: centre within 8 points, R within the larger of 15% and 8 points? Returns '' or why not. */
export function placeProblem(m, g) {
  if (!m) return `the middle is not dark at the expected centre (${g.cx.toFixed(0)}, ${g.cy.toFixed(0)})`
  if (Math.abs(m.cx - g.cx) > 8) return `centre across ${m.cx.toFixed(1)}, formula ${g.cx.toFixed(1)}`
  if (Math.abs(m.cy - g.cy) > 8) return `centre up ${m.cy.toFixed(1)}, formula ${g.cy.toFixed(1)}`
  if (Math.abs(m.R - g.R) > Math.max(0.15 * g.R, 8)) return `R ${m.R.toFixed(1)}, formula ${g.R.toFixed(1)}`
  return ''
}

/**
 * Runs the shader frame by frame.
 *   res, points, composer, values: as the Renderer takes them (values over BASE)
 *   frames: how many frames to run (0 to frames - 1)
 *   draw(f): whether frame f's picture is wanted (undrawn frames are only stepped, which is cheap)
 *   tweak(f, api): called before frame f; api = { setWindow([pw, ph]), setComposer([l, b, r, t]), setValues(obj), setFps(n),
 *     buffers(), snapshot(buf), clearBuffer(buf), restoreBuffer(buf, copy) }
 *   onFrame(f, pic, r): called for each drawn frame with the premultiplied picture (y up) and the renderer
 * Returns the renderer's count of non-finite values.
 */
export async function drive({ res, points = res, composer = PROMPT, values = {}, frames, draw, tweak, onFrame, fps }) {
  const shader = await loadShader(SHADER)
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
    buffers: () => {
      const bs = r.shader.passes.filter(b => b.kind === 'buffer' && b.data)
      const found = {
        lens: bs.find(b => b.once),
        state: bs.find(b => b.w === 4 && b.h === 1),
        geo: bs.find(b => b.options.scale !== undefined),
      }
      for (const k of Object.keys(found)) if (!found[k]) throw new Error(`blackhole-kit: no ${k} buffer found in the shader's passes`)
      return found
    },
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
