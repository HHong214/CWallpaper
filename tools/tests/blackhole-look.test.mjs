// The black hole's look after the owner's pictures: contract v5 items 1 to 9, on rendered frames. Run: node --test tools/tests/
// (one run: the first 900 frames stepped, four drawn, about 10 seconds). The contract is the job's look-contract-v5.md (2026-11-24).
//
// THE RUN: 800 by 500 points, one pixel to the point, the standard prompt box (0.2, 0.05, 0.8, 0.15), dim 0, speed 1, calm 0, size 1,
// 30 frames a second. "High" is frame 30, "low" is frame 900 (reached by stepping, not drawing; the swing's period is 60 seconds of the flow
// clock, so frame 900 is the low angle). R, the centre (cx, cy) and W are the contract's: kit `geometry()` (R = size * min(clamp(0.13 W,
// 40, 125), 0.15 * the window's height)). "Lit" is an excess luminance over the ground of more than 0.03; the red and blue lanes are the
// picture's own (over the preview's ground where alpha is below 1); "the disc's box" is the kit's (|x - cx| <= 0.575 W, |y - cy| <= 0.35 W).
//   1. Level at both: |phi| <= 4 degrees (kit `rollDegrees`: the principal axis of the light over the disc's box).
//   2. The swing: outside the jets' strip (|x - cx| > 0.5 R) the lit picture is between 0.40 and 0.60 as high as it is wide at high, and
//      between 0.04 and 0.22 at low (kit `spreadRatio`: the weighted standard deviation of y over that of x).
//   3. A whole black circle at high: over r < 0.8 R the mean red lane is under 0.012 and the blue under 0.018; and a ring all round: in each
//      of twelve 30 degree sectors of the annulus 0.95 R to 1.25 R at least 20% of the samples are lit.
//   4. At low the upper half is dark and the disc crosses the lower: the circle of radius 0.35 R centred 0.4 R above the centre is black as in
//      3; in the strip |x - cx| <= 0.15 R the lit samples between 0.9 R and 0.1 R below the centre span 0.15 R or more.
//   5. White-hot inside, red outside (high): of the cells that see the disc (geo.x > 0, not ring, not spark, not jet), the inner third by radius is
//      at least twice as bright as the outer third (the mean excess luminance over each cell's 6 by 10 pixels); the inner third's mean blue
//      lane is 0.45 of its mean red or more, the outer third's 0.30 or less (the lanes over the lit pixels of the cells).
//   6. One bright side (high): the half with x < cx is brighter than the other over the disc's box.
//   7. Jets: at high, in the strip |x - cx| <= 0.3 R between 2.3 R and 3.3 R above the centre there are 30 or more lit samples and on 60% or
//      more of them the blue lane is above the red. At low the same holds between 0.7 R and 1.8 R above and between 0.7 R and 1.8 R below.
//   8. Sparks: the lit cells (brightness drawn, flow.y, 0.15 or more) of kind spark (geo.w bit 8) number between 15 and 400 at high and at
//      low, and fewer than 70% of the ones lit at frame 60 are lit and in the same cell at frame 75.
//   9. The brightest light is at the hole's edge (high): of the brightest 0.5% of the samples in the picture, the median distance from the
//      centre is between 0.8 R and 1.8 R.
// They replace v4's items 1 to 3 (the roll, the front band over the lower shadow, the arch over the top); v4's bright side and brightest
// light are kept (6 and 9), and the dark core is items 3 and 4.
//
// WHERE THE PRESENT SHADER STANDS (v4's look: 20 degrees above, rolled 12, a front band over the lower shadow; HEAD 6fd7e40), item by item,
// from this run: 1 roll 9.24 degrees at high and 13.79 at low (needs 4): FAILS. 2 ratio 0.628 at high (needs 0.40 to 0.60) and 0.577 at low
// (needs 0.04 to 0.22): FAILS. 3 mean red 0.0709, blue 0.0095 over r < 0.8 R (needs 0.012 and 0.018) and the weakest ring sector 1% lit
// (needs 20%): FAILS. 4 core red 0.0008, blue 0.0012 and a strip span of 0.417 R: PASSES (a kept guard: today's picture has a dark
// upper shadow and a front band across the lower half at both angles, which is what item 4 asks of the low angle; the swing's own
// discriminator is item 2). 5 inner light 0.0827 against outer 0.0231 (ratio 3.59, passes) but blue over red 0.176 inside and 0.082 outside (needs 0.45 or more inside): FAILS on the inner blue. 6 left 0.0446, right 0.0216: PASSES (a kept guard). 7 blue share 0 in every band
// (the jet strip holds the old picture's orange: n 239 at high): FAILS. 8 the present shader's kind bits 8 and 16 are its old stray
// colours (teal and violet): 167 lit at high, 159 at low, 83% still lit in the same cell at frame 75 (needs under 70%): FAILS on the
// persistence. 9 median 2.119 R (needs 0.8 to 1.8): FAILS.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  brightestMedian, cellKinds, discColourByRadius, drive, findBuffers, geometry, jetSamples, lanesOver, litTexels, lowerStripSpan,
  PROMPT, ringSectors, rollDegrees, sideMeans, spreadRatio,
} from './blackhole-kit.mjs'
import { discCells } from './blackhole-motion.mjs'

