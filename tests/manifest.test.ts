// Tests that the manifest, .claude-plugin/plugin.json, declares in `userConfig` exactly the options
// `optionSpecs(WALLPAPERS)` lists (hooks/core/options.ts and hooks/core/registry.ts): the same keys, types, titles,
// defaults, choices and ranges; the old `spinner` key is gone. Written before the code, to core-contract.md.
//
// THE TEST RUNNER CANNOT READ THE FILE. A test's hooks module may import only code (a .json file is refused, and
// there is no fs, process or fetch in it), and the engine's `$` has no way to list a plugin's declared options. So
// the manifest is read the one way the harness lets a test read it: through the engine's own check of the options
// a test hands the plugin (`test(name, { options }, body)`), which is the check a real load makes against
// `userConfig`. What that shows, and what this file pins with it:
//
//   * a boolean or number key the manifest declares, given a value of the wrong type, fails the load with
//     "<title> must be a <boolean|number>" (title = the declared `title`); a key it does not declare is taken
//     without a word. So one test per boolean and number option pins that the key is declared, its title and its
//     type.
//   * a CHOICE (a string with `options`) never fails the load, whatever it is given: a value outside `options`
//     just reads as the default, with a note only the engine's report shows. So the title of a choice option
//     (Wallpaper, Motion, Kiki: time of day) cannot be read from a test, and is pinned only in core-options and
//     core-registry.test.ts. What is pinned for a choice is that the key is declared and takes each value: the
//     status line the mod answers with shows the value it was handed.
//   * every number's two ends, and every choice's every other value, are handed to the plugin and must reach it:
//     the status line shows them. (A manifest range narrower than the contract's, a missing choice or an
//     undeclared key fails these.)
//   * with no options at all the plugin gets the manifest's defaults: the status line and the look it sets show
//     them (the cat spinner's and Show FPS's defaults are shown in core-backdrop.test.tsx, which mounts the
//     Spinner and the pane).
//   * the old `spinner` key, and the keys of the removed loaders, are not declared.
//
// NOT PINNABLE FROM A TEST, and so left to `claude plugin validate .` and to review: the order of the keys in
// the file, their `description`s, the titles of the three choices, and a manifest range or choice list WIDER than
// the contract's (the plugin clamps and the engine counts a stray choice as unset, so nothing shows).
//
// Names used: optionSpecs(wallpapers) (core-options.test.ts), WALLPAPERS (core-registry.test.ts). Until both
// modules exist this file fails to load as a whole.
import { expect, mock, test } from 'claude-code/testing'

import { optionSpecs } from '../hooks/core/options'
import { WALLPAPERS } from '../hooks/core/registry'

type Spec = { key: string; title: string; type: 'boolean' | 'choice' | 'number'; default: unknown; choices?: readonly string[]; min?: number; max?: number }
const specs = optionSpecs(WALLPAPERS as never) as unknown as Spec[]

const WORD = { boolean: 'boolean', number: 'number', choice: 'string' } as const
const WRONG = { boolean: 'yes', number: 'ten', choice: 7 } as const

type Look = { backdrop?: { scene?: string; glass?: { blur?: number; opacity?: number; tint?: string } }; colors?: { label?: string } }
const wallpaper = (args: string) => ({ command: 'wallpaper', args }) as never

/** Loads the plugin with these options and says what it said: '' when it loaded. */
async function loadWith($: any, on: any): Promise<string> {
  mock.clock(on)
  mock.store(on)
  on('command.register', () => ({ value: { command: 'wallpaper' } }))
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'backdrop' } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  try {
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    return ''
  } catch (err) {
    return String(err)
  }
}

