// Tests for tools/flash.mjs, the repository's own flash estimator. Run: node --test tools/tests/
//
// The app freezes a shader that flashes, and nothing checks that before the app does, so this
// estimator does. Its contract is in the job's blackhole-contract.md, "Flashing".
//
// WHAT THESE TESTS EXPECT THE BUILDER TO PROVIDE (tools/flash.mjs, pure, Node's own modules only):
//
//   export function flashReport(frames, options)  ->  { ok, worstArea, worstWindow: { x, y }, flashingSamples, maxSwingsPerSecond }
//   export function flashMeter(options)           ->  { add(frame), report() }   (report() gives what flashReport gives)
//
//   options = { width, height, fps, pointsPerSample = 1, swing = 0.05, perSecond = 3,
//               windowPoints = [340, 256], limitArea = 10000 }
//   frames: one Float32Array of luminance (0 to 1) a frame, width * height samples in rows (row 0 is the
//   first row; y grows down the rows), each sample pointsPerSample points square.
//   `flashReport(frames, o)` is `flashMeter(o)` fed every frame, then `report()`.
//
// WHAT IS PINNED
//   - A sample swings each time its luminance turns round after moving at least `swing` from its last
//     turning point; it is flashing when some span of one second holds MORE than `perSecond` swings.
//   - worstArea is the largest area of flashing samples, in square points, over every window of
//     `windowPoints` (the window slides: it is not a fixed tiling, and it is not a bounding box). ok is
//     `worstArea < limitArea`. A picture smaller than the window is the one window, and limitArea is scaled
//     by (picture area / window area).
//   - flashingSamples counts samples (not points). maxSwingsPerSecond is the largest swing count any one
//     sample has in a one-second span (0 when nothing swung).
//   - worstWindow is the top-left corner of the worst window, in samples of the picture's own grid with row 0 at
//     the top (`x` across, `y` down). Tests only check that this window holds the flashing region.
//
// HOW THE COUNTING IS KEPT FREE OF OFF-BY-ONE QUESTIONS the contract leaves open (does the first rise count?
// is a one-second span closed or open?): the tests use steady toggling, where every transition is one swing
// whichever convention is used, and spacings (0.4 s, 0.3 s) that put 3 or 4 swings in a second under either.
//
// Why these fail now: tools/flash.mjs does not exist. It is imported inside each test, so a missing
// module fails that test and not the other files.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

const load = () => import('../flash.mjs')

const FPS = 30

/** n frames of w by h; sample(x, y, i) is the luminance of sample (x, y) in frame i. */
function frames(w, h, n, sample) {
  const out = []
  for (let i = 0; i < n; i++) {
    const f = new Float32Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = sample(x, y, i)
    out.push(f)
  }
  return out
}
/** 1 on the first `half` frames, 0 on the next `half`, and so on: toggles every `half` frames. */
const toggle = (i, half) => (Math.floor(i / half) % 2 === 0 ? 1 : 0)
const inRect = (x, y, x0, y0, w, h) => x >= x0 && x < x0 + w && y >= y0 && y < y0 + h
const GREY = 0.3

/** A picture w by h, a flashing rectangle (toggling every `half` frames) over a steady grey. */
const rectFrames = (w, h, n, half, rects) =>
  frames(w, h, n, (x, y, i) => (rects.some(r => inRect(x, y, ...r)) ? toggle(i, half) : GREY))

describe('flashReport: what it gives back', () => {
  it('a still picture is ok, with nothing flashing and a worst window to point at', async () => {
    const { flashReport } = await load()
    const r = flashReport(frames(400, 300, 40, () => 0.4), { width: 400, height: 300, fps: FPS })
    assert.equal(r.ok, true)
    assert.equal(r.worstArea, 0)
    assert.equal(r.flashingSamples, 0)
    assert.equal(r.maxSwingsPerSecond, 0)
    assert.equal(typeof r.worstWindow, 'object')
    assert.ok(Number.isFinite(r.worstWindow.x) && Number.isFinite(r.worstWindow.y))
    assert.deepEqual(Object.keys(r).sort(), ['flashingSamples', 'maxSwingsPerSecond', 'ok', 'worstArea', 'worstWindow'])
  })
})

