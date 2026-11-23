// The option model: what the mod's settings are, where the manifest keeps them
// (`userConfig` in .claude-plugin/plugin.json, written from `optionSpecs` by
// tools/sync-manifest.mjs) and how the values the engine hands `register` are
// read. Pure: no engine import, no clock, no store, never throws; junk in gives
// the default out.

/** A value an option holds. */
export type OptionValue = boolean | string | number

/**
 * One option. `key` is the manifest key ('motion', 'kikiTime'); a wallpaper's
 * own option keeps its SHORT key ('time') in `Wallpaper.options`, and
 * `optionSpecs` gives it its manifest key. A `choice` is written to the
 * manifest as `type: "string"` with `options`.
 */
export type OptionSpec = {
  key: string
  title: string
  description: string
  type: 'boolean' | 'choice' | 'number'
  default: OptionValue
  choices?: readonly string[]
  min?: number
  max?: number
}

export type Motion = 'smooth' | 'light' | 'off'

/** The settings, as `readSettings` reads them. */
export type Settings = {
  on: boolean
  wallpaper: string
  motion: Motion
  clear: number
  blur: number
  dim: number
  colors: boolean
  fps: boolean
  /** Each wallpaper's own values, by wallpaper id, then by SHORT key. */
  own: Record<string, Record<string, OptionValue>>
}

/** What `optionSpecs` and `readSettings` need of a wallpaper. */
export type HasOptions = { id: string; label?: string; options: readonly OptionSpec[] }

const spec = (o: OptionSpec): OptionSpec => Object.freeze({ ...o, ...(o.choices ? { choices: Object.freeze([...o.choices]) } : {}) })

/** The common options, in the manifest's order. */
export const COMMON: readonly OptionSpec[] = Object.freeze([
  spec({ key: 'wallpaper', title: 'Wallpaper', description: 'Which wallpaper the app shows.', type: 'choice', default: 'kiki' }),
  spec({ key: 'on', title: 'Wallpaper: on', description: 'Show the wallpaper and its colors, or leave the app its own look.', type: 'boolean', default: true }),
  spec({
    key: 'motion',
    title: 'Motion',
    description: "How the wallpaper moves: smooth (all of it), light (calmer: Kiki's shooting star rests, the black hole turns more slowly) or off (still).",
    type: 'choice',
    default: 'smooth',
    choices: ['smooth', 'light', 'off'],
  }),
  spec({ key: 'clear', title: 'Panels: how clear', description: 'How see-through the app panels are over the wallpaper: 0 is solid, 100 is clear.', type: 'number', default: 100, min: 0, max: 100 }),
  spec({ key: 'blur', title: 'Panels: blur', description: 'How far the panels blur the wallpaper behind them, 0 to 40.', type: 'number', default: 0, min: 0, max: 40 }),
  spec({ key: 'dim', title: 'Scene: dim', description: 'How much the wallpaper itself is darkened so words stand clear of it, 0 to 80.', type: 'number', default: 30, min: 0, max: 80 }),
  spec({ key: 'colors', title: 'App colors follow the wallpaper', description: 'Repaint the app in colors that match the wallpaper.', type: 'boolean', default: true }),
  spec({ key: 'fps', title: 'Show FPS', description: 'Draw the measured frames a second at the top left of the chat, on a wallpaper the app plays on the GPU.', type: 'boolean', default: false }),
])

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const isSpec = (v: unknown): v is OptionSpec => isRecord(v) && typeof v.key === 'string' && v.key !== '' && (v.type === 'boolean' || v.type === 'choice' || v.type === 'number')

/** The wallpapers of a list that can be read: an id and a list of options. */
function usable(wallpapers: unknown): HasOptions[] {
  if (!Array.isArray(wallpapers)) return []
  return wallpapers.filter((w): w is HasOptions => isRecord(w) && typeof w.id === 'string' && w.id !== '')
}

