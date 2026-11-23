// Smoke tests for the stand-in and the renderer. Run: node --test tools/tests/
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { loadShader, Renderer } from '../render.mjs'
import * as S from '../shader-standin.mjs'

const dir = mkdtempSync(path.join(tmpdir(), 'shader-test-'))
after(() => rmSync(dir, { recursive: true, force: true }))
let n = 0
function shaderFile(source) {
  const file = path.join(dir, `s${++n}.ts`)
  writeFileSync(file, source)
  return file
}
async function render(source, { frames = 1, ...opts } = {}) {
  const shader = await loadShader(shaderFile(source))
  const r = new Renderer(shader, { res: [2, 2], ...opts })
  let pic
  for (let f = 0; f < frames; f++) pic = r.runFrame(f, f === frames - 1).pic
  return { pic, r }
}

describe('table', () => {
  it('reads number rows, vector rows and int rows, and .at clamps', () => {
    const t = S.table([1.5, 2.5, 3.5])
    assert.equal(t.length, 3)
    assert.equal(t.at(1), 2.5)
    assert.equal(t.at(-4), 1.5)
    assert.equal(t.at(99), 3.5)
    assert.equal(t.at(1.9), 2.5)
    const v = S.table([[1, 2], [3, 4]])
    assert.equal(v.at(1).x, 3)
    assert.equal(v.at(1).g, 4)
    assert.equal(v.at(50).y, 4)
    const ints = S.table([[1.9, -2.9], [7, 8]], 'int')
    assert.deepEqual(ints.at(0), [1, -2])
    assert.deepEqual(S.table([5.7, 6.2], 'int').at(0), 5)
  })
  it('refuses what the app refuses', () => {
    assert.throws(() => S.table([]), /1 to 256/)
    assert.throws(() => S.table([[1, 2], [3]]), /row 1/)
    assert.throws(() => S.table(Array(257).fill(0)), /256/)
  })
})

describe('values', () => {
  it('holds each value to its range and defaults to the low end', () => {
    const v = S.values({ a: [0, 1], b: [-2, 2], c: [3, 9] })
    S.state.values = { a: 5, b: -10 }
    assert.equal(v.a, 1)
    assert.equal(v.b, -2)
    assert.equal(v.c, 3)
    S.state.values = { a: -1 }
    assert.equal(v.a, 0)
    S.state.values = { a: 0.5 }
    assert.ok(Math.abs(v.a - 0.5) < 1 / 1023) // kept to 10 bits
    S.state.values = {}
  })
  it('refuses a name the file did not declare', async () => {
    const shader = await loadShader(
      shaderFile(`import { picture, shader, values, vec4 } from 'claude-code/shader'
const v = values({ k: [0, 1] })
export default shader({ passes: [picture(p => vec4(v.k, 0, 0, 1))] })`),
    )
    assert.throws(() => new Renderer(shader, { res: [1, 1], values: { nope: 1 } }), /declares no value "nope"/)
  })
})

describe('maths, as the type file says', () => {
  it('mod keeps the sign of b', () => {
    assert.equal(S.mod(-1, 3), 2)
    assert.equal(S.mod(1, -3), -2)
    assert.equal(S.mod(5.5, 2), 1.5)
    assert.equal(S.mod(-6, 3) + 0, 0)
  })
  it('atan(y, x) is the angle of (x, y)', () => {
    assert.equal(S.atan(1, 0), Math.PI / 2)
    assert.equal(S.atan(0, -1), Math.PI)
    assert.equal(S.atan(-1, 0), -Math.PI / 2)
    assert.ok(Math.abs(S.atan(1, 1) - Math.PI / 4) < 1e-12)
  })
  it('quot cuts toward zero, step is 0 below the edge, smoothstep takes either order', () => {
    assert.equal(S.quot(-7, 2), -3)
    assert.equal(S.quot(7, 2), 3)
    assert.equal(S.step(0.5, 0.49), 0)
    assert.equal(S.step(0.5, 0.5), 1)
    assert.equal(S.smoothstep(0, 1, 0.5), 0.5)
    assert.equal(S.smoothstep(1, 0, 0.25), S.smoothstep(0, 1, 0.75))
    assert.equal(S.smoothstep(0, 1, -3), 0)
    assert.equal(S.smoothstep(0, 1, 3), 1)
  })
  it('fract, sign, mix, clamp, int, signed, unsigned', () => {
    assert.equal(S.fract(-0.25), 0.75)
    assert.equal(S.sign(-3), -1)
    assert.equal(S.mix(2, 4, 0.25), 2.5)
    assert.equal(S.clamp(5, 0, 1), 1)
    assert.equal(S.int(-2.9), -2)
    assert.equal(S.signed(S.int(2 ** 31)), -(2 ** 31))
    assert.equal(S.unsigned(-1), 2 ** 32 - 1)
  })
  it('a function given a vector works lane by lane', () => {
    const v = S.floor(S.vec2(1.5, -1.5))
    assert.deepEqual([v.x, v.y], [1, -2])
    assert.equal(S.length(S.vec2(3, 4)), 5)
    assert.equal(S.dot(S.vec2(1, 2), S.vec2(3, 4)), 11)
  })
})

