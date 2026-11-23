// Runs a shader file on the CPU: loads it with the stand-in for 'claude-code/shader'
// and steps its passes frame by frame. The command line is tools/preview.mjs.
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import * as S from './shader-standin.mjs'

register('./loader.mjs', import.meta.url)

export { S }
export const GROUND = [10, 13, 26] // the dark ground a picture is drawn over (0 to 255)

let loads = 0
// Imports the shader file as it is. Returns { passes, fps, declared (the `values` names and ranges) }.
export async function loadShader(file) {
  S.reset()
  const url = pathToFileURL(path.resolve(file)).href + `?load=${++loads}` // fresh each time
  const mod = await import(url)
  const shader = mod.default
  if (!shader || shader.kind !== 'shader') throw new S.PreviewError('the file must `export default shader({ passes: [...] })`')
  return { passes: shader.passes, fps: shader.fps, declared: { ...S.declared } }
}

export class Renderer {
  // res: target pixels [w, h]; points: the window in points [w, h]
  constructor(shader, { res, points = res, composer = [0.2, 0.05, 0.8, 0.15], values = {}, fps = shader.fps }) {
    this.shader = shader
    this.w = res[0]
    this.h = res[1]
    this.pw = points[0]
    this.ph = points[1]
    this.fps = fps
    this.badPicture = 0 // picture values that were not finite
    for (const name of Object.keys(values)) {
      if (!(name in shader.declared)) {
        const names = Object.keys(shader.declared)
        throw new S.PreviewError(`the file declares no value "${name}" (it declares: ${names.length ? names.join(', ') : 'none'})`)
      }
    }
    S.state.values = values
    S.setVec(S.size, this.pw, this.ph)
    S.setVec(S.res, this.w, this.h)
    S.setVec(S.composer, ...composer)
    this.lastFrame = -1
  }

  // Runs frame f (call with f = 0, 1, 2 ... in turn). With wantPicture, draws the
  // picture and returns its premultiplied floats, row 0 at the bottom (y up).
  runFrame(f, wantPicture) {
    const st = S.state
    st.time = f / this.fps
    st.dt = 1 / this.fps
    st.frame = f
    st.turn = 0
    st.still = 0
    st.first = f === 0
    st.fresh = f === 0
    st.px = this.pw / this.w
    S.sync()
    const t0 = performance.now()
    let pictureMs = 0
    let pic = null
    for (const pass of this.shader.passes) {
      if (pass.kind === 'buffer') {
        if (!pass.color) continue // no body: an empty target for shapes
        const [bw, bh] = pass.fits(this.w, this.h, this.pw, this.ph)
        pass.allocate(bw, bh)
        if (pass.once && f > 0) continue
        for (let t = 0; t < pass.repeat; t++) {
          st.turn = t
          S.sync()
          this.drawBuffer(pass)
        }
        st.turn = 0
        S.sync()
      } else if (wantPicture) {
        st.px = this.pw / this.w
        S.sync()
        const t1 = performance.now()
        pic = this.drawPicture(pass)
        pictureMs = performance.now() - t1
      }
    }
    this.lastFrame = f
    return { pic, ms: performance.now() - t0, pictureMs }
  }

  pixelObject(w, h) {
    return {
      uv: S.vec2(0, 0),
      point: S.vec2(0, 0),
      cell: S.vec2(0, 0),
      pixel: S.pixel,
      px: this.pw / w,
    }
  }

  drawBuffer(b) {
    const { w, h } = b
    const p = this.pixelObject(w, h)
    S.state.px = this.pw / w
    S.sync()
    const out = b.next
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w
        const v = (y + 0.5) / h
        p.uv.x = u
        p.uv.y = v
        p.point.x = u * this.pw
        p.point.y = v * this.ph
        p.cell.x = x
        p.cell.y = y
        p.pixel.x = x + 0.5
        p.pixel.y = y + 0.5
        const c = b.color(p)
        const i = (y * w + x) * 4
        out[i] = b.quantise(c.x)
        out[i + 1] = b.quantise(c.y)
        out[i + 2] = b.quantise(c.z)
        out[i + 3] = b.quantise(c.w)
      }
    }
    b.next = b.data // what the next run reads is what this run wrote
    b.data = out
  }

  drawPicture(pic) {
    const { w, h } = this
    const p = this.pixelObject(w, h)
    const out = new Float32Array(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w
        const v = (y + 0.5) / h
        p.uv.x = u
        p.uv.y = v
        p.point.x = u * this.pw
        p.point.y = v * this.ph
        p.cell.x = x
        p.cell.y = y
        p.pixel.x = x + 0.5
        p.pixel.y = y + 0.5
        const c = pic.color(p)
        if (c === undefined || c === null || c.w === undefined || c.z === undefined) {
          throw new S.PreviewError('a picture must return a vec4')
        }
        const i = (y * w + x) * 4
        let r = c.x, g = c.y, bl = c.z, a = c.w
        if (!(Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(bl) && Number.isFinite(a))) {
          this.badPicture++
          r = g = bl = a = 0
        }
        out[i] = r
        out[i + 1] = g
        out[i + 2] = bl
        out[i + 3] = a
      }
    }
    return out
  }

  // Non-finite values written so far: the app never has any, a guard belongs in the shader.
  badValues() {
    let n = this.badPicture
    for (const p of this.shader.passes) if (p.kind === 'buffer') n += p.bad
    return n
  }

  // Premultiplied picture over the ground -> an 8-bit RGBA Buffer, top row first.
  toRgba(pic) {
    const { w, h } = this
    const raw = Buffer.alloc(w * h * 4)
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w // y points up, an image's first row is the top
      for (let x = 0; x < w; x++) {
        const s = (src + x) * 4
        const d = (y * w + x) * 4
        const a = pic[s + 3]
        for (let k = 0; k < 3; k++) {
          raw[d + k] = Math.round(Math.min(255, Math.max(0, pic[s + k] * 255 + GROUND[k] * (1 - a))))
        }
        raw[d + 3] = 255
      }
    }
    return raw
  }

  // Relative luminance (WCAG: linear light, 0 to 1) of the picture over the ground,
  // as a Float32Array, top row first.
  luminance(pic) {
    const { w, h } = this
    const out = new Float32Array(w * h)
    const lin = v => {
      const c = Math.min(1, Math.max(0, v))
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w
      for (let x = 0; x < w; x++) {
        const s = (src + x) * 4
        const a = pic[s + 3]
        const r = pic[s] + (GROUND[0] / 255) * (1 - a)
        const g = pic[s + 1] + (GROUND[1] / 255) * (1 - a)
        const b = pic[s + 2] + (GROUND[2] / 255) * (1 - a)
        out[y * w + x] = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
      }
    }
    return out
  }
}
