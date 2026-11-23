// Which rows the settings pane shows, as plain data; register.tsx draws them.
// Pure: no engine import, no clock, no store, never throws. Every control names
// the manifest key and the value pressing it writes, and writes nothing else.
import { COMMON, manifestKey, readValue } from './options.ts'
import type { OptionSpec, OptionValue, Settings } from './options.ts'
import { ownName } from './commands.ts'
import { currentWallpaper } from './registry.ts'
import type { Wallpaper } from './registry.ts'

export type Control = {
  /** The manifest key it writes ('wallpaper', 'motion', 'clear', 'kikiTime', ...). */
  key: string
  /** The value pressing it writes (for a toggle, the opposite of today's). */
  value: OptionValue
  /** What the button says. */
  label: string
  /** True on the button whose value is the setting's today (choices only). */
  current?: boolean
  /** On a wallpaper's control while the wallpaper is off: the second write a press makes, after `wallpaper`. */
  also?: { key: 'on'; value: true }
}

export type PaneRow =
  | { kind: 'controls'; label: string; controls: Control[]; value?: string }
  | { kind: 'heading'; text: string }
  | { kind: 'note'; text: string }

/** How far one press of a minus or a plus moves each number, as 1.9.0's pane had it. */
const STEPS: Record<string, number> = { clear: 10, blur: 4, dim: 10 }

const common = (key: string): OptionSpec => COMMON.find(o => o.key === key) as OptionSpec
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const onOff = (v: unknown): string => (v === true ? 'On' : 'Off')

const choiceRow = (label: string, key: string, choices: readonly string[], today: unknown): PaneRow => ({
  kind: 'controls',
  label,
  controls: choices.map(c => ({ key, value: c, label: cap(c), ...(c === today ? { current: true } : {}) })),
})
const toggleRow = (label: string, key: string, today: unknown): PaneRow => ({
  kind: 'controls',
  label,
  value: onOff(today),
  controls: [{ key, value: today !== true, label: today === true ? 'Turn off' : 'Turn on' }],
})
function dialRow(label: string, key: string, o: OptionSpec, today: number, step: number, unit: string): PaneRow {
  const lo = o.min ?? 0
  const hi = o.max ?? 0
  const held = (v: number): number => Math.min(hi, Math.max(lo, v))
  return {
    kind: 'controls',
    label,
    value: `${today}${unit}`,
    controls: [
      { key, value: held(today - step), label: '-' },
      { key, value: held(today + step), label: '+' },
    ],
  }
}

function rows(settings: Settings, wallpapers: readonly Wallpaper[]): PaneRow[] {
  const all = Array.isArray(wallpapers) ? wallpapers.filter(w => w && typeof w.id === 'string') : []
  const s = settings && typeof settings === 'object' ? settings : ({} as Settings)
  const w = currentWallpaper(s, all)
  const num = (key: string): number => readValue(common(key), s[key as 'clear']) as number
  const out: PaneRow[] = [
    {
      kind: 'controls',
      label: 'Wallpaper',
      // While the wallpaper is off, choosing one also switches it on, as the command does.
      controls: all.map(x => ({
        key: 'wallpaper',
        value: x.id,
        label: x.label,
        ...(x === w ? { current: true } : {}),
        ...(s.on === false ? { also: { key: 'on' as const, value: true as const } } : {}),
      })),
    },
    toggleRow('Wallpaper shown', 'on', s.on !== false),
    choiceRow('Motion', 'motion', common('motion').choices ?? [], s.motion),
    dialRow('Panels see-through', 'clear', common('clear'), num('clear'), STEPS.clear ?? 10, '%'),
    dialRow('Blur behind panels', 'blur', common('blur'), num('blur'), STEPS.blur ?? 4, ''),
    dialRow('Scene dimming', 'dim', common('dim'), num('dim'), STEPS.dim ?? 10, '%'),
    toggleRow('App colors', 'colors', s.colors !== false),
    toggleRow('Show FPS', 'fps', s.fps === true),
  ]
  if (w === undefined) return out
  if (w.kind === 'svg' && s.fps === true) {
    out.push({ kind: 'note', text: 'The frame rate of this wallpaper cannot be measured: the app animates it itself, not on the GPU.' })
  }
  if (w.kind === 'shader' && s.fps === true) {
    out.push({ kind: 'note', text: 'Drawn at the top left of the chat.' })
  }
  const own = Array.isArray(w.options) ? w.options.filter(o => o && typeof o.key === 'string') : []
  out.push({ kind: 'heading', text: own.length > 0 ? w.label : `${w.label}: no settings of its own` })
  const values = (s.own && s.own[w.id]) || {}
  for (const o of own) {
    const key = manifestKey(w.id, o.key)
    const today = readValue(o, values[o.key])
    const label = ownName(w, o)
    if (o.type === 'choice') out.push(choiceRow(label, key, o.choices ?? [], today))
    else if (o.type === 'boolean') out.push(toggleRow(label, key, today))
    else {
      const span = (o.max ?? 0) - (o.min ?? 0)
      out.push(dialRow(label, key, o, today as number, Math.max(1, Math.round(span / 10)), ''))
    }
  }
  return out
}

/** The rows of the settings pane, in order, for these settings. */
export function paneRows(settings: Settings, wallpapers: readonly Wallpaper[]): PaneRow[] {
  try {
    return rows(settings, wallpapers)
  } catch {
    return []
  }
}
