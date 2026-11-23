// The black hole while its geometry changes, and at the very start. Run: node --test tools/tests/
// (the quick part: about 20 to 30 seconds. The flash estimate of the same runs is blackhole-geometry-flash.test.mjs, behind SLOW.)
//
// WHAT IS WRONG TODAY (found by review): every cell is worked out afresh on each frame in which the hole's centre,
// radius or the chat column's width changes, so each cell jumps to another part of the disc every frame while a
// window is dragged, the prompt box glides or `size` eases. The right behaviour: a change of geometry is taken while
// the picture is dark. It fades to the ground, takes the new place and size, and fades back; while the change is
// still going on (a drag) it stays dark. A fade is one swing down and one up at any spot, which is not flashing.
//
// WHAT THESE TESTS PIN (shader: hooks/wallpapers/blackhole/shader.ts, values dim 0, speed 1, fps 0, calm 0)
//   Each run is settled for 2 seconds (60 frames, stepped, not drawn), then the change starts at frame 60 and takes
//   n frames (frame 60 + k has k + 1 steps of n done; the window is rounded to whole points), then the run goes on
//   for 3 seconds past the end of the change (90 frames). "The picture's mean" is the mean luminance above the
//   ground over the disc's box (kit: |x - cx| <= 0.575 W, |y - cy| <= 0.35 W; the lit disc follows W, not `size`); the settled mean is
//   the mean of frames 55 to 59, over the box of the geometry before the change.
//   For a change that lasts 30 frames or more (a window dragged, the chat column glided, `size` eased):
//     1. the picture's mean falls below a fifth of the settled mean before the change ends (the minimum over the
//        change), and is still below a fifth on the last frame of the change (it stays dark while the change goes on);
//     2. 1.5 seconds after the change ends (45 frames) the picture is back: its mean, over the box of the NEW geometry,
//        is within 30% of the settled mean, and the shadow sits at the contract's centre and R for the new
//        geometry (centre within 8 points, R within the larger of 15% and 8 points, as blackhole.test.mjs reads them);
//        the same holds at the end of the run, 3 seconds after.
//   For a single-frame jump of the prompt box (left 0.1, right 0.7 to left 0.35, right 0.95):
//     3. the frame right after the jump (frame 60) is not brighter than the settled picture, the picture goes dark
//        (mean under a fifth of the settled one at some frame within the next 45; my reading of "goes through the same
//        fade"), and 1.5 seconds after it the hole is at the new place and the picture is back within 30%.
//   And at the very start:
//     4. frame 0 is dark (its mean is under a tenth of frame 30's), the frame at 1 second is formed (lit and not
//        dark), and between them the picture only rises (no frame's mean is 10% below the highest so far) and no
//        spot does more than rise: no sample swings (0.05, counted as the flash rule counts) three or more times.
//        The strict reading, that no sample falls at all from its own peak, cannot hold with the flow's natural
//        light (a plain fade-in over the present shader still has about 1.6% of samples dim by 0.05 once), so
//        the test allows the flow its rise and fall but not a flash. Today 21 samples swing three times.
//
// WHAT THEY ASSUME ABOUT tools/render.mjs: nothing new is needed; see the header of blackhole-kit.mjs (the window,
// the prompt box and the values are changed between frames through the Renderer's and the stand-in's public fields).
//
// Why these fail now: the shader recomputes every cell each frame while the geometry changes (the picture never
// fades), and it starts at full brightness. The numbers it gives today are printed in each failure message.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { drive, discMean, excess, geometry, held, measureShadow, placeProblem, PROMPT, SIZE_RANGE } from './blackhole-kit.mjs'

const T0 = 60
const lerp = (a, b, t) => a + (b - a) * t

/**
 * One change: start and end are { points, composer, size }; n frames (1 is a jump). Draws frames T0 - 5 on.
 * Gives { settled, means (by frame), endFrame, shadowAt45, shadowAtEnd, g0, g1 }.
 */
