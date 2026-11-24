// THE SLOW ONE. The black hole shader (hooks/wallpapers/blackhole/shader.ts) rendered for 6 seconds, fed to the
// flash estimator frame by frame. It is kept out of the quick run.
//
// HOW TO RUN IT
//   SLOW=1 node --test tools/tests/                      (tools/tests/index.js then imports this file)
//   SLOW=1 node --test tools/tests/blackhole-flash.test.mjs     (this file alone; it needs no SLOW to run alone)
//   In PowerShell:  $env:SLOW = '1'; node --test tools/tests/
//
// HOW LONG IT RUNS: 180 frames on each of two windows, three runs in all (1512 by 945 at calm 0, 800 by 600 at
// calm 0, and 800 by 600 at calm 1), one sample a point (one pixel to the point). Measured with a stand-in black
// hole about as dear as tools/examples/ascii.ts (one font lookup a pixel, a few dozen operations) and a plain
// reference estimator: 89 s for the 1512 by 945 run and 37 s and 34 s for the two 800 by 600 runs, 2.7 minutes in
// all. The real shader costs more a frame, so expect 3 to 10 times that: 8 to 30 minutes in all. Each test below
// is allowed 40 minutes on its own.
//
// WHAT IT PINS (contract, "Flashing"): the black hole at `speed` 1 and `calm` 0, 30 frames a second, for 6
// seconds, on a window of 1512 by 945 points and on one of 800 by 600: `worstArea` under 2,500 square points
// (a quarter of the 10,000 limit). The luminance of every frame is the tool's own (`Renderer.luminance`: the
// picture over the preview's dark ground). The estimator is tools/flash.mjs, `flashMeter(options)` with
// { width, height, fps: 30, pointsPerSample: 1 }, `add(frame)` for each frame and `report()` at the end.
// The prompt box is the preview's default (0.2, 0.05, 0.8, 0.15) and `dim` 0, `size` 1 (contract v5: there is no `fps` value).
//
// A fourth test, from the contract v5's kept limits: the same estimate over 6 seconds in the middle of the swing between the two
// angles, frames 360 to 539 on 800 by 600 (the first 360 frames stepped, not drawn), where the angle changes fastest: worstArea under
// 2,500. It adds about 20 seconds with the present shader (measured: 21 s, worstArea 107).
//
// A third test, from the contract's `calm` line ("the flash estimate at 1 is no higher than at 0"), runs the
// 800 by 600 window again at calm 1 and asks that its worstArea is no higher than the calm 0 run's.
//
// Where it stands: these are kept limits; the numbers each gives are in its console line and failure message.
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { loadShader, Renderer } from '../render.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SHADER = path.join(ROOT, 'hooks', 'wallpapers', 'blackhole', 'shader.ts')
const FPS = 30
const SECONDS = 6
const TIMEOUT = 40 * 60 * 1000
const LIMIT = 2500

const runs = new Map()
/** Renders `SECONDS` seconds of the shader on a window of points, and gives back flashMeter's report. */
function flashOf(points, calm, from = 0) {
  const key = `${points.join('x')}-calm${calm}-from${from}`
  if (!runs.has(key)) {
    runs.set(
      key,
      (async () => {
        const { flashMeter } = await import('../flash.mjs')
        const shader = await loadShader(SHADER)
        const r = new Renderer(shader, {
          res: points,
          points,
          composer: [0.2, 0.05, 0.8, 0.15],
          values: { dim: 0, speed: 1, calm, size: 1 },
          fps: FPS,
        })
        const meter = flashMeter({ width: points[0], height: points[1], fps: FPS, pointsPerSample: 1 })
        const began = performance.now()
        for (let f = 0; f < from + FPS * SECONDS; f++) {
          const { pic } = r.runFrame(f, f >= from)
          if (pic) meter.add(r.luminance(pic))
        }
        const report = meter.report()
        console.log(
          `black hole ${points.join('x')} calm ${calm} from frame ${from}: ${((performance.now() - began) / 1000).toFixed(0)} s, ` +
            `worstArea ${report.worstArea}, flashingSamples ${report.flashingSamples}, ` +
            `maxSwingsPerSecond ${report.maxSwingsPerSecond}, worstWindow ${JSON.stringify(report.worstWindow)}`,
        )
        assert.equal(r.badValues(), 0, 'the preview drew non-finite values as 0')
        return report
      })(),
    )
  }
  return runs.get(key)
}

describe('the black hole against the flash estimator (slow)', () => {
  it('on a window of 1512 by 945 points: worstArea is under 2,500', { timeout: TIMEOUT }, async () => {
    const report = await flashOf([1512, 945], 0)
    assert.ok(report.worstArea < LIMIT, `worstArea ${report.worstArea} (limit ${LIMIT})`)
  })
  it('on a window of 800 by 600 points: worstArea is under 2,500', { timeout: TIMEOUT }, async () => {
    const report = await flashOf([800, 600], 0)
    assert.ok(report.worstArea < LIMIT, `worstArea ${report.worstArea} (limit ${LIMIT})`)
  })
  it('in the middle of the swing (frames 360 to 539) on 800 by 600: worstArea is under 2,500', { timeout: TIMEOUT }, async () => {
    const report = await flashOf([800, 600], 0, 360)
    assert.ok(report.worstArea < LIMIT, `worstArea ${report.worstArea} (limit ${LIMIT})`)
  })
  it('calm 1 flashes no more than calm 0 on 800 by 600', { timeout: TIMEOUT }, async () => {
    const calm0 = await flashOf([800, 600], 0)
    const calm1 = await flashOf([800, 600], 1)
    assert.ok(calm1.worstArea <= calm0.worstArea, `calm 1: ${calm1.worstArea}, calm 0: ${calm0.worstArea}`)
  })
})
