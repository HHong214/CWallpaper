// A CPU stand-in for the module 'claude-code/shader', so a shader file can be
// run in Node and looked at. It follows the names and meanings of the type file
// (claude-code.d.ts, `declare module 'claude-code/shader'`).
//
// It is NOT the app's language. It runs what the app would refuse, and it
// refuses (loudly) the few things it cannot do. tools/README.md lists both.
//
// Vectors here are objects with lanes x y z w (and r g b a). Arithmetic between
// vectors throws, as do swizzles of several lanes and v[i]: write scalar code.
// The renderer (tools/render.mjs) drives the inputs below through `state`.

export class PreviewError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PreviewError'
  }
}
const notInPreview = what => new PreviewError(`${what} is not in the preview: draw without it, or check that part in the app`)

// ---------------------------------------------------------------- vectors

const LANE_SETS = ['xyzw', 'rgba']
const WIDTH = ' width'

class VecBase {
  valueOf() {
    throw new PreviewError(
      'arithmetic on a vector is not in the preview: write it per lane, for example vec2(a.x * 2, a.y * 2)',
    )
  }
  toString() {
    return `vec${this[WIDTH]}(${lanesOf(this).join(', ')})`
  }
}
Object.defineProperty(VecBase.prototype, 'toJSON', {
  value() {
    return lanesOf(this)
  },
})

class Vec2 extends VecBase {
  constructor(x, y) {
    super()
    this.x = x
    this.y = y
  }
}
class Vec3 extends VecBase {
  constructor(x, y, z) {
    super()
    this.x = x
    this.y = y
    this.z = z
  }
}
class Vec4 extends VecBase {
  constructor(x, y, z, w) {
    super()
    this.x = x
    this.y = y
    this.z = z
    this.w = w
  }
}
for (const [C, n] of [[Vec2, 2], [Vec3, 3], [Vec4, 4]]) {
  Object.defineProperty(C.prototype, WIDTH, { value: n })
  // r g b a name the same lanes as x y z w
  for (let i = 0; i < n; i++) {
    const from = 'rgba'[i]
    const to = 'xyzw'[i]
    Object.defineProperty(C.prototype, from, {
      get() {
        return this[to]
      },
      set(v) {
        this[to] = v
      },
    })
  }
}
// What the app allows and the preview does not: say so, instead of giving undefined.
{
  const swizzleError = name =>
    new PreviewError(
      `the swizzle .${name} is not in the preview: read one lane at a time and build the vector, for example vec2(v.x, v.y)`,
    )
  const indexError = i => new PreviewError(`v[${i}] is not in the preview: read the lane by name (v.x, v.y, v.z, v.w)`)
  const strings = (set, k) => {
    if (k === 0) return ['']
    const rest = strings(set, k - 1)
    return [...set].flatMap(c => rest.map(r => c + r))
  }
  for (const set of LANE_SETS) {
    for (const len of [2, 3, 4]) {
      for (const name of strings(set, len)) {
        Object.defineProperty(VecBase.prototype, name, {
          get() {
            throw swizzleError(name)
          },
          set() {
            throw swizzleError(name)
          },
        })
      }
    }
  }
  for (let i = 0; i < 4; i++) {
    Object.defineProperty(VecBase.prototype, String(i), {
      get() {
        throw indexError(i)
      },
      set() {
        throw indexError(i)
      },
    })
  }
}

const isVec = v => typeof v === 'object' && v !== null && v instanceof VecBase
function lanesOf(v) {
  const n = v[WIDTH]
  return n === 2 ? [v.x, v.y] : n === 3 ? [v.x, v.y, v.z] : [v.x, v.y, v.z, v.w]
}
const laneAt = (v, i) => (isVec(v) ? (i === 0 ? v.x : i === 1 ? v.y : i === 2 ? v.z : v.w) : +v)
function make(n, a) {
  return n === 2 ? new Vec2(a[0], a[1]) : n === 3 ? new Vec3(a[0], a[1], a[2]) : new Vec4(a[0], a[1], a[2], a[3])
}
function build(n, parts) {
  const flat = []
  for (const p of parts) {
    if (isVec(p)) flat.push(...lanesOf(p))
    else if (typeof p === 'number' || typeof p === 'boolean') flat.push(+p)
    else throw new PreviewError(`vec${n} takes numbers and vectors, got ${typeof p}`)
  }
  if (flat.length === 1) return make(n, Array(n).fill(flat[0]))
  if (flat.length !== n) throw new PreviewError(`vec${n} needs one number or ${n} lanes in all, got ${flat.length}`)
  return make(n, flat)
}
export const vec2 = (...p) => build(2, p)
export const vec3 = (...p) => build(3, p)
export const vec4 = (...p) => build(4, p)
export const setVec = (v, ...l) => {
  l.forEach((n, i) => {
    v['xyzw'[i]] = n
  })
  return v
}