async function change({ res, start, end, n }) {
  const endFrame = T0 + n
  const total = endFrame + 90
  const g0 = geometry(start.points, start.composer, held(SIZE_RANGE, start.size))
  const g1 = geometry(end.points, end.composer, held(SIZE_RANGE, end.size))
  const means = {}
  const shadows = {}
  const bad = await drive({
    res,
    points: start.points,
    composer: start.composer,
    values: { size: start.size },
    frames: total,
    draw: f => f >= T0 - 5,
    tweak: (f, api) => {
      if (f < T0) return
      const t = Math.min(f - T0 + 1, n) / n
      api.setWindow([Math.round(lerp(start.points[0], end.points[0], t)), Math.round(lerp(start.points[1], end.points[1], t))])
      api.setComposer(start.composer.map((v, i) => lerp(v, end.composer[i], t)))
      api.setValues({ size: lerp(start.size, end.size, t) })
    },
    onFrame: (f, pic, r) => {
      const lum = r.luminance(pic)
      means[f] = discMean(lum, r.w, r.h, f < T0 ? g0 : f < endFrame ? g0 : g1)
      if (f === endFrame + 45 || f === total - 1) shadows[f] = measureShadow(lum, r.w, r.h, g1)
    },
  })
  assert.equal(bad, 0, 'the preview drew non-finite values as 0')
  let settled = 0
  for (let f = T0 - 5; f < T0; f++) settled += means[f] / 5
  return { settled, means, endFrame, total, shadows, g0, g1 }
}

const frame = (m, f) => m.means[f]
const minOver = (run, from, to) => {
  let lo = Infinity
  for (let f = from; f < to; f++) lo = Math.min(lo, run.means[f])
  return lo
}
const pct = (v, settled) => `${((100 * v) / settled).toFixed(0)}% of the settled mean`

function checkLong(run, n) {
  assert.ok(run.settled > 1e-4, `the settled picture is blank (${run.settled})`)
  const during = minOver(run, T0, run.endFrame)
  assert.ok(during < 0.2 * run.settled, `during the change the mean never falls below a fifth: its lowest is ${pct(during, run.settled)}`)
  const last = frame(run, run.endFrame - 1)
  assert.ok(last < 0.2 * run.settled, `on the last frame of the change the picture is at ${pct(last, run.settled)}: it should stay dark while the change goes on`)
  for (const f of [run.endFrame + 45, run.total - 1]) {
    const m = frame(run, f)
    assert.ok(Math.abs(m / run.settled - 1) <= 0.3, `frame ${f} (${f - run.endFrame} after the change): the mean is ${pct(m, run.settled)}`)
    const why = placeProblem(run.shadows[f], run.g1)
    assert.equal(why, '', `frame ${f}: the hole is not at the new place: ${why}`)
  }
}

