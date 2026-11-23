// The command line, end to end: a two-line shader, one pixel read back from the PNG.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, describe, it } from 'node:test'
import { inflateSync } from 'node:zlib'

const preview = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'preview.mjs')
const dir = mkdtempSync(path.join(tmpdir(), 'preview-test-'))
after(() => rmSync(dir, { recursive: true, force: true }))

// reads back a PNG this tool wrote (8-bit RGBA, filter 0)
function readPng(file) {
  const buf = readFileSync(file)
  assert.equal(buf.subarray(1, 4).toString(), 'PNG')
  let off = 8
  let w = 0, h = 0
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.subarray(off + 4, off + 8).toString()
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4) }
    if (type === 'IDAT') idat.push(data)
    off += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const px = (x, y) => [...raw.subarray(y * (w * 4 + 1) + 1 + x * 4, y * (w * 4 + 1) + 1 + x * 4 + 4)]
  return { w, h, px }
}

function run(source, args) {
  const file = path.join(dir, `p${Math.random().toString(36).slice(2)}.ts`)
  writeFileSync(file, source)
  const out = path.join(dir, 'out.png')
  const text = execFileSync(process.execPath, [preview, file, '--size', '4x4', '--out', out, ...args], { encoding: 'utf8' })
  return { text, png: readPng(out) }
}

describe('preview.mjs', () => {
  it('draws a two-line shader: the expected pixels, y up, over the dark ground', () => {
    const { text, png } = run(
      `import { picture, shader, vec4 } from 'claude-code/shader'
export default shader({ passes: [picture(p => vec4(p.uv.x, p.uv.y, 0, 1))] })`,
      [],
    )
    assert.equal(png.w, 4)
    assert.equal(png.h, 4)
    // the top-left pixel: uv = (0.125, 0.875); the image's top row is the top of the picture
    assert.deepEqual(png.px(0, 0), [Math.round(0.125 * 255), Math.round(0.875 * 255), 0, 255])
    assert.deepEqual(png.px(3, 3), [Math.round(0.875 * 255), Math.round(0.125 * 255), 0, 255])
    assert.match(text, /frame 0 \(t=0s\): \d+ ms/) // it prints the time a frame took
  })
  it('draws a premultiplied colour over the ground (10, 13, 26)', () => {
    const { png } = run(
      `import { picture, shader, vec4 } from 'claude-code/shader'
export default shader({ passes: [picture(p => vec4(0.5, 0, 0, 0.5))] })`,
      [],
    )
    assert.deepEqual(png.px(1, 1), [Math.round(127.5 + 5), Math.round(6.5), 13, 255])
  })
  it('--at steps every earlier frame first, so a buffer holds what it would', () => {
    const { text, png } = run(
      `import { buffer, picture, shader, vec4 } from 'claude-code/shader'
import type { Buffer as Buf } from 'claude-code/shader'
const n: Buf = buffer({ size: [1, 1], float: 32 }, p => vec4(n.at(p.cell).x + 1, 0, 0, 1))
export default shader({ fps: 30, passes: [n, picture(p => vec4(n.at(vec2(0, 0)).x / 255, 0, 0, 1))] })
import { vec2 } from 'claude-code/shader'`,
      ['--at', '0.1'], // frame 3: the counter has run 4 times
    )
    assert.equal(png.px(0, 0)[0], 4)
    assert.match(text, /3 frames stepped without drawing/)
  })
  it('stops with a plain message, not a stack, when the shader does vector arithmetic', () => {
    const file = path.join(dir, 'bad.ts')
    writeFileSync(
      file,
      `import { picture, shader, vec2, vec4 } from 'claude-code/shader'
export default shader({ passes: [picture(p => vec4(p.uv * 2, 0, 1))] })`,
    )
    const r = spawnSync(process.execPath, [preview, file, '--size', '2x2', '--out', path.join(dir, 'bad.png')], { encoding: 'utf8' })
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /error: arithmetic on a vector is not in the preview/)
    assert.doesNotMatch(r.stderr, /\n\s+at /)
  })
})