// ----------------------------------------------------------------- inputs
// The renderer writes `state`, then calls sync(); the shader reads the exports.

export const state = {
  time: 0, dt: 1 / 30, frame: 0, first: true, fresh: true, turn: 0, still: 0, px: 1,
  values: {},
}
export let time = 0
export let dt = 1 / 30
export let frame = 0
export let first = true
export let fresh = true
export let turn = 0
export let still = 0
export let px = 1
export function sync() {
  time = state.time
  dt = state.dt
  frame = state.frame
  first = state.first
  fresh = state.fresh
  turn = state.turn
  still = state.still
  px = state.px
}
export const PI = Math.PI
export const size = vec2(0, 0) // the window, in points
export const res = vec2(0, 0) // the target, in pixels
export const composer = vec4(0, 0, 1, 1)
export const pixel = vec2(0, 0) // the renderer moves it to each pixel's centre
export const coord = vec2(0, 0)
export const vertex = 0
export const instance = 0
export const pointerCount = 0
export const pointers = []

// ------------------------------------------------------------------ maths

function lanewise(f, args) {
  let n = 0
  for (const a of args) {
    if (isVec(a)) {
      if (n && a[WIDTH] !== n) throw new PreviewError('a function was given vectors of different widths')
      n = a[WIDTH]
    }
  }
  if (!n) return f(...args.map(Number))
  const out = []
  for (let i = 0; i < n; i++) out.push(f(...args.map(a => laneAt(a, i))))
  return make(n, out)
}
const one = f => x => (typeof x === 'number' ? f(x) : lanewise(f, [x]))
const two = f => (a, b) => (typeof a === 'number' && typeof b === 'number' ? f(a, b) : lanewise(f, [a, b]))
const three = f => (a, b, c) =>
  typeof a === 'number' && typeof b === 'number' && typeof c === 'number' ? f(a, b, c) : lanewise(f, [a, b, c])

export const abs = one(Math.abs)
export const sign = one(Math.sign)
export const floor = one(Math.floor)
export const trunc = one(Math.trunc)
export const fract = one(x => x - Math.floor(x))
export const sqrt = one(Math.sqrt)
export const sin = one(Math.sin)
export const cos = one(Math.cos)
export const exp = one(Math.exp)
export const log = one(Math.log)
export const tanh = one(Math.tanh)
export const min = two(Math.min)
export const max = two(Math.max)
// the remainder with the sign of b (not the JS %); a guard for b = 0
export const mod = two((a, b) => (b === 0 ? 0 : a - b * Math.floor(a / b)))
// a / b cut toward zero; a guard for b = 0
export const quot = two((a, b) => (b === 0 ? 0 : Math.trunc(a / b)))
export const pow = two(Math.pow)
export const step = two((edge, x) => (x < edge ? 0 : 1))
export const atan = two((y, x) => Math.atan2(y, x))
export const mix = three((a, b, t) => a + (b - a) * t)
export const clamp = three((x, lo, hi) => Math.min(Math.max(x, lo), hi))
// the edges go in either order; equal edges act as a step
export const smoothstep = three((a, b, x) => {
  if (a === b) return x < a ? 0 : 1
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
})
export function length(v) {
  if (!isVec(v)) return Math.abs(v)
  return Math.hypot(...lanesOf(v))
}
export function dot(a, b) {
  if (!isVec(a) && !isVec(b)) return a * b
  const n = isVec(a) ? a[WIDTH] : b[WIDTH]
  let s = 0
  for (let i = 0; i < n; i++) s += laneAt(a, i) * laneAt(b, i)
  return s
}
export function normalize(v) {
  if (!isVec(v)) return Math.sign(v)
  const l = length(v)
  return make(v[WIDTH], lanesOf(v).map(c => (l > 0 ? c / l : 0)))
}
export const dx = () => {
  throw notInPreview('dx')
}
export const dy = () => {
  throw notInPreview('dy')
}
export const fwidth = () => {
  throw notInPreview('fwidth')
}