const points = [800, 500]
const [w, h] = points
const g = geometry(points, PROMPT)
const HIGH = 30
const LOW = 900
const DRAWN = [HIGH, 60, 75, LOW]
let run = null
async function frames() {
  if (!run) {
    const out = { shots: {}, sparks: {}, cells: null, geoW: 0 }
    const bad = await drive({
      res: points,
      points,
      composer: PROMPT,
      frames: LOW + 1,
      draw: f => DRAWN.includes(f),
      onFrame: (f, pic, r) => {
        const b = findBuffers(r)
        const kinds = cellKinds(b.geo)
        out.sparks[f] = { lit: litTexels(b.flow, kinds.sparks), all: kinds.sparks.length }
        if (f === HIGH) {
          out.shots[f] = { pic, lum: r.luminance(pic) }
          out.cells = discCells(b.geo)
          out.geoW = b.geo.w
        }
        if (f === LOW) out.shots[f] = { pic, lum: r.luminance(pic) }
      },
    })
    assert.equal(bad, 0)
    run = out
  }
  return run
}
const f3 = v => v.toFixed(3)
const f4 = v => v.toFixed(4)

describe('the view (contract v5, items 1, 2, 6, 9)', () => {
  it('1. is level at both angles: |phi| is 4 degrees or less', { timeout: 300000 }, async () => {
    const s = await frames()
    for (const f of [HIGH, LOW]) {
      const phi = rollDegrees(s.shots[f].lum, w, h, g)
      assert.ok(Math.abs(phi) <= 4, `frame ${f} (${f === HIGH ? 'high' : 'low'}): the roll is ${f3(phi)} degrees (needs 4 or less)`)
    }
  })
  it('2. swings: the lit picture outside the jets is 0.40 to 0.60 as high as wide at high and 0.04 to 0.22 at low', { timeout: 300000 }, async () => {
    const s = await frames()
    const high = spreadRatio(s.shots[HIGH].lum, w, h, g)
    const low = spreadRatio(s.shots[LOW].lum, w, h, g)
    const msg = `high ${f3(high.ratio)} (needs 0.40 to 0.60), low ${f3(low.ratio)} (needs 0.04 to 0.22)`
    assert.ok(high.ratio >= 0.4 && high.ratio <= 0.6, msg)
    assert.ok(low.ratio >= 0.04 && low.ratio <= 0.22, msg)
  })
  it('6. has one bright side at high: the half with x < cx is brighter than the other over the disc box', { timeout: 300000 }, async () => {
    const s = await frames()
    const m = sideMeans(s.shots[HIGH].lum, w, h, g, 0)
    assert.ok(m.left > m.right, `x < cx ${m.left.toFixed(5)}, x > cx ${m.right.toFixed(5)}`)
  })
  it("9. has its brightest light at the hole's edge at high: the median distance of the brightest 0.5% from the centre is 0.8 R to 1.8 R", { timeout: 300000 }, async () => {
    const s = await frames()
    const b = brightestMedian(s.shots[HIGH].lum, w, h, g)
    assert.ok(b.median >= 0.8 && b.median <= 1.8, `the median distance of the brightest ${b.count} samples is ${f3(b.median)} R (needs 0.8 to 1.8)`)
  })
})

