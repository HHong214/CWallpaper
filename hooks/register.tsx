// wallpaper: a moving backdrop and matching colors for the whole app.
//
//   kiki            pixel art of a young witch and her black cat floating on
//                   a broom toward a seaside city, by day, at sunset or at
//                   night, following the clock (/wallpaper time)
//   blackhole       an ASCII-art black hole drawn by code: a dark centre in a
//                   thin gold ring, its disc bent over and under it, and
//                   everything round it streaming in (/wallpaper blackhole)
//   my-picture      a picture of your own, traced into flat shapes
//                   (/wallpaper picture <file>)
//   my-video        a short, soft loop traced from a video of your own
//                   (/wallpaper video <file>)
//
// A look is two things sent in one `$.theme.set`: `colors`, which repaint
// every surface, word and line of the app, and a `backdrop` behind the
// conversation. Over a moving scene the app lays its panels as `glass`, and
// three numbers shape how the scene shows: how see-through the panels are, how
// far they blur it, and how much the scene itself is dimmed so words stand
// clear. `/wallpaper settings` opens a pane with those; they are kept in the
// mod's store.
//
// The desktop and mobile apps draw the look; the terminal draws none.
import type { EngineInterface, Register, ThemeSetArgs, Timer } from 'claude-code'

import { BLACKHOLE_ALT, blackhole } from './blackhole'
import { kikiScene } from './kiki'
import type { Phase as KikiPhase } from './kiki'
import { makeColors } from './make-colors.js'
import { asPlace, DEFAULT_SUNRISE, DEFAULT_SUNSET, phaseAt } from './kiki/sun'
import type { Place } from './kiki/sun'
import { trace, traceLoop } from './trace'

// ------------------------------------------------------------------ themes

const THEMES = ['kiki', 'blackhole', 'my-picture', 'my-video'] as const
type Theme = (typeof THEMES)[number]
const isTheme = (v: unknown): v is Theme => THEMES.some(t => t === v)

const LABEL: Record<Theme, string> = {
  kiki: 'Kiki',
  blackhole: 'Black hole',
  'my-picture': 'My picture',
  'my-video': 'My video',
}

// The words `/wallpaper` takes for each theme.
const NAMES: Record<string, Theme> = {
  kiki: 'kiki', night: 'kiki', witch: 'kiki',
  blackhole: 'blackhole', 'black-hole': 'blackhole', hole: 'blackhole',
  'my-picture': 'my-picture', picture: 'my-picture', image: 'my-picture',
  'my-video': 'my-video', video: 'my-video',
}

// The app's colors, made by the design system's own helper from a few anchors.
// Kiki: a near-black night indigo in dark mode, warm paper in light
// mode. The roles keep their meaning (red is danger, green success, amber
// warning); the accent is dusk violet and `pro` the rose of the bow.
const NIGHT = makeColors({
  label: 'Kiki night',
  roles: { accent: '#7c6bd0', danger: '#c0453f', success: '#4f8a4a', warning: '#c98a1b', pro: '#c05a86' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#efe6d6', 'surface-1': '#f4ecde', 'surface-2': '#faf5ea',
        'text-primary': '#2a2433', 'text-secondary': '#4f4760', 'text-muted': '#655d76',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#07091a', 'surface-1': '#0b0e22', 'surface-2': '#0f122a', 'surface-3': '#121631',
        'text-primary': '#eeecfa', 'text-secondary': '#c9c6e2', 'text-muted': '#a6a2c6',
      },
    },
  },
})

// The black hole: near-black in dark mode with an amber accent, the gold of its
// ring; warm paper in light mode. Danger, success and warning keep their meaning.
const HOLE = makeColors({
  label: 'Black hole',
  roles: { accent: '#f0a020', danger: '#d4503a', success: '#5f9a4c', warning: '#e0a030', pro: '#d07a4a' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#f1e8d8', 'surface-1': '#f6efe2', 'surface-2': '#fbf7ee',
        'text-primary': '#2b2118', 'text-secondary': '#54473a', 'text-muted': '#6b5d4e',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#070508', 'surface-1': '#0c090b', 'surface-2': '#110d0e', 'surface-3': '#161112',
        'text-primary': '#f5ecdc', 'text-secondary': '#d8cab2', 'text-muted': '#b2a288',
      },
    },
  },
})

/** The app's colors for a theme: the black hole's own, Kiki's for the rest. */
const colorsOf = (theme: Theme): typeof NIGHT => (theme === 'blackhole' ? HOLE : NIGHT)

// ---------------------------------------------------------------- settings