describe('flashReport: the blinking square and the slow gradient', () => {
  const sq = [[140, 90, 120, 120]] // 120 points a side, in a 400 by 300 picture (symmetric top to bottom and left to right)
  it('a square 120 points a side blinking 5 times a second is not ok', async () => {
    const { flashReport } = await load()
    // 5 blinks a second at 30 frames a second: a cycle is 6 frames, so it toggles every 3 frames
    const r = flashReport(rectFrames(400, 300, 60, 3, sq), { width: 400, height: 300, fps: FPS })
    assert.equal(r.ok, false)
    assert.equal(r.flashingSamples, 14400)
    assert.equal(r.worstArea, 14400)
    // 10 swings a second (9 to 11 allowing for how the ends of a second are drawn)
    assert.ok(r.maxSwingsPerSecond >= 9 && r.maxSwingsPerSecond <= 11, `maxSwingsPerSecond was ${r.maxSwingsPerSecond}`)
    // the worst window holds the whole square: 340 by 256 samples at this corner
    const { x, y } = r.worstWindow
    assert.ok(x <= 140 && x + 340 >= 260, `window x ${x} misses the square`)
    assert.ok(y <= 90 && y + 256 >= 210, `window y ${y} misses the square`)
  })
  it('the same square blinking once a second is ok', async () => {
    const { flashReport } = await load()
    // once a second: on for 15 frames, off for 15; three seconds of it
    const r = flashReport(rectFrames(400, 300, 90, 15, sq), { width: 400, height: 300, fps: FPS })
    assert.equal(r.ok, true)
    assert.equal(r.flashingSamples, 0)
    assert.equal(r.worstArea, 0)
    // two swings a second (the square goes on and off), 3 at most if a span of one second is closed at both ends
    assert.ok(r.maxSwingsPerSecond >= 1 && r.maxSwingsPerSecond <= 3, `maxSwingsPerSecond was ${r.maxSwingsPerSecond}`)
  })
  it('a slow gradient drifting across the picture is ok', async () => {
    const { flashReport } = await load()
    // a soft stripe pattern moving at half a cycle a second: every sample rises and falls once in 2 seconds
    const r = flashReport(
      frames(400, 300, 90, (x, _y, i) => 0.5 + 0.5 * Math.sin(2 * Math.PI * (x / 80 - (0.5 * i) / FPS))),
      { width: 400, height: 300, fps: FPS },
    )
    assert.equal(r.ok, true)
    assert.equal(r.flashingSamples, 0)
    assert.equal(r.worstArea, 0)
    assert.ok(r.maxSwingsPerSecond >= 1 && r.maxSwingsPerSecond <= 2, `maxSwingsPerSecond was ${r.maxSwingsPerSecond}`)
  })
  it('the frame rate is used: the same frames flash at 60 a second and do not at 15', async () => {
    const { flashReport } = await load()
    const fr = rectFrames(400, 300, 120, 6, sq) // toggles every 6 frames
    const at60 = flashReport(fr, { width: 400, height: 300, fps: 60 }) // every 0.1 s: 10 a second
    const at15 = flashReport(fr, { width: 400, height: 300, fps: 15 }) // every 0.4 s: 2.5 a second
    assert.equal(at60.ok, false)
    assert.equal(at60.worstArea, 14400)
    assert.equal(at15.ok, true)
    assert.equal(at15.flashingSamples, 0)
  })
})

