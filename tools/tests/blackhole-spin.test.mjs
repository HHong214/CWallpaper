// The black hole turning, its ring light travelling and its jets streaming: contract v5, items 10, 11 and 12 (10 and 11 are v4's
// items 5 and 6). Behind SLOW: one run of 180 drawn frames at 800 by 500 points, about 15 seconds with the present shader.
// Run: SLOW=1 node --test tools/tests/blackhole-spin.test.mjs
//
// THE RUN: frames 60 to 239 of a run at 30 frames a second (the first 60 stepped, not drawn), 800 by 500 points, one pixel
// to the point, the standard prompt box (0.2, 0.05, 0.8, 0.15), speed 1, calm 0, dim 0, size 1. For each drawn frame the test
// reads the `geo` and `flow` buffers through the kit (`findBuffers`; the lanes are part of the contract: geo.x the disc
// radius in units of R / 5.196, 0 where the cell sees none; geo.y its angle in the disc, radians; geo.w the kind, order + 4 ring +
// 8 spark + 16 jet + 32 dither; flow.y the brightness the cell is drawn at) and the rendered luminance.
//   10 (v4's 5). The disc's pattern turns, the inner part faster. The cells that see the disc (geo.x > 0, not ring, not stray, not the
//      stamp texel) are split by radius into an inner and an outer third; for each, the brightness by angle in bins of 10
//      degrees every frame, and the circular shift that best matches it to the profile half a second later (refined by a
//      parabola so a turn under one bin in that time is measured): degrees a second, the median over the run. Pinned: the
//      inner third turns at 45 or more, the outer at 6 or more, both the same way, the inner at least twice as fast as the outer.
//   11 (v4's 6). The light round the top of the shadow travels round it. On the frames, the annulus 0.9 R to 1.2 R about the centre in
//      eight sectors of 15 degrees from 30 to 150 degrees (measured from the u axis, turned by the roll measured on the
//      first drawn frame as in blackhole-look.test.mjs); the series of mean luminance of adjacent sectors match best at a lag
//      (up to 40 frames) of the same sign for at least six of the seven pairs, and the median speed (15 degrees times 30 over
//      the lag in frames) is 60 degrees a second or more.
//   12. The jets stream outward. The cells of kind jet above the centre (geo.w bit 16, cell centre above cy), split by height into six
//      equal-count bins; the brightness series (flow.y, mean over a bin's cells) of adjacent bins match best with the lower bin
//      leading the upper (lag above 0.05 frame, up to 30 frames) in 60% or more of the five pairs, and the median lag is one
//      frame or more (kit-side function: blackhole-motion.mjs streamLead).
// v4's item 7 (the disc's lanes drifting inward) is not in contract v5's list of pinned motion and its test is gone from here
// (inwardLead and its made-up-field tests stay in blackhole-motion.mjs and blackhole-measure.test.mjs).
// The measuring functions are tools/tests/blackhole-motion.mjs, tested on made-up fields in blackhole-measure.test.mjs.
//
// Where it stands: the numbers each gives on the present shader are in the messages; they scatter from run to run and window to
// window when there is no motion for a measure to find.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { brightnessOf, discCells, sectorTravel, streamLead, turnRates } from './blackhole-motion.mjs'
import { drive, findBuffers, geometry, PROMPT, rollDegrees } from './blackhole-kit.mjs'

const points = [800, 500]
const [w, h] = points
const FPS = 30
const g = geometry(points, PROMPT)
let run = null

