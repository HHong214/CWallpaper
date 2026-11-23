// The black hole's smaller stability faults (review findings). Run: node --test tools/tests/ (about 30 seconds).
//
// WHAT THESE TESTS PIN (shader: hooks/wallpapers/blackhole/shader.ts; dim 0, speed 1 unless a test says)
//   1. No cell flickers in calm motion. On a settled 600x400 picture (the prompt box 0.2, 0.05, 0.8, 0.15), over the 5
//      seconds from frame 60 to 209, at `calm` 1 and again at `calm` 0: take each colour lane by itself (red, green,
//      blue of the picture drawn over the preview's ground, 0 to 1, NOT luminance, which weighs red at 0.21 and
//      misses dim red dots) and run tools/flash.mjs `flashMeter` on it with a swing of 0.05. In each lane fewer than
//      60 samples swing more than three times a second (`flashingSamples` < 60), and no sample swings 10 or more
//      times in any second (`maxSwingsPerSecond` < 10). The review found about 70 cells at calm 1 that switch between
//      blank and a glyph on every frame (up to 30 changes a second).
//   2. A prompt box too narrow to be one counts as none: a box under 80 points wide gives, pixel for pixel, the picture
//      of no prompt box (not a blank one). On a 640x400 window: left 0.5 and right 0.5 with top 0.3, and left 0.45
//      and right 0.55 (64 points), each equal the picture with all four zero, at frame 30. A box of 83 points
//      (left 0.45, right 0.58) is a box: its picture differs from none's.
//   3. The frames-a-second digits hold still when the rate hovers. `fps` 1 on 480x320, the frame time alternating
//      between 1/29 and 1/30 second (the Renderer's `fps` is set to 29 and 30 on alternate frames; the shader reads
//      only dt) so the measured rate sits at 29.5, between 29.4 and 29.6: after 4 seconds (120 frames, to let it settle)
//      the readout's box (96 points wide, 24 high, bottom left) is read on each of the next 5 seconds' frames and
//      changes at most twice in all (a frame whose box differs from the one before it counts as a change).
//
// WHAT THEY ASSUME ABOUT tools/render.mjs: nothing new is needed (see blackhole-kit.mjs): the frame time is changed by
// writing `r.fps` between frames.
//
//   4. The disc comes back after the lens table was emptied, also when the geometry was worked out while it was empty
//      (480x300, prompt box 0.2, 0.05, 0.8, 0.15, each case against a control run that is the same but for the emptying):
//      a. the lens table zeroed before frame 90, the prompt box moved in one frame to left 0.3, right 0.9 at frame 100, the
//         saved table put back before frame 130. Frames 91 to 129 are all alpha 0 (the shader draws nothing while the
//         table reads empty); at frame 200 the disc is back: lit samples (red + green + blue over 0.2, as above)
//         within 15% of the control's, the disc's mean within 30% of the control's, the shadow at the formulas' new place.
//      b. the lens table, the `state` buffer and the `geo` buffer all zeroed before frame 90 (what an app might do at a
//         resize), the table put back before frame 120, no change of geometry: the same three checks at frame 190.
//      The stand-in lets a test reach the buffers (kit: `api.buffers()`, `snapshot`, `clearBuffer`, `restoreBuffer`, which
//      write the buffers' `data`), so both cases are pinned. The fault: `geo` keeps what each cell sees under a stamp of the
//      geometry it was worked out for and works it out again only when the geometry changes; worked out while the table
//      reads empty it keeps zeros under a good stamp, and the disc stays missing when the table returns.
//
// Why these fail now: the dim red dots of the calm motion swing in the red lane; a box under 80 points wide is read as a
// real one (a blank picture); the digits follow the rate's rounding every time it crosses a whole number. The numbers
// it gives today are in each failure message.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { discMean, drive, excess, geometry, lane, measureShadow, placeProblem, PROMPT } from './blackhole-kit.mjs'