test('the list the manifest is compared with holds the ten options in the contract\'s order', () => {
  expect(specs.map(s => s.key)).toEqual(['wallpaper', 'on', 'motion', 'clear', 'blur', 'dim', 'colors', 'fps', 'kikiTime', 'kikiSpinner'])
  expect(specs.map(s => s.title)).toEqual([
    'Wallpaper',
    'Wallpaper: on',
    'Motion',
    'Panels: how clear',
    'Panels: blur',
    'Scene: dim',
    'App colors follow the wallpaper',
    'Show FPS',
    'Kiki: time of day',
    'Kiki: cat spinner',
  ])
  expect(specs.map(s => s.type)).toEqual(['choice', 'boolean', 'choice', 'number', 'number', 'number', 'boolean', 'boolean', 'choice', 'boolean'])
  expect(specs.map(s => s.default)).toEqual(['kiki', true, 'smooth', 100, 0, 30, true, false, 'auto', true])
  expect(specs[0]?.choices).toEqual(['kiki', 'blackhole'])
  expect(specs[2]?.choices).toEqual(['smooth', 'light', 'off'])
  expect(specs[8]?.choices).toEqual(['auto', 'day', 'sunset', 'night'])
  expect([specs[3]?.min, specs[3]?.max, specs[4]?.min, specs[4]?.max, specs[5]?.min, specs[5]?.max]).toEqual([0, 100, 0, 40, 0, 80])
})

// One test per boolean and number option: declared, with this title and this type.
for (const spec of specs.filter(x => x.type !== 'choice')) {
  test(`the manifest declares ${spec.key} as a ${WORD[spec.type]} titled "${spec.title}"`, { options: { [spec.key]: WRONG[spec.type] } as never }, async ($, on) => {
    const said = await loadWith($, on)
    expect(said).toContain(`${spec.title} must be a ${WORD[spec.type]}`)
  })
}

// What the status line says when the plugin is handed this value of this option, for the options it shows.
const SHOWN: Record<string, (value: unknown) => RegExp | undefined> = {
  wallpaper: v => new RegExp(`The wallpaper is ${String((WALLPAPERS as unknown as { id: string; label: string }[]).find(w => w.id === v)?.label)}[.]`),
  motion: v => new RegExp(`motion ${String(v)}([^a-z]|$)`),
  clear: v => new RegExp(`Panels ${String(v)}% clear`),
  blur: v => new RegExp(`blur ${String(v)}([^0-9]|$)`),
  dim: v => new RegExp(`scene dimmed ${String(v)}%`),
  kikiTime: v => new RegExp(`Kiki time: ${String(v)}([^a-z]|$)`),
}

// One test per end of each number and per value of each choice: the manifest takes it, and it reaches the plugin.
for (const spec of specs) {
  const values: unknown[] = spec.type === 'number' ? [spec.min, spec.max] : spec.type === 'choice' ? [...(spec.choices ?? [])] : []
  for (const value of values) {
    test(`the manifest takes ${spec.key} = ${String(value)}, and the plugin is handed it`, { options: { [spec.key]: value } as never }, async ($, on) => {
      expect(await loadWith($, on)).toBe('')
      const shown = SHOWN[spec.key]?.(value)
      if (shown !== undefined) expect(String((await $.command.run(wallpaper(''))).text)).toMatch(shown)
    })
  }
}

test('the old spinner key and the keys of the removed loaders are not declared', { options: { spinner: ['x'], theme: ['x'], isOn: ['x'], picture: ['x'], video: ['x'], film: ['x'], steps: ['x'] } as never }, async ($, on) => {
  expect(await loadWith($, on)).toBe('')
})

test('with no options the plugin gets the manifest\'s defaults: Kiki, on, smooth, 100% clear, no blur, dimmed 30%, app colors on', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const looks: Look[] = []
  on('command.register', () => ({ value: { command: 'wallpaper' } }))
  on('theme.set', (_, e) => { looks.push(e as Look); return { value: { isDrawn: true, requestId: 'backdrop' } } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // On, Kiki, clear and unblurred (never an exact zero), the app's colors set.
  expect(looks.length).toBe(1)
  expect(looks[0]?.backdrop?.scene).toBe('kiki')
  expect(looks[0]?.backdrop?.glass?.opacity).toBe(0.01)
  expect(looks[0]?.backdrop?.glass?.blur).toBe(0.1)
  expect(looks[0]?.colors?.label).toBe('Kiki night')
  const said = String((await $.command.run(wallpaper(''))).text)
  expect(said).toMatch(/The wallpaper is Kiki\./)
  expect(said).toMatch(/Panels 100% clear, blur 0, scene dimmed 30%, app colors on, motion smooth\./)
  expect(said).toMatch(/Kiki time: auto/)
})
