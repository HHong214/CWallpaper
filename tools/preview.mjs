// Runs a wallpaper's shader file on the CPU and writes pictures or a video of it.
// See tools/README.md.
//
//   node tools/preview.mjs <shader file> [--at s] [--size WxH] [--points WxH]
//        [--values name=n,...] [--composer l,b,r,t] [--fps 30] [--out file.png]
//        [--sheet N --over s] [--video s [--rate 15]] [--frames s --raw folder]
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePng } from './png.mjs'
import { GROUND, loadShader, Renderer, S } from './render.mjs'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out')

const USAGE = `usage: node tools/preview.mjs <shader file> [options]
  --at <seconds>            the frame to draw (default 0); every earlier frame is stepped first
  --size <W>x<H>           the target in pixels (default 960x540)
  --points <W>x<H>         the window in points (default: the same as --size)
  --values name=n,...      the shader's values()
  --composer l,b,r,t       the prompt box, each 0 to 1 (default 0.2,0.05,0.8,0.15)
  --fps <30|60>            frames a second (default: the shader's own)
  --out <file>             the output file (default under tools/out/)
  --sheet <N> --over <s>   N evenly spaced frames in one picture (the last at --at + --over)
  --video <s> [--rate 15]  an mp4 of s seconds, drawn --rate times a second (needs ffmpeg)
  --frames <s> --raw <dir> the luminance of every frame as float32 files, for a flash check`

function parseArgs(argv) {
  const opts = {}
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const value = argv[++i]
      if (value === undefined) fail(`--${key} needs a value`)
      opts[key] = value
    } else rest.push(a)
  }
  return { opts, rest }
}
function fail(message) {
  console.error(`error: ${message}`)
  process.exit(1)
}
const num = (name, v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) fail(`--${name} needs a number, got "${v}"`)
  return n
}
function dims(name, v) {
  const m = /^(\d+)x(\d+)$/.exec(v)
  if (!m || +m[1] < 1 || +m[2] < 1) fail(`--${name} is WIDTHxHEIGHT, such as 960x540, got "${v}"`)
  return [+m[1], +m[2]]
}

const { opts, rest } = parseArgs(process.argv.slice(2))
if (rest.length !== 1) fail(USAGE)
const file = rest[0]
const known = ['at', 'size', 'points', 'values', 'composer', 'fps', 'out', 'sheet', 'over', 'video', 'rate', 'frames', 'raw']
for (const k of Object.keys(opts)) if (!known.includes(k)) fail(`unknown option --${k}\n${USAGE}`)

const res = dims('size', opts.size ?? '960x540')
const points = opts.points ? dims('points', opts.points) : res
const at = num('at', opts.at ?? '0')
const composer = (opts.composer ?? '0.2,0.05,0.8,0.15').split(',').map(Number)
if (composer.length !== 4 || composer.some(n => !Number.isFinite(n))) fail('--composer is left,bottom,right,top, four numbers')
const values = {}
if (opts.values) {
  for (const pair of opts.values.split(',')) {
    const m = /^([A-Za-z_]\w*)=(-?[\d.]+(?:e-?\d+)?)$/.exec(pair)
    if (!m) fail(`--values is name=number,name=number, got "${pair}"`)
    values[m[1]] = Number(m[2])
  }
}
const modes = ['sheet', 'video', 'frames'].filter(k => opts[k] !== undefined)
if (modes.length > 1) fail(`use one of --${modes.join(', --')}`)
const base = path.basename(file).replace(/\.[^.]+$/, '')
const tag = s => String(+s.toFixed(3))
mkdirSync(OUT, { recursive: true })

let shader
let r
try {
  shader = await loadShader(file)
  const fps = opts.fps ? num('fps', opts.fps) : shader.fps
  if (!(fps > 0)) fail('--fps must be above 0')
  r = new Renderer(shader, { res, points, composer, values, fps })
} catch (e) {
  report(e)
}
function report(e) {
  if (e instanceof S.PreviewError) fail(e.message)
  console.error(e)
  process.exit(1)
}

// the frames to draw, as { frame, ... } in order; every other frame up to the last is only stepped
function plan() {
  const fps = r.fps
  const at0 = Math.round(at * fps)
  if (modes[0] === 'sheet') {
    const n = Math.round(num('sheet', opts.sheet))
    const over = num('over', opts.over ?? fail('--sheet needs --over <seconds>'))
    if (n < 1) fail('--sheet is a number of frames, 1 or more')
    return Array.from({ length: n }, (_, i) => ({ frame: at0 + Math.round(((i + 1) * over * fps) / n) }))
  }
  if (modes[0] === 'video') {
    const secs = num('video', opts.video)
    const rate = num('rate', opts.rate ?? '15')
    const n = Math.max(1, Math.round(secs * rate))
    return Array.from({ length: n }, (_, k) => ({ frame: at0 + Math.round((k * fps) / rate), k }))
  }
  if (modes[0] === 'frames') {
    if (!opts.raw) fail('--frames needs --raw <folder>')
    const n = Math.round(num('frames', opts.frames) * fps) + 1
    return Array.from({ length: n }, (_, i) => ({ frame: at0 + i }))
  }
  return [{ frame: at0 }]
}
const targets = plan()
const last = Math.max(...targets.map(t => t.frame))
const wanted = new Map(targets.map(t => [t.frame, t]))

