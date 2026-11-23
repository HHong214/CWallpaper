import {
  atan, buffer, clamp, composer, dt, first, floor, int, length, max, mix, mod,
  picture, shader, signed, sin, size, table, time, values, vec2, vec4,
} from 'claude-code/shader'
import type { Buffer as Buf } from 'claude-code/shader'

const v = values({ fps: [0, 1] })

// 5x7 font, 7 rows (top first) of 5 bits per glyph.
// glyphs 0-9: ramp dim -> bright: ' ' . : - = + * # % @ ; 10-19: digits 0-9
const FONT = table([
  0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 12, 12,
  0, 12, 12, 0, 12, 12, 0,
  0, 0, 0, 31, 0, 0, 0,
  0, 0, 31, 0, 31, 0, 0,
  0, 4, 4, 31, 4, 4, 0,
  0, 21, 14, 31, 14, 21, 0,
  10, 10, 31, 10, 31, 10, 10,
  25, 26, 2, 4, 8, 11, 19,
  14, 17, 23, 21, 23, 16, 14,
  14, 17, 19, 21, 25, 17, 14,
  4, 12, 4, 4, 4, 4, 14,
  14, 17, 1, 2, 4, 8, 31,
  31, 2, 4, 2, 1, 17, 14,
  2, 6, 10, 18, 31, 2, 2,
  31, 16, 30, 1, 1, 17, 14,
  6, 8, 16, 30, 17, 17, 14,
  31, 1, 2, 4, 8, 8, 8,
  14, 17, 17, 14, 17, 17, 14,
  14, 17, 17, 15, 1, 2, 12,
], 'int')

// The measured frames a second, smoothed, in one texel that reads itself.
const meter: Buf = buffer({ size: [1, 1], float: 32 }, p => {
  const inst = 1 / max(dt, 0.001)
  const prev = meter.at(p.cell).x
  return vec4(first ? inst : mix(prev, inst, 0.05), 0, 0, 1)
})

// three-stop ramp, one channel
const stop = (t: number, a: number, b: number, c: number) =>
  t < 0.5 ? mix(a, b, t * 2) : mix(b, c, t * 2 - 1)

const CW = 7
const CH = 12

const art = picture(p => {
  const gx = floor(p.point.x / CW)
  const gy = floor(p.point.y / CH)
  const lx = p.point.x - gx * CW
  const ly = p.point.y - gy * CH

  // field: rings and an angle, centred over the chat column
  const cx = (composer.x + composer.z) * 0.5 * size.x
  const cy = 0.5 * size.y
  const dx = (gx + 0.5) * CW - cx
  const dy = (gy + 0.5) * CH - cy
  const r = length(vec2(dx, dy))
  const a = atan(dy, dx)
  const field = 0.5 + 0.5 * sin(r * 0.035 - time * 1.6 + 2.5 * sin(a * 3 + time * 0.4))
  const fade = 1 - smooth(r)
  const b = clamp(field * fade, 0, 0.999)

  let glyph = floor(b * 10)
  let on = 1
  let hot = b

  // fps counter, three digits in the bottom-left cells
  if (v.fps > 0.5 && gy < 1 && gx < 3) {
    const n = floor(meter.at(vec2(0, 0)).x + 0.5)
    const tens = gx < 1 ? 100 : gx < 2 ? 10 : 1
    const blank = gx < 2 && n < tens
    glyph = blank ? 0 : 10 + mod(floor(n / tens), 10)
    hot = 1
  }

  const col = floor(lx - 1)
  const row = 6 - floor((ly - 1.5) / 1.5)
  const inside = col >= 0 && col < 5 && row >= 0 && row < 7
  const bits = FONT.at(glyph * 7 + clamp(row, 0, 6))
  const bit = signed((bits >> int(4 - clamp(col, 0, 4))) & 1)
  const al = inside ? (bit * (0.35 + 0.65 * hot)) : 0

  const t = hot
  const rr = stop(t, 0.05, 0.1, 1.0)
  const gg = stop(t, 0.1, 0.8, 0.95)
  const bb = stop(t, 0.35, 0.7, 0.8)
  return vec4(rr * al, gg * al, bb * al, al)
})

function smooth(r: number) {
  return clamp(r / 700, 0, 1)
}

export default shader({ fps: 30, passes: [meter, art] })
