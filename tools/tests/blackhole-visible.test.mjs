// The black hole's motion and texture, as the eye sees them. Run: node --test tools/tests/ (one run of 165 frames, about 5 s).
//
// WHY: the first candidates of the v4 look turn at 70 degrees a second by the locked measure (blackhole-spin.test.mjs) and still
// show almost no motion to the eye: the glyphs no longer follow the moving brightness, the disc is filled almost wholly with
// the densest glyph, the moving pattern is a faint change of colour, and the falling streaks are a few dim specks. The version
// the owner saw and called "looks great" (the committed shader at the time, git show HEAD:hooks/wallpapers/blackhole/shader.ts
// before the look round) had varied characters, gaps and visible tails. These tests pin that the motion and the texture can be seen.
//
// THE RUN (kit `visibleMetrics`): 600 by 378 points, the standard prompt box (0.2, 0.05, 0.8, 0.15), dim 0, speed 1, calm 0, size 1,
// 30 frames a second, frames 60 to 164 (the first 60 stepped). "The disc's box" is the kit's: |x - cx| <= 0.575 W, |y - cy| <= 0.35 W.
// Cells that "see the disc" are those of the `geo` buffer with geo.x > 0 that are not ring and not stray; a cell's glyph is
// flow.x mod 64 (0 is blank); its brightness drawn is flow.y; "lit" for a cell is a glyph above 0.
//
// THE NUMBERS OF THE VERSION THE OWNER LIKED, measured on the same run (committed shader of 2026-11-23, before the look round):
//   M_old = 0.5665 (item 1)
//   glyphs at frame 90: 461 lit cells that see the disc, the commonest glyph holds 22.1%, 9 glyphs hold 4% or more each (item 2)
//   lanes: spread 0.672 (item 3)
//   glyph changes: 55.1% of the lit cells change their glyph at least once, the most any makes in a second is 2 (item 4)
//   stray cells lit (brightness drawn 0.15 or more) on frames 60, 90, 120, 150: 10, 10, 10, 9 (item 5)
// THE WORKING TREE's shader when these were written (candidate B), and what each test below gives on it:
//   1. M = 0.392 against the threshold 0.850: FAILS
//   2. the commonest glyph holds 54.7% (needs 45% or less), 3 glyphs hold 4% or more each (needs 5): FAILS
//   3. lanes spread 0.861 (needs 0.6): PASSES (the working tree's brightness by angle is as varied as the old one's; the test
//      guards a lane structure that must not be lost while the glyphs are fixed)
//   4. 0% of the lit cells change their glyph (needs 25%), none changes more than twice a second: FAILS (the first part)
//   5. stray cells lit on frames 60, 90, 120, 150: 19, 20, 21, 19 against 40: FAILS
//
// WHAT IS PINNED
//   1. Motion you can see. M = (the mean over frames 60 to 149 of the mean over the disc's box of |L(t + 15 frames) - L(t)|, L the
//      luminance) divided by (the mean over frames 60 to 164 of the mean over the disc's box of the luminance above the ground).
//      M >= 0.6: a little over the committed shader's 0.5665 (the router's decision: the first rule, 1.5 times it or 0.850, would force a far busier picture than the one the owner called great; what was missing there was the turning, which blackhole-spin pins).
//   2. The disc is not one flat fill. Over the lit cells that see the disc at frame 90: the commonest glyph holds at most 45%
//      of them and at least five different glyphs hold 4% or more each.
//   3. Lanes. The cells that see the disc in the middle third by radius, their brightness drawn binned by angle in 10 degree
//      bins at frame 90: (the 90th percentile of the bins' means minus the 10th) divided by the mean of the bins is 0.6 or more.
//   4. The glyphs follow the motion. Over frames 60 to 164 at least 25% of the lit cells that see the disc (lit at frame 90)
//      change their glyph at least once, and none changes more than twice in any 30 consecutive frames (the flicker rule).
//   5. Falling matter you can see. The cells of kind stray (geo.w, floor(w / 8) mod 4 above 0) whose brightness drawn is 0.15 or
//      more, counted over the whole window on each of frames 60, 90, 120 and 150: each count is at least
//      max(half the committed shader's count on the same frame, 40), that is 40.
//
// The tests assume the glyph is flow.x mod 64 and the stray kind is geo.w's bits 8 and 16, as both shaders pack them (the
// contract lists these lanes).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { visibleMetrics } from './blackhole-kit.mjs'

const M_OLD = 0.5665
const STRAY_OLD = { 60: 10, 90: 10, 120: 10, 150: 9 }

let run = null
const measured = () => (run ??= visibleMetrics())

describe('the black hole shows its motion and its texture (visible to the eye)', () => {
  it('1. the motion can be seen: half a second apart the picture differs by 0.6 of its own brightness or more (the old shader gave 0.5665)', { timeout: 300000 }, async () => {
    const m = await measured()
    assert.equal(m.bad, 0)
    const need = 0.6
    assert.ok(m.M >= need, `M is ${m.M.toFixed(3)} (needs ${need.toFixed(3)}; the old shader gave ${M_OLD})`)
  })
  it('2. the disc is not one flat fill: the commonest glyph holds 45% or less of the lit cells and five glyphs hold 4% or more each', { timeout: 300000 }, async () => {
    const m = await measured()
    const msg = `${m.glyphs.cells} lit cells; the commonest glyph holds ${(100 * m.glyphs.top).toFixed(1)}% (needs 45% or less), ${m.glyphs.common} glyphs hold 4% or more (needs 5); shares ${m.glyphs.shares.map(v => (100 * v).toFixed(0)).join(' ')}%`
    assert.ok(m.glyphs.cells > 100, msg)
    assert.ok(m.glyphs.top <= 0.45 && m.glyphs.common >= 5, msg)
  })
  it('3. the disc has lanes: the brightness by angle in the middle third spreads by 0.6 of its mean (90th percentile minus 10th)', { timeout: 300000 }, async () => {
    const m = await measured()
    assert.ok(m.lanes.spread >= 0.6, `the spread is ${m.lanes.spread.toFixed(3)} over ${m.lanes.bins} bins of ${m.lanes.cells} cells (needs 0.6; the old shader gave 0.672)`)
  })
  it('4. the glyphs follow the motion: a quarter of the lit cells change glyph during the run, none more than twice in a second', { timeout: 300000 }, async () => {
    const m = await measured()
    const msg = `${(100 * m.changed).toFixed(1)}% of the lit cells change their glyph at least once (needs 25%; the old shader gave 55.1%); the most any makes in a second is ${m.mostIn1s} (needs 2 or fewer)`
    assert.ok(m.changed >= 0.25, msg)
    assert.ok(m.mostIn1s <= 2, msg)
  })
  it('5. the falling matter can be seen: 40 or more stray cells lit (brightness 0.15 or more), and half the old count, on each of frames 60, 90, 120, 150', { timeout: 300000 }, async () => {
    const m = await measured()
    const counts = Object.entries(m.strays).map(([f, n]) => `${f}: ${n} (needs ${Math.max(0.5 * STRAY_OLD[f], 40)}, old ${STRAY_OLD[f]})`)
    for (const f of [60, 90, 120, 150]) {
      assert.ok(m.strays[f] >= Math.max(0.5 * STRAY_OLD[f], 40), `lit stray cells by frame, ${counts.join('; ')}`)
    }
  })
})