type Settings = {
  theme: Theme
  isOn: boolean
  /** How see-through the app's panels are over a moving scene: 0 (solid) to 100 (clear). */
  clear: number
  /** How far the panels blur the scene behind them: 0 to 40. */
  blur: number
  /** How much the scene itself is darkened, so words stand clear of it: 0 to 80. */
  dim: number
  colors: boolean
  /**
   * How the kiki scene and the black hole move. `smooth`: everything moves,
   * through the scene's own CSS animations. `light`: calmer, Kiki with the
   * shooting star at rest, the black hole's loop played more slowly. `off`: still.
   */
  motion: Motion
  /**
   * Which part of the day the kiki scene shows. `auto`: the one the sun is in
   * now where you are (./kiki/sun); else always that one.
   */
  kikiTime: KikiTime
  /** The picture of your own, as a path inside the mod's folder; '' when none. */
  picture: string
  /** The filmstrip made from your video, as a path inside the mod's folder; '' when none. */
  film: string
}

// Clear panels over a dimmed scene: the whole window is the wallpaper.
const MOTIONS = ['smooth', 'light', 'off'] as const
type Motion = (typeof MOTIONS)[number]
const isMotion = (v: unknown): v is Motion => MOTIONS.some(m => m === v)
const MOTION_LABEL: Record<Motion, string> = { smooth: 'Smooth', light: 'Light', off: 'Off' }
// What `light` rests, for a calmer scene: the shooting star, the one sudden
// streak. The sea, the clouds, the stars, the moon, the lighthouse, the wind,
// the camera's gentle bob and Kiki's own float all still move: each was asked
// for, by someone who keeps to light (they rest with motion off, or when the
// system asks for less motion).
const LIGHT = { stillShoot: true } as const

const KIKI_TIMES = ['auto', 'day', 'sunset', 'night'] as const
type KikiTime = (typeof KIKI_TIMES)[number]
const isKikiTime = (v: unknown): v is KikiTime => KIKI_TIMES.some(t => t === v)
const KIKI_TIME_LABEL: Record<KikiTime, string> = { auto: 'Auto', day: 'Day', sunset: 'Sunset', night: 'Night' }

const DEFAULTS: Settings = { theme: 'kiki', isOn: true, clear: 100, blur: 0, dim: 30, colors: true, motion: 'smooth', kikiTime: 'auto', picture: '', film: '' }

const LIMITS = { clear: [0, 100, 10], blur: [0, 40, 4], dim: [0, 80, 10] } as const
type Dial = keyof typeof LIMITS

const within = (v: unknown, dial: Dial, fallback: number): number => {
  const [lo, hi] = LIMITS[dial]
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback
}

function asSettings(v: unknown): Settings {
  const o = v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  return {
    theme: isTheme(o.theme) ? o.theme : DEFAULTS.theme,
    isOn: o.isOn !== false,
    clear: within(o.clear, 'clear', DEFAULTS.clear),
    blur: within(o.blur, 'blur', DEFAULTS.blur),
    dim: within(o.dim, 'dim', DEFAULTS.dim),
    colors: o.colors !== false,
    // The old `steps`, and anything else unknown, move smoothly now.
    motion: isMotion(o.motion) ? o.motion : 'smooth',
    kikiTime: isKikiTime(o.kikiTime) ? o.kikiTime : 'auto',
    picture: typeof o.picture === 'string' ? o.picture : '',
    film: typeof o.film === 'string' ? o.film : '',
  }
}

const PANE = 'wallpaper-settings'
// A scene is one SVG picture, which holds 131,072 characters in all; a traced
// picture keeps under this, which leaves room for the dimming laid inside it.
const SCENE_CHARS = 124_000
// What a picture is traced at, best first: width, height and number of colors.
// The first that fits is kept; a picture of flat color fits near the top.
const STILL_TRIES: readonly (readonly [number, number, number])[] = [
  [480, 270, 32], [480, 270, 24], [448, 252, 24], [416, 234, 24], [400, 226, 24], [384, 216, 24],
  [352, 198, 32], [352, 198, 24], [320, 180, 48], [320, 180, 32], [320, 180, 24], [256, 144, 32], [256, 144, 16],
]
// The same for a video's loop, which also holds each frame's changes: width,
// height, colors and frames, four frames a second.
const LOOP_FPS = 4
const LOOP_TRIES: readonly (readonly [number, number, number, number])[] = [
  [288, 162, 16, 6], [256, 144, 16, 6], [224, 126, 16, 6], [192, 108, 16, 6], [192, 108, 12, 5], [160, 90, 16, 6], [160, 90, 12, 4],
]

const FACE: Record<string, string> = {
  requesting: '=^-^=',
  thinking: '=^.^=',
  'tool-input': '=^o^=',
  'tool-use': '=^o^=',
  responding: '=^w^=',
}

