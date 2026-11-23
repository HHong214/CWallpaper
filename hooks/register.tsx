// CWallpaper: a moving backdrop and matching colors for the whole app. The
// wallpapers are under ./wallpapers (Kiki, the black hole), listed in
// ./core/registry; the settings are the plugin's options (the manifest's
// `userConfig`), read by ./core/options. This file is the wiring alone: it
// reads the options, sets the theme, answers the Backdrop render, runs
// `/cwallpaper` and draws the settings pane.
//
// A look is two things sent in one `$.theme.set`: `colors`, which repaint the
// app, and a `backdrop` behind the conversation. Over a moving scene the app
// lays its panels as `glass`: how see-through they are, how far they blur it.
//
// Settings come only from the options the engine hands `register`. A command or
// a pane control writes one option with `$.config.set`; the engine then loads
// the module again with the new options, and `session.start` runs again, which
// sets the look again at once. Until then this copy keeps what it wrote, so
// the look, the status line and the pane show the new value straight away.
//
// The desktop and mobile apps draw the look; the terminal draws none.
import type { EngineInterface, Register, ThemeSetArgs, Timer } from 'claude-code'

import { helpText, parseCommand, statusText } from './core/commands'
import type { Action } from './core/commands'
import { optionValue, readSettings } from './core/options'
import type { OptionValue, Settings } from './core/options'
import { paneRows } from './core/pane'
import type { Control, PaneRow } from './core/pane'
import { WALLPAPERS, currentWallpaper } from './core/registry'
import type { Wallpaper } from './core/registry'
import { sceneFor } from './core/scene'
import { makeColors } from './make-colors.js'

// The name the manifest gives the plugin: its options are `CWallpaper.<key>` in /config.
const PLUGIN = 'CWallpaper'
const PANE = 'cwallpaper-settings'
const PANE_TITLE = 'CWallpaper'
// The C of the title, in the orange of the owner's other mods.
const BRAND = '#D97757'

// Session values that outlive a reload of this code (./types).
const PANE_OPEN = { plugin: 'CWallpaper', key: 'paneOpen' } as const
const LOOK_SET = { plugin: 'CWallpaper', key: 'lookSet' } as const
const PENDING = { plugin: 'CWallpaper', key: 'pendingWrites' } as const

/** One option to write: its manifest key and the value. */
type Write = { key: string; value: OptionValue }

// --------------------------------------------------------------- settings

// The options the engine handed this load, and what this copy wrote since.
let given: Record<string, unknown> = {}
let written: Record<string, OptionValue> = {}

const settingsNow = (): Settings => readSettings({ ...given, ...written }, WALLPAPERS)
const wallpaperOf = (s: Settings): Wallpaper => currentWallpaper(s, WALLPAPERS) ?? (WALLPAPERS[0] as Wallpaper)

// The app's colors of each wallpaper, made once by the design system's own helper.
const madeColors = new Map<object, ReturnType<typeof makeColors>>()
function colorsOf(w: Wallpaper, s: Settings): ReturnType<typeof makeColors> {
  const definition = w.colors(s)
  let made = madeColors.get(definition)
  if (!made) {
    made = makeColors(definition as Parameters<typeof makeColors>[0])
    madeColors.set(definition, made)
  }
  return made
}

/** True for this plugin's name, bare or as the loader keys it (`name@marketplace`). */
function isOurs($: EngineInterface, plugin: unknown): boolean {
  const name = $.plugin.name
  return typeof plugin === 'string' && (plugin === name || plugin.startsWith(`${name}@`) || name.startsWith(`${plugin}@`))
}

/**
 * Writes one option as the plugin options screen would: `<plugin>.<key>`. A
 * name the engine has no row for is tried under the loader's name, then looked
 * up among the rows. Answers '' once written (and keeps a copy), else why not.
 */
