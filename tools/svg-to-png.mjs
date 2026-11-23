// Renders an SVG to a PNG with headless Chrome, to look at a wallpaper's Svg scene.
//   node tools/svg-to-png.mjs <file.svg> <out.png> [--size WxH] [--after seconds] [--background css-colour]
// One Chrome at a time: its profile folder tools/out/chrome-profile exists while it runs
// and is deleted afterwards. If it is still there, another run is going (or one was killed).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out')
const PROFILE = path.join(OUT, 'chrome-profile')

const USAGE = 'usage: node tools/svg-to-png.mjs <file.svg> <out.png> [--size WxH] [--after seconds] [--background colour]'
const fail = message => {
  console.error(`error: ${message}`)
  process.exit(1)
}

const args = process.argv.slice(2)
const opts = {}
const rest = []
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].slice(2)
    if (!['size', 'after', 'background'].includes(key)) fail(`unknown option --${key}\n${USAGE}`)
    if (args[i + 1] === undefined) fail(`--${key} needs a value`)
    opts[key] = args[++i]
  } else rest.push(args[i])
}
if (rest.length !== 2) fail(USAGE)
const svg = path.resolve(rest[0])
const png = path.resolve(rest[1])
if (!existsSync(svg)) fail(`no such file: ${svg}`)
if (!existsSync(CHROME)) fail(`Chrome is not at ${CHROME}`)
const m = /^(\d+)x(\d+)$/.exec(opts.size ?? '960x540')
if (!m) fail('--size is WIDTHxHEIGHT, such as 960x540')
const [w, h] = [+m[1], +m[2]]
// headless Chrome gives a smaller window a different viewport than its picture (checked: 480x270 and 500x300 shift the scene)
if (w < 640 || h < 360) fail('--size must be at least 640x360: headless Chrome misplaces the scene in a smaller window')
const after = Number(opts.after ?? 0)
if (!Number.isFinite(after) || after < 0) fail('--after is a number of seconds')
const background = opts.background ?? '#0a0d1a'
if (!/^[#\w(),.% -]+$/.test(background)) fail('--background is a plain CSS colour')

mkdirSync(OUT, { recursive: true })
try {
  mkdirSync(PROFILE) // not recursive: this is the lock
} catch (e) {
  if (e.code === 'EEXIST') fail(`${PROFILE} exists: another svg-to-png is running, or one was killed. Delete the folder if none is.`)
  throw e
}
let status = 1
try {
  // The SVG inline, scaled to the window, over a plain background. Inline, so the
  // page's own timeline runs it: after the page loads, a script sets every
  // animation (SMIL and CSS) to `after` seconds and holds it there.
  const page = path.join(PROFILE, 'page.html')
  const source = readFileSync(svg, 'utf8').replace(/^﻿/, '').replace(/<\?xml[^>]*\?>/, '').replace(/<!DOCTYPE[^>]*>/i, '')
  writeFileSync(
    page,
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${background}}` +
      `body>svg{display:block;width:100vw;height:100vh}</style>${source}` +
      `<script>addEventListener('load',()=>{const s=document.querySelector('body>svg');` +
      `if(s&&s.pauseAnimations){s.pauseAnimations();s.setCurrentTime(${after})}` +
      `for(const a of document.getAnimations()){a.pause();a.currentTime=${after * 1000}}})</script>`,
  )
  mkdirSync(path.dirname(png), { recursive: true })
  const run = spawnSync(
    CHROME,
    [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--disable-sync', '--disable-component-update',
      '--disable-background-networking',
      '--disable-features=OptimizationHints,OptimizationGuideModelDownloading,Translate,MediaRouter',
      `--user-data-dir=${PROFILE}`, `--window-size=${w},${h}`,
      "--virtual-time-budget=500",
      `--screenshot=${png}`, pathToFileURL(page).href,
    ],
    { encoding: 'utf8', timeout: 60000 },
  )
  status = run.status ?? 1
  if (run.error) console.error(`chrome: ${run.error.message}`)
  if (!existsSync(png)) console.error(`chrome stopped with status ${run.status} and wrote no picture\n${(run.stderr || '').slice(-600)}`)
  else console.log(`wrote ${png} (${w}x${h}${after ? `, after ${after}s` : ''})`)
} finally {
  rmSync(PROFILE, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
}
process.exit(existsSync(png) ? 0 : status || 1)