const HELP = [
  'Usage: /wallpaper [command]',
  '  (none)                          what is drawn now; also draws the scene afresh',
  '  settings                        open the settings pane',
  '  kiki                            switch back to the Kiki scene',
  '  blackhole                       an ASCII-art black hole, everything streaming in (also black-hole, hole)',
  '  picture <file>                  use a .png or .jpg of your own, traced into flat shapes (needs ffmpeg)',
  '  video <file>                    use a short, soft loop traced from an .mp4 or .gif of your own (needs ffmpeg)',
  '  picture | video                 switch back to the one you loaded',
  '  clear <0-100>                   how see-through the app panels are',
  '  blur <0-40>                     how far the panels blur the scene',
  '  dim <0-80>                      how much the scene is darkened',
  '  motion smooth|light|off         how the scene moves: all of it; calmer (Kiki\'s shooting star rests, the black hole turns slower); or still',
  '  time auto|day|sunset|night      the kiki scene\'s time of day: following the sun where you are, or always that one',
  '  colors on|off                   repaint the app in the theme colors, or keep its own',
  '  on | off                        show or take off the look',
].join('\n')

// ------------------------------------------------------------ session values

// What the drawing reads. Module variables: a reload starts them over, and
// `session.start`, which runs again then, reads the saved ones back.
let settings: Settings = DEFAULTS
let hasSpinner = true
// Where the kiki scene's sun is reckoned from in auto, read back at the start.
let place: Place | undefined
let filmSvg = '' // the loop traced from your video, a whole SVG
let pictureSvg = '' // your picture traced, a whole SVG
// What the Backdrop hook last answered, so a wallpaper that does not show can say why.
let lastDraw = 'never asked to draw'
// What the app last said it frosts its panels with, as the Backdrop hook heard it.
let seenGlass = ''
// The kiki scene's phase of the day as last drawn (undefined before the first draw),
// and the minute timer that watches for the next one while it follows the clock.
let kikiShown: KikiPhase | undefined
let kikiTimer: Timer | undefined
// Wake draws. In this app an image the app builds while the backdrop is still
// hidden (as the app starts, a plugin reloads or a scene is switched on) can
// stand still for good, and the browser reuses that same still picture for any
// later image with a byte-identical source; an image built from a new source
// while the backdrop shows moves (motion test 5). So a few seconds after a
// scene is first drawn the mod draws it again, twice, each time with a fresh
// invisible mark in its source, so the app builds a new image. The picture is
// the same. The mark comes from the clock, so it never repeats across reloads.
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

// A drawing is its SVG pictures, bottom to top. Every theme draws one: in the
// desktop app a stack of pictures stood still while the same art as one picture
// moved (./kiki). A drawing of several is still drawn as a stack. `moves` marks
// the ones that animate, which the wake draws mark afresh.
type Drawing = { layers: { source: string; moves: boolean }[]; alt: string }
const drawings = new Map<string, Drawing>()

/** The theme that can be drawn now: one of your own with nothing loaded falls back. */
function drawn(): Theme {
  if (settings.theme === 'my-picture' && (settings.picture === '' || pictureSvg === '')) return 'kiki'
  if (settings.theme === 'my-video' && (settings.film === '' || filmSvg === '')) return 'kiki'
  return settings.theme
}

// A picture or a video of your own is drawn as a scene, traced into flat shapes:
// the app lays its see-through panels over a scene, hides a still backdrop of
// its own under solid ones, and does not draw a picture file put inside a scene.
function pictureScene(): Drawing {
  return { layers: [{ source: pictureSvg, moves: false }], alt: 'Your own picture, traced into flat shapes.' }
}

function filmScene(): Drawing {
  return { layers: [{ source: filmSvg, moves: true }], alt: 'A short loop traced from your own video.' }
}

/**
 * A scene with the dimming laid over it, painted last inside its one picture.
 * A drawing of several pictures would get it as a still picture of its own on
 * top instead (inside a moving one of them it would be painted again on every frame).
 */
function dimmed(art: Drawing): Drawing {
  if (settings.dim <= 0) return art
  const veil = `<rect width="100%" height="100%" fill="#000" opacity="${settings.dim / 100}"/>`
  const [only] = art.layers
  if (art.layers.length === 1 && only !== undefined) {
    const end = only.source.lastIndexOf('</svg>')
    if (end < 0) return art
    return { layers: [{ source: only.source.slice(0, end) + veil + '</svg>', moves: only.moves }], alt: art.alt }
  }
  const cover = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">${veil}</svg>`
  return { layers: [...art.layers, { source: cover, moves: false }], alt: art.alt }
}

