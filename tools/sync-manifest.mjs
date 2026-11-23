// Writes `userConfig` in .claude-plugin/plugin.json from `optionSpecs(WALLPAPERS)`
// (hooks/core/options.ts, hooks/core/registry.ts), so the manifest holds exactly
// the options the mod reads. Every other field of the file is kept, in its
// place, and so are its line endings. Run it after adding a wallpaper or an
// option:  node tools/sync-manifest.mjs   (add --check to only say whether it is in step)
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const FILE = path.join(ROOT, '.claude-plugin', 'plugin.json')

const { optionSpecs } = await import(pathToFileURL(path.join(ROOT, 'hooks', 'core', 'options.ts')).href)
const { WALLPAPERS } = await import(pathToFileURL(path.join(ROOT, 'hooks', 'core', 'registry.ts')).href)

/** One option as the manifest declares it: a choice is a string with `options`, a number has `min` and `max`. */
function entry(spec) {
  const out = { type: spec.type === 'choice' ? 'string' : spec.type, title: spec.title, description: spec.description, default: spec.default }
  if (spec.type === 'choice') out.options = [...spec.choices]
  if (spec.type === 'number') {
    out.min = spec.min
    out.max = spec.max
  }
  return out
}

const text = readFileSync(FILE, 'utf8')
const eol = text.includes('\r\n') ? '\r\n' : '\n'
const manifest = JSON.parse(text)
const userConfig = Object.fromEntries(optionSpecs(WALLPAPERS).map(spec => [spec.key, entry(spec)]))
// The key keeps its place when it is there; else it goes last.
const next = 'userConfig' in manifest ? Object.fromEntries(Object.entries(manifest).map(([k, v]) => [k, k === 'userConfig' ? userConfig : v])) : { ...manifest, userConfig }
const written = JSON.stringify(next, null, 2).split('\n').join(eol) + (/\r?\n$/.test(text) ? eol : '')

if (process.argv.includes('--check')) {
  if (written !== text) {
    console.error(`${path.relative(ROOT, FILE)} is not in step with optionSpecs(WALLPAPERS): run node tools/sync-manifest.mjs`)
    process.exit(1)
  }
  console.log(`${path.relative(ROOT, FILE)} is in step: ${Object.keys(userConfig).length} options.`)
} else if (written === text) {
  console.log(`${path.relative(ROOT, FILE)} already holds the ${Object.keys(userConfig).length} options.`)
} else {
  writeFileSync(FILE, written)
  console.log(`${path.relative(ROOT, FILE)}: userConfig written, ${Object.keys(userConfig).length} options: ${Object.keys(userConfig).join(', ')}.`)
}
