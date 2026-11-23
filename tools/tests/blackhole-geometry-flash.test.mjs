// THE SLOW PART of the geometry tests: the black hole's flash estimate while its geometry changes.
// Kept out of the quick run: tools/tests/index.js imports it only when SLOW is set.
//
// HOW TO RUN IT
//   SLOW=1 node --test tools/tests/                                   (index.js then imports this file)
//   SLOW=1 node --test tools/tests/blackhole-geometry-flash.test.mjs   (this file alone)
//   In PowerShell:  $env:SLOW = '1'; node --test tools/tests/
//
// HOW LONG IT RUNS: five runs of 120 to 150 drawn frames each, one sample a point, on windows up to 1000 by 630
// points. About 8 s (720x450), 7 s (720x400), 16 s and 20 s (1000x630), 10 s (800x500) with the shader as it is
// today: about a minute in all, and more if the fixed shader draws a frame more slowly. Each test is allowed 20 minutes.
//
// WHAT IT PINS (review finding; the quick part is blackhole-geometry.test.mjs, which explains the fault and the
// fade): each run starts from a settled picture (2 seconds, 60 frames stepped, not drawn), changes the geometry
// from frame 60 over n frames, and goes on for 3 seconds past its end (90 frames). The estimator is tools/flash.mjs
// `flashMeter({ width, height, fps: 30, pointsPerSample: 1 })` (default swing 0.05, three swings a second, 340 by 256
// window), fed every drawn frame from frame 60 on with the tool's own `Renderer.luminance`. `worstArea` must be under
// 2,500 square points (a quarter of the 10,000 limit) in each of the five cases:
//     a window dragged from 640x400 to 720x450 over 30 frames                      (today 33,384 by the review)
//     a window widened from 640 to 720 over 20 frames (the height stays 400)        (today 8,263)
//     the chat column gliding a quarter of a 1000x630 window across over 30 frames  (today 5,139)
//     the same over 60 frames                                                       (today 8,176)
//     `size` eased from 1 to 1.25 over 30 frames on an 800x500 window               (today 4,026)
// The numbers each prints today are in its failure message and in the console line of the run.
// The window is changed between frames through the Renderer's public fields (see blackhole-kit.mjs, which also
// says why `res` stays at the largest window and what that does to an area measured in samples).
//
// Why it fails now: tools/flash.mjs exists, but the shader recomputes every cell on every frame of a change, so the
// areas are over the limit above.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { drive, PROMPT } from './blackhole-kit.mjs'

const FPS = 30
const T0 = 60
const TIMEOUT = 20 * 60 * 1000
const LIMIT = 2500
const lerp = (a, b, t) => a + (b - a) * t

async function flashOf({ res, start, end, n }) {
  const { flashMeter } = await import('../flash.mjs')
  const meter = flashMeter({ width: res[0], height: res[1], fps: FPS, pointsPerSample: 1 })
  const began = performance.now()
  const bad = await drive({
    res,
    points: start.points,
    composer: start.composer,
    values: { size: start.size },
    frames: T0 + n + 90,
    draw: f => f >= T0,
    tweak: (f, api) => {
      if (f < T0) return
      const t = Math.min(f - T0 + 1, n) / n
      api.setWindow([Math.round(lerp(start.points[0], end.points[0], t)), Math.round(lerp(start.points[1], end.points[1], t))])
      api.setComposer(start.composer.map((v, i) => lerp(v, end.composer[i], t)))
      api.setValues({ size: lerp(start.size, end.size, t) })
    },
    onFrame: (_f, pic, r) => meter.add(r.luminance(pic)),
  })
  assert.equal(bad, 0, 'the preview drew non-finite values as 0')
  const report = meter.report()
  console.log(
    `${((performance.now() - began) / 1000).toFixed(0)} s: worstArea ${report.worstArea}, flashingSamples ${report.flashingSamples}, ` +
      `maxSwingsPerSecond ${report.maxSwingsPerSecond}, worstWindow ${JSON.stringify(report.worstWindow)}`,
  )
  return report
}

const SAME = { composer: PROMPT, size: 1 }
const GLIDE = { points: [1000, 630], size: 1 }
const cases = [
  ['a window dragged from 640x400 to 720x450 over 30 frames', { res: [720, 450], start: { ...SAME, points: [640, 400] }, end: { ...SAME, points: [720, 450] }, n: 30 }],
  ['a window widened from 640 to 720 over 20 frames', { res: [720, 400], start: { ...SAME, points: [640, 400] }, end: { ...SAME, points: [720, 400] }, n: 20 }],
  [
    'the chat column gliding a quarter of a 1000x630 window across over 30 frames',
    { res: [1000, 630], start: { ...GLIDE, composer: [0.1, 0.05, 0.7, 0.15] }, end: { ...GLIDE, composer: [0.35, 0.05, 0.95, 0.15] }, n: 30 },
  ],
  [
    'the chat column gliding a quarter of a 1000x630 window across over 60 frames',
    { res: [1000, 630], start: { ...GLIDE, composer: [0.1, 0.05, 0.7, 0.15] }, end: { ...GLIDE, composer: [0.35, 0.05, 0.95, 0.15] }, n: 60 },
  ],
  ['`size` eased from 1 to 1.25 over 30 frames on an 800x500 window', { res: [800, 500], start: { points: [800, 500], composer: PROMPT, size: 1 }, end: { points: [800, 500], composer: PROMPT, size: 1.25 }, n: 30 }],
]

describe('the black hole against the flash estimator while its geometry changes (slow)', () => {
  for (const [name, c] of cases) {
    it(`${name}: worstArea is under 2,500`, { timeout: TIMEOUT }, async () => {
      const report = await flashOf(c)
      assert.ok(report.worstArea < LIMIT, `worstArea ${report.worstArea} (limit ${LIMIT}), flashingSamples ${report.flashingSamples}`)
    })
  }
})