describe('flashReport: what counts as a swing', () => {
  it('a change smaller than swing is never counted, however fast it repeats', async () => {
    const { flashReport } = await load()
    // every frame between 0.50 and 0.54: 30 turns a second, each 0.04 high, under the default swing of 0.05
    const small = flashReport(frames(400, 300, 60, (_x, _y, i) => 0.5 + (i % 2 ? 0.04 : 0)), { width: 400, height: 300, fps: FPS })
    assert.equal(small.maxSwingsPerSecond, 0)
    assert.equal(small.flashingSamples, 0)
    assert.equal(small.ok, true)
    // 0.06 is over it: the same pace is counted, and the whole picture flashes
    const big = flashReport(frames(400, 300, 60, (_x, _y, i) => 0.5 + (i % 2 ? 0.06 : 0)), { width: 400, height: 300, fps: FPS })
    assert.ok(big.maxSwingsPerSecond >= 25, `maxSwingsPerSecond was ${big.maxSwingsPerSecond}`)
    assert.equal(big.flashingSamples, 400 * 300)
    assert.equal(big.ok, false)
  })
  it('swing is an option: the same wobble of 0.2 is counted under 0.1 and not under 0.3', async () => {
    const { flashReport } = await load()
    const fr = frames(400, 300, 60, (_x, _y, i) => 0.4 + (i % 2 ? 0.2 : 0))
    const under = flashReport(fr, { width: 400, height: 300, fps: FPS, swing: 0.3 })
    const over = flashReport(fr, { width: 400, height: 300, fps: FPS, swing: 0.1 })
    assert.equal(under.maxSwingsPerSecond, 0)
    assert.equal(under.ok, true)
    assert.ok(over.maxSwingsPerSecond >= 25)
    assert.equal(over.ok, false)
  })
  it('exactly three swings in a second is not flashing; four is', async () => {
    const { flashReport } = await load()
    const sq = [[140, 90, 120, 120]]
    // toggling every 12 frames = every 0.4 s: any one second holds 3 swings (at 0, 0.4 and 0.8 s), never 4
    const three = flashReport(rectFrames(400, 300, 120, 12, sq), { width: 400, height: 300, fps: FPS })
    assert.equal(three.maxSwingsPerSecond, 3)
    assert.equal(three.flashingSamples, 0)
    assert.equal(three.ok, true)
    // toggling every 9 frames = every 0.3 s: four swings fit in 0.9 s
    const four = flashReport(rectFrames(400, 300, 120, 9, sq), { width: 400, height: 300, fps: FPS })
    assert.equal(four.maxSwingsPerSecond, 4)
    assert.equal(four.flashingSamples, 14400)
    assert.equal(four.worstArea, 14400)
    assert.equal(four.ok, false)
  })
  it('perSecond is an option: 1 a second blinking is flashing at perSecond 1, and 5 a second is not at 12', async () => {
    const { flashReport } = await load()
    const sq = [[140, 90, 120, 120]]
    const slow = flashReport(rectFrames(400, 300, 90, 15, sq), { width: 400, height: 300, fps: FPS, perSecond: 1 })
    assert.equal(slow.ok, false)
    assert.equal(slow.flashingSamples, 14400)
    const fast = flashReport(rectFrames(400, 300, 60, 3, sq), { width: 400, height: 300, fps: FPS, perSecond: 12 })
    assert.equal(fast.ok, true)
    assert.equal(fast.flashingSamples, 0)
  })
})

describe('flashReport: the area of flashing samples', () => {
  it('thin lines that flash still add up: one sample wide, every 6th column, is not ok', async () => {
    const { flashReport } = await load()
    const fr = frames(400, 300, 60, (x, _y, i) => (x % 6 === 0 ? toggle(i, 3) : GREY))
    const r = flashReport(fr, { width: 400, height: 300, fps: FPS })
    assert.equal(r.flashingSamples, 67 * 300) // columns 0, 6 ... 396
    assert.ok(r.worstArea >= 56 * 256, `worstArea was ${r.worstArea}`) // 56 or 57 lines a window, 256 rows
    assert.equal(r.ok, false)
  })
  it('scattered dots that flash still add up: one in 6 samples is not ok', async () => {
    const { flashReport } = await load()
    const fr = frames(400, 300, 60, (x, y, i) => (x % 3 === 0 && y % 2 === 0 ? toggle(i, 3) : GREY))
    const r = flashReport(fr, { width: 400, height: 300, fps: FPS })
    assert.equal(r.flashingSamples, 134 * 150)
    assert.ok(r.worstArea >= 113 * 128, `worstArea was ${r.worstArea}`)
    assert.equal(r.ok, false)
  })
  it('it adds up the flashing samples themselves, not the box round them: sparse dots stay ok', async () => {
    const { flashReport } = await load()
    // one flashing sample in 64: about 1,400 in a window, though they reach every corner of it
    const fr = frames(400, 300, 60, (x, y, i) => (x % 8 === 0 && y % 8 === 0 ? toggle(i, 3) : GREY))
    const r = flashReport(fr, { width: 400, height: 300, fps: FPS })
    assert.ok(r.flashingSamples > 0)
    assert.ok(r.worstArea >= 1000 && r.worstArea < 10000, `worstArea was ${r.worstArea}`)
    assert.equal(r.ok, true)
  })
})

