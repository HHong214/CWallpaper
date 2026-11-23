// `/wallpaper ...` text to one action, and the texts the command answers with.
// Pure: no engine import, no clock, no store, never throws; junk in gives the
// default out. The mod (register.tsx) carries the action out.
import { COMMON, manifestKey, readValue } from './options.ts'
import type { OptionSpec, OptionValue, Settings } from './options.ts'
import { currentWallpaper, findWallpaper } from './registry.ts'
import type { Wallpaper } from './registry.ts'

export type Action =
  | { kind: 'status' }
  | { kind: 'help' }
  | { kind: 'pane' }
  | { kind: 'set'; key: string; value: OptionValue; also?: Action | Action[] }
  | { kind: 'error'; message: string }

const HELP_POINTER = '/wallpaper help lists every command.'
const REMOVED =
  'Pictures and videos of your own were removed from the wallpaper mod: wallpapers are now made in the repository, as code.'

const common = (key: string): OptionSpec => COMMON.find(o => o.key === key) as OptionSpec
const list = (wallpapers: unknown): Wallpaper[] => (Array.isArray(wallpapers) ? wallpapers.filter(w => w && typeof w.id === 'string') : [])
const ownOf = (w: Wallpaper): OptionSpec[] => (Array.isArray(w.options) ? w.options.filter(o => o && typeof o.key === 'string') : [])

/** A wallpaper's own option's name without the wallpaper's label: "Kiki: time of day" gives "Time of day". */
export function ownName(w: Wallpaper, o: OptionSpec): string {
  const title = typeof o.title === 'string' && o.title !== '' ? o.title : o.key
  const lead = `${w.label}: `
  const bare = title.startsWith(lead) ? title.slice(lead.length) : title
  return bare.charAt(0).toUpperCase() + bare.slice(1)
}

/** What an option takes, in words: "on or off", "a whole number from 0 to 100", "smooth, light or off". */
function takes(o: OptionSpec): string {
  if (o.type === 'boolean') return 'on or off'
  if (o.type === 'number') return `a whole number from ${o.min ?? 0} to ${o.max ?? 0}`
  const choices = [...(o.choices ?? [])]
  return choices.length < 2 ? choices.join('') : `${choices.slice(0, -1).join(', ')} or ${choices.at(-1)}`
}

/** One value typed for an option, or undefined when the option does not take it. */
function parseValue(o: OptionSpec, words: string[]): OptionValue | undefined {
  if (words.length !== 1) return undefined
  const word = words[0] ?? ''
  if (o.type === 'boolean') return word === 'on' ? true : word === 'off' ? false : undefined
  if (o.type === 'choice') return (o.choices ?? []).includes(word) ? word : undefined
  if (!/^-?\d+$/.test(word)) return undefined
  const n = Number(word)
  const lo = o.min ?? -Infinity
  const hi = o.max ?? Infinity
  return Number.isSafeInteger(n) && n >= lo && n <= hi ? n : undefined
}

const set = (key: string, value: OptionValue): Action => ({ kind: 'set', key, value })
const error = (message: string): Action => ({ kind: 'error', message })

function parse(text: unknown, settings: Settings, wallpapers: readonly Wallpaper[]): Action {
  const words = (typeof text === 'string' ? text : '').trim().split(/\s+/).filter(w => w !== '')
  const typed = words[0] ?? ''
  const verb = typed.toLowerCase()
  const rest = words.slice(1).map(w => w.toLowerCase())
  const all = list(wallpapers)
  const isOn = settings && typeof settings === 'object' ? settings.on !== false : true
  const unknown = (): Action => error(`There is no "${words.join(' ').slice(0, 80)}" for /wallpaper. ${HELP_POINTER}`)

  if (verb === '') return { kind: 'status' }
  if (verb === 'picture' || verb === 'video' || verb === 'image') return error(REMOVED)
  if (verb === 'help' || verb === 'settings') return rest.length === 0 ? { kind: verb === 'help' ? 'help' : 'pane' } : unknown()
  if (verb === 'on' || verb === 'off') return rest.length === 0 ? set('on', verb === 'on') : unknown()

  // The common settings.
  if (['motion', 'clear', 'blur', 'dim', 'colors', 'fps'].includes(verb)) {
    const o = common(verb)
    const value = parseValue(o, rest)
    return value === undefined ? error(`${verb} takes ${takes(o)}: /wallpaper ${verb} <${o.type === 'number' ? `${o.min}-${o.max}` : (o.type === 'boolean' ? ['on', 'off'] : [...(o.choices ?? [])]).join('|')}>.`) : set(verb, value)
  }

  // A wallpaper by its name.
  const named = findWallpaper(typed, all)
  if (named !== undefined) {
    if (rest.length > 0) return unknown()
    const action: Action = { kind: 'set', key: 'wallpaper', value: named.id }
    return isOn ? action : { ...action, also: set('on', true) }
  }

  // One of the current wallpaper's own options, by its short key.
  const current = currentWallpaper(settings, all)
  const mine = current ? ownOf(current).find(o => o.key.toLowerCase() === verb) : undefined
  if (current && mine) {
    const value = parseValue(mine, rest)
    return value === undefined ? error(`${mine.key} takes ${takes(mine)} (${ownName(current, mine)}).`) : set(manifestKey(current.id, mine.key), value)
  }

  // One of another wallpaper's.
  for (const w of all) {
    if (w === current) continue
    const theirs = ownOf(w).find(o => o.key.toLowerCase() === verb)
    if (theirs) return error(`${ownName(w, theirs)} belongs to ${w.label}. The wallpaper is ${current?.label ?? 'none'}.`)
  }
  return unknown()
}

