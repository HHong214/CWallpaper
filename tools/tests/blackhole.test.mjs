// Tests for the black hole shader, hooks/wallpapers/blackhole/shader.ts, run under the preview tool
// (tools/render.mjs: loadShader + Renderer, the same code `node tools/preview.mjs` uses). Run: node --test tools/tests/
//
// The contract is the job's blackhole-contract.md ("The shader's numbers", "The grid", "Where it sits",
// "The picture"). The look itself is the builder's; these tests pin only what the contract says.
//
// WHAT THESE TESTS EXPECT THE BUILDER TO PROVIDE
//   hooks/wallpapers/blackhole/shader.ts   `export default shader({ fps: 30, passes: [...] })` (exactly one picture),
//   written in the subset tools/README.md gives, so loadShader() can import it as it stands. It declares
//     values({ dim: [0, 0.8], speed: [0, 1], calm: [0, 1], size: [0.6, 1.4] })   four names, no more (contract v5: `fps` is gone),
//   and in its source `const CELL_W = 6` and `const CELL_H = 10`, and a bitmap font held in a `table(...)`.
//
// HOW THE SHADER'S `values` ARE READ: from the stand-in. loadShader() returns `declared`, the names and ranges every
// values() call registered (tools/shader-standin.mjs keeps them for --values). The stand-in does expose them, so
// the source is not parsed for the values. The grid constants are read from the source, because the stand-in
// cannot show them.
//
// HOW IT IS RENDERED: every picture below is a window of points drawn at one pixel to the point (so the
// picture's own numbers are points), `dim` 0, `speed` 1, `calm` 0, `size` 1 unless a test says
// otherwise (a value left out would be its LOW end: size 0.6, speed 0). A window of 900 by 600 points is the
// usual one; 480 by 320 where the position does not matter. Frames are at 1 second (frame 30) or later.
// Each frame is read as luminance over the preview's dark ground (the tool's own `luminance()`), y up. "Excess"
// below is luminance above the ground's own.
//
// MEASURES THE BUILDER SHOULD KNOW (the contract says "the dark middle follows the formulas, to 6 points";
// this is how that is read off a picture):
//   - The shadow is read from the upper half of its circle only (kit measureShadow): in whole character cells (a cell is dark
//     when its block's mean excess is under 0.01), the dark runs along four rows of cells at 0.35, 0.5, 0.65 and 0.8 R above
//     the expected centre and up the centre column, a circle fitted through their ends. The centre must be within 8 points
//     of the formula's (the contract's 6 for snapping to a cell, and 2 for reading an edge off a grid of dots); R within the
//     larger of 15% and 8 points.
//   - Lit means luminance more than 0.002 above the ground. Brightness for `dim` is the sum of
//     0.2126 r + 0.7152 g + 0.0722 b over the premultiplied colours the shader returns (the values drawn,
//     not linear light): "a fifth as bright" means a fifth of that, so dim 0.8 is a ratio between 0.12 and 0.3
//     of the sum at dim 0 (it is exactly 0.2 if the colours are multiplied by 1 - dim).
//   - Thresholds I chose where the contract only says "brighter" or "light": the ring's mean luminance is 0.01
//     above the space outside the disc; the band's left half is at least 10% brighter than its right; light
//     above and below the ring is any (mean excess above 0.0005), above greater than below.
//
// CONTRACT v2 (placement): the prompt box's top and bottom change nothing (the box grows as the owner types). The
// centre is (left + right) / 2 across and 0.57 of the window's height up (the window's centre with no prompt box),
// and (contract v5) R = size * min(clamp(0.13 W, 40, 125), 0.15 * the window's height); it was 0.16 W, 48 to 150 and 0.18.
//
// CONTRACT v5 (the look after the owner's pictures, 2026-11-24): the readout, its box and every test of it are gone with the `fps`
// value, and so are the empty-lens-table tests and v4's items 1 to 3 (the roll, the front band over the lower shadow, the arch
// over the top). The look is pinned in blackhole-look.test.mjs (items 1 to 9), blackhole-spin.test.mjs (10 to 12, SLOW),
// blackhole-visible.test.mjs (13) and blackhole-measure.test.mjs (their measuring functions on made-up fields). The shadow
// measure (kit measureShadow, used by the placement and size tests) reads the upper half of the circle only; at the high angle
// the circle is whole, so it may stay as it is.
//
// Why these fail now: the shader file does not exist, so loadShader() fails to import it, in each test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { GROUND, loadShader, Renderer } from '../render.mjs'
import { measureShadow as measureLum } from './blackhole-kit.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SHADER = path.join(ROOT, 'hooks', 'wallpapers', 'blackhole', 'shader.ts')

