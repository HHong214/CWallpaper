// Tests for the manifest and the marketplace file, read from Node (the plugin test runner cannot read a JSON file:
// see tests/manifest.test.ts, which can only probe the manifest through the engine). Run: node --test tools/tests/
//
// What they pin (core-contract.md, "Options"):
//   1. .claude-plugin/plugin.json `userConfig` is exactly what `optionSpecs(WALLPAPERS)` lists
//      (hooks/core/options.ts, hooks/core/registry.ts): the same keys in the same order; for each, the type (a choice
//      is "type": "string" with `options` equal to its choices in order; a number is "type": "number" with `min` and
//      `max`; a boolean is "type": "boolean"), the `title`, a non-empty `description` equal to the spec's, the
//      `default`. No other key, so `spinner` is gone.
//   2. plugin.json: `name` is "CWallpaper" (capitals are fine: `claude plugin validate .` warns that it is not
//      kebab-case and accepts it, so no test here forbids them); `author.name` is "HHong214"; there is NO `version`
//      field; the description names Kiki and the black hole, says nothing of a picture or a video of your own, and
//      never names "/wallpaper" (the command is "/cwallpaper"); no option description does either, and the `fps`
//      description says where the readout is drawn.
//   3. .claude-plugin/marketplace.json: `name` is "cwallpaper" (unchanged), its `metadata.description` is
//      "CWallpaper: moving wallpapers for the Claude desktop app.", its one plugin entry is "CWallpaper" with
//      "source": "./" and no `version`. (Installed, the id is "CWallpaper@cwallpaper".)
//   4. The five modules under hooks/core/ (options, registry, commands, pane, scene) import under Node as they are.
//
// WHY THERE IS NO `version` IN plugin.json (decided, do not add one back by habit): with no version pinned, every
// commit pushed to GitHub counts as an update for the people who installed the mod. With a version, nobody gets
// anything until it is raised. This test fails if a `version` appears in plugin.json or in the marketplace entry.
//
// WHAT THE BUILDER MUST KEEP TO, so the modules import under Node 24 (which runs a `.ts` file with erasable types
// as it is, with no flag):
//   - erasable TypeScript only: types, `import type`, interfaces and `as` are fine; no enum, namespace, parameter
//     property, `import x = require(...)` or decorator;
//   - every relative import is written WITH its extension: `import { kiki } from '../wallpapers/kiki/index.ts'`
//     (an extensionless './x' fails under Node with ERR_MODULE_NOT_FOUND). This holds for everything the core
//     modules import in turn, since registry.ts pulls in the wallpapers (hooks/wallpapers/kiki and blackhole);
//   - no import of 'claude-code/...' and no JSX in those files (register.tsx is not imported here);
//   - a JavaScript file they import (make-colors.js) is imported with its extension too, as it is today.
// A failing import is reported with those rules in its message.
//
// Why they fail now: hooks/core/options.ts does not exist (each module is imported inside its test, so the tool's own
// tests keep passing), and plugin.json still has a `version`, the old description and the `spinner` key.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, it } from 'node:test'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = file => JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'))
const CORE = ['options', 'registry', 'commands', 'pane', 'scene']

const cache = new Map()
/** Imports hooks/core/<name>.ts, or throws an error that says what the module has to keep to. */
async function core(name) {
  const file = path.join(ROOT, 'hooks', 'core', `${name}.ts`)
  if (!cache.has(file)) {
    cache.set(
      file,
      import(pathToFileURL(file).href).catch(e => {
        const missing = !existsSync(file)
        throw new Error(
          missing
            ? `${file} does not exist yet.`
            : `${file} could not be imported under Node: ${e && e.message}. It and everything it imports must be erasable ` +
                `TypeScript only (no enum, namespace, parameter property), every relative import written with its .ts or ` +
                `.js extension (an extensionless one cannot resolve under Node), nothing from 'claude-code/...', no JSX.`,
        )
      }),
    )
  }
  return cache.get(file)
}

/** The specs of the real wallpapers, from the modules. */
async function specs() {
  const { optionSpecs } = await core('options')
  const { WALLPAPERS } = await core('registry')
  assert.equal(typeof optionSpecs, 'function', 'hooks/core/options.ts must export optionSpecs')
  assert.ok(Array.isArray(WALLPAPERS), 'hooks/core/registry.ts must export the array WALLPAPERS')
  return optionSpecs(WALLPAPERS)
}

