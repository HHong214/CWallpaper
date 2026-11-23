// Tests of the measuring functions for contract v4's items 5 to 7 (tools/tests/blackhole-motion.mjs), on made-up fields:
// one turning at a known rate with the inner part faster, one drifting inward at a known speed, one standing still (which
// must measure as not turning and not drifting), and of the kit's shadow measure on a made-up picture. They need no renderer
// and no shader, and run in well under a second.
// Run: node --test tools/tests/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bestLag, circularShift, inwardLead, median, sectorTravel, turnRates } from './blackhole-motion.mjs'
import { geometry, GROUND_LUM, measureShadow, placeProblem, PROMPT, toUV } from './blackhole-kit.mjs'

const TWO_PI = 2 * Math.PI
const FPS = 30
const FRAMES = 180

/** A made-up disc: 6000 cells with a repeatable spread of radius (10 to 50) and angle. */
function makeCells(n = 6000) {
  let s = 12345
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
  const radius = new Float32Array(n)
  const angle = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    radius[i] = 10 + 40 * rnd()
    angle[i] = TWO_PI * rnd()
  }
  return { index: Int32Array.from({ length: n }, (_, i) => i), radius, angle }
}
const pattern = a => Math.sin(3 * a) + 0.6 * Math.sin(5 * a + 1) + 0.3 * Math.cos(2 * a)
const series = (cells, fn) => Array.from({ length: FRAMES }, (_, t) => Float32Array.from(cells.radius, (r, i) => fn(r, cells.angle[i], t / FPS)))
const rad = deg => (deg * Math.PI) / 180

describe('circularShift and bestLag', () => {
  it('circularShift finds a shift of 2.5 bins either way, and 0 for a flat or an unmoved profile', () => {
    const f = x => Math.exp(-((((x + 18) % 36) - 18) ** 2) / 8)
    const a = Array.from({ length: 36 }, (_, k) => f(k - 10))
    const b = Array.from({ length: 36 }, (_, k) => f(k - 12.5))
    assert.ok(Math.abs(circularShift(a, b) - 2.5) < 0.15, `${circularShift(a, b)}`)
    assert.ok(Math.abs(circularShift(b, a) + 2.5) < 0.15)
    assert.equal(circularShift(a, a), 0)
    assert.equal(circularShift(new Array(36).fill(0.4), a), 0)
  })
  it('bestLag finds a delay of 7 frames (x leads y), a delay of 7 the other way, and no lag for a flat series', () => {
    const x = Float32Array.from({ length: 180 }, (_, t) => Math.sin(t / 5) + 0.3 * Math.sin(t / 2.3))
    const y = Float32Array.from({ length: 180 }, (_, t) => (t >= 7 ? x[t - 7] : 0))
    assert.ok(Math.abs(bestLag(x, y, 30).lag - 7) < 0.3, `${bestLag(x, y, 30).lag}`)
    assert.ok(Math.abs(bestLag(y, x, 30).lag + 7) < 0.3)
    assert.deepEqual(bestLag(new Float32Array(180).fill(0.5), y, 30), { lag: 0, score: 0 })
  })
})

describe('turnRates (item 5)', () => {
  const rate = (r, inner, outer) => (r < 23.3 ? inner : r > 36.7 ? outer : (inner + outer) / 2)
  it('a disc turning at 90 degrees a second inside and 30 outside measures about that, both the same way', () => {
    const cells = makeCells()
    const m = turnRates(cells, series(cells, (r, a, t) => pattern(a - rad(rate(r, 90, 30)) * t)), FPS)
    assert.ok(Math.abs(m.inner - 90) <= 5, `inner ${m.inner}`)
    assert.ok(Math.abs(m.outer - 30) <= 3, `outer ${m.outer}`)
    assert.ok(m.inner / m.outer > 2.5)
  })
  it('the other way round gives the same speeds with the opposite sign', () => {
    const cells = makeCells()
    const m = turnRates(cells, series(cells, (r, a, t) => pattern(a + rad(rate(r, 90, 30)) * t)), FPS)
    assert.ok(Math.abs(m.inner + 90) <= 5 && Math.abs(m.outer + 30) <= 3, `${m.inner}, ${m.outer}`)
  })
  it('a slow turn (6 degrees a second, under one bin in the half second) is still measured', () => {
    const cells = makeCells()
    const m = turnRates(cells, series(cells, (r, a, t) => pattern(a - rad(rate(r, 45, 6)) * t)), FPS)
    assert.ok(Math.abs(m.outer - 6) <= 1.5, `outer ${m.outer}`)
    assert.ok(Math.abs(m.inner - 45) <= 4, `inner ${m.inner}`)
  })
  it('a field that stands still (a fixed pattern, or nothing) does not turn', () => {
    const cells = makeCells()
    const fixed = turnRates(cells, series(cells, (_r, a) => pattern(a)), FPS)
    assert.ok(Math.abs(fixed.inner) < 1 && Math.abs(fixed.outer) < 1, `${fixed.inner}, ${fixed.outer}`)
    const flat = turnRates(cells, series(cells, () => 0.5), FPS)
    assert.equal(flat.inner, 0)
    assert.equal(flat.outer, 0)
  })
})