const BIG = [900, 600]
const SMALL = [480, 320]
const PROMPT = [0.2, 0.05, 0.8, 0.15] // left, bottom, right, top: the preview's default prompt box
const BASE = { dim: 0, speed: 1, calm: 0, size: 1 }

const lin = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const GROUND_LUM = 0.2126 * lin(GROUND[0] / 255) + 0.7152 * lin(GROUND[1] / 255) + 0.0722 * lin(GROUND[2] / 255)
const excess = v => Math.max(0, v - GROUND_LUM)

const cache = new Map()
/**
 * Renders the shader (a fresh load each time) and keeps the luminance and the premultiplied picture of each
 * frame asked for, as { w, h, pics, lums, bad }. A value not given is the BASE one.
 */
function render({ points = BIG, composer = PROMPT, values = {}, frames = [30], fps } = {}) {
  const key = JSON.stringify([points, composer, values, frames, fps])
  if (!cache.has(key)) {
    cache.set(
      key,
      (async () => {
        const shader = await loadShader(SHADER)
        const r = new Renderer(shader, { res: points, points, composer, values: { ...BASE, ...values }, fps })
        const want = new Set(frames)
        const out = { w: points[0], h: points[1], pics: {}, lums: {}, declared: shader.declared, fps: shader.fps }
        for (let f = 0; f <= Math.max(...frames); f++) {
          const { pic } = r.runFrame(f, want.has(f))
          if (pic) {
            out.pics[f] = pic
            out.lums[f] = r.luminance(pic) // top row first
          }
        }
        out.bad = r.badValues()
        return out
      })(),
    )
  }
  return cache.get(key)
}

/** The contract's (v2) W, centre and R, in points with y up. The prompt box's top and bottom change nothing. `size` is the value the shader sees (after the stand-in holds it to 10 bits). */
function geometry(points, composer, sizeValue = 1) {
  const [sx, sy] = points
  const [l, b, rt, t] = composer
  const none = composer.every(v => v === 0)
  const W = none ? 0.6 * sx : (rt - l) * sx
  const cx = none ? sx / 2 : ((l + rt) / 2) * sx
  const cy = none ? sy / 2 : 0.57 * sy
  const R = sizeValue * Math.min(Math.min(Math.max(0.13 * W, 40), 125), 0.15 * sy)
  return { W, cx, cy, R }
}
/** What the stand-in makes of a value: held to its range, on 10 bits of it. */
const held = (range, v) => {
  const [lo, hi] = range
  const c = Math.min(Math.max(v, lo), hi)
  return lo + (Math.round(((c - lo) / (hi - lo)) * 1023) / 1023) * (hi - lo)
}
const SIZE_RANGE = [0.6, 1.4]

/** Mean of `fn` over the pixels (centre in points, y up) that `pred` accepts. */
function meanOver(shot, f, pred) {
  const { w, h } = shot
  const L = shot.lums[f]
  let sum = 0
  let n = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pred(x + 0.5, y + 0.5)) {
        sum += L[(h - 1 - y) * w + x]
        n++
      }
    }
  }
  return { mean: n ? sum / n : 0, n }
}

/** Reads the shadow's centre and R off a frame (kit measureShadow: the upper half of the circle only, see its header). Null if the middle is not dark at the expected centre. */
function measureShadow(shot, f, g) {
  return measureLum(shot.lums[f], shot.w, shot.h, g)
}

