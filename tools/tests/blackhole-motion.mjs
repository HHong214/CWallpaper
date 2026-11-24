// Contract v4, items 5 to 7: how the pattern moves. Pure functions on plain arrays (no renderer), tested on made-up
// fields with a known turn rate and drift in blackhole-measure.test.mjs, then used on the shader's own buffers and
// frames in blackhole-spin.test.mjs. Not a test file.

const median = xs => {
  const a = Float64Array.from(xs).sort()
  return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : NaN
}
export { median }

/**
 * The cells of the `geo` buffer that see the disc: geo.x > 0, not ring (bit 4 of the kind), not stray (8 and 16), not the
 * stamp texel (0, 0). Gives { index (of the texel; its lanes are at index * 4), radius, angle (radians, 0 to 2 pi) }.
 * `geo` is { data, w, h } as the renderer's buffer is.
 */
export function discCells(geo) {
  const index = []
  const radius = []
  const angle = []
  for (let t = 1; t < geo.w * geo.h; t++) {
    const x = geo.data[t * 4]
    if (!(x > 0)) continue
    const code = geo.data[t * 4 + 3]
    if (Math.floor(code / 4) % 2 === 1) continue
    if (Math.floor(code / 8) % 4 !== 0) continue
    index.push(t)
    radius.push(x)
    const a = geo.data[t * 4 + 1]
    angle.push(((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI))
  }
  return { index: Int32Array.from(index), radius: Float32Array.from(radius), angle: Float32Array.from(angle) }
}

/** The brightness (`flow` lane y) of each of the cells, now. */
export function brightnessOf(flow, cells) {
  const out = new Float32Array(cells.index.length)
  for (let i = 0; i < out.length; i++) out[i] = flow.data[cells.index[i] * 4 + 1]
  return out
}

/**
 * The shift s (a fraction of a bin, positive towards higher bins) that best carries profile a onto profile b in a
 * circle: b[k] ~ a[k - s]. The best integer shift by correlation, refined by a parabola through it and its
 * neighbours (so a turn smaller than one bin can be measured). 0 when either profile is flat.
 */
export function circularShift(a, b) {
  const n = a.length
  const ma = a.reduce((s, v) => s + v, 0) / n
  const mb = b.reduce((s, v) => s + v, 0) / n
  let va = 0
  let vb = 0
  for (let k = 0; k < n; k++) {
    va += (a[k] - ma) ** 2
    vb += (b[k] - mb) ** 2
  }
  if (va < 1e-12 || vb < 1e-12) return 0
  const score = new Float64Array(n)
  for (let s = 0; s < n; s++) {
    let c = 0
    for (let k = 0; k < n; k++) c += (a[(((k - s) % n) + n) % n] - ma) * (b[k] - mb)
    score[s] = c
  }
  let best = 0
  for (let s = 1; s < n; s++) if (score[s] > score[best]) best = s
  const l = score[(best - 1 + n) % n]
  const r = score[(best + 1) % n]
  const d = l - 2 * score[best] + r
  let frac = d < 0 ? (0.5 * (l - r)) / d : 0
  if (!(Math.abs(frac) <= 0.5)) frac = 0
  let s = best + frac
  if (s > n / 2) s -= n
  return s
}

/** The mean brightness by angle in `bins` equal bins over the cells `sel`; a bin with no cell takes the mean of the others. */
function profile(angle, bright, sel, bins) {
  const sum = new Float64Array(bins)
  const cnt = new Float64Array(bins)
  for (const i of sel) {
    const b = Math.min(bins - 1, Math.floor((angle[i] / (2 * Math.PI)) * bins))
    sum[b] += bright[i]
    cnt[b]++
  }
  let total = 0
  let n = 0
  for (let b = 0; b < bins; b++) {
    if (cnt[b]) {
      total += sum[b] / cnt[b]
      n++
    }
  }
  const fill = n ? total / n : 0
  return Array.from({ length: bins }, (_, b) => (cnt[b] ? sum[b] / cnt[b] : fill))
}

/**
 * Item 5. cells: { radius, angle } from discCells(); series: an array (one per frame) of the cells' brightness
 * (brightnessOf). Splits the cells by radius into an inner and an outer third; for each, builds the brightness by
 * angle in bins of 10 degrees on every frame and finds the circular shift that best matches it to the profile `lag`
 * seconds later (sub-bin, see circularShift): degrees a second, the median over the run (positive: towards higher
 * angles). Gives { inner, outer, thirds }.
 */
export function turnRates(cells, series, fps, lag = 0.5) {
  const lagFrames = Math.round(lag * fps)
  const order = Array.from(cells.radius.keys()).sort((a, b) => cells.radius[a] - cells.radius[b])
  const third = Math.floor(order.length / 3)
  const sets = { inner: order.slice(0, third), outer: order.slice(order.length - third) }
  const out = { thirds: third }
  for (const [name, sel] of Object.entries(sets)) {
    const rates = []
    for (let t = 0; t + lagFrames < series.length; t++) {
      const a = profile(cells.angle, series[t], sel, 36)
      const b = profile(cells.angle, series[t + lagFrames], sel, 36)
      rates.push((circularShift(a, b) * 10) / (lagFrames / fps))
    }
    out[name] = median(rates)
  }
  return out
}

/**
 * The lag L (frames, fractional, in [-maxLag, maxLag]) at which y[t] best matches x[t - L] (x leads y when L > 0): the
 * normalised correlation over the overlap, refined by a parabola through the best score and its neighbours.
 * { lag, score }; lag 0 and score 0 when either series is flat.
 */
export function bestLag(x, y, maxLag) {
  const n = x.length
  const scores = []
  for (let L = -maxLag; L <= maxLag; L++) {
    const from = Math.max(0, L)
    const to = Math.min(n, n + L)
    const m = to - from
    if (m < 8) {
      scores.push(-Infinity)
      continue
    }
    let mx = 0
    let my = 0
    for (let t = from; t < to; t++) {
      mx += x[t - L]
      my += y[t]
    }
    mx /= m
    my /= m
    let c = 0
    let vx = 0
    let vy = 0
    for (let t = from; t < to; t++) {
      c += (x[t - L] - mx) * (y[t] - my)
      vx += (x[t - L] - mx) ** 2
      vy += (y[t] - my) ** 2
    }
    scores.push(vx < 1e-12 || vy < 1e-12 ? 0 : c / Math.sqrt(vx * vy))
  }
  let best = 0
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i
  if (!(scores[best] > 1e-6)) return { lag: 0, score: 0 }
  let frac = 0
  if (best > 0 && best < scores.length - 1 && Number.isFinite(scores[best - 1]) && Number.isFinite(scores[best + 1])) {
    const d = scores[best - 1] - 2 * scores[best] + scores[best + 1]
    if (d < 0) frac = (0.5 * (scores[best - 1] - scores[best + 1])) / d
    if (!(Math.abs(frac) <= 0.5)) frac = 0
  }
  return { lag: best - maxLag + frac, score: scores[best] }
}

/**
 * Item 6. series: one array of mean luminance a frame for each sector, in order of angle (sectors `sectorDeg` wide).
 * For each adjacent pair, the lag at which the later sector's series best matches the earlier one's (positive: the
 * pattern travels towards higher angles). Gives { lags, agree (the number of pairs with the commoner nonzero sign),
 * sign, speed (the median over the pairs of sectorDeg * fps / |lag|, 0 for a pair at lag 0, in degrees a second) }.
 */
export function sectorTravel(series, fps, sectorDeg = 15, maxLag = 40) {
  const lags = []
  for (let i = 0; i + 1 < series.length; i++) lags.push(bestLag(series[i], series[i + 1], maxLag).lag)
  const pos = lags.filter(l => l > 0.05).length
  const neg = lags.filter(l => l < -0.05).length
  return {
    lags,
    agree: Math.max(pos, neg),
    sign: pos === neg ? 0 : pos > neg ? 1 : -1,
    speed: median(lags.map(l => (Math.abs(l) > 0.05 ? (sectorDeg * fps) / Math.abs(l) : 0))),
  }
}

/**
 * Item 7. For each of four quarter-turns of angle, the cells split by radius into five equal-count bins; the brightness
 * series of each bin (the mean over its cells); for each adjacent pair the lag at which the inner bin matches the
 * outer one (positive: the outer leads). Gives { pairs (the lags), lead (the share of pairs with the outer leading,
 * lag above 0.05), medianLag (frames) }.
 */
export function inwardLead(cells, series, quarters = 4, bins = 5, maxLag = 30) {
  const lags = []
  for (let q = 0; q < quarters; q++) {
    const inQ = []
    for (let i = 0; i < cells.angle.length; i++) {
      if (Math.min(quarters - 1, Math.floor((cells.angle[i] / (2 * Math.PI)) * quarters)) === q) inQ.push(i)
    }
    inQ.sort((a, b) => cells.radius[a] - cells.radius[b])
    const per = Math.floor(inQ.length / bins)
    const groups = Array.from({ length: bins }, (_, b) => inQ.slice(b * per, b === bins - 1 ? inQ.length : (b + 1) * per))
    const s = groups.map(sel => series.map(f => sel.reduce((acc, i) => acc + f[i], 0) / Math.max(1, sel.length)))
    for (let b = 0; b + 1 < bins; b++) lags.push(bestLag(s[b + 1], s[b], maxLag).lag)
  }
  return { pairs: lags, lead: lags.filter(l => l > 0.05).length / lags.length, medianLag: median(lags) }
}

/**
 * Contract v5 item 12. `heights` is each cell's height along the jet (any unit), `series` an array (one per frame) of the cells'
 * brightness. The cells are split by height into `bins` equal-count bins (lowest first); the brightness series of each bin (the
 * mean over its cells); for each adjacent pair the lag at which the upper bin matches the lower one (positive: the lower leads, the
 * matter streams outward). Gives { pairs (the lags in frames), lead (the share of pairs with the lower leading, lag above 0.05),
 * medianLag }.
 */
export function streamLead(heights, series, bins = 6, maxLag = 30) {
  const order = Array.from(heights.keys()).sort((a, b) => heights[a] - heights[b])
  const per = Math.floor(order.length / bins)
  const groups = Array.from({ length: bins }, (_, b) => order.slice(b * per, b === bins - 1 ? order.length : (b + 1) * per))
  const s = groups.map(sel => series.map(f => sel.reduce((acc, i) => acc + f[i], 0) / Math.max(1, sel.length)))
  const lags = []
  for (let b = 0; b + 1 < bins; b++) lags.push(bestLag(s[b], s[b + 1], maxLag).lag)
  return { pairs: lags, lead: lags.filter(l => l > 0.05).length / lags.length, medianLag: median(lags) }
}
