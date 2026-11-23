// The flash estimator: does a moving picture flash, by the app's rule (look.md: "A spot flashes when it
// swings between lighter and darker ... more than three times a second. It's too much when flashing spots
// within any 340 by 256 points add up to a patch about 100 points a side")?
//
//   flashReport(frames, options)  ->  { ok, worstArea, worstWindow: { x, y }, flashingSamples, maxSwingsPerSecond }
//   flashMeter(options)           ->  { add(frame), report() }, the same check fed one frame at a time
//
//   options = { width, height, fps, pointsPerSample = 1, swing = 0.05, perSecond = 3,
//               windowPoints = [340, 256], limitArea = 10000 }
//
// A frame is a Float32Array of luminance (0 to 1), width * height samples in rows, row 0 at the top, each
// sample pointsPerSample points square. Pure: Node's own language only, no imports.
//
// A swing: a sample's luminance turns round after moving at least `swing` from its last turning point. It is
// counted on the frame the turn is confirmed, that is when the luminance has come back at least `swing` from
// the extreme of the run (so a wobble smaller than `swing` is never counted, however fast). The first run
// from the starting value is not a turn.
// A sample flashes when some span of one second (the frames f with t - 1 s < f <= t) holds more than
// `perSecond` swings. worstArea is the largest area of flashing samples, in square points, inside any window
// of `windowPoints` (sliding, one sample at a time); a picture smaller than the window is the one window, and
// `limitArea` shrinks by the same share. ok is worstArea < that limit.

const RING = 32 // swings kept a sample: counts in one second are exact up to this many

export function flashMeter(options) {
  const {
    width, height, fps, pointsPerSample = 1, swing = 0.05, perSecond = 3,
    windowPoints = [340, 256], limitArea = 10000,
  } = options
  if (!(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)) {
    throw new Error('flashMeter: width and height are whole numbers above 0')
  }
  if (!(fps > 0)) throw new Error('flashMeter: fps must be above 0')
  const n = width * height
  const ref = new Float32Array(n) // the last turning point (or the first value)
  const ext = new Float32Array(n) // the extreme of the current run
  const dir = new Int8Array(n) // 0 no run yet, 1 rising, -1 falling
  const flashing = new Uint8Array(n)
  // swing frames, kept only for samples that swing: slot[i] is the sample's place in the pool
  const slot = new Int32Array(n).fill(-1)
  let pool = new Float64Array(1024 * RING)
  let count = new Uint32Array(1024) // swings so far, a slot
  let used = 0
  let frame = 0
  let maxSwings = 0

  function swingAt(i) {
    let s = slot[i]
    if (s < 0) {
      if (used === count.length) {
        const bigger = new Float64Array(pool.length * 2)
        bigger.set(pool)
        pool = bigger
        const c2 = new Uint32Array(count.length * 2)
        c2.set(count)
        count = c2
      }
      s = slot[i] = used++
    }
    const k = count[s]
    const base = s * RING
    pool[base + (k % RING)] = frame
    count[s] = k + 1
    // swings within one second ending now: frames f with frame - f < fps
    const kept = Math.min(k + 1, RING)
    let inSecond = 0
    for (let j = 0; j < kept; j++) if (frame - pool[base + j] < fps) inSecond++
    if (inSecond > maxSwings) maxSwings = inSecond
    if (inSecond > perSecond) flashing[i] = 1
  }

  function add(lum) {
    if (!lum || lum.length !== n) throw new Error(`flashMeter: a frame has ${n} samples (width * height)`)
    if (frame === 0) {
      for (let i = 0; i < n; i++) {
        ref[i] = lum[i]
        ext[i] = lum[i]
      }
      frame++
      return
    }
    for (let i = 0; i < n; i++) {
      const x = lum[i]
      const d = dir[i]
      if (d === 1) {
        if (x > ext[i]) ext[i] = x
        else if (ext[i] - x >= swing) {
          ref[i] = ext[i]
          dir[i] = -1
          ext[i] = x
          swingAt(i)
        }
      } else if (d === -1) {
        if (x < ext[i]) ext[i] = x
        else if (x - ext[i] >= swing) {
          ref[i] = ext[i]
          dir[i] = 1
          ext[i] = x
          swingAt(i)
        }
      } else if (x - ref[i] >= swing) {
        dir[i] = 1
        ext[i] = x
      } else if (ref[i] - x >= swing) {
        dir[i] = -1
        ext[i] = x
      }
    }
    frame++
  }

  function report() {
    let flashingSamples = 0
    for (let i = 0; i < n; i++) flashingSamples += flashing[i]
    // the window in samples, held to the picture
    const ww = Math.max(1, Math.round(windowPoints[0] / pointsPerSample))
    const wh = Math.max(1, Math.round(windowPoints[1] / pointsPerSample))
    const sw = Math.min(ww, width)
    const sh = Math.min(wh, height)
    const limit = limitArea * ((sw * sh) / (ww * wh))
    // sums over every window from a summed-area table
    const W1 = width + 1
    const sat = new Float64Array(W1 * (height + 1))
    for (let y = 0; y < height; y++) {
      let row = 0
      for (let x = 0; x < width; x++) {
        row += flashing[y * width + x]
        sat[(y + 1) * W1 + x + 1] = sat[y * W1 + x + 1] + row
      }
    }
    let best = 0
    let bx = 0
    let by = 0
    if (flashingSamples > 0) {
      for (let y = 0; y + sh <= height; y++) {
        for (let x = 0; x + sw <= width; x++) {
          const s = sat[(y + sh) * W1 + x + sw] - sat[y * W1 + x + sw] - sat[(y + sh) * W1 + x] + sat[y * W1 + x]
          if (s > best) {
            best = s
            bx = x
            by = y
          }
        }
      }
    }
    const worstArea = best * pointsPerSample * pointsPerSample
    return {
      ok: worstArea < limit,
      worstArea,
      worstWindow: { x: bx, y: by },
      flashingSamples,
      maxSwingsPerSecond: maxSwings,
    }
  }

  return { add, report }
}

export function flashReport(frames, options) {
  const meter = flashMeter(options)
  for (const f of frames) meter.add(f)
  return meter.report()
}