describe('flashReport: the window slides to find the worst place', () => {
  const W = 700
  const H = 270 // a window is 340 by 256, so it can sit at x 0 to 360 and y 0 to 14
  it('a region of exactly 10,000 points straddling the edge of a fixed tiling is not ok (the window slides)', async () => {
    const { flashReport } = await load()
    // 100 by 100 at x 290 to 390: a tiling of 340-wide windows would see 50 by 100 in each of two windows
    const r = flashReport(rectFrames(W, H, 45, 3, [[290, 85, 100, 100]]), { width: W, height: H, fps: FPS })
    assert.equal(r.flashingSamples, 10000)
    assert.equal(r.worstArea, 10000)
    assert.equal(r.ok, false) // ok is worstArea < limitArea, and 10,000 is not below 10,000
    const { x, y } = r.worstWindow
    assert.ok(x >= 50 && x <= 290, `window x ${x} does not hold x 290 to 390`)
    assert.ok(y >= 0 && y <= 14, `window y ${y}`)
  })
  it('a region of 9,900 points is ok', async () => {
    const { flashReport } = await load()
    const r = flashReport(rectFrames(W, H, 45, 3, [[290, 85, 99, 100]]), { width: W, height: H, fps: FPS })
    assert.equal(r.worstArea, 9900)
    assert.equal(r.ok, true)
  })
  it('two squares of 6,400 points too far apart for one window do not add: the worst place sees one', async () => {
    const { flashReport } = await load()
    const r = flashReport(
      rectFrames(W, H, 45, 3, [[20, 90, 80, 80], [600, 90, 80, 80]]), // 500 points between their left edges
      { width: W, height: H, fps: FPS },
    )
    assert.equal(r.flashingSamples, 12800)
    assert.equal(r.worstArea, 6400)
    assert.equal(r.ok, true)
  })
  it('the same two squares within one window do add: 12,800 is not ok', async () => {
    const { flashReport } = await load()
    const r = flashReport(
      rectFrames(W, H, 45, 3, [[100, 90, 80, 80], [250, 90, 80, 80]]), // both fit in 340 across (100 to 330)
      { width: W, height: H, fps: FPS },
    )
    assert.equal(r.worstArea, 12800)
    assert.equal(r.ok, false)
  })
  it('windowPoints is an option: a 50 by 50 window sees 2,500 points of an 80 by 80 square', async () => {
    const { flashReport } = await load()
    const r = flashReport(rectFrames(400, 300, 45, 3, [[140, 90, 80, 80]]), { width: 400, height: 300, fps: FPS, windowPoints: [50, 50] })
    assert.equal(r.flashingSamples, 6400)
    assert.equal(r.worstArea, 2500)
    assert.equal(r.ok, true)
  })
  it('limitArea is an option: 6,400 points is not ok under a limit of 5,000, and ok under 7,000', async () => {
    const { flashReport } = await load()
    const fr = rectFrames(400, 300, 45, 3, [[140, 90, 80, 80]])
    assert.equal(flashReport(fr, { width: 400, height: 300, fps: FPS, limitArea: 5000 }).ok, false)
    assert.equal(flashReport(fr, { width: 400, height: 300, fps: FPS, limitArea: 7000 }).ok, true)
  })
})

describe('flashReport: a picture smaller than the window', () => {
  it('is the one window, and limitArea scales down with it: 1,600 points of a 100 by 100 picture is not ok', async () => {
    const { flashReport } = await load()
    // the picture is 10,000 of the window's 87,040 square points, so the limit is 10,000 * 10,000 / 87,040 = about 1,149
    const r = flashReport(rectFrames(100, 100, 45, 3, [[30, 30, 40, 40]]), { width: 100, height: 100, fps: FPS })
    assert.equal(r.flashingSamples, 1600)
    assert.equal(r.worstArea, 1600)
    assert.equal(r.ok, false)
  })
  it('900 points of the same small picture is under the scaled limit and ok', async () => {
    const { flashReport } = await load()
    const r = flashReport(rectFrames(100, 100, 45, 3, [[35, 35, 30, 30]]), { width: 100, height: 100, fps: FPS })
    assert.equal(r.worstArea, 900)
    assert.equal(r.ok, true)
  })
  it('the same 1,600 points in a big picture is ok: the scaling is only for a small one', async () => {
    const { flashReport } = await load()
    const r = flashReport(rectFrames(400, 300, 45, 3, [[180, 130, 40, 40]]), { width: 400, height: 300, fps: FPS })
    assert.equal(r.worstArea, 1600)
    assert.equal(r.ok, true)
  })
})