async function writeOption($: EngineInterface, key: string, value: OptionValue): Promise<string> {
  const names = [PLUGIN]
  try {
    if ($.plugin.name !== PLUGIN) names.push($.plugin.name)
  } catch {
    // The bare name only.
  }
  const attempt = async (row: string): Promise<string> => {
    const set = await $.config.set({ key: row, value })
    if (set.deny !== undefined) return String(set.deny) || 'refused'
    // The value the engine holds now, which another mod's hook may have changed.
    const held = set.value
    written = { ...written, [key]: typeof held === 'boolean' || typeof held === 'string' || typeof held === 'number' ? held : value }
    return ''
  }
  let why = 'no such option'
  for (const name of names) {
    try {
      return await attempt(`${name}.${key}`)
    } catch (err) {
      why = String(err).slice(0, 160)
    }
  }
  try {
    const row = (await $.config.list()).find(r => r.key.endsWith(`.${key}`) && isOurs($, (r.provider as { plugin?: unknown }).plugin))
    if (row) return await attempt(row.key)
  } catch {
    // Said below.
  }
  return why
}

// Each value is read and written by its own literal reference, as the engine lists them.
async function isPaneOpen($: EngineInterface): Promise<boolean> {
  try {
    return (await $.state.get(PANE_OPEN)).value === true
  } catch {
    return false
  }
}
async function isLookSet($: EngineInterface): Promise<boolean> {
  try {
    return (await $.state.get(LOOK_SET)).value === true
  } catch {
    return false
  }
}
async function setPaneOpen($: EngineInterface, value: boolean): Promise<void> {
  try {
    await $.state.set(PANE_OPEN, value)
  } catch {
    // Not kept past a reload; nothing else changes.
  }
}
async function setLookSet($: EngineInterface, value: boolean): Promise<void> {
  try {
    await $.state.set(LOOK_SET, value)
  } catch {
    // Not kept past a reload; nothing else changes.
  }
}
async function pendingWrites($: EngineInterface): Promise<Write[]> {
  try {
    const { value } = await $.state.get(PENDING)
    if (!Array.isArray(value)) return []
    return value.filter(
      (w): w is Write =>
        w !== null && typeof w === 'object' && typeof w.key === 'string' && (typeof w.value === 'boolean' || typeof w.value === 'string' || typeof w.value === 'number'),
    )
  } catch {
    return []
  }
}
async function setPendingWrites($: EngineInterface, value: Write[]): Promise<void> {
  try {
    await $.state.set(PENDING, value.map(w => ({ key: w.key, value: w.value })))
  } catch {
    // Not kept past a reload: a change cut by one stays half made.
  }
}

// ------------------------------------------------------------ wake draws

// In this app an image the app builds while the backdrop is still hidden (as
// the app starts, a plugin reloads or a scene is switched on) can stand still
// for good, and the browser reuses that same still picture for any later image
// with a byte-identical source; an image built from a new source while the
// backdrop shows moves. So a few seconds after a scene is first drawn the mod
// draws it again, twice, each time with a fresh invisible mark in its source,
// so the app builds a new image. The picture is the same. The mark comes from
// the clock, so it never repeats across reloads.
let wakes = 0
let wakeTag = ''
let wakeTimers: Timer[] = []
const WAKE_AFTER_MS = [3000, 12_000] as const
// The surfaces the backdrop was drawn on since the mod loaded: a surface's first
// draw is always followed by wake draws.
const drawnOn = new Set<string>()
// A later draw the mod did not ask for (the app drew the backdrop afresh: a new
// window or a renewed connection) is followed by wake draws too, at most every
// two minutes. A draw within OWN_DRAW_MS of the mod setting the look or asking
// for a redraw is its own.
let ownDrawUntil = -Infinity
let appWokeAt = -Infinity
const OWN_DRAW_MS = 2500
const APP_WAKE_GAP_MS = 120_000
// What the Backdrop last drew, without a mark, and the minute timer that asks
// for a redraw when the picture for the time now differs (Kiki's time of day).
let shown: { id: string; source: string } | undefined
let ticker: Timer | undefined
// While above 0, a theme set or clear going through is this mod's own.
let ownThemeCalls = 0