describe('no cell flickers in calm motion (each colour lane on its own)', () => {
  const lanesName = ['red', 'green', 'blue']
  async function lanesOf(calm) {
    const { flashMeter } = await import('../flash.mjs')
    const points = [600, 400]
    const meters = [0, 1, 2].map(() => flashMeter({ width: 600, height: 400, fps: 30, pointsPerSample: 1 }))
    const bad = await drive({
      res: points,
      points,
      values: { calm },
      frames: 60 + 150,
      draw: f => f >= 60,
      onFrame: (_f, pic) => {
        for (let k = 0; k < 3; k++) meters[k].add(lane(pic, k))
      },
    })
    assert.equal(bad, 0)
    return meters.map(m => m.report())
  }
  for (const calm of [1, 0]) {
    it(`at calm ${calm}: fewer than 60 samples swing more than three times a second in any lane, and none swings 10 times in a second`, { timeout: 300000 }, async () => {
      const reports = await lanesOf(calm)
      const text = reports.map((r, k) => `${lanesName[k]}: ${r.flashingSamples} flashing samples, at most ${r.maxSwingsPerSecond} swings a second`).join('; ')
      reports.forEach((r, k) => {
        assert.ok(r.flashingSamples < 60, `${lanesName[k]} lane has ${r.flashingSamples} flashing samples (limit 60). ${text}`)
        assert.ok(r.maxSwingsPerSecond < 10, `${lanesName[k]} lane has a sample swinging ${r.maxSwingsPerSecond} times in a second (limit 9). ${text}`)
      })
    })
  }
})

describe('a prompt box too narrow to be one counts as none', () => {
  const points = [640, 400]
  async function picture(composer) {
    let out = null
    const bad = await drive({
      res: points,
      points,
      composer,
      frames: 31,
      draw: f => f === 30,
      onFrame: (_f, pic) => {
        out = pic
      },
    })
    assert.equal(bad, 0)
    return out
  }
  const worst = (a, b) => {
    let d = 0
    for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]))
    return d
  }
  const litCount = pic => {
    let n = 0
    for (let i = 0; i < pic.length; i += 4) if (pic[i] + pic[i + 1] + pic[i + 2] > 0.2) n++
    return n
  }
  it('left 0.5, right 0.5 with a non-zero top gives the picture of no prompt box, which is not blank', { timeout: 120000 }, async () => {
    const none = await picture([0, 0, 0, 0])
    assert.ok(litCount(none) > 500, 'the picture with no prompt box is blank')
    const zero = await picture([0.5, 0.05, 0.5, 0.3])
    assert.equal(worst(zero, none), 0, `lit samples ${litCount(zero)} against ${litCount(none)} with no box; the largest difference is ${worst(zero, none)}`)
  })
  it('a box 64 points wide gives the picture of no prompt box', { timeout: 120000 }, async () => {
    const none = await picture([0, 0, 0, 0])
    const narrow = await picture([0.45, 0.05, 0.55, 0.15])
    assert.equal(worst(narrow, none), 0, `lit samples ${litCount(narrow)} against ${litCount(none)} with no box`)
  })
  it('a box 83 points wide is a box: its picture is not the picture of no prompt box', { timeout: 120000 }, async () => {
    const none = await picture([0, 0, 0, 0])
    const box = await picture([0.45, 0.05, 0.58, 0.15])
    assert.ok(litCount(box) > 500, 'a box of 83 points gives a blank picture')
    assert.ok(worst(box, none) > 0.05, 'a box of 83 points gives the picture of none')
  })
})

describe('the frames-a-second digits hold still when the rate hovers', () => {
  it('with the measured rate at 29.5 for 5 seconds the readout changes at most twice', { timeout: 120000 }, async () => {
    const points = [480, 320]
    let prev = null
    let changes = 0
    const bad = await drive({
      res: points,
      points,
      composer: PROMPT,
      values: { fps: 1 },
      frames: 120 + 150,
      draw: f => f >= 120,
      tweak: (f, api) => api.setFps(f % 2 === 0 ? 29 : 30),
      onFrame: (f, pic, r) => {
        const L = r.luminance(pic)
        // the readout's box: 96 points wide, 24 high, bottom left (y up in the picture, rows top first in L)
        const box = new Float32Array(96 * 24)
        for (let y = 0; y < 24; y++) for (let x = 0; x < 96; x++) box[y * 96 + x] = excess(L[(r.h - 1 - y) * r.w + x])
        if (prev) {
          let differs = false
          for (let i = 0; i < box.length; i++) if (Math.abs(box[i] - prev[i]) > 1e-6) differs = true
          if (differs) changes++
        }
        prev = box
      },
    })
    assert.equal(bad, 0)
    assert.ok(changes <= 2, `the readout's box changed on ${changes} of 149 frames while the rate sat at 29.5 (limit 2)`)
  })
})