// where output goes
const sink = {}
if (modes[0] === 'video') {
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) fail('--video needs ffmpeg on the PATH')
  const rate = num('rate', opts.rate ?? '15')
  const out = path.resolve(opts.out ?? path.join(OUT, `${base}.mp4`))
  mkdirSync(path.dirname(out), { recursive: true })
  const ff = spawn(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${res[0]}x${res[1]}`, '-r', String(rate), '-i', '-',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', out,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  )
  const closed = once(ff, 'close')
  ff.stdin.on('error', () => {}) // ffmpeg's own exit code reports the failure
  sink.out = out
  sink.write = async buf => {
    if (!ff.stdin.write(buf)) await once(ff.stdin, 'drain')
  }
  sink.finish = async () => {
    ff.stdin.end()
    const [code] = await closed
    if (code !== 0) fail(`ffmpeg stopped with status ${code}`)
  }
} else if (modes[0] === 'frames') {
  sink.dir = path.resolve(opts.raw)
  mkdirSync(sink.dir, { recursive: true })
}

const shots = [] // sheet and single frame: kept RGBA
let stepMs = 0
let stepped = 0
const begin = performance.now()
try {
  for (let f = 0; f <= last; f++) {
    const want = wanted.has(f)
    const { pic, ms, pictureMs } = r.runFrame(f, want)
    if (!want) {
      stepMs += ms
      stepped++
      continue
    }
    console.log(`frame ${f} (t=${tag(f / r.fps)}s): ${ms.toFixed(0)} ms (picture ${pictureMs.toFixed(0)} ms)`)
    if (modes[0] === 'video') await sink.write(r.toRgba(pic))
    else if (modes[0] === 'frames') {
      const lum = r.luminance(pic)
      writeFileSync(path.join(sink.dir, `frame-${String(f - Math.round(at * r.fps)).padStart(6, '0')}.f32`), Buffer.from(lum.buffer))
    } else shots.push(r.toRgba(pic))
  }
} catch (e) {
  report(e)
}
if (stepped) console.log(`${stepped} frames stepped without drawing: ${stepMs.toFixed(0)} ms in all`)

if (modes[0] === 'video') {
  await sink.finish()
  console.log(`wrote ${sink.out}`)
} else if (modes[0] === 'frames') {
  const meta = {
    width: res[0], height: res[1], fps: r.fps, frames: targets.length, startSeconds: at,
    format: 'one file a frame, float32 little-endian, width x height values, top row first',
    value: 'relative luminance (WCAG, linear light, 0 to 1) of the picture over the ground colour',
    ground: GROUND,
  }
  writeFileSync(path.join(sink.dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n')
  console.log(`wrote ${targets.length} frames and meta.json to ${sink.dir}`)
} else {
  let rgba = shots[0]
  let w = res[0]
  let h = res[1]
  let out = opts.out ?? path.join(OUT, `${base}-${tag(at)}s.png`)
  if (modes[0] === 'sheet') {
    const n = shots.length
    const cols = Math.ceil(Math.sqrt(n))
    const rows = Math.ceil(n / cols)
    const gap = 4
    w = cols * res[0] + (cols + 1) * gap
    h = rows * res[1] + (rows + 1) * gap
    rgba = Buffer.alloc(w * h * 4)
    for (let i = 0; i < w * h; i++) rgba.writeUInt32LE(0xff3c2c28, i * 4) // a quiet grey-blue gap: RGBA 28 2c 3c ff
    shots.forEach((shot, i) => {
      const ox = gap + (i % cols) * (res[0] + gap)
      const oy = gap + Math.floor(i / cols) * (res[1] + gap)
      for (let y = 0; y < res[1]; y++) shot.copy(rgba, ((oy + y) * w + ox) * 4, y * res[0] * 4, (y + 1) * res[0] * 4)
    })
    out = opts.out ?? path.join(OUT, `${base}-sheet.png`)
  }
  out = path.resolve(out)
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, encodePng(rgba, w, h))
  console.log(`wrote ${out} (${w}x${h})`)
}
const bad = r.badValues()
if (bad > 0) {
  console.warn(
    `warning: ${bad} values were not finite (NaN or infinity) and were drawn as 0. The app never has any: guard the division, log or sqrt.`,
  )
}