async function clockNow($: EngineInterface): Promise<number> {
  try {
    return await $.clock.now()
  } catch {
    return Date.now()
  }
}

/** Notes the draws of the next OWN_DRAW_MS as ones this mod asked for. */
async function markOwn($: EngineInterface): Promise<void> {
  try {
    ownDrawUntil = (await $.clock.now()) + OWN_DRAW_MS
  } catch {
    // No clock: the draws that follow count as the app's own.
  }
}

/** Asks the app to draw this mod's surfaces again, noting the draws that follow as the mod's own. */
async function redraw($: EngineInterface): Promise<void> {
  await markOwn($)
  $.ui.invalidate('ui.render')
}

/** One wake draw: the same picture under a fresh mark, taken from the clock. */
async function wake($: EngineInterface): Promise<void> {
  wakes += 1
  try {
    wakeTag = (await $.clock.now()).toString(36)
  } catch {
    wakeTag = `n${wakes}`
  }
  await redraw($)
}

function wakeCancel(): void {
  for (const timer of wakeTimers) {
    try {
      timer.cancel()
    } catch {
      // Already gone.
    }
  }
  wakeTimers = []
}

/** Schedules the wake draws, counted from now. */
function wakeSoon($: EngineInterface): void {
  wakeCancel()
  for (const ms of WAKE_AFTER_MS) {
    try {
      // A redraw once the module was unloaded rejects: there is nothing left to draw then.
      wakeTimers.push($.clock.after(ms, () => void wake($).catch(() => undefined)))
    } catch {
      // No timer: /cwallpaper with no words draws the scene afresh instead.
    }
  }
}

/** A moving scene's source with the mark of the latest wake draw. */
function marked(source: string): string {
  const end = source.lastIndexOf('</svg>')
  if (wakeTag === '' || end < 0) return source
  return `${source.slice(0, end)}<g id="kw${wakeTag}"/>${source.slice(end)}`
}

/** Starts the minute timer once: a tick redraws only when the picture for now is not the one drawn. */
function tickSoon($: EngineInterface): void {
  if (ticker) return
  try {
    ticker = $.clock.every(60_000, () => {
      void (async () => {
        const s = settingsNow()
        if (!s.on || !shown || shown.id !== s.wallpaper) return
        const scene = sceneFor(s, WALLPAPERS, await clockNow($))
        if (scene.kind === 'svg' && scene.source !== shown.source) await redraw($)
      })().catch(() => undefined)
    })
  } catch {
    // No timer: the picture moves on at the next redraw.
  }
}

// ------------------------------------------------------------------ the look

/**
 * The glass the settings ask for. Never an exact zero: a zero may be read as
 * "not given" and filled with the app's default, a solid-looking panel. At
 * fully clear the tint is see-through as well, for a panel painted from it alone.
 */
function glassOf(s: Settings): { blur: number; opacity: number; tint?: string } {
  const glass = { blur: Math.max(0.1, s.blur), opacity: Math.max(0.01, Math.round((1 - s.clear / 100) * 100) / 100) }
  return s.clear >= 100 ? { ...glass, tint: 'rgba(0,0,0,0)' } : glass
}

/** Sets the whole look in one call, as a later set replaces an earlier one; answers why nothing draws it, or ''. */
async function apply($: EngineInterface): Promise<string> {
  const s = settingsNow()
  const w = wallpaperOf(s)
  const glass = glassOf(s)
  const look: ThemeSetArgs = { backdrop: { scene: w.id, glass } }
  if (s.colors) look.colors = colorsOf(w, s).theme
  // Setting the look makes the app draw it: that draw is the mod's own.
  await markOwn($)
  let why: string
  ownThemeCalls += 1
  try {
    try {
      const set = await $.theme.set(look)
      why = set.isDrawn ? '' : set.reason
    } catch {
      // Claude Code before 2.1.323 names the scene `id` and refuses `scene`.
      const older = { backdrop: { id: w.id, glass } } as unknown as ThemeSetArgs
      const set = await $.theme.set(older)
      why = set.isDrawn ? '' : set.reason
    }
  } finally {
    ownThemeCalls -= 1
  }
  await setLookSet($, true)
  // Wake draws, counted from now, as the app may already have drawn the scene
  // while the look was being set; a later first draw counts them afresh.
  wakeCancel()
  if (why === '' && w.kind === 'svg' && w.moves(s)) wakeSoon($)
  return why
}

