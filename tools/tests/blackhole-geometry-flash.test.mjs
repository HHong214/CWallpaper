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
//
// V5.1, B: a window drag as the app does it. The five runs above keep the pixel count fixed while the window changes, which the app
// does not do. Two more runs let the pixel count follow the window (kit `drive({ followPixels: true })`: setWindow also writes r.w, r.h
// and the stand-in's res beside r.pw, r.ph and size, so each frame's picture is the size of that frame's window, one pixel to the point):
//     640x400 to 720x450 over 30 frames, and 720x450 to 600x380 over 25 frames,
// each settled first (60 frames at the start window) and run on 90 frames past the end as the others. The picture changes size, so the
// estimator reads a part every frame has, TWICE in the same run: its lower-left 600 by 380 points (columns 0 to 599, the 380 rows up from the
// bottom of each frame) and its top-left 600 by 380 (columns 0 to 599, the 380 rows down from the top of each frame), each as a 600 by 380
// picture. worstArea under 2,500 on both. The picture is anchored to the window's bottom-left, so when the window's height changes it stays put
// in the bottom-anchored view and slides in the top-anchored one (how a detector counting pixels from the top sees a drag of the bottom
// edge); a sliding picture of fine characters makes every spot swing, so the top-left reading is the hard one. The reviewer's own script gave 2,449 and 3,484 (and rising over
// three rounds); the numbers this one gives today are in the console line and the failure message.
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
const PART = [600, 380] // the lower-left part every frame has, in points

/** One run with the pixel count following the window; two flashMeters read the lower-left and the top-left 600 by 380 points of each frame. Gives { bottom, top } reports. */
async function flashFollowing({ start, end, n }) {
  const { flashMeter } = await import('../flash.mjs')
  const meters = { bottom: flashMeter({ width: PART[0], height: PART[1], fps: FPS, pointsPerSample: 1 }), top: flashMeter({ width: PART[0], height: PART[1], fps: FPS, pointsPerSample: 1 }) }
  const began = performance.now()
  const bad = await drive({
    res: start,
    points: start,
    composer: PROMPT,
    frames: T0 + n + 90,
    draw: f => f >= T0,
    followPixels: true,
    tweak: (f, api) => {
      if (f < T0) return
      const t = Math.min(f - T0 + 1, n) / n
      api.setWindow([Math.round(lerp(start[0], end[0], t)), Math.round(lerp(start[1], end[1], t))])
    },
    onFrame: (_f, pic, r) => {
      const lum = r.luminance(pic) // r.w by r.h of this frame's window, top row first
      for (const [name, first] of [['bottom', r.h - PART[1]], ['top', 0]]) {
        // row y of the part (from the part's top): the bottom part's last row is the frame's bottom row; the top part's first row is the frame's top row
        const crop = new Float32Array(PART[0] * PART[1])
        for (let y = 0; y < PART[1]; y++) {
          const src = (first + y) * r.w
          crop.set(lum.subarray(src, src + PART[0]), y * PART[0])
        }
        meters[name].add(crop)
      }
    },
  })
  assert.equal(bad, 0, 'the preview drew non-finite values as 0')
  const reports = { bottom: meters.bottom.report(), top: meters.top.report() }
  console.log(
    `${((performance.now() - began) / 1000).toFixed(0)} s: lower-left worstArea ${reports.bottom.worstArea} (flashingSamples ${reports.bottom.flashingSamples}, maxSwingsPerSecond ${reports.bottom.maxSwingsPerSecond}), ` +
      `top-left worstArea ${reports.top.worstArea} (flashingSamples ${reports.top.flashingSamples}, maxSwingsPerSecond ${reports.top.maxSwingsPerSecond}, worstWindow ${JSON.stringify(reports.top.worstWindow)})`,
  )
  return reports
}

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
  for (const [name, c] of [
    ['a window dragged 640x400 to 720x450 over 30 frames with the pixel count following it', { start: [640, 400], end: [720, 450], n: 30 }],
    ['a window dragged 720x450 to 600x380 over 25 frames with the pixel count following it', { start: [720, 450], end: [600, 380], n: 25 }],
  ]) {
    it(`${name}: worstArea is under 2,500 over its lower-left and over its top-left 600 by 380 points`, { timeout: TIMEOUT }, async () => {
      const r = await flashFollowing(c)
      const msg = `worstArea lower-left ${r.bottom.worstArea}, top-left ${r.top.worstArea} (limit ${LIMIT}); flashingSamples ${r.bottom.flashingSamples} and ${r.top.flashingSamples}`
      assert.ok(r.bottom.worstArea < LIMIT && r.top.worstArea < LIMIT, msg)
    })
  }
})
