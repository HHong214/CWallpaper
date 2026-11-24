// "Black hole: calmer motion" is calmer, not nearly still. Behind SLOW (with blackhole-spin.test.mjs): two runs of 180 drawn frames
// at 800 by 500 points (about 15 seconds each) and two of the kit's visible-motion runs (about 5 seconds each).
// Run: SLOW=1 node --test tools/tests/blackhole-calm.test.mjs
//
// WHY: a review measured, with calm 1 and speed 0.5, the outer disc turning at 1.6 degrees a second and the swing of the view (30 to
// 6 degrees above the disc, once every 20 periods of the 3 second flow clock) taking four minutes: it reads as almost still. Calm
// is meant to take the edge off, not to stop the picture. The shader's clock pace is speed * (1 - 0.5 * calm) and calm also slows
// the easing of each cell's light; these tests pin how much calm may take away.
//
// THE RUN of items 1 and 2: as blackhole-spin.test.mjs item 10 measures it (frames 60 to 239 drawn of a run at 30 frames a second,
// 800 by 500 points, the standard prompt box, dim 0, size 1), with calm 1 and speed 1, then speed 0.5. The disc cells, the inner and
// outer third by radius, and the turn rate (degrees a second, the median over the run of the shift of the angle profile half a
// second apart) are blackhole-motion.mjs `discCells` and `turnRates`.
//   1. Calm 1, speed 1: the inner third turns at 30 degrees a second or more, the outer at 6 or more, the same way, the inner at
//      least twice as fast as the outer.
//   2. Calm 1, speed 0.5: the inner at 15 or more, the outer at 3 or more, the same way.
//   3. The swing. The flow clock is texel 3 of the `state` buffer (lane x the phase of a period, lane y the count of whole periods).
//      Over 300 frames at 30 frames a second (read after each frame from frame 1, the first frame's own start excluded), the
//      periods it advances for every 3 seconds of frames is: at calm 1, speed 1, 0.67 or more (the swing of 20 periods then takes
//      90 seconds or less); at calm 0, speed 1, one, within 2% (a guard: it passes today).
//   4. Calm is still calmer (a guard: it passes today). The visible change half a second apart, the kit's `visibleMetrics` M
//      (blackhole-visible.test.mjs item 1), on the same window and frames, is lower at calm 1 than at calm 0, speed 1.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { brightnessOf, discCells, turnRates } from './blackhole-motion.mjs'
import { drive, findBuffers, visibleMetrics } from './blackhole-kit.mjs'

const points = [800, 500]
const FPS = 30

/** The turn rates (degrees a second) of the disc's inner and outer third for the values, measured as blackhole-spin.test.mjs does. */
async function turns(values) {
  let cells = null
  const series = []
  const bad = await drive({
    res: points,
    points,
    frames: 240,
    values,
    draw: f => f >= 60,
    onFrame: (_f, _pic, r) => {
      const b = findBuffers(r)
      if (!cells) cells = discCells(b.geo)
      series.push(brightnessOf(b.flow, cells))
    },
  })
  assert.equal(bad, 0)
  assert.ok(cells.index.length > 100, `only ${cells.index.length} cells see the disc`)
  return { cells: cells.index.length, ...turnRates(cells, series, FPS) }
}

/** Periods of the flow clock advanced for every 3 seconds of frames, over 300 frames at 30 frames a second. */
async function periodsPer3s(values) {
  const res = [200, 126]
  const clock = []
  const bad = await drive({
    res,
    values,
    frames: 300,
    draw: () => false,
    // before frame f the state buffer holds the clock after frame f - 1
    tweak: (f, api) => {
      if (f < 1) return
      const d = api.buffers().state.data
      clock.push(d[3 * 4 + 1] + d[3 * 4])
    },
  })
  assert.equal(bad, 0)
  const seconds = (clock.length - 1) / FPS
  return { periods: (clock[clock.length - 1] - clock[0]) / seconds * 3, seconds }
}

const needTurn = (t, inner, outer, label) => {
  const msg = `${label}: ${t.cells} cells see the disc; the inner third turns at ${t.inner.toFixed(1)} degrees a second (needs ${inner}), the outer at ${t.outer.toFixed(1)} (needs ${outer})`
  assert.ok(Math.abs(t.inner) >= inner, msg)
  assert.ok(Math.abs(t.outer) >= outer, msg)
  assert.ok(Math.sign(t.inner) === Math.sign(t.outer), `${msg}: they turn opposite ways`)
  return msg
}

describe('calmer motion is calmer, not nearly still', () => {
  it('1. calm 1, speed 1: the inner third turns at 30 degrees a second or more, the outer at 6 or more, the same way, the inner at least twice as fast', { timeout: 300000 }, async () => {
    const t = await turns({ speed: 1, calm: 1 })
    const msg = needTurn(t, 30, 6, 'calm 1, speed 1')
    assert.ok(Math.abs(t.inner) >= 2 * Math.abs(t.outer), `${msg}: the inner is not twice as fast`)
  })
  it('2. calm 1, speed 0.5: the inner third turns at 15 degrees a second or more, the outer at 3 or more, the same way', { timeout: 300000 }, async () => {
    const t = await turns({ speed: 0.5, calm: 1 })
    needTurn(t, 15, 3, 'calm 1, speed 0.5')
  })
  it('3a. the swing at calm 1, speed 1 takes 90 seconds or less: the clock advances 0.67 periods or more for every 3 seconds', { timeout: 300000 }, async () => {
    const c = await periodsPer3s({ speed: 1, calm: 1 })
    assert.ok(c.periods >= 0.67, `calm 1, speed 1: the flow clock advances ${c.periods.toFixed(3)} periods for every 3 seconds over ${c.seconds.toFixed(1)} s (needs 0.67; the swing of 20 periods then takes ${(60 / c.periods).toFixed(0)} s, needs 90 or less)`)
  })
  it('3b. guard: at calm 0, speed 1 the clock advances one period for every 3 seconds, within 2%', { timeout: 300000 }, async () => {
    const c = await periodsPer3s({ speed: 1, calm: 0 })
    assert.ok(Math.abs(c.periods - 1) <= 0.02, `calm 0, speed 1: the flow clock advances ${c.periods.toFixed(3)} periods for every 3 seconds over ${c.seconds.toFixed(1)} s (needs 1 within 2%)`)
  })
  it('4. guard: calm 1 still changes less than calm 0, half a second apart, on the same window and frames', { timeout: 300000 }, async () => {
    const calm = await visibleMetrics(undefined, { calm: 1 })
    const plain = await visibleMetrics(undefined, { calm: 0 })
    assert.equal(calm.bad + plain.bad, 0)
    assert.ok(calm.M < plain.M, `M at calm 1 is ${calm.M.toFixed(3)}, at calm 0 ${plain.M.toFixed(3)} (calm 1 must be lower)`)
  })
})