/**
 * Takes the look off. A clear clears whatever theme stands, whichever plugin set
 * it, so it is made only when the person switches the wallpaper off through this
 * mod while it is on, and at a start only while `lookSet` says the standing look
 * is the one this mod set this session.
 */
async function takeOff($: EngineInterface): Promise<void> {
  wakeCancel()
  ownThemeCalls += 1
  try {
    await $.theme.clear().catch(() => undefined)
  } finally {
    ownThemeCalls -= 1
  }
  await setLookSet($, false)
}

/**
 * Makes writes in order, each taken off the session's `pendingWrites` as it is
 * made, so the reload the first one causes cannot cut the change in two: the
 * next start makes the rest. Answers '' once all are made, else why not.
 */
async function writeAll($: EngineInterface, todo: Write[]): Promise<string> {
  await setPendingWrites($, todo)
  for (const [i, one] of todo.entries()) {
    const why = await writeOption($, one.key, one.value)
    if (why !== '') {
      await setPendingWrites($, [])
      return `could not change ${one.key}: ${why}`
    }
    await setPendingWrites($, todo.slice(i + 1))
  }
  return ''
}

/**
 * One change asked for by a command or a press. Only the writes that would change
 * something are made; with none, nothing is written and the look is not set
 * again. Then the look follows, and it is cleared only when this change switched
 * the wallpaper off. Answers '' or why a write was refused.
 */
async function change($: EngineInterface, writes: Write[]): Promise<string> {
  const before = settingsNow()
  const todo = writes.filter(w => optionValue(before, w.key, WALLPAPERS) !== w.value)
  if (todo.length === 0) return ''
  const why = await writeAll($, todo)
  // The write may have reloaded the module: this copy's calls can then reject.
  try {
    const now = settingsNow()
    if (now.on) await apply($)
    else if (before.on) await takeOff($)
    await redraw($)
  } catch {
    // The new copy sets the look at its start.
  }
  return why
}

// ---------------------------------------------------------------- the pane

async function openPane($: EngineInterface): Promise<boolean> {
  // See-through, like the panels: the wallpaper shows behind the settings too. A build
  // that does not take `backgroundColor` on an open refuses it, and the pane opens plain.
  const pane = { id: PANE, title: PANE_TITLE, focus: true, closeOnEscape: true } as const
  const clear = { ...pane, backgroundColor: 'transparent' } as Parameters<EngineInterface['ui']['open']>[0]
  const opened = await $.ui.open(clear).catch(() => $.ui.open(pane))
  await setPaneOpen($, true)
  return opened.isPlaced
}

/** A press in the pane: writes its option (then `on`, for a wallpaper chosen while off) and shows it at once; the pane stays open. */
async function press($: EngineInterface, c: Control): Promise<void> {
  try {
    const why = await change($, [{ key: c.key, value: c.value }, ...(c.also ? [c.also] : [])])
    if (why !== '') $.ui.toast(`The wallpaper ${why}`)
  } catch {
    // The module was reloaded under the press: the new copy draws the pane.
  }
}

// ---------------------------------------------------------------- commands