const ownSpecs = (w: HasOptions): OptionSpec[] => (Array.isArray(w.options) ? w.options.filter(isSpec) : [])

/** The manifest key of a wallpaper's own option: `kiki` and `time` give `kikiTime`. */
export const manifestKey = (id: string, key: string): string => `${id}${key.charAt(0).toUpperCase()}${key.slice(1)}`

/** A wallpaper's own option title, led by its label and a colon. */
function ownTitle(label: string, title: string): string {
  const lead = `${label}: `
  return title.startsWith(lead) ? title : `${lead}${title}`
}

/** The full list of options, with manifest keys: the common ones, then each wallpaper's own, in order. */
export function optionSpecs(wallpapers: readonly HasOptions[]): OptionSpec[] {
  const list = usable(wallpapers)
  const common = COMMON.map(o => (o.key === 'wallpaper' ? { ...o, choices: list.map(w => w.id) } : { ...o, ...(o.choices ? { choices: [...o.choices] } : {}) }))
  const own = list.flatMap(w =>
    ownSpecs(w).map(o => ({
      ...o,
      key: manifestKey(w.id, o.key),
      title: ownTitle(typeof w.label === 'string' && w.label !== '' ? w.label : w.id, String(o.title ?? o.key)),
      description: String(o.description ?? ''),
      ...(o.choices ? { choices: [...o.choices] } : {}),
    })),
  )
  return [...common, ...own]
}

/** One value read by its spec: the default when it is missing, mistyped or out of its choices. */
export function readValue(o: OptionSpec, v: unknown): OptionValue {
  if (o.type === 'boolean') return typeof v === 'boolean' ? v : o.default
  if (o.type === 'choice') return typeof v === 'string' && (o.choices ?? []).includes(v) ? v : o.default
  if (typeof v !== 'number' || !Number.isFinite(v)) return o.default
  const lo = typeof o.min === 'number' ? o.min : -Infinity
  const hi = typeof o.max === 'number' ? o.max : Infinity
  return Math.min(hi, Math.max(lo, Math.round(v))) + 0
}

/** What the settings hold for one manifest key ('dim', 'kikiTime'); undefined for a key no option has. */
export function optionValue(settings: Settings, key: string, wallpapers: readonly HasOptions[]): OptionValue | undefined {
  if (!isRecord(settings) || typeof key !== 'string') return undefined
  const plain = (v: unknown): OptionValue | undefined => (typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number' ? v : undefined)
  if (COMMON.some(o => o.key === key)) return plain((settings as Record<string, unknown>)[key])
  for (const w of usable(wallpapers)) {
    for (const o of ownSpecs(w)) {
      if (manifestKey(w.id, o.key) !== key) continue
      const own = isRecord(settings.own) ? settings.own[w.id] : undefined
      return plain(isRecord(own) ? own[o.key] : undefined)
    }
  }
  return undefined
}

const common = (key: string): OptionSpec => COMMON.find(o => o.key === key) as OptionSpec

/** The typed settings from the options the engine hands `register(on, options)`. */
export function readSettings(options: unknown, wallpapers: readonly HasOptions[]): Settings {
  const given = isRecord(options) ? options : {}
  const list = usable(wallpapers)
  const pick = (key: string): OptionValue => readValue(common(key), given[key])
  const named = given.wallpaper
  const own: Record<string, Record<string, OptionValue>> = {}
  for (const w of list) {
    const values: Record<string, OptionValue> = {}
    for (const o of ownSpecs(w)) values[o.key] = readValue(o, given[manifestKey(w.id, o.key)])
    own[w.id] = values
  }
  return {
    on: pick('on') as boolean,
    wallpaper: typeof named === 'string' && list.some(w => w.id === named) ? named : 'kiki',
    motion: pick('motion') as Motion,
    clear: pick('clear') as number,
    blur: pick('blur') as number,
    dim: pick('dim') as number,
    colors: pick('colors') as boolean,
    fps: pick('fps') as boolean,
    own,
  }
}