describe('flashReport: pointsPerSample', () => {
  it('2 points a sample: 60 by 60 flashing samples are 14,400 points, which is not ok, and 3,600 samples', async () => {
    const { flashReport } = await load()
    const o = { width: 200, height: 150, fps: FPS, pointsPerSample: 2 } // 400 by 300 points
    const r = flashReport(rectFrames(200, 150, 45, 3, [[70, 45, 60, 60]]), o)
    assert.equal(r.flashingSamples, 3600) // samples, not points
    assert.equal(r.worstArea, 14400) // square points
    assert.equal(r.ok, false)
  })
  it('40 by 40 flashing samples are 6,400 points and ok', async () => {
    const { flashReport } = await load()
    const o = { width: 200, height: 150, fps: FPS, pointsPerSample: 2 }
    const r = flashReport(rectFrames(200, 150, 45, 3, [[80, 55, 40, 40]]), o)
    assert.equal(r.flashingSamples, 1600)
    assert.equal(r.worstArea, 6400)
    assert.equal(r.ok, true)
  })
  it('the window is 340 by 256 points, so 170 by 128 samples: two 40 by 40 squares 225 samples apart cannot be seen together', async () => {
    const { flashReport } = await load()
    const o = { width: 250, height: 150, fps: FPS, pointsPerSample: 2 } // 500 by 300 points
    const apart = flashReport(rectFrames(250, 150, 45, 3, [[5, 55, 40, 40], [190, 55, 40, 40]]), o) // span 5 to 230
    assert.equal(apart.worstArea, 6400)
    assert.equal(apart.ok, true)
    const near = flashReport(rectFrames(250, 150, 45, 3, [[10, 55, 40, 40], [100, 55, 40, 40]]), o) // span 10 to 140
    assert.equal(near.worstArea, 12800)
    assert.equal(near.ok, false)
  })
})

describe('flashMeter', () => {
  const o = { width: 400, height: 300, fps: FPS }
  // a blinking square, a line that blinks slowly and a ripple, so the report is not trivial
  const mixed = frames(400, 300, 60, (x, y, i) => {
    if (inRect(x, y, 100, 80, 90, 90)) return toggle(i, 3)
    if (x === 300) return toggle(i, 15)
    return 0.4 + (y % 2 ? 0.02 : 0)
  })
  it('fed frame by frame it gives what flashReport gives', async () => {
    const { flashMeter, flashReport } = await load()
    const meter = flashMeter(o)
    assert.equal(typeof meter.add, 'function')
    assert.equal(typeof meter.report, 'function')
    for (const f of mixed) meter.add(f)
    const got = meter.report()
    assert.deepEqual(got, flashReport(mixed, o))
    assert.equal(got.ok, true) // 8,100 points of square: under the limit
    assert.equal(got.flashingSamples, 8100)
    assert.equal(got.worstArea, 8100)
  })
  it('a meter that sees a flashing picture says so, with every option the same as flashReport takes', async () => {
    const { flashMeter, flashReport } = await load()
    const opts = { ...o, swing: 0.3, perSecond: 2, limitArea: 4000, windowPoints: [200, 200], pointsPerSample: 1 }
    const meter = flashMeter(opts)
    for (const f of mixed) meter.add(f)
    assert.deepEqual(meter.report(), flashReport(mixed, opts))
  })
  it('it reads a frame as it is added: the caller may overwrite the same array for the next one', async () => {
    const { flashMeter, flashReport } = await load()
    const meter = flashMeter(o)
    const reused = new Float32Array(400 * 300)
    for (const f of mixed) {
      reused.set(f)
      meter.add(reused)
    }
    assert.deepEqual(meter.report(), flashReport(mixed, o))
  })
})