/** The scene of a theme as it stands. */
function drawingOf(name: Theme): Drawing {
  if (name === 'my-video') return dimmed(filmScene())
  if (name === 'my-picture') return dimmed(pictureScene())
  if (name === 'blackhole') {
    // One picture per setting, built once and kept; it darkens itself.
    const key = `blackhole|${settings.dim}|${settings.motion}`
    let hole = drawings.get(key)
    if (!hole) {
      hole = { layers: [{ source: blackhole({ motion: settings.motion, dim: settings.dim }), moves: settings.motion !== 'off' }], alt: BLACKHOLE_ALT }
      drawings.set(key, hole)
    }
    return hole
  }
  // One picture per phase and setting, built once and kept: a redraw
  // then costs nothing to make, and it changes only when the phase or a setting does.
  const phase = kikiShown ?? 'night'
  const key = `kiki|${phase}|${settings.dim}|${settings.motion}`
  let made = drawings.get(key)
  if (!made) {
    made = dimmed(kikiScene(phase, settings.motion === 'off', settings.motion === 'light' ? LIGHT : undefined))
    drawings.set(key, made)
  }
  return made
}

/** The phase the kiki scene is to show now: the one chosen, or in auto the sun's. */
async function kikiPhaseNow($: EngineInterface): Promise<KikiPhase> {
  if (settings.kikiTime !== 'auto') return settings.kikiTime
  try {
    const now = await $.clock.now()
    return phaseAt(now, -new Date(now).getTimezoneOffset() * 60, place)
  } catch {
    // No clock to read: keep what is drawn.
    return kikiShown ?? 'night'
  }
}

/** True for a scene that moves by itself: kiki or the black hole with motion on, your video loop. */
function moves(theme: Theme): boolean {
  if (theme === 'my-picture') return false
  if (theme === 'kiki' || theme === 'blackhole') return settings.motion !== 'off'
  return true
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

/** Cancels the wake draws still to come. */
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
      wakeTimers.push(
        $.clock.after(ms, () => {
          void wake($)
        }),
      )
    } catch {
      // No timer: /wallpaper with no words draws the scene afresh instead.
    }
  }
}

/** A moving scene's source with the mark of the latest wake draw: a new source makes the app build a new image. */
function marked(source: string): string {
  const end = source.lastIndexOf('</svg>')
  if (wakeTag === '' || end < 0) return source
  return `${source.slice(0, end)}<g id="kw${wakeTag}"/>${source.slice(end)}`
}

/** Stops the kiki scene's minute timer. */
function kikiSleep(): void {
  try {
    kikiTimer?.cancel()
  } catch {
    // Already gone.
  }
  kikiTimer = undefined
}

/**
 * Starts the minute timer while the kiki scene follows the clock; safe to call
 * on every draw. A tick asks for a redraw only when the phase is not the one
 * drawn: a redraw builds the picture anew, which starts its motion over.
 */
function kikiWake($: EngineInterface): void {
  if (kikiTimer || settings.kikiTime !== 'auto') return
  try {
    kikiTimer = $.clock.every(60_000, () => {
      void kikiPhaseNow($).then(phase => {
        if (settings.kikiTime === 'auto' && phase !== kikiShown) void redraw($)
      })
    })
  } catch {
    // No timer: the phase moves on at the next redraw.
  }
}

/**
 * The glass the settings ask for. Never an exact zero: a zero may be read as
 * "not given" and filled with the app's default (blur 16, opacity 0.6), which
 * is a solid-looking panel. At fully clear the tint is see-through as well, for
 * a panel that is painted from the tint alone.
 */
function glassNow(): { blur: number; opacity: number; tint?: string } {
  const glass = { blur: Math.max(0.1, settings.blur), opacity: Math.max(0.01, 1 - settings.clear / 100) }
  return settings.clear >= 100 ? { ...glass, tint: 'rgba(0,0,0,0)' } : glass
}

/** True for this plugin's name, bare or as the loader keys it (`name@marketplace`). */
function isOurs($: EngineInterface, plugin: unknown): boolean {
  const name = $.plugin.name
  return typeof plugin === 'string' && (plugin === name || plugin.startsWith(`${name}@`) || name.startsWith(`${plugin}@`))
}

async function save($: EngineInterface): Promise<void> {
  try {
    await $.store.set('settings', settings)
  } catch {
    // A store that refuses keeps the session's values.
  }
}