// ints are plain numbers here: int() cuts toward zero and wraps once. `+ - *`
// between ints do not wrap by themselves: write int(a * b), and keep a * b under 2^53.
export const int = x => x | 0
export const signed = i => i | 0
export const unsigned = i => i >>> 0
export const range = (a, b) =>
  b === undefined ? [...Array(a).keys()] : [...Array(Math.max(0, b - a)).keys()].map(i => i + a)
export const box = v => ({ v })

// ----------------------------------------------------------------- values

// the names a file declared, for the renderer to check `--values` against
export const declared = {}
export function reset() {
  for (const k of Object.keys(declared)) delete declared[k]
}
export function values(ranges) {
  const names = Object.keys(ranges)
  if (names.length > 8) throw new PreviewError(`values() holds 8 names at most, this file has ${names.length}`)
  const o = {}
  for (const name of names) {
    const r = ranges[name]
    if (!Array.isArray(r) || r.length !== 2 || !r.every(Number.isFinite) || !(r[0] <= r[1])) {
      throw new PreviewError(`values: ${name} needs a range [low, high] of finite numbers, low first`)
    }
    const [lo, hi] = r
    declared[name] = [lo, hi]
    Object.defineProperty(o, name, {
      enumerable: true,
      get() {
        const v = state.values[name]
        if (v === undefined || hi === lo) return lo // one left out is its low end
        const c = Math.min(Math.max(+v, lo), hi)
        // the app keeps each value to 10 bits of its range
        return lo + (Math.round(((c - lo) / (hi - lo)) * 1023) / 1023) * (hi - lo)
      },
    })
  }
  return Object.freeze(o)
}

// ------------------------------------------------------------------ table

export function table(rows, kind) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 256) throw new PreviewError('table() holds 1 to 256 rows')
  if (kind !== undefined && kind !== 'int') throw new PreviewError("table's second argument is 'int' or nothing")
  const asInt = kind === 'int'
  const width = Array.isArray(rows[0]) ? rows[0].length : 1
  if (width < 1 || width > 4) throw new PreviewError('a table row holds 1 to 4 numbers')
  const data = rows.map((r, i) => {
    const w = Array.isArray(r) ? r.length : 1
    if (w !== width) throw new PreviewError(`table row ${i} has ${w} numbers, row 0 has ${width}`)
    return (Array.isArray(r) ? r : [r]).map(v => {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new PreviewError(`table row ${i} holds a value that is not a finite number`)
      }
      return asInt ? v | 0 : v
    })
  })
  const n = data.length
  return {
    length: n,
    // `.at` clamps the index into the table
    at(index) {
      const i = Math.min(Math.max(Math.floor(+index) || 0, 0), n - 1)
      const r = data[i]
      if (width === 1) return r[0]
      return asInt ? r.slice() : make(width, r)
    },
  }
}

// ------------------------------------------------------- pictures, buffers

export const picture = color => ({ kind: 'picture', color, ' pass': true })