describe('the disc comes back after the lens table was empty', () => {
  const points = [480, 300]
  const NEW_BOX = [0.3, 0.05, 0.9, 0.15]
  const litCount = pic => {
    let n = 0
    for (let i = 0; i < pic.length; i += 4) if (pic[i] + pic[i + 1] + pic[i + 2] > 0.2) n++
    return n
  }
  /**
   * One run. `empty`: false for the control. `wide`: also zero state and geo. `moveAt`: the frame the box jumps (or null),
   * `emptyAt`, `backAt`, `checkAt`. Gives { lit, mean, shadow, alphaWhileEmpty, geo } at checkAt.
   */
  async function run({ empty, wide, moveAt, emptyAt, backAt, checkAt }) {
    let saved = null
    let alphaWhileEmpty = 0
    let out = null
    const g = geometry(points, moveAt === null ? PROMPT : NEW_BOX)
    const bad = await drive({
      res: points,
      points,
      composer: PROMPT,
      frames: checkAt + 1,
      draw: f => (f > emptyAt && f < backAt) || f === checkAt,
      tweak: (f, api) => {
        if (f === moveAt) api.setComposer(NEW_BOX)
        if (!empty) return
        if (f === emptyAt) {
          const b = api.buffers()
          saved = api.snapshot(b.lens)
          api.clearBuffer(b.lens)
          if (wide) {
            api.clearBuffer(b.state)
            api.clearBuffer(b.geo)
          }
        }
        if (f === backAt) api.restoreBuffer(api.buffers().lens, saved)
      },
      onFrame: (f, pic, r) => {
        if (f === checkAt) {
          const lum = r.luminance(pic)
          out = { lit: litCount(pic), mean: discMean(lum, r.w, r.h, g), shadow: measureShadow(lum, r.w, r.h, g) }
        } else for (let i = 3; i < pic.length; i += 4) alphaWhileEmpty = Math.max(alphaWhileEmpty, pic[i])
      },
    })
    assert.equal(bad, 0)
    return { ...out, alphaWhileEmpty, g }
  }
  function check(got, control, label) {
    const numbers = `lit ${got.lit} against ${control.lit} in the control; disc mean ${got.mean.toFixed(5)} against ${control.mean.toFixed(5)}`
    assert.ok(control.lit > 1000, `the control run is nearly blank (${control.lit} lit samples)`)
    assert.ok(Math.abs(got.lit / control.lit - 1) <= 0.15, `${label}: lit samples are not within 15% of the control's: ${numbers}`)
    assert.ok(Math.abs(got.mean / control.mean - 1) <= 0.3, `${label}: the disc's mean is not within 30% of the control's: ${numbers}`)
    assert.equal(placeProblem(got.shadow, got.g), '', `${label}: the shadow is not at the new place (${numbers})`)
  }
  it('the table emptied at frame 90, the box moved at 100, the table put back at 130: nothing drawn while empty, the disc back at 200', { timeout: 300000 }, async () => {
    const control = await run({ empty: false, moveAt: 100, emptyAt: 90, backAt: 130, checkAt: 200 })
    const got = await run({ empty: true, moveAt: 100, emptyAt: 90, backAt: 130, checkAt: 200 })
    assert.equal(got.alphaWhileEmpty, 0, `while the table is empty (frames 91 to 129) a pixel has alpha ${got.alphaWhileEmpty}`)
    check(got, control, 'frame 200')
  })
  it('the table, state and geo all cleared at frame 90, the table put back at 120, no change of geometry: the disc back at 190', { timeout: 300000 }, async () => {
    const control = await run({ empty: false, wide: true, moveAt: null, emptyAt: 90, backAt: 120, checkAt: 190 })
    const got = await run({ empty: true, wide: true, moveAt: null, emptyAt: 90, backAt: 120, checkAt: 190 })
    check(got, control, 'frame 190')
  })
})