describe('the shader file', () => {
  it('loads under the stand-in as 30 frames a second with one picture', async () => {
    const shader = await loadShader(SHADER)
    assert.equal(shader.fps, 30)
  })
  it('declares four values and no more, with these ranges (read from the stand-in)', async () => {
    const shader = await loadShader(SHADER)
    assert.deepEqual(shader.declared, { dim: [0, 0.8], speed: [0, 1], calm: [0, 1], size: [0.6, 1.4] })
    assert.equal(shader.passes.filter(p => p.kind === 'picture').length, 1)
  })
})

describe('the grid', () => {
  const source = () => readFileSync(SHADER, 'utf8')
  it('has cells 6 points wide and 10 high, as two constants', () => {
    assert.match(source(), /\bconst\s+CELL_W\s*(?::\s*number\s*)?=\s*6\s*(?:;|\r?\n|$)/)
    assert.match(source(), /\bconst\s+CELL_H\s*(?::\s*number\s*)?=\s*10\s*(?:;|\r?\n|$)/)
  })
  it('draws its characters from a bitmap font held in a table', () => {
    assert.match(source(), /\btable\s*\(/)
  })
})

describe('where it sits', () => {
  // composer is left, bottom, right, top. A window of 900 by 600 points unless a case says otherwise.
  // v2: the centre is 0.57 of the window's height up whatever the box's top and bottom, and R is bounded by 0.15 of it (v5).
  const cases = [
    ['a prompt box in the middle', PROMPT],
    ['a prompt box pushed left', [0.05, 0.05, 0.65, 0.15]],
    ['a prompt box pushed right', [0.35, 0.05, 0.95, 0.15]],
    ['no prompt box', [0, 0, 0, 0]],
    ['a tall prompt box (its top changes nothing)', [0.2, 0.05, 0.8, 0.55]],
    ['a narrow prompt box (0.13 W is under 40, so 40 sets R)', [0.4, 0.05, 0.6, 0.15]],
    ['a short window, 900 by 300 (0.15 of its height sets R)', PROMPT, [900, 300]],
  ]
  for (const [name, composer, points = BIG] of cases) {
    it(`${name}: the dark middle is at the formulas' centre and radius, and the light keeps inside 1.15 W`, async () => {
      const shot = await render({ composer, points })
      const g = geometry(points, composer)
      const m = measureShadow(shot, 30, g)
      assert.ok(m, `the middle of the picture is not dark at the expected centre (${g.cx}, ${g.cy})`)
      assert.ok(Math.abs(m.cx - g.cx) <= 8, `centre across: measured ${m.cx.toFixed(1)}, formula ${g.cx.toFixed(1)}`)
      assert.ok(Math.abs(m.cy - g.cy) <= 8, `centre up: measured ${m.cy.toFixed(1)}, formula ${g.cy.toFixed(1)}`)
      assert.ok(Math.abs(m.R - g.R) <= Math.max(0.15 * g.R, 8), `R: measured ${m.R.toFixed(1)}, formula ${g.R.toFixed(1)}`)
      // nothing lit further across than 1.15 W centred on the centre (a cell of 6 points for snapping)
      const L = shot.lums[30]
      const reach = 0.575 * g.W + 6
      let worst = 0
      for (let y = 0; y < shot.h; y++) {
        for (let x = 0; x < shot.w; x++) {
          if (excess(L[(shot.h - 1 - y) * shot.w + x]) > 0.002) worst = Math.max(worst, Math.abs(x + 0.5 - g.cx))
        }
      }
      assert.ok(worst <= reach, `light reaches ${worst.toFixed(1)} points from the centre, the limit is ${reach.toFixed(1)}`)
    })
  }
})

describe('the prompt box as it grows (v2)', () => {
  // The box's top and bottom change as the owner types; nothing may move with them. Its left and right still do.
  const same = (a, b, label) => {
    for (const f of [30, 60]) {
      let worst = 0
      for (let i = 0; i < a.pics[f].length; i++) worst = Math.max(worst, Math.abs(a.pics[f][i] - b.pics[f][i]))
      assert.equal(worst, 0, `${label}: frame ${f} differs by up to ${worst}`)
    }
  }
  it('two prompt boxes that differ only in top (0.14 against 0.34) give the same picture, pixel for pixel', async () => {
    const low = await render({ points: SMALL, composer: [0.2, 0.05, 0.8, 0.14], frames: [30, 60] })
    const high = await render({ points: SMALL, composer: [0.2, 0.05, 0.8, 0.34], frames: [30, 60] })
    same(low, high, 'top 0.14 and 0.34')
  })
  it('two prompt boxes that differ only in bottom (0.02 against 0.12) give the same picture, pixel for pixel', async () => {
    const a = await render({ points: SMALL, composer: [0.2, 0.02, 0.8, 0.2], frames: [30, 60] })
    const b = await render({ points: SMALL, composer: [0.2, 0.12, 0.8, 0.2], frames: [30, 60] })
    same(a, b, 'bottom 0.02 and 0.12')
  })
  it('a prompt box moved sideways still moves the hole: its centre follows the box across', async () => {
    const left = await render({ points: SMALL, composer: [0.05, 0.05, 0.65, 0.15] })
    const right = await render({ points: SMALL, composer: [0.35, 0.05, 0.95, 0.15] })
    const gl = geometry(SMALL, [0.05, 0.05, 0.65, 0.15])
    const gr = geometry(SMALL, [0.35, 0.05, 0.95, 0.15])
    const ml = measureShadow(left, 30, gl)
    const mr = measureShadow(right, 30, gr)
    assert.ok(ml && mr, 'the middle is not dark at the expected centre')
    assert.ok(Math.abs(ml.cx - gl.cx) <= 8 && Math.abs(mr.cx - gr.cx) <= 8)
    assert.ok(mr.cx - ml.cx > 0.25 * SMALL[0], `the hole moved ${(mr.cx - ml.cx).toFixed(1)} points across, the boxes are ${(gr.cx - gl.cx).toFixed(1)} apart`)
  })
})

describe('the picture', () => {
  const g = geometry(BIG, PROMPT)
  it('has a ring round the shadow brighter than the space just outside the disc', async () => {
    const shot = await render({ frames: [30, 60] })
    for (const f of [30, 60]) {
      const ring = meanOver(shot, f, (x, y) => {
        const d = Math.hypot(x - g.cx, y - g.cy)
        return d >= 0.95 * g.R && d <= 1.4 * g.R
      })
      // beside the disc, at the height of the hole, 0.6 W to 0.75 W from the centre, both sides
      const out = meanOver(
        shot, f,
        (x, y) => Math.abs(x - g.cx) >= 0.6 * g.W && Math.abs(x - g.cx) <= 0.75 * g.W && Math.abs(y - g.cy) <= g.R,
      )
      assert.ok(out.n > 1000)
      assert.ok(ring.mean > out.mean + 0.01, `frame ${f}: ring ${ring.mean.toFixed(4)}, outside ${out.mean.toFixed(4)}`)
    }
  })
  it('is all finite, each colour lane 0 to 1, and no lane above its alpha (premultiplied)', async () => {
    const shot = await render({ frames: [30, 60] })
    assert.equal(shot.bad, 0, 'the preview drew non-finite values as 0')
    for (const f of [30, 60]) {
      const pic = shot.pics[f]
      for (let i = 0; i < pic.length; i += 4) {
        const [r, gg, b, a] = [pic[i], pic[i + 1], pic[i + 2], pic[i + 3]]
        for (const v of [r, gg, b, a]) {
          if (!(Number.isFinite(v) && v >= 0 && v <= 1)) assert.fail(`frame ${f}, pixel ${i / 4}: lane ${v} is not finite or not within 0 to 1`)
        }
        if (r > a + 1e-6 || gg > a + 1e-6 || b > a + 1e-6) assert.fail(`frame ${f}, pixel ${i / 4}: (${r}, ${gg}, ${b}) is above alpha ${a}`)
      }
    }
  })
  it('is not blank at 1 second, and moves: the frame at 2 seconds is not the frame at 1', async () => {
    const shot = await render({ frames: [30, 60] })
    const a = shot.lums[30]
    const b = shot.lums[60]
    let lit = 0
    let moved = 0
    let total = 0
    for (let i = 0; i < a.length; i++) {
      if (excess(a[i]) > 0.01) lit++
      const d = Math.abs(a[i] - b[i])
      total += d
      if (d > 0.01) moved++
    }
    assert.ok(lit > 500, `only ${lit} lit pixels at 1 second`)
    assert.ok(moved > 100, `only ${moved} pixels differ by more than 0.01 between 1 and 2 seconds`)
    assert.ok(total / a.length > 1e-4)
  })
})

describe('dim', () => {
  const brightness = shot => {
    const pic = shot.pics[30]
    let s = 0
    for (let i = 0; i < pic.length; i += 4) s += 0.2126 * pic[i] + 0.7152 * pic[i + 1] + 0.0722 * pic[i + 2]
    return s
  }
  it('0.8 gives about a fifth of the light of 0: between 0.12 and 0.3', async () => {
    const full = brightness(await render({ points: SMALL, values: { dim: 0 } }))
    const dim = brightness(await render({ points: SMALL, values: { dim: 0.8 } }))
    assert.ok(full > 10, `the picture at dim 0 is nearly dark (${full})`)
    const ratio = dim / full
    assert.ok(ratio >= 0.12 && ratio <= 0.3, `dim 0.8 gives ${ratio.toFixed(3)} of the light at dim 0`)
  })
  it('0.4 sits in between, and dim darkens without moving anything: the lit pixels stay where they were', async () => {
    const full = await render({ points: SMALL, values: { dim: 0 } })
    const half = await render({ points: SMALL, values: { dim: 0.4 } })
    const dim = await render({ points: SMALL, values: { dim: 0.8 } })
    assert.ok(brightness(dim) < brightness(half) && brightness(half) < brightness(full))
    // no new lit pixel appears where dim 0 was dark
    const a = full.pics[30]
    const b = half.pics[30]
    for (let i = 3; i < a.length; i += 4) {
      if (a[i] < 1e-6 && b[i] > 1e-3) assert.fail(`pixel ${(i - 3) / 4} is lit at dim 0.4 and not at dim 0`)
    }
  })
})

describe('calm', () => {
  const frames = [30, 31, 32, 33, 34, 35, 36]
  const change = shot => {
    let sum = 0
    for (let k = 0; k + 1 < frames.length; k++) {
      const a = shot.lums[frames[k]]
      const b = shot.lums[frames[k + 1]]
      for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
    }
    return sum / ((frames.length - 1) * shot.lums[frames[0]].length)
  }
  it('1 slows and softens the motion: the change from one frame to the next is smaller than at 0, and the picture is still alive', async () => {
    const lively = await render({ points: SMALL, values: { calm: 0 }, frames })
    const calm = await render({ points: SMALL, values: { calm: 1 }, frames })
    const c0 = change(lively)
    const c1 = change(calm)
    assert.ok(c0 > 0, 'the picture at calm 0 does not change from frame to frame')
    assert.ok(c1 < c0 * 0.95, `change per frame: calm 1 ${c1.toExponential(3)}, calm 0 ${c0.toExponential(3)}`)
    let lit = 0
    for (const v of calm.lums[30]) if (excess(v) > 0.01) lit++
    assert.ok(lit > 200, 'the calm picture is blank')
  })
})

describe('size', () => {
  it('0.8 and 1.25 scale the dark middle: the shadow is 0.8 and 1.25 times as large', async () => {
    const radii = {}
    for (const size of [0.8, 1, 1.25]) {
      const shot = await render({ values: { size } })
      const g = geometry(BIG, PROMPT, held(SIZE_RANGE, size))
      const m = measureShadow(shot, 30, g)
      assert.ok(m, `size ${size}: the middle is not dark at the expected centre`)
      assert.ok(Math.abs(m.R - g.R) <= Math.max(0.15 * g.R, 8), `size ${size}: R measured ${m.R.toFixed(1)}, formula ${g.R.toFixed(1)}`)
      assert.ok(Math.abs(m.cx - g.cx) <= 8 && Math.abs(m.cy - g.cy) <= 8, `size ${size}: the centre moved`)
      radii[size] = m.R
    }
    assert.ok(radii[0.8] < radii[1] && radii[1] < radii[1.25])
    assert.ok(radii[1.25] / radii[0.8] > 1.4, `1.25 over 0.8 is ${(radii[1.25] / radii[0.8]).toFixed(2)}, it should be about 1.56`)
  })
})
