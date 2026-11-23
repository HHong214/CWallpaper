// Tests of the time of day Kiki shows through the Backdrop, rewritten for the rebuild. In 1.9.0 the test set each
// time with `/cwallpaper time ...` and jumped the clock with `/cwallpaper off` and `on`; now each time is an option of
// a test of its own (`kikiTime`), and the clock starts where the test says.
//
// These tests compare the Backdrop with `sceneFor` of hooks/core/scene.ts, which the contract says is what the
// Backdrop shows, given the settings `readSettings` of hooks/core/options.ts reads from the same options; so they
// need the core, and until hooks/core/options.ts, registry.ts and scene.ts exist this file fails to load as a
// whole. (The Backdrop's draw of Kiki, one Svg, dimmed, moving or still, is backdrop.test.tsx's.)
import { expect, mock, test } from 'claude-code/testing'

import { readSettings } from '../hooks/core/options'
import { WALLPAPERS } from '../hooks/core/registry'
import { sceneFor } from '../hooks/core/scene'

const propsOf = (name: string, plugin = 'CWallpaper') => ({ id: name, scene: name, plugin, glass: false }) as never
const BACKDROP = { plugin: 'CWallpaper', component: 'Backdrop', props: propsOf('kiki') } as const
const local = (h: number, m = 0): number => new Date(2026, 5, 15, h, m, 0).getTime()

// Every Svg element drawn, with its props.
const svgs = async (ui: { drawn: () => Promise<unknown> }): Promise<Record<string, unknown>[]> => {
  const out: Record<string, unknown>[] = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    const el = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown }
    if (el.type === 'Svg' && typeof el.props?.source === 'string') out.push(el.props)
    walk(el.children)
    walk(el.props?.children)
  }
  walk(await ui.drawn())
  return out
}
const whole = async (ui: { drawn: () => Promise<unknown> }): Promise<string> => (await svgs(ui)).map(p => String(p.source)).join('')

// A source without the invisible mark a wake draw adds, so the app builds a new image.
const WAKE_MARK = /<g id="kw[0-9a-z]+"\/>/g
const bare = (source: string): string => source.replace(WAKE_MARK, '')

/** What the Backdrop is to show, by the core: the scene's picture for these options at this time. */
const expected = (options: Record<string, unknown>, now: number): string =>
  String((sceneFor(readSettings(options as never, WALLPAPERS as never), WALLPAPERS as never, now) as { source?: string }).source)

for (const phase of ['day', 'sunset', 'night'] as const) {
  test(`the option kikiTime ${phase} shows that time of day, stable across redraws, a turn and time passing (needs the core)`, { options: { kikiTime: phase } }, async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    on('command.register', () => ({ value: { command: 'cwallpaper' } }))
    on('theme.set', () => ({ value: { isDrawn: true, requestId: 'backdrop' } }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('turn.start', (_, e) => ({ turnId: e.turnId }))
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

    // One drawing of the kiki backdrop, as images, without the marks of wake draws.
    const draw = async (): Promise<string> => {
      const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
      const drawn = await svgs(ui)
      await ui.unmount()
      expect(drawn.length > 0).toBe(true)
      expect(drawn.some(d => d.isInteractive === true)).toBe(false)
      return bare(drawn.map(d => String(d.source)).join(''))
    }
    const shown = await draw()
    expect(shown.includes('viewBox="0 0 320 180"')).toBe(true)
    expect(shown).toBe(expected({ kikiTime: phase }, clock.now()))
    // Stable across redraws, a turn and time passing.
    expect(await draw()).toBe(shown)
    await $.turn.start({ text: 'hello', turnId: 't1' })
    expect(await draw()).toBe(shown)
    await clock.advance(3100)
    expect(await draw()).toBe(shown)
  })
}

for (const [label, now, phase] of [['noon', local(12), 'day'], ['twenty past six in the evening', local(18, 20), 'sunset'], ['eleven at night', local(23), 'night']] as const) {
  test(`in auto Kiki follows the clock, with no place known: at ${label} it is the ${phase} (needs the core)`, async ($, on) => {
    // The machine's clock and the default sun times (06:30 and 18:30).
    mock.clock(on, { now })
    mock.store(on)
    on('command.register', () => ({ value: { command: 'cwallpaper' } }))
    on('theme.set', () => ({ value: { isDrawn: true, requestId: 'backdrop' } }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
    const drawn = bare(await whole(ui))
    await ui.unmount()
    expect(drawn).toBe(expected({ kikiTime: phase }, now))
    expect(drawn).toBe(expected({}, now))
  })
}