describe('vectors', () => {
  it('build from parts, and r g b a are the lanes x y z w', () => {
    const c = S.vec4(S.vec2(1, 2), 3, 4)
    assert.deepEqual([c.x, c.y, c.z, c.w], [1, 2, 3, 4])
    assert.deepEqual([c.r, c.g, c.b, c.a], [1, 2, 3, 4])
    const g = S.vec3(0.5)
    assert.deepEqual([g.x, g.y, g.z], [0.5, 0.5, 0.5])
  })
  it('say plainly what the preview does not do', () => {
    const v = S.vec2(1, 2)
    assert.throws(() => v * 2, /arithmetic on a vector/)
    assert.throws(() => v + v, /arithmetic on a vector/)
    assert.throws(() => v.xy, /swizzle \.xy/)
    assert.throws(() => v[0], /v\[0\]/)
    assert.throws(() => S.vec3(1, 2), /needs one number or 3 lanes/)
  })
  it('shapes, pointer and scene throw a clear error', () => {
    assert.throws(() => S.shapes(), /shapes is not in the preview/)
    assert.throws(() => S.pointer(0), /pointer is not in the preview/)
    assert.throws(() => S.scene.sample(S.vec2(0)), /scene is not in the preview/)
    assert.equal(S.pointerCount, 0)
  })
})

describe('buffers and the renderer', () => {
  it('a buffer that reads itself keeps its value across frames', async () => {
    const { pic } = await render(
      `import { buffer, picture, shader, vec4 } from 'claude-code/shader'
import type { Buffer as Buf } from 'claude-code/shader'
const count: Buf = buffer({ size: [1, 1], float: 32 }, p => vec4(count.at(p.cell).x + 1, 0, 0, 1))
export default shader({ passes: [count, picture(p => vec4(count.at(p.cell).x / 100, 0, 0, 1))] })`,
      { frames: 5, res: [1, 1] },
    )
    assert.ok(Math.abs(pic[0] - 0.05) < 1e-6, `red was ${pic[0]}`)
  })
  it('a buffer without float holds 0 to 1 in 8 bits, and repeat runs it more than once a frame', async () => {
    const { pic } = await render(
      `import { buffer, picture, shader, turn, vec4 } from 'claude-code/shader'
import type { Buffer as Buf } from 'claude-code/shader'
const b: Buf = buffer({ size: [1, 1], repeat: 3 }, p => vec4(b.at(p.cell).x + 0.4, 0, 0, 1))
export default shader({ passes: [b, picture(p => vec4(b.at(p.cell).x, turn, 0, 1))] })`,
      { frames: 1, res: [1, 1] },
    )
    // 0.4, 0.8, then 1.2 clamped to 1; the picture's `turn` is 0
    assert.equal(pic[0], 1)
    assert.equal(pic[1], 0)
  })
  it('once runs on the first frame only', async () => {
    const { pic } = await render(
      `import { buffer, picture, shader, vec4 } from 'claude-code/shader'
import type { Buffer as Buf } from 'claude-code/shader'
const b: Buf = buffer({ size: [1, 1], float: 32, once: true }, p => vec4(b.at(p.cell).x + 1, 0, 0, 1))
export default shader({ passes: [b, picture(p => vec4(b.at(p.cell).x / 10, 0, 0, 1))] })`,
      { frames: 4, res: [1, 1] },
    )
    assert.ok(Math.abs(pic[0] - 0.1) < 1e-6)
  })
  it('composer, size and res reach the shader', async () => {
    const { pic } = await render(
      `import { composer, picture, shader, vec4 } from 'claude-code/shader'
export default shader({ passes: [picture(p => vec4(composer.x, composer.y, composer.z, composer.w))] })`,
      { composer: [0.1, 0.2, 0.3, 0.4], res: [1, 1] },
    )
    ;[0.1, 0.2, 0.3, 0.4].forEach((want, i) => assert.ok(Math.abs(pic[i] - want) < 1e-6, `lane ${i}: ${pic[i]}`))
    const { pic: p2 } = await render(
      `import { picture, px, res, shader, size, vec4 } from 'claude-code/shader'
export default shader({ passes: [picture(p => vec4(size.x / 100, size.y / 100, res.x / 10 + px, 1))] })`,
      { res: [4, 2], points: [40, 20] },
    )
    assert.ok(Math.abs(p2[0] - 0.4) < 1e-6 && Math.abs(p2[1] - 0.2) < 1e-6)
    assert.ok(Math.abs(p2[2] - (0.4 + 10)) < 1e-5) // px: one pixel is 10 points wide
  })
  it('values reach the shader, held to their range', async () => {
    const { pic } = await render(
      `import { picture, shader, values, vec4 } from 'claude-code/shader'
const v = values({ k: [0, 1] })
export default shader({ passes: [picture(p => vec4(v.k, 0, 0, 1))] })`,
      { values: { k: 7 }, res: [1, 1] },
    )
    assert.equal(pic[0], 1)
  })
  it('y points up: row 0 of the floats is the bottom', async () => {
    const { pic } = await render(
      `import { picture, shader, vec4 } from 'claude-code/shader'
export default shader({ passes: [picture(p => vec4(0, p.uv.y, 0, 1))] })`,
      { res: [1, 2] },
    )
    assert.ok(pic[1] < pic[5]) // pixel row 0 (bottom) is darker than row 1
  })
})