describe('the hole (contract v5, items 3 and 4)', () => {
  it('3. is a whole black circle with a ring all round at high: r < 0.8 R is black, and every 30 degree sector of 0.95 R to 1.25 R is 20% lit', { timeout: 300000 }, async () => {
    const s = await frames()
    const inside = lanesOver(s.shots[HIGH].pic, w, h, g, (dx, dy) => Math.hypot(dx, dy) < 0.8 * g.R)
    const ring = ringSectors(s.shots[HIGH].lum, w, h, g)
    const msg = `over r < 0.8 R the mean red is ${f4(inside.red)} (needs under 0.012) and blue ${f4(inside.blue)} (needs under 0.018); the weakest of the twelve ring sectors is ${(100 * ring.min).toFixed(0)}% lit (needs 20%): ${ring.fractions.map(v => (100 * v).toFixed(0)).join(' ')}`
    assert.ok(inside.red < 0.012 && inside.blue < 0.018, msg)
    assert.ok(ring.min >= 0.2, msg)
  })
  it('4. at low has a dark upper half and the disc across the lower: the circle 0.4 R above the centre is black, the strip below it spans 0.15 R or more', { timeout: 300000 }, async () => {
    const s = await frames()
    const core = lanesOver(s.shots[LOW].pic, w, h, g, (dx, dy) => Math.hypot(dx, dy - 0.4 * g.R) < 0.35 * g.R)
    const strip = lowerStripSpan(s.shots[LOW].lum, w, h, g)
    const msg = `the core's mean red is ${f4(core.red)} (needs under 0.012), blue ${f4(core.blue)} (needs under 0.018); in the strip ${strip.n} lit samples below the centre span ${f3(strip.span)} R (needs 0.15)`
    assert.ok(core.red < 0.012 && core.blue < 0.018, msg)
    assert.ok(strip.span >= 0.15, msg)
  })
})

describe('the disc and the jets (contract v5, items 5 and 7)', () => {
  it('5. is white-hot inside and red outside at high: the inner third twice as bright as the outer, blue 0.45 of red inside and 0.30 or less outside', { timeout: 300000 }, async () => {
    const s = await frames()
    const c = discColourByRadius(s.shots[HIGH].pic, s.shots[HIGH].lum, w, h, s.cells, s.geoW)
    const msg = `${s.cells.index.length} cells see the disc; inner light ${c.inner.light.toFixed(4)}, outer ${c.outer.light.toFixed(4)} (needs the inner twice the outer: ratio ${(c.inner.light / Math.max(c.outer.light, 1e-9)).toFixed(2)}); blue over red inner ${f3(c.inner.blue / Math.max(c.inner.red, 1e-9))} (needs 0.45 or more), outer ${f3(c.outer.blue / Math.max(c.outer.red, 1e-9))} (needs 0.30 or less)`
    assert.ok(s.cells.index.length > 100, msg)
    assert.ok(c.inner.light >= 2 * c.outer.light, msg)
    assert.ok(c.inner.blue >= 0.45 * c.inner.red && c.outer.blue <= 0.3 * c.outer.red, msg)
  })
  it('7. has blue-white jets: at high 30 or more lit samples 2.3 R to 3.3 R above the centre, at low 0.7 R to 1.8 R above and below, 60% or more bluer than red', { timeout: 300000 }, async () => {
    const s = await frames()
    const bands = [
      ['high, above 2.3 R to 3.3 R', HIGH, 2.3, 3.3],
      ['low, above 0.7 R to 1.8 R', LOW, 0.7, 1.8],
      ['low, below 0.7 R to 1.8 R', LOW, -1.8, -0.7],
    ]
    const got = bands.map(([name, f, a, b]) => ({ name, ...jetSamples(s.shots[f].pic, s.shots[f].lum, w, h, g, a, b) }))
    const msg = got.map(j => `${j.name}: ${j.n} lit samples, ${(100 * j.blueShare).toFixed(0)}% bluer than red`).join('; ') + ' (needs 30 samples and 60% in each)'
    for (const j of got) assert.ok(j.n >= 30 && j.blueShare >= 0.6, msg)
  })
})

describe('the sparks (contract v5, item 8)', () => {
  it('8. has 15 to 400 lit sparks at high and at low, and they move: under 70% of those lit at frame 60 are lit in the same cell at frame 75', { timeout: 300000 }, async () => {
    const s = await frames()
    const nHigh = s.sparks[HIGH].lit.length
    const nLow = s.sparks[LOW].lit.length
    const at60 = new Set(s.sparks[60].lit)
    const same = s.sparks[75].lit.filter(t => at60.has(t)).length
    const share = at60.size ? same / at60.size : 1
    const msg = `${nHigh} lit sparks at high and ${nLow} at low (needs 15 to 400 each; ${s.sparks[HIGH].all} cells are of kind spark); ${(100 * share).toFixed(0)}% of the ${at60.size} lit at frame 60 are lit in the same cell at frame 75 (needs under 70%)`
    assert.ok(nHigh >= 15 && nHigh <= 400 && nLow >= 15 && nLow <= 400, msg)
    assert.ok(share < 0.7, msg)
  })
})