// Sets the whole look in one call, as a later set replaces an earlier one.
// Answers why nothing draws it, or '' when something does.
async function apply($: EngineInterface): Promise<string> {
  const theme = drawn()
  const glass = glassNow()
  const look: ThemeSetArgs = { backdrop: { scene: theme, glass } }
  if (settings.colors) look.colors = colorsOf(theme).theme
  // Setting the look makes the app draw it: that draw is the mod's own.
  await markOwn($)
  let why: string
  try {
    const set = await $.theme.set(look)
    why = set.isDrawn ? '' : set.reason
  } catch {
    // Claude Code before 2.1.323 names the scene `id` and refuses `scene`.
    const older = { backdrop: { id: theme, glass } } as unknown as ThemeSetArgs
    const set = await $.theme.set(older)
    why = set.isDrawn ? '' : set.reason
  }
  // The kiki scene's minute timer, only while it is drawn and follows the clock.
  if (theme === 'kiki' && settings.kikiTime === 'auto' && why === '') kikiWake($)
  else kikiSleep()
  // Wake draws, counted from now, as the app may already have drawn the scene
  // while the look was being set; a later first draw counts them afresh.
  wakeCancel()
  if (why === '' && moves(theme)) wakeSoon($)
  return why
}

/** Applies what the settings now say and redraws; answers why nothing draws it, or ''. */
async function refresh($: EngineInterface): Promise<string> {
  await save($)
  let why = ''
  if (settings.isOn) {
    why = await apply($).catch(err => String(err))
  } else {
    kikiSleep()
    wakeCancel()
    await $.theme.clear().catch(() => undefined)
  }
  await redraw($)
  return why
}

// ------------------------------------------------------- what the pane does

async function pick($: EngineInterface, theme: Theme): Promise<void> {
  settings = { ...settings, theme, isOn: true }
  await refresh($)
}

async function turn($: EngineInterface, dial: Dial, by: number): Promise<void> {
  const [, , step] = LIMITS[dial]
  settings = { ...settings, [dial]: within(settings[dial] + by * step, dial, settings[dial]) }
  await refresh($)
}

async function move($: EngineInterface, motion: Motion): Promise<void> {
  settings = { ...settings, motion }
  await refresh($)
}

async function setKikiTime($: EngineInterface, kikiTime: KikiTime): Promise<void> {
  settings = { ...settings, kikiTime }
  await refresh($)
}

async function flip($: EngineInterface, key: 'colors' | 'isOn'): Promise<void> {
  settings = { ...settings, [key]: !settings[key] }
  await refresh($)
}

// ----------------------------------------------------- pictures of your own