async function run($: EngineInterface, args: string): Promise<string> {
  const action: Action = parseCommand(args, settingsNow(), WALLPAPERS)
  if (action.kind === 'help') return helpText(WALLPAPERS)
  if (action.kind === 'error') return action.message
  if (action.kind === 'status') {
    // Also draws the scene afresh: the redraw builds a new picture, which starts
    // its motion over, and applying schedules wake draws after it.
    if (settingsNow().on) await apply($).catch(() => '')
    await redraw($)
    return statusText(settingsNow(), WALLPAPERS)
  }
  if (action.kind === 'pane') {
    const isPlaced = await openPane($)
    return isPlaced ? 'The wallpaper settings are open.' : `The settings pane could not open here. ${statusText(settingsNow(), WALLPAPERS)}`
  }
  const sets = [action, ...[action.also ?? []].flat()].filter((a): a is Extract<Action, { kind: 'set' }> => a.kind === 'set')
  const why = await change($, sets.map(one => ({ key: one.key, value: one.value })))
  if (why !== '') return `The wallpaper ${why}.`
  return statusText(settingsNow(), WALLPAPERS)
}

// ------------------------------------------------------------------- hooks

export const register: Register = (on, options) => {
  given = options && typeof options === 'object' ? { ...options } : {}
  written = {}

  on('session.start', async ($, e, next) => {
    // This runs at the session's start and again after every reload of this
    // code, an option changed on the plugin options screen included: the look
    // the new options say is set again at once.
    try {
      const ids = WALLPAPERS.map(w => w.id).join('|')
      await $.command.register({
        name: 'cwallpaper',
        description: 'The app wallpaper: settings, Kiki, the black hole, on, off',
        argumentHint: `[settings|${ids}|on|off|help]`,
        immediate: true,
      })
    } catch {
      // The look still applies.
    }
    try {
      // A change the last reload cut in two: its writes still to make, in order.
      const left = await pendingWrites($)
      if (left.length > 0) {
        const s = settingsNow()
        const why = await writeAll($, left.filter(w => optionValue(s, w.key, WALLPAPERS) !== w.value))
        if (why !== '') $.ui.toast(`The wallpaper ${why}`)
      }
    } catch {
      // Left as it is.
    }
    try {
      const s = settingsNow()
      if (s.on) {
        // A line here means the desktop app would ignore the colors altogether.
        const unpainted = colorsOf(wallpaperOf(s), s).problems.find((line: string) => line.startsWith("Desktop won't paint"))
        if (unpainted !== undefined && s.colors) $.ui.toast(unpainted)
        await apply($)
      } else if (await isLookSet($)) {
        // Turned off on the options screen: the look this mod set this session, and that
        // still stands (no theme set or cleared by anyone else since), goes, once.
        await takeOff($)
      }
    } catch {
      // A session with no app to draw the look still starts.
    }
    try {
      // The settings pane stays up through a reload; should it have gone, it comes back.
      if (await isPaneOpen($)) {
        const isUp = (await $.ui.panes()).some(p => p.id === PANE)
        if (!isUp) await openPane($)
        await redraw($)
      }
    } catch {
      // Left closed; /cwallpaper settings opens it.
    }
    return next(e)
  })

  on('command.run', { command: 'cwallpaper' }, async ($, e) => {
    try {
      return { text: await run($, typeof e.args === 'string' ? e.args : '') }
    } catch (err) {
      return { text: `The wallpaper could not do that just now (${String(err).slice(0, 160)}).` }
    }
  })

  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    // Closed by the person or a plugin: not opened again after a reload.
    if (e.id === PANE && e.origin.kind !== 'unload') await setPaneOpen($, false)
    return closed
  }).catch(($, e, next) => next(e))

  // There is one theme, and the engine says nowhere whose stands. A theme set or
  // cleared by anyone else ends this mod's claim to it, so a later start that
  // finds the option off clears nothing.
  on('theme.set', async ($, e, next) => {
    const set = await next(e)
    if (ownThemeCalls === 0) await setLookSet($, false)
    return set
  }).catch(($, e, next) => next(e))
  on('theme.clear', async ($, e, next) => {
    const cleared = await next(e)
    if (ownThemeCalls === 0) await setLookSet($, false)
    return cleared
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    // Every mod's hook hears every backdrop: draw only this mod's own scenes.
    const props = e.props as { scene?: unknown; id?: unknown; plugin: unknown }
    const name = props.scene ?? props.id
    const w = WALLPAPERS.find(x => x.id === name)
    if (!w || !isOurs($, props.plugin)) return next(e)
    if (e.surface !== 'desktop' && e.surface !== 'mobile') return next(e)
    const now = await clockNow($)
    const s: Settings = { ...settingsNow(), wallpaper: w.id, on: true }
    const scene = sceneFor(s, WALLPAPERS, now)
    if (scene.kind === 'none') return next(e)
    const kit = $.ui.resolve(e)
    const { Svg } = kit
    tickSoon($)

    if (scene.kind === 'shader') {
      shown = undefined
      // The wallpaper's own tree: its Shader names its file by a literal in its own source.
      try {
        const tree = w.scene?.(kit as never, scene)
        if (tree) return tree as never
      } catch {
        // Its still picture alone.
      }
      return <Svg source={scene.source} alt={scene.alt} />
    }

    // The first draw on a surface since the mod loaded, and a later draw the mod
    // did not ask for (the app drew the backdrop afresh, maybe while it was
    // hidden, at most every two minutes), are followed by wake draws.
    const moving = w.moves(s)
    const isFirstHere = !drawnOn.has(String(e.surface))
    drawnOn.add(String(e.surface))
    if (moving && isFirstHere) {
      wakeSoon($)
    } else if (moving && now > ownDrawUntil && now - appWokeAt >= APP_WAKE_GAP_MS) {
      appWokeAt = now
      wakeSoon($)
    }
    shown = { id: w.id, source: scene.source }
    // Drawn as one image, not in a frame: a framed scene stood still even when
    // built afresh, while images built after the backdrop showed moved.
    return <Svg source={moving ? marked(scene.source) : scene.source} alt={scene.alt} />
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const s = settingsNow()
    const buttons = (controls: Control[]) =>
      controls.map(c => (
        <Button key={`${c.key}:${String(c.value)}`} label={c.label} variant={c.current ? 'primary' : 'secondary'} onPress={() => press($, c)} />
      ))
    const rowOf = (row: PaneRow) => {
      if (row.kind === 'heading') return <Text bold>{row.text}</Text>
      if (row.kind === 'note') return <Text dimColor>{row.text}</Text>
      const [less, more] = row.controls
      // A number: its minus, its value, its plus. A toggle: its state, then its button.
      if (row.controls.length === 2 && less?.label === '-' && more?.label === '+') {
        return (
          <Box flexDirection="row" columnGap={1}>
            <Text>{row.label}</Text>
            {buttons([less])}
            <Text bold>{row.value ?? ''}</Text>
            {buttons([more])}
          </Box>
        )
      }
      return (
        <Box flexDirection="row" columnGap={1} flexWrap="wrap">
          <Text>{row.label}</Text>
          {row.value !== undefined && <Text bold>{row.value}</Text>}
          {buttons(row.controls)}
        </Box>
      )
    }
    return (
      <Box flexDirection="column" rowGap={1}>
        <Text bold>
          <Text color={BRAND}>C</Text>Wallpaper
        </Text>
        {paneRows(s, WALLPAPERS).map(rowOf)}
        <Text dimColor>Each control writes one of the plugin's options; the same settings are on the app's plugin options screen.</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    // The cat's face belongs to the wallpaper the cat is in.
    const s = settingsNow()
    if (!s.on) return next(e)
    let face: string | undefined
    try {
      face = wallpaperOf(s).spinner?.(s, String(e.props.mode))
    } catch {
      face = undefined
    }
    if (!face) return next(e)
    return next({ ...e, props: { ...e.props, suffix: `${e.props.suffix} ${face}` } })
  })
}