/** The action `/wallpaper <text>` asks for. */
export function parseCommand(text: string, settings: Settings, wallpapers: readonly Wallpaper[]): Action {
  try {
    return parse(text, settings, wallpapers)
  } catch {
    return error(`That could not be read. ${HELP_POINTER}`)
  }
}

const word = (v: unknown): string => (v === true ? 'on' : v === false ? 'off' : String(v))

/** What `/wallpaper` with no words says: one or two plain lines. */
export function statusText(settings: Settings, wallpapers: readonly Wallpaper[]): string {
  try {
    const all = list(wallpapers)
    const w = currentWallpaper(settings, all)
    const label = w?.label ?? 'none'
    if (!settings.on) return `The wallpaper is off. /wallpaper on brings back ${label}.`
    const own = w ? ownOf(w) : []
    const values = (w && settings.own && settings.own[w.id]) || {}
    const mine = own.map(o => `${label} ${o.key}: ${word(readValue(o, values[o.key]))}`)
    const first = [`The wallpaper is ${label}.`, mine.length ? `${mine.join('; ')}.` : ''].filter(s => s !== '').join(' ')
    const dials = `Panels ${settings.clear}% clear, blur ${settings.blur}, scene dimmed ${settings.dim}%, app colors ${word(settings.colors)}, motion ${settings.motion}.`
    return `${first}\n${dials}${settings.fps ? ' Show FPS on.' : ''}`
  } catch {
    return 'The wallpaper could not say what it shows just now.'
  }
}

const pad = (left: string, right: string): string => `  ${left.padEnd(30)} ${right}`

/** Every command, and the wallpapers by name. */
export function helpText(wallpapers: readonly Wallpaper[]): string {
  const all = list(wallpapers)
  const lines = [
    'Usage: /wallpaper [command]',
    pad('(none)', 'what is drawn now; also draws it afresh'),
    pad('settings', 'open the settings pane'),
    pad('help', 'this list'),
    pad('on | off', 'show or take off the wallpaper and its colors'),
  ]
  for (const w of all) {
    const also = (Array.isArray(w.aliases) ? w.aliases : []).filter(a => typeof a === 'string')
    lines.push(pad(w.id, `the wallpaper ${w.label}${also.length ? ` (also ${also.join(', ')})` : ''}`))
  }
  lines.push(
    pad('motion smooth|light|off', 'how it moves: all of it, calmer, or still'),
    pad(`clear <${common('clear').min}-${common('clear').max}>`, 'how see-through the app panels are'),
    pad(`blur <${common('blur').min}-${common('blur').max}>`, 'how far the panels blur the wallpaper'),
    pad(`dim <${common('dim').min}-${common('dim').max}>`, 'how much the wallpaper is darkened'),
    pad('colors on|off', 'repaint the app in the wallpaper\'s colors, or keep its own'),
    pad('fps on|off', 'show the frame rate of a wallpaper played on the GPU'),
  )
  for (const w of all) {
    const own = ownOf(w)
    if (own.length === 0) continue
    lines.push(`While ${w.label} is the wallpaper:`)
    for (const o of own) {
      const values = o.type === 'number' ? `<${o.min}-${o.max}>` : o.type === 'boolean' ? 'on|off' : [...(o.choices ?? [])].join('|')
      lines.push(pad(`${o.key} ${values}`, ownName(w, o).toLowerCase()))
    }
  }
  lines.push('The same settings are in the app\'s plugin options.')
  return lines.join('\n')
}
