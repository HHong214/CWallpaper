// Which part of the day the kiki scene shows in `auto`: the sun's times where
// you are, estimated from the date and the place, read on the machine's clock.
// Pure maths: no `$`, no network and no clock of its own, every input is an
// argument. Kept from the pixel valley's almanac when the valley was taken
// out, so the scene turns at the same moments it did.
import type { Phase } from './types'

/** Where the sun is reckoned from: degrees north and east, and a name to show. */
export type Place = { lat: number; lon: number; name: string }

const DAY_MINUTES = 1440
/** The sun times with no place known: 06:30 and 18:30. */
export const DEFAULT_SUNRISE = 390
export const DEFAULT_SUNSET = 1110

const mod = (n: number, m: number): number => ((n % m) + m) % m

/** A place as it was kept in the store, or undefined when it is not one. */
export function asPlace(v: unknown): Place | undefined {
  if (v === null || typeof v !== 'object') return undefined
  const { lat, lon, name } = v as Record<string, unknown>
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return undefined
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined
  return { lat, lon, name: typeof name === 'string' && name.trim() !== '' ? name.trim().slice(0, 80) : `${lat}, ${lon}` }
}

/** Day of the year, 1..366, of a local date given by its UTC fields. */
function dayOfYear(local: Date): number {
  const y = local.getUTCFullYear()
  return Math.round((Date.UTC(y, local.getUTCMonth(), local.getUTCDate()) - Date.UTC(y, 0, 1)) / 86_400_000) + 1
}

/**
 * Sunrise and sunset in local minutes since midnight, estimated from the date
 * and the place's latitude (its longitude and the UTC offset give the time of
 * solar noon). With no place, 06:30 and 18:30. Polar day and night are clamped
 * to a day of 1 to 23 hours, so the scene still turns.
 */
export function sunTimes(epochMs: number, offsetSec: number, place?: Place): { sunrise: number; sunset: number } {
  if (!place) return { sunrise: DEFAULT_SUNRISE, sunset: DEFAULT_SUNSET }
  const n = dayOfYear(new Date(epochMs + offsetSec * 1000))
  const rad = Math.PI / 180
  const decl = -23.44 * Math.cos(((2 * Math.PI) / 365) * (n + 10)) * rad
  const phi = Math.max(-89.9, Math.min(89.9, place.lat)) * rad
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(phi) * Math.sin(decl)) / (Math.cos(phi) * Math.cos(decl))
  const w = Math.acos(Math.max(-1, Math.min(1, cosW))) / rad
  const half = Math.max(30, Math.min(690, w * 4))
  const b = ((2 * Math.PI) / 364) * (n - 81)
  const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b)
  const noon = 720 - 4 * place.lon - eot + offsetSec / 60
  return { sunrise: Math.round(mod(noon - half, DAY_MINUTES)), sunset: Math.round(mod(noon + half, DAY_MINUTES)) }
}

/**
 * The phase at `epochMs`, its local time read with `offsetSec` and floored to
 * ten minutes. Sunset runs from 40 minutes before sunrise to 30 after it, and
 * from an hour before sunset to 30 minutes after; day lies between them; the
 * rest is night. The windows are the valley's dawn, morning, noon, afternoon
 * and dusk, tried in that order, so a very short day never leaves a gap.
 */
export function phaseAt(epochMs: number, offsetSec: number, place?: Place): Phase {
  const minutes = Math.floor(mod(Math.floor((epochMs + offsetSec * 1000) / 60_000), DAY_MINUTES) / 10) * 10
  const { sunrise, sunset } = sunTimes(epochMs, offsetSec, place)
  const set = sunset <= sunrise ? sunset + DAY_MINUTES : sunset
  const noon = (sunrise + set) / 2
  const windows: readonly (readonly [Phase, number, number])[] = [
    ['sunset', sunrise - 40, sunrise + 30],
    ['day', sunrise + 30, noon - 90],
    ['day', noon - 90, noon + 90],
    ['day', noon + 90, set - 60],
    ['sunset', set - 60, set + 30],
  ]
  for (const [phase, start, end] of windows) {
    const length = end - start
    if (length > 0 && length < DAY_MINUTES && mod(minutes - start, DAY_MINUTES) < length) return phase
  }
  return 'night'
}