describe('plugin.json userConfig is what optionSpecs(WALLPAPERS) lists', () => {
  it('declares the same keys in the same order, and no other (the old spinner is gone)', async () => {
    const list = await specs()
    const config = read('.claude-plugin/plugin.json').userConfig
    assert.ok(config && typeof config === 'object', 'plugin.json has a userConfig')
    assert.deepEqual(Object.keys(config), list.map(s => s.key))
    assert.ok(!('spinner' in config), 'the old `spinner` key is gone')
  })

  it('gives each option its type, its title, its description and its default', async () => {
    const list = await specs()
    const config = read('.claude-plugin/plugin.json').userConfig
    for (const spec of list) {
      const entry = config[spec.key]
      assert.ok(entry, `${spec.key} is declared`)
      const want = spec.type === 'choice' ? 'string' : spec.type
      assert.equal(entry.type, want, `${spec.key}: type`)
      assert.equal(entry.title, spec.title, `${spec.key}: title`)
      assert.equal(typeof entry.description, 'string', `${spec.key}: description is a string`)
      assert.ok(entry.description.trim() !== '', `${spec.key}: description is not empty`)
      assert.equal(entry.description, spec.description, `${spec.key}: description equals the spec's`)
      assert.equal(entry.default, spec.default, `${spec.key}: default`)
    }
  })

  it('gives a choice its `options` in the order of its choices, and a number its min and max', async () => {
    const list = await specs()
    const config = read('.claude-plugin/plugin.json').userConfig
    for (const spec of list) {
      const entry = config[spec.key]
      assert.ok(entry, `${spec.key} is declared`)
      if (spec.type === 'choice') {
        assert.deepEqual(entry.options, [...spec.choices], `${spec.key}: options`)
        assert.ok(!('min' in entry) && !('max' in entry), `${spec.key}: a choice has no range`)
      } else if (spec.type === 'number') {
        assert.equal(entry.min, spec.min, `${spec.key}: min`)
        assert.equal(entry.max, spec.max, `${spec.key}: max`)
        assert.ok(!('options' in entry), `${spec.key}: a number has no options`)
      } else {
        assert.ok(!('options' in entry) && !('min' in entry) && !('max' in entry), `${spec.key}: a boolean has neither`)
      }
    }
  })

  it('has the twelve options of the contract: the ten common and Kiki\'s, then the black hole\'s size and calm', async () => {
    const list = await specs()
    assert.deepEqual(list.map(s => s.key), ['wallpaper', 'on', 'motion', 'clear', 'blur', 'dim', 'colors', 'fps', 'kikiTime', 'kikiSpinner', 'blackholeSize', 'blackholeCalm'])
    assert.deepEqual(list.slice(10).map(s => s.title), ['Black hole: size', 'Black hole: calmer motion'])
    assert.deepEqual(list[10].choices, ['small', 'medium', 'large'])
    assert.equal(list[10].default, 'medium')
    assert.equal(list[11].default, false)
  })
})

describe('plugin.json', () => {
  it('is named CWallpaper', () => {
    assert.equal(read('.claude-plugin/plugin.json').name, 'CWallpaper')
  })

  it('is by HHong214, not by local', () => {
    const { author } = read('.claude-plugin/plugin.json')
    assert.equal(author && author.name, 'HHong214')
  })

  it('names the command /cwallpaper wherever it names it, never /wallpaper', () => {
    const manifest = read('.claude-plugin/plugin.json')
    assert.ok(!manifest.description.includes('/wallpaper'), 'the description says /cwallpaper')
    for (const [key, entry] of Object.entries(manifest.userConfig)) {
      assert.ok(!String(entry.description).includes('/wallpaper'), `${key}: the description says /cwallpaper`)
    }
  })

  it('describes the fps option as the readout at the top left of the chat', () => {
    const { fps } = read('.claude-plugin/plugin.json').userConfig
    assert.equal(fps.title, 'Show FPS')
    assert.equal(fps.default, false)
    assert.equal(fps.description, 'Draw the measured frames a second at the top left of the chat, on a wallpaper the app plays on the GPU.')
  })

  it('has no version field: every commit pushed to GitHub is an update', () => {
    assert.ok(!('version' in read('.claude-plugin/plugin.json')), 'plugin.json must not pin a `version`')
  })

  it('describes Kiki and the black hole, and says nothing of a picture or a video of your own', () => {
    const { description } = read('.claude-plugin/plugin.json')
    assert.equal(typeof description, 'string')
    assert.match(description, /kiki/i)
    assert.match(description, /black hole/i)
    assert.doesNotMatch(description, /picture|video|ffmpeg/i)
  })
})

describe('marketplace.json', () => {
  it('is described as CWallpaper: moving wallpapers for the Claude desktop app.', () => {
    assert.equal(read('.claude-plugin/marketplace.json').metadata.description, 'CWallpaper: moving wallpapers for the Claude desktop app.')
  })

  it('is named cwallpaper, with one plugin entry, CWallpaper, sourced from ./, and no version', () => {
    const market = read('.claude-plugin/marketplace.json')
    assert.equal(market.name, 'cwallpaper')
    assert.ok(!('version' in market), 'the marketplace pins no `version`')
    assert.equal(market.plugins.length, 1)
    const [entry] = market.plugins
    assert.equal(entry.name, 'CWallpaper')
    assert.equal(entry.source, './')
    assert.ok(!('version' in entry), 'the plugin entry pins no `version`')
  })
})

describe('the modules under hooks/core/ import under Node as they are', () => {
  for (const name of CORE) {
    it(`${name}.ts`, async () => {
      const mod = await core(name)
      assert.ok(mod && typeof mod === 'object')
      assert.ok(Object.keys(mod).length > 0, `${name}.ts exports something`)
    })
  }
})