const unquote = (path: string): string => path.trim().replace(/^["']|["']$/g, '')

/** Runs ffmpeg; answers '' when it worked, else one line saying why not. */
async function ffmpeg($: EngineInterface, args: readonly string[]): Promise<string> {
  try {
    const ran = await $.process.run(['ffmpeg', '-y', '-loglevel', 'error', ...args], { timeoutMs: 120_000 })
    if (ran.exitCode === 0) return ''
    return (ran.stderr.trim().split('\n').pop() ?? '').slice(0, 200) || `ffmpeg stopped with code ${ran.exitCode}`
  } catch (err) {
    return `ffmpeg could not be run (${String(err).slice(0, 120)}). Install ffmpeg and try again.`
  }
}

/** The bytes of a file ffmpeg wrote, or undefined when they are not the size asked for. */
async function pixels($: EngineInterface, path: string, size: number): Promise<Uint8Array | undefined> {
  const text = atob((await $.fs.read(path, { as: 'bytes' })).base64)
  if (text.length !== size) return undefined
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i += 1) bytes[i] = text.charCodeAt(i)
  return bytes
}

/**
 * Traces `source` at the first size in `tries` whose SVG fits a scene, and keeps
 * it as a file in the mod's folder. Answers that file's path inside the folder
 * and the SVG, or a line starting "!" saying why not. ffmpeg cuts the picture
 * to 16:9 at the size asked for, and down to that many colors, as raw pixels.
 */
async function traced($: EngineInterface, source: string, kind: 'picture' | 'video', tries: readonly (readonly number[])[]): Promise<{ path: string; svg: string } | string> {
  const from = unquote(source)
  if (from === '') return `!Usage: /wallpaper ${kind} <file>`
  if (!(await $.fs.exists(from).catch(() => false))) return `!There is no file at ${from}.`
  let smallest = 0
  for (const [w = 0, h = 0, colors = 16, frames = 1] of tries) {
    const raw = `${$.plugin.root}/user/work-${w}x${h}x${frames}.rgb`
    const cut = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`
    const few = `split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=${frames > 1 ? 'full' : 'single'}[p];[b][p]paletteuse=dither=none`
    const graph = frames > 1 ? `fps=${LOOP_FPS},${cut},trim=end_frame=${frames},${few}` : `${cut},${few}`
    const failed = await ffmpeg($, ['-i', from, '-filter_complex', graph, '-frames:v', String(frames), '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw])
    if (failed) return `!${failed}`
    const rgb = await pixels($, raw, w * h * 3 * frames)
    if (!rgb) return frames > 1 ? '!The video is too short to make a loop from, or could not be read.' : '!The picture could not be read.'
    const svg = frames > 1 ? traceLoop(rgb, w, h, frames, LOOP_FPS) : trace(rgb, w, h)
    if (svg.length <= SCENE_CHARS) {
      // The name changes with each import, so an earlier file is never mistaken for the new one.
      const path = `user/${kind}-${(await $.clock.now()).toString(36)}.svg`
      await $.fs.write(`${$.plugin.root}/${path}`, svg)
      return { path, svg }
    }
    smallest = svg.length
  }
  return `!It is too detailed to draw as a scene even at the smallest size (${smallest} characters, and a scene holds ${SCENE_CHARS}).`
}

async function importPicture($: EngineInterface, source: string): Promise<string> {
  const made = await traced($, source, 'picture', STILL_TRIES)
  if (typeof made === 'string') return made.slice(1)
  pictureSvg = made.svg
  settings = { ...settings, picture: made.path, theme: 'my-picture', isOn: true }
  const why = await refresh($)
  return `Your picture is the wallpaper, traced into flat shapes: the app does not draw a picture file in a scene.${why ? ` Nothing draws it here (${why}).` : ''} It follows the panel, blur and dimming settings like the other themes.`
}

async function importVideo($: EngineInterface, source: string): Promise<string> {
  const made = await traced($, source, 'video', LOOP_TRIES)
  if (typeof made === 'string') return made.slice(1)
  filmSvg = made.svg
  settings = { ...settings, film: made.path, theme: 'my-video', isOn: true }
  const why = await refresh($)
  return `A short loop from the start of your video is the wallpaper.${why ? ` Nothing draws it here (${why}).` : ''} The app cannot play a video: this is a few frames traced small and soft, played forwards and back.`
}

// ---------------------------------------------------------------- commands

/** What `/wallpaper` with no words says. */
async function status($: EngineInterface, why: string): Promise<string> {
  if (!settings.isOn) return `The wallpaper is off. /wallpaper on brings back ${LABEL[settings.theme]}.`
  const theme = drawn()
  const where = why ? ` Nothing draws it here (${why}); the desktop and mobile apps do.` : ''
  const missing = theme !== settings.theme ? ` (${LABEL[settings.theme]} has nothing loaded yet.)` : ''
  const lines = [
    `The wallpaper is ${LABEL[theme]}.${missing}${where}`,
    `Panels ${settings.clear}% clear, blur ${settings.blur}, scene dimmed ${settings.dim}%, app colors ${settings.colors ? 'on' : 'off'}, motion ${settings.motion}.`,
  ]
  if (theme === 'kiki') {
    const phase = await kikiPhaseNow($)
    const hhmm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    const sun = place ? `the sun in ${place.name}` : `the clock, with sunrise at ${hhmm(DEFAULT_SUNRISE)} and sunset at ${hhmm(DEFAULT_SUNSET)}`
    const how = settings.kikiTime === 'auto' ? `auto, following ${sun}` : `${settings.kikiTime}, always`
    lines.push(`Kiki time: ${how}; the scene shows ${phase === 'day' ? 'the day' : phase === 'sunset' ? 'the sunset' : 'the night'} now.`)
  }
  lines.push(`Last draw: ${lastDraw}. Wake draws so far: ${wakes}. Glass the app used: ${seenGlass || 'not drawn yet'}.`)
  lines.push('/wallpaper settings opens the controls; /wallpaper help lists every command.')
  return lines.join('\n')
}

async function run($: EngineInterface, args: string): Promise<string> {
  const words = args.trim().split(/\s+/).filter(w => w !== '')
  const verb = (words[0] ?? '').toLowerCase()
  const rest = words.slice(1).map(w => w.toLowerCase())
  const tail = args.trim().slice(verb.length).trim()

  if (verb === 'help') return HELP
  if (verb === '') {
    // Also draws the scene afresh: the redraw builds a new picture, which starts
    // its motion over, and applying schedules wake draws after it.
    const why = settings.isOn ? await apply($).catch(err => String(err)) : ''
    await redraw($)
    return status($, why)
  }
  if (verb === 'settings') {
    // See-through, like the panels: the wallpaper shows behind the settings too. A build
    // that does not take `backgroundColor` on an open refuses it, and the pane opens plain.
    const pane = { id: PANE, title: 'Wallpaper', focus: true, closeOnEscape: true } as const
    const clear = { ...pane, backgroundColor: 'transparent' } as Parameters<EngineInterface['ui']['open']>[0]
    const opened = await $.ui.open(clear).catch(() => $.ui.open(pane))
    return opened.isPlaced ? 'The wallpaper settings are open.' : `The settings pane could not open here. ${await status($, '')}`
  }
  if ((verb === 'on' || verb === 'off') && rest.length === 0) {
    settings = { ...settings, isOn: verb === 'on' }
    return status($, await refresh($))
  }
  if ((verb === 'picture' || verb === 'image') && tail !== '') return importPicture($, tail)
  if (verb === 'video' && tail !== '') return importVideo($, tail)
  if (verb === 'clear' || verb === 'blur' || verb === 'dim') {
    const [lo, hi] = LIMITS[verb]
    const value = Number(rest[0])
    if (rest.length !== 1 || !Number.isFinite(value)) return `Usage: /wallpaper ${verb} <${lo}-${hi}>`
    settings = { ...settings, [verb]: within(value, verb, settings[verb]) }
    return status($, await refresh($))
  }
  if (verb === 'motion') {
    const motion = rest[0]
    if (rest.length !== 1 || !isMotion(motion)) return 'Usage: /wallpaper motion smooth|light|off'
    settings = { ...settings, motion }
    return status($, await refresh($))
  }
  if (verb === 'time') {
    const kikiTime = rest[0]
    if (rest.length !== 1 || !isKikiTime(kikiTime)) return 'Usage: /wallpaper time auto|day|sunset|night'
    settings = { ...settings, kikiTime }
    return status($, await refresh($))
  }
  if (verb === 'colors' && (rest[0] === 'on' || rest[0] === 'off') && rest.length === 1) {
    settings = { ...settings, colors: rest[0] === 'on' }
    return status($, await refresh($))
  }
  const named = rest.length === 0 ? NAMES[verb] : undefined
  if (named !== undefined) {
    settings = { ...settings, theme: named, isOn: true }
    return status($, await refresh($))
  }
  return `There is no "${verb}".\n${HELP}`
}

// ------------------------------------------------------------------- hooks

export const register: Register = (on, options) => {
  hasSpinner = options.spinner !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'wallpaper',
      description: 'The app wallpaper: settings, Kiki, the black hole, your own picture or video, on, off',
      argumentHint: '[settings|kiki|blackhole|picture <file>|video <file>|on|off|help]',
      immediate: true,
    })
    try {
      settings = asSettings(await $.store.get('settings'))
      // The picture and the loop traced earlier, read back. One that is gone, or is
      // not a scene's SVG (made by an earlier version), counts as not loaded.
      const kept = (text: string): string => (text.startsWith('<svg') && text.length <= SCENE_CHARS ? text : '')
      if (settings.film !== '') filmSvg = await $.fs.read(`${$.plugin.root}/${settings.film}`).then(kept, () => '')
      if (settings.picture !== '') pictureSvg = await $.fs.read(`${$.plugin.root}/${settings.picture}`).then(kept, () => '')
      // The place the pixel valley found from your IP address (or the city named
      // for it) before it was taken out, still kept under its key. Nothing looks a
      // place up now: with none kept, the kiki scene's day follows the clock alone.
      place = asPlace(await $.store.get('valley.location').catch(() => undefined))
      // A line here means the desktop app would ignore the colors altogether.
      const unpainted = colorsOf(drawn()).problems.find(line => line.startsWith("Desktop won't paint"))
      if (unpainted !== undefined && settings.colors) $.ui.toast(unpainted)
      if (settings.isOn) await apply($)
    } catch {
      // A session with no app to draw the look, or no store, still starts.
    }
    return next(e)
  })

  on('command.run', { command: 'wallpaper' }, async ($, e) => {
    try {
      return { text: await run($, typeof e.args === 'string' ? e.args : '') }
    } catch (err) {
      return { text: `The wallpaper could not do that just now (${String(err).slice(0, 160)}).` }
    }
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    // Every mod's hook hears every backdrop: draw only this mod's own scenes.
    const props = e.props as { scene?: unknown; id?: unknown; plugin: unknown }
    const name = props.scene ?? props.id
    if (!isOurs($, props.plugin) || !isTheme(name)) return next(e)
    seenGlass = `${JSON.stringify((e.props as { glass?: unknown }).glass)} on ${String(e.surface)}`
    if ((name === 'my-video' && filmSvg === '') || (name === 'my-picture' && pictureSvg === '')) {
      lastDraw = `${name} was asked for with nothing loaded`
      return next(e)
    }
    if (e.surface !== 'desktop' && e.surface !== 'mobile') return next(e)
    const { Svg, Box } = $.ui.resolve(e)
    if (name === 'kiki') {
      kikiShown = await kikiPhaseNow($)
      kikiWake($)
    }
    const art = drawingOf(name)
    const moving = moves(name)
    // The first draw on a surface since the mod loaded, and a later draw the mod
    // did not ask for (the app drew the backdrop afresh, maybe while it was
    // hidden, at most every two minutes), are followed by wake draws.
    const isFirstHere = !drawnOn.has(String(e.surface))
    drawnOn.add(String(e.surface))
    let now = -Infinity
    try {
      now = await $.clock.now()
    } catch {
      // No clock: only a first draw brings wake draws.
    }
    if (moving && isFirstHere) {
      wakeSoon($)
    } else if (moving && now > ownDrawUntil && now - appWokeAt >= APP_WAKE_GAP_MS) {
      appWokeAt = now
      wakeSoon($)
    }
    const leaves = art.layers.map(l => (moving && l.moves ? marked(l.source) : l.source))
    const chars = leaves.reduce((n, s) => n + s.length, 0)
    const how = leaves.length === 1 ? 'an SVG image' : `${leaves.length} stacked SVG images`
    lastDraw = `${name}, ${how} of ${chars} characters, on ${String(e.surface)}`

    // Drawn as images, not in frames: on this PC a framed scene stood still even
    // when built afresh, while images built after the backdrop showed moved. The
    // app builds an image anew on each redraw, which starts its motion over, so
    // beyond the wake draws the mod asks for one only when the picture changes.
    // Each scene is one picture. A drawing of several would be laid as a stack,
    // each filling the window, but the desktop app does not animate one.
    const [only] = leaves
    if (leaves.length === 1 && only !== undefined) return <Svg source={only} alt={art.alt} />
    return (
      <Box>
        {leaves.map((source, i) => (
          <Svg source={source} alt={i === 0 ? art.alt : `${art.alt} (layer ${i + 1} of ${leaves.length})`} />
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const now = drawn()
    const dial = (key: Dial, label: string, value: string) => (
      <Box flexDirection="row" columnGap={1}>
        <Text>{label}</Text>
        <Button key={`${key}-less`} label="-" onPress={() => turn($, key, -1)} />
        <Text bold>{value}</Text>
        <Button key={`${key}-more`} label="+" onPress={() => turn($, key, 1)} />
      </Box>
    )

    return (
      <Box flexDirection="column" rowGap={1}>
        <Text bold>Theme</Text>
        <Box flexDirection="row" columnGap={1} flexWrap="wrap">
          {THEMES.map(t => (
            <Button key={`theme-${t}`} label={LABEL[t]} variant={t === now ? 'primary' : 'secondary'} onPress={() => pick($, t)} />
          ))}
        </Box>
        {settings.theme !== now && <Text dimColor>{LABEL[settings.theme]} has nothing loaded yet: see the last lines.</Text>}
        <Text bold>How it shows</Text>
        {dial('clear', 'Panels see-through', `${settings.clear}%`)}
        {dial('blur', 'Blur behind panels', String(settings.blur))}
        {dial('dim', 'Scene dimming', `${settings.dim}%`)}
        <Box flexDirection="row" columnGap={1}>
          <Text>Motion</Text>
          {MOTIONS.map(m => (
            <Button key={`motion-${m}`} label={MOTION_LABEL[m]} variant={m === settings.motion ? 'primary' : 'secondary'} onPress={() => move($, m)} />
          ))}
        </Box>
        <Box flexDirection="row" columnGap={1}>
          <Text>Kiki time</Text>
          {KIKI_TIMES.map(t => (
            <Button key={`time-${t}`} label={KIKI_TIME_LABEL[t]} variant={t === settings.kikiTime ? 'primary' : 'secondary'} onPress={() => setKikiTime($, t)} />
          ))}
        </Box>
        <Text dimColor>Smooth: everything in the scene moves. Light: a calmer scene: Kiki's shooting star at rest, everything else moving, the lighthouse and the camera's gentle bob included; the black hole turning more slowly. The app stills it when Windows animation effects are off or it draws without the GPU. If it ever stands still, /wallpaper with no words draws it afresh.</Text>
        <Text dimColor>
          One setting covers every panel: the app gives a mod no way to set the sidebar apart, and it paints the sidebar solid.
        </Text>
        <Box flexDirection="row" columnGap={1}>
          <Text>App colors</Text>
          <Button key="colors" label={settings.colors ? 'On' : 'Off'} onPress={() => flip($, 'colors')} />
          <Text>Wallpaper</Text>
          <Button key="power" label={settings.isOn ? 'On' : 'Off'} onPress={() => flip($, 'isOn')} />
        </Box>
        <Text bold>Your own</Text>
        <Text dimColor>/wallpaper picture &lt;file&gt; traces a .png or .jpg into flat shapes. /wallpaper video &lt;file&gt; traces a short, soft loop from an .mp4 or .gif. Both need ffmpeg.</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    // The cat's face belongs to the looks the cat is in.
    const theme = drawn()
    if (!settings.isOn || !hasSpinner || theme !== 'kiki') return next(e)
    const face = FACE[e.props.mode] ?? '=^.^='
    return next({ ...e, props: { ...e.props, suffix: `${e.props.suffix} ${face}` } })
  })
}