export function buffer(options = {}, color) {
  const o = options
  if (o.scale !== undefined && !(o.scale > 0 && o.scale <= 2)) {
    throw new PreviewError('buffer scale is texels a point, above 0 and up to 2')
  }
  if (o.float !== undefined && o.float !== 16 && o.float !== 32) throw new PreviewError('buffer float is 16 or 32')
  if (o.filter !== undefined && !['linear', 'nearest', 'mipmap'].includes(o.filter)) {
    throw new PreviewError("buffer filter is 'linear', 'nearest' or 'mipmap'")
  }
  if (o.wrap !== undefined && !['clamp', 'repeat'].includes(o.wrap)) throw new PreviewError("buffer wrap is 'clamp' or 'repeat'")
  if (o.repeat !== undefined && !(Number.isInteger(o.repeat) && o.repeat >= 1 && o.repeat <= 24)) {
    throw new PreviewError('buffer repeat is a whole number from 1 to 24')
  }
  const b = {
    kind: 'buffer',
    ' pass': true,
    options: o,
    color,
    float: o.float ?? 8, // 8 means no `float`: lanes hold 0 to 1 in 8 bits
    filter: o.filter ?? 'linear',
    wrap: o.wrap ?? 'clamp',
    repeat: o.repeat ?? 1,
    once: !!o.once,
    w: 0,
    h: 0,
    data: null, // what the last run wrote: what a read gives
    next: null, // what this run is writing
    size: vec2(0, 0), // in texels
    bad: 0, // values that were not finite when written
    // the size in texels for a target of resX x resY pixels over pointsX x pointsY points
    fits(resX, resY, pointsX, pointsY) {
      let w, h
      if (o.size !== undefined) [w, h] = isVec(o.size) ? [o.size.x, o.size.y] : [o.size[0], o.size[1]]
      else if (o.scale !== undefined) [w, h] = [pointsX * o.scale, pointsY * o.scale]
      else [w, h] = [resX, resY]
      return [Math.min(2048, Math.max(1, Math.round(w))), Math.min(2048, Math.max(1, Math.round(h)))]
    },
    // allocate it empty; true when the size is new (a "fresh" frame)
    allocate(w, h) {
      if (b.w === w && b.h === h && b.data) return false
      b.w = w
      b.h = h
      b.data = new Float32Array(w * h * 4)
      b.next = new Float32Array(w * h * 4)
      b.size.x = w
      b.size.y = h
      return true
    },
    // what one lane keeps: 8 bits, 0 to 1, unless `float`
    quantise(v) {
      if (!Number.isFinite(v)) {
        b.bad++
        return 0
      }
      if (b.float === 8) return Math.round(Math.min(Math.max(v, 0), 1) * 255) / 255
      return b.float === 16 ? Math.f16round(v) : Math.fround(v)
    },
    texel(ix, iy) {
      const i = (iy * b.w + ix) * 4
      return make(4, [b.data[i], b.data[i + 1], b.data[i + 2], b.data[i + 3]])
    },
    at(cell) {
      if (!isVec(cell)) throw new PreviewError('buffer.at takes a vec2 cell, such as p.cell')
      const ix = Math.min(Math.max(Math.floor(cell.x), 0), b.w - 1)
      const iy = Math.min(Math.max(Math.floor(cell.y), 0), b.h - 1)
      return b.texel(ix, iy)
    },
    sample(uv, _lod) {
      if (!isVec(uv)) throw new PreviewError('buffer.sample takes a vec2 uv, such as p.uv')
      const wrap = (i, n) => (b.wrap === 'repeat' ? ((i % n) + n) % n : Math.min(Math.max(i, 0), n - 1))
      if (b.filter === 'nearest') {
        return b.texel(wrap(Math.floor(uv.x * b.w), b.w), wrap(Math.floor(uv.y * b.h), b.h))
      }
      // 'mipmap' reads as 'linear' in the preview: the lod is ignored
      const fx = uv.x * b.w - 0.5
      const fy = uv.y * b.h - 0.5
      const x0 = Math.floor(fx)
      const y0 = Math.floor(fy)
      const tx = fx - x0
      const ty = fy - y0
      const xa = wrap(x0, b.w)
      const xb = wrap(x0 + 1, b.w)
      const ya = wrap(y0, b.h)
      const yb = wrap(y0 + 1, b.h)
      const d = b.data
      const W = b.w
      const out = [0, 0, 0, 0]
      for (let k = 0; k < 4; k++) {
        const top = d[(ya * W + xa) * 4 + k] * (1 - tx) + d[(ya * W + xb) * 4 + k] * tx
        const bot = d[(yb * W + xa) * 4 + k] * (1 - tx) + d[(yb * W + xb) * 4 + k] * tx
        out[k] = top * (1 - ty) + bot * ty
      }
      return make(4, out)
    },
  }
  return b
}

export const shapes = () => {
  throw notInPreview('shapes')
}
export const pointer = () => {
  throw notInPreview('pointer')
}
export const scene = new Proxy(
  {},
  {
    get() {
      throw notInPreview('scene')
    },
  },
)

export function shader(options) {
  if (!options || !Array.isArray(options.passes)) throw new PreviewError('shader() needs { passes: [...] }')
  if (options.fps !== undefined && options.fps !== 30 && options.fps !== 60) throw new PreviewError('shader fps is 30 or 60')
  if (options.passes.length > 24) throw new PreviewError('a shader has 24 passes at most')
  const pictures = options.passes.filter(p => p && p.kind === 'picture').length
  if (pictures !== 1) throw new PreviewError(`a shader has exactly one picture, this one has ${pictures}`)
  return { kind: 'shader', fps: options.fps ?? 30, passes: options.passes }
}