describe('a change of geometry is taken while the picture is dark', () => {
  const PROMPT_MID = PROMPT
  it('a window dragged from 480x300 to 540x338 over 30 frames', { timeout: 120000 }, async () => {
    const run = await change({
      res: [540, 338],
      start: { points: [480, 300], composer: PROMPT_MID, size: 1 },
      end: { points: [540, 338], composer: PROMPT_MID, size: 1 },
      n: 30,
    })
    checkLong(run, 30)
  })
  it('the chat column gliding a quarter of the window across a 600x378 window over 30 frames', { timeout: 120000 }, async () => {
    const run = await change({
      res: [600, 378],
      start: { points: [600, 378], composer: [0.1, 0.05, 0.7, 0.15], size: 1 },
      end: { points: [600, 378], composer: [0.35, 0.05, 0.95, 0.15], size: 1 },
      n: 30,
    })
    checkLong(run, 30)
  })
  it('`size` eased from 1 to 1.25 over 30 frames', { timeout: 120000 }, async () => {
    const run = await change({
      res: [600, 378],
      start: { points: [600, 378], composer: PROMPT_MID, size: 1 },
      end: { points: [600, 378], composer: PROMPT_MID, size: 1.25 },
      n: 30,
    })
    checkLong(run, 30)
  })
  it('a single-frame jump of the prompt box goes through the same fade', { timeout: 120000 }, async () => {
    const run = await change({
      res: [600, 378],
      start: { points: [600, 378], composer: [0.1, 0.05, 0.7, 0.15], size: 1 },
      end: { points: [600, 378], composer: [0.35, 0.05, 0.95, 0.15], size: 1 },
      n: 1,
    })
    assert.ok(run.settled > 1e-4)
    const first = frame(run, T0)
    assert.ok(first <= run.settled, `the frame right after the jump is at ${pct(first, run.settled)}: it must not be brighter than the settled picture`)
    const dark = minOver(run, T0, T0 + 45)
    assert.ok(dark < 0.2 * run.settled, `within 1.5 seconds of the jump the lowest mean is ${pct(dark, run.settled)}: it should go through the ground`)
    const f = run.endFrame + 45
    assert.ok(Math.abs(frame(run, f) / run.settled - 1) <= 0.3, `1.5 seconds after the jump the mean is ${pct(frame(run, f), run.settled)}`)
    assert.equal(placeProblem(run.shadows[f], run.g1), '', 'the hole is not at the new place 1.5 seconds after the jump')
  })
})

describe('the start: the picture fades in from the ground', () => {
  it('frame 0 is dark, the frame at 1 second is formed, and no sample does more than rise in between', { timeout: 120000 }, async () => {
    const points = [480, 320]
    const g = geometry(points, PROMPT)
    const lums = []
    const bad = await drive({
      res: points,
      points,
      frames: 31,
      draw: () => true,
      onFrame: (f, pic, r) => lums.push(r.luminance(pic)),
    })
    assert.equal(bad, 0)
    const [w, h] = points
    const first = discMean(lums[0], w, h, g)
    const settled = discMean(lums[30], w, h, g)
    assert.ok(settled > 0.002, `the frame at 1 second is nearly dark (mean ${settled})`)
    let lit = 0
    for (const v of lums[30]) if (excess(v) > 0.01) lit++
    assert.ok(lit > 500, `only ${lit} lit samples at 1 second`)
    assert.ok(first < 0.1 * settled, `frame 0 is at ${pct(first, settled)}: it should start from the ground`)
    // the picture only rises: no frame's mean falls more than 10% below the highest so far
    let top = 0
    for (let f = 0; f <= 30; f++) {
      const m = discMean(lums[f], w, h, g)
      assert.ok(m >= 0.9 * top, `frame ${f}: the mean ${m.toFixed(5)} is more than 10% below the highest so far (${top.toFixed(5)})`)
      top = Math.max(top, m)
    }
    // and no spot does more than rise: swings of 0.05 counted as the flash rule counts them (a turn after a move of at
    // least 0.05 from the last turning point). The flow's own light may turn a spot round once or twice in a second
    // (a rise, a fall, a rise), so a sample may swing twice; three or more would be a flash. No sample does.
    const n = lums[0].length
    let many = 0
    for (let i = 0; i < n; i++) {
      let ref = lums[0][i]
      let ext = ref
      let dir = 0
      let swings = 0
      for (let f = 1; f <= 30; f++) {
        const v = lums[f][i]
        if (dir === 0) {
          if (Math.abs(v - ref) >= 0.05) {
            dir = v > ref ? 1 : -1
            ext = v
          }
        } else if (dir === 1) {
          if (v > ext) ext = v
          else if (ext - v >= 0.05) {
            swings++
            dir = -1
            ext = v
          }
        } else if (v < ext) ext = v
        else if (v - ext >= 0.05) {
          swings++
          dir = 1
          ext = v
        }
      }
      if (swings >= 3) many++
    }
    assert.equal(many, 0, `${many} samples swing three or more times between frame 0 and 1 second`)
  })
})