describe('inwardLead (item 7)', () => {
  // a pattern that is a function of r + v t drifts inwards at v (units of radius a second)
  const wave = (r, a, x) => Math.sin((TWO_PI * x) / 120 + a) * (1 + 0.3 * Math.cos(a))
  it('a pattern drifting inward at 40 a second: the outer bin leads the inner in every pair, by about 6 frames', () => {
    const cells = makeCells()
    const m = inwardLead(cells, series(cells, (r, a, t) => wave(r, a, r + 40 * t)))
    assert.equal(m.pairs.length, 16)
    assert.equal(m.lead, 1)
    assert.ok(Math.abs(m.medianLag - 6) <= 1.2, `median lag ${m.medianLag}`)
  })
  it('the same drifting outward has no outer-leads pair and a negative median lag', () => {
    const cells = makeCells()
    const m = inwardLead(cells, series(cells, (r, a, t) => wave(r, a, r - 40 * t)))
    assert.equal(m.lead, 0)
    assert.ok(m.medianLag < -4, `median lag ${m.medianLag}`)
  })
  it('a field that stands still, and a pure turn with no drift, are not drifting', () => {
    const cells = makeCells()
    const still = inwardLead(cells, series(cells, (r, a) => wave(r, a, r)))
    assert.equal(still.lead, 0)
    assert.equal(still.medianLag, 0)
    const turning = inwardLead(cells, series(cells, (_r, a, t) => pattern(a - rad(90) * t)))
    assert.ok(turning.lead < 0.6, `lead ${turning.lead}`)
    assert.ok(Math.abs(turning.medianLag) < 1, `median lag ${turning.medianLag}`)
  })
})

describe('sectorTravel (item 6)', () => {
  const sectors = (fn) => Array.from({ length: 8 }, (_, i) => Float32Array.from({ length: FRAMES }, (_, t) => fn(rad(30 + 15 * (i + 0.5)), t / FPS)))
  it('a pattern travelling round at 90 degrees a second: all seven pairs agree, the speed is about 90', () => {
    const m = sectorTravel(sectors((th, t) => pattern(th - rad(90) * t)), FPS)
    assert.equal(m.agree, 7)
    assert.equal(m.sign, 1)
    assert.ok(Math.abs(m.speed - 90) <= 10, `speed ${m.speed}`)
  })
  it('the other way round has the opposite sign and the same speed', () => {
    const m = sectorTravel(sectors((th, t) => pattern(th + rad(90) * t)), FPS)
    assert.equal(m.agree, 7)
    assert.equal(m.sign, -1)
    assert.ok(Math.abs(m.speed - 90) <= 10, `speed ${m.speed}`)
  })
  it('a pattern that stands still does not travel: no pair agrees, speed 0', () => {
    for (const fn of [th => pattern(th), () => 0.3]) {
      const m = sectorTravel(sectors(fn), FPS)
      assert.equal(m.agree, 0)
      assert.equal(m.sign, 0)
      assert.equal(m.speed, 0)
    }
  })
  it('median ignores order and takes the middle', () => {
    assert.equal(median([5, 1, 3]), 3)
    assert.equal(median([4, 1, 3, 2]), 2.5)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// The kit's shadow measure on a made-up picture: a dark circle (the ground's own luminance) with a lit rim (R to 1.25 R)
// and a lit band across its lower half, rolled by 15 and by 25 degrees, the band's inner (upper) edge 0.25 R below the
// centre (v from -0.55 R to -0.25 R, |u| up to 1.8 R). measureShadow reads the upper half only, so the band must not move
// the circle it returns: the centre within 8 points and R within the larger of 15% and 8 points (placeProblem's tolerances),
// on a smooth picture and on one drawn in cells of 6 by 10 points (a cell is lit or dark by its centre).
describe('measureShadow (the kit) on a made-up picture with a band across the lower half', () => {
  const points = [800, 500]
  const g = geometry(points, PROMPT)
  function picture(phiDeg, cells) {
    const [w, h] = points
    const lum = new Float32Array(w * h).fill(GROUND_LUM)
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const x = cells ? (Math.floor((i + 0.5) / 6) + 0.5) * 6 : i + 0.5
        const y = cells ? (Math.floor((j + 0.5) / 10) + 0.5) * 10 : j + 0.5
        const d = Math.hypot(x - g.cx, y - g.cy)
        const { u, v } = toUV(x, y, g, phiDeg)
        let value = GROUND_LUM
        if (d >= g.R && d < 1.25 * g.R) value = GROUND_LUM + 0.3
        if (v >= -0.55 * g.R && v <= -0.25 * g.R && Math.abs(u) <= 1.8 * g.R) value = GROUND_LUM + 0.4
        lum[(h - 1 - j) * w + i] = value
      }
    }
    return lum
  }
  for (const phi of [15, 25, -15]) {
    for (const cells of [false, true]) {
      it(`a band rolled by ${phi} degrees, drawn ${cells ? 'in cells of 6 by 10 points' : 'smooth'}: the circle is found within the tolerances`, () => {
        const m = measureShadow(picture(phi, cells), points[0], points[1], g)
        assert.equal(placeProblem(m, g), '', m ? `measured centre (${m.cx.toFixed(1)}, ${m.cy.toFixed(1)}), R ${m.R.toFixed(1)}; formula (${g.cx}, ${g.cy}), R ${g.R.toFixed(1)}` : 'null')
      })
    }
  }
  it('a picture whose middle is lit gives null', () => {
    const lum = new Float32Array(points[0] * points[1]).fill(GROUND_LUM + 0.3)
    assert.equal(measureShadow(lum, points[0], points[1], g), null)
  })
})
