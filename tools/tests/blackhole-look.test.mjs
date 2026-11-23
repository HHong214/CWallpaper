// The black hole's look, contract v4 items 1 to 4, 8 and 9 (the view and the dark core), on rendered frames.
// Run: node --test tools/tests/ (about 6 seconds). The contract is the job's look-contract.md (2026-11-23, v4).
//
// WHAT THESE TESTS PIN, on settled frames (60 frames stepped, then drawn at frames 90 and 120) of the shader at
// dim 0, speed 1, calm 0, size 1, on an 800 by 500 window with the standard prompt box (0.2, 0.05, 0.8, 0.15), one
// pixel to the point. R, the centre (cx, cy) and W are the contract's (v2) formulas, kit `geometry()`.
//   1. Rolled: the roll phi is the angle of the principal axis of the luminance above the ground over the disc's box
//      (|x - cx| <= 0.575 W, |y - cy| <= 0.35 W; the weights are the excess luminance, the axis that of the second moments
//      about the weighted centroid; kit `rollDegrees`). |phi| is between 5 and 25 degrees.
//   2. The front of the disc is a band with height in front of the lower shadow (the wording of 2026-11-23, after the first was
//      met by today's picture). u, v: coordinates about the centre turned by phi (kit `toUV`; v up the window). In the strip
//      |u| <= 0.15 R, among the samples with v between -0.9 R and -0.1 R, the lit ones (luminance above the ground over 0.03)
//      span at least 0.25 R in v (highest minus lowest), and at least 30% of the samples between the highest and the lowest
//      lit one are lit (kit `frontBand`). Both parts are one test; the message gives the numbers.
//   3. The far side arches over the top: the mean luminance above the ground in 1.05 R <= v <= 1.6 R, |u| <= 0.5 R is over 0.02.
//   4. One side is the bright one: the mean over the disc's box for u < 0 is above the mean for u > 0.
//   8. A dark core: in the circle of radius 0.35 R centred 0.4 R above the centre along v, the mean of the red lane (the
//      picture's own colour, 0 to 1, over the preview's ground where alpha is below 1) is under 0.012 and of the blue lane
//      under 0.018 (the shader's ground, #060409, is 0.0235 and 0.0353 there), at dim 0.
//   9. The brightest light is at the edge: of the brightest 0.5% of the samples in the picture, the median distance
//      from the centre is between 0.8 R and 1.8 R.
// They replace v1's "the middle of the hole is dark" (with its strip across the centre) and "more light above than below",
// and item 4 replaces "the front band is brighter on its left half than on its right" (the strip across the centre no longer
// holds the band). They must hold for every candidate (tilt about 12, 20 or 28 degrees, roll 8 to 16), so the thresholds
// are the contract's ranges and nothing finer.
//
// Why these fail now: the shader looks at the disc almost edge-on: no roll (phi is about -0.5 degrees), the front of the disc
// a flat line through the centre, the upper shadow at the ground's own colour, not darker. Items 3, 4 and 9 are met by
// today's picture (the arch over the top, the bright left side, the brightest light round the ring): they are the
// properties to keep, and their tests pass today. The numbers each gives today are in the messages.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  brightestMedian, coreLane, drive, frontBand, geometry, meanInUV, PROMPT, rollDegrees, sideMeans,
} from './blackhole-kit.mjs'

const points = [800, 500]
const FRAMES = [90, 120]
let shots = null
async function frames() {
  if (!shots) {
    const out = {}
    const bad = await drive({
      res: points,
      points,
      composer: PROMPT,
      frames: Math.max(...FRAMES) + 1,
      draw: f => FRAMES.includes(f),
      onFrame: (f, pic, r) => {
        out[f] = { pic, lum: r.luminance(pic) }
      },
    })
    assert.equal(bad, 0)
    shots = out
  }
  return shots
}
const g = geometry(points, PROMPT)
const [w, h] = points
const f3 = v => v.toFixed(3)

describe('the view (contract v4, items 1 to 4)', () => {
  it('1. is rolled: the principal axis of the light is 5 to 25 degrees off the horizontal', async () => {
    const s = await frames()
    for (const f of FRAMES) {
      const phi = rollDegrees(s[f].lum, w, h, g)
      assert.ok(Math.abs(phi) >= 5 && Math.abs(phi) <= 25, `frame ${f}: the roll is ${f3(phi)} degrees (needs 5 to 25 either way)`)
    }
  })
  it('2. has a front band with height in front of the lower shadow: in the strip, the lit samples between v -0.9 R and -0.1 R span 0.25 R or more and fill 30% or more of that span', async () => {
    const s = await frames()
    for (const f of FRAMES) {
      const phi = rollDegrees(s[f].lum, w, h, g)
      const b = frontBand(s[f].lum, w, h, g, phi)
      const msg = `frame ${f} (roll ${f3(phi)}): ${b.n} lit samples in the strip between v -0.9 R and -0.1 R, span ${f3(b.span)} R (needs 0.25), ${(100 * b.fraction).toFixed(0)}% of the samples between the highest and lowest lit one are lit (needs 30%)`
      assert.ok(b.n > 0, msg)
      assert.ok(b.span >= 0.25 && b.fraction >= 0.3, msg)
    }
  })
  it('3. has the far side still arching over the top: the mean light in 1.05 R to 1.6 R above, within 0.5 R across, is over 0.02', async () => {
    const s = await frames()
    for (const f of FRAMES) {
      const phi = rollDegrees(s[f].lum, w, h, g)
      const m = meanInUV(s[f].lum, w, h, g, phi, (u, v) => v >= 1.05 && v <= 1.6 && Math.abs(u) <= 0.5)
      assert.ok(m.n > 500 && m.mean > 0.02, `frame ${f}: the mean over ${m.n} samples is ${f3(m.mean)} (needs over 0.02)`)
    }
  })
  it('4. has one bright side: the half of the disc with u < 0 is brighter than the half with u > 0', async () => {
    const s = await frames()
    for (const f of FRAMES) {
      const phi = rollDegrees(s[f].lum, w, h, g)
      const m = sideMeans(s[f].lum, w, h, g, phi)
      assert.ok(m.left > m.right, `frame ${f}: u < 0 ${m.left.toFixed(5)}, u > 0 ${m.right.toFixed(5)}`)
    }
  })
})

describe('the dark core (contract v4, items 8 and 9)', () => {
  it('8. is darker than the ground in the upper shadow: the mean red lane is under 0.012 and the blue under 0.018', async () => {
    const s = await frames()
    for (const f of FRAMES) {
      const phi = rollDegrees(s[f].lum, w, h, g)
      const red = coreLane(s[f].pic, w, h, g, phi, 0)
      const blue = coreLane(s[f].pic, w, h, g, phi, 2)
      assert.ok(red < 0.012 && blue < 0.018, `frame ${f}: the core's mean red is ${red.toFixed(4)} (needs under 0.012) and blue ${blue.toFixed(4)} (needs under 0.018)`)
    }
  })
  it('9. has its brightest light at the edge: the median distance of the brightest 0.5% from the centre is 0.8 R to 1.8 R', async () => {
    const s = await frames()
    for (const f of FRAMES) {
      const b = brightestMedian(s[f].lum, w, h, g)
      assert.ok(b.median >= 0.8 && b.median <= 1.8, `frame ${f}: the median distance of the brightest ${b.count} samples is ${f3(b.median)} R`)
    }
  })
})