async function measured() {
  if (run) return run
  let cells = null
  let phi = null
  const series = []
  let jets = null
  const jetSeries = []
  const sectors = Array.from({ length: 8 }, () => [])
  const bad = await drive({
    res: points,
    points,
    composer: PROMPT,
    frames: 240,
    draw: f => f >= 60,
    onFrame: (_f, pic, r) => {
      const b = findBuffers(r)
      if (!cells) cells = discCells(b.geo)
      if (!jets) {
        // the cells of kind jet above the centre (geo.w bit 16), and their height above it
        const index = []
        const height = []
        for (let t = 1; t < b.geo.w * b.geo.h; t++) {
          if (Math.floor(b.geo.data[t * 4 + 3] / 16) % 2 !== 1) continue
          const y = (Math.floor(t / b.geo.w) + 0.5) * 10
          if (y > g.cy) {
            index.push(t)
            height.push(y - g.cy)
          }
        }
        jets = { index: Int32Array.from(index), height }
      }
      jetSeries.push(Float32Array.from(jets.index, t => b.flow.data[t * 4 + 1]))
      series.push(brightnessOf(b.flow, cells))
      const lum = r.luminance(pic)
      if (phi === null) phi = rollDegrees(lum, w, h, g)
      const sum = new Float64Array(8)
      const cnt = new Float64Array(8)
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const dx = i + 0.5 - g.cx
          const dy = j + 0.5 - g.cy
          const d = Math.hypot(dx, dy) / g.R
          if (d < 0.9 || d > 1.2) continue
          const deg = (((Math.atan2(dy, dx) * 180) / Math.PI - phi) % 360 + 360) % 360
          const k = Math.floor((deg - 30) / 15)
          if (k < 0 || k > 7) continue
          sum[k] += lum[(h - 1 - j) * w + i]
          cnt[k]++
        }
      }
      for (let k = 0; k < 8; k++) sectors[k].push(cnt[k] ? sum[k] / cnt[k] : 0)
    },
  })
  assert.equal(bad, 0)
  assert.ok(cells.index.length > 100, `only ${cells.index.length} cells see the disc`)
  run = { cells, series, sectors, phi, jets, jetSeries }
  return run
}

describe('the black hole turns, its ring light travels and its jets stream (contract v5, items 10 to 12)', () => {
  it('10. the disc turns, the inner third at 45 degrees a second or more, the outer at 6 or more, the same way, the inner at least twice as fast', { timeout: 300000 }, async () => {
    const r = await measured()
    const t = turnRates(r.cells, r.series, FPS)
    const msg = `${r.cells.index.length} cells see the disc; the inner third turns at ${t.inner.toFixed(1)} degrees a second (needs 45), the outer at ${t.outer.toFixed(1)} (needs 6)`
    assert.ok(Math.abs(t.inner) >= 45, msg)
    assert.ok(Math.abs(t.outer) >= 6, msg)
    assert.ok(Math.sign(t.inner) === Math.sign(t.outer), `${msg}: they turn opposite ways`)
    assert.ok(Math.abs(t.inner) >= 2 * Math.abs(t.outer), `${msg}: the inner is not twice as fast`)
  })
  it('11. the light round the top of the shadow travels round it: at least six of seven pairs of sectors agree, at 60 degrees a second or more', { timeout: 300000 }, async () => {
    const r = await measured()
    const s = sectorTravel(r.sectors, FPS)
    const msg = `lags in frames ${s.lags.map(l => l.toFixed(1)).join(' ')}: ${s.agree} of 7 agree (needs 6), the median speed is ${s.speed.toFixed(1)} degrees a second (needs 60)`
    assert.ok(s.agree >= 6, msg)
    assert.ok(s.speed >= 60, msg)
  })
  it('12. the jets stream outward: the lower bin leads the upper in at least 60% of the pairs of six height bins, by one frame or more', { timeout: 300000 }, async () => {
    const r = await measured()
    assert.ok(r.jets.index.length >= 60, `only ${r.jets.index.length} cells of kind jet above the centre (needs 60 to measure six bins)`)
    const m = streamLead(r.jets.height, r.jetSeries)
    const msg = `${r.jets.index.length} jet cells above the centre; the lower bin leads in ${(100 * m.lead).toFixed(0)}% of ${m.pairs.length} pairs (needs 60%), the median lag is ${m.medianLag.toFixed(2)} frames (needs 1); lags ${m.pairs.map(l => l.toFixed(1)).join(' ')}`
    assert.ok(m.lead >= 0.6, msg)
    assert.ok(m.medianLag >= 1, msg)
  })
})
