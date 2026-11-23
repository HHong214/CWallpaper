// Tests for the sun that times Kiki's day: hooks/wallpapers/kiki/sun.ts (`sunTimes`, `phaseAt`, `asPlace`), moved
// from hooks/kiki/sun.ts with the rebuild; the test is as it was, with the import moved.
//
// Until hooks/wallpapers/kiki/sun.ts exists this file fails to load as a whole.
import { expect, test } from 'claude-code/testing'

import { asPlace, phaseAt, sunTimes } from '../hooks/wallpapers/kiki/sun'

test('the kiki day turns with the sun: the default times with no place, the sun where you are with one', async () => {
  const at = (h: number, m = 0): number => Date.UTC(2026, 10, 15, h, m)
  // No place: sunrise 06:30, sunset 18:30. Sunset from 40 minutes before
  // sunrise to 30 after, and from an hour before sunset to 30 after.
  expect(sunTimes(at(12), 0)).toEqual({ sunrise: 390, sunset: 1110 })
  expect(phaseAt(at(5, 40), 0)).toBe('night')
  expect(phaseAt(at(6, 0), 0)).toBe('sunset')
  expect(phaseAt(at(12), 0)).toBe('day')
  expect(phaseAt(at(18, 20), 0)).toBe('sunset')
  expect(phaseAt(at(19, 0), 0)).toBe('night')
  // The same hours read an hour ahead of UTC.
  expect(phaseAt(at(5, 0), 3600)).toBe('sunset')
  expect(phaseAt(at(17, 20), 3600)).toBe('sunset')

  // Birmingham in mid-November: the weather service gave sunrise 07:29 and
  // sunset 16:14; the estimate keeps within ten minutes of them.
  const home = asPlace({ lat: 52.48, lon: -1.9, name: 'Birmingham, United Kingdom', source: 'ip', at: 0 })
  expect(home?.name).toBe('Birmingham, United Kingdom')
  const sun = sunTimes(at(12), 0, home)
  expect(Math.abs(sun.sunrise - 449) <= 10).toBe(true)
  expect(Math.abs(sun.sunset - 974) <= 10).toBe(true)
  expect(phaseAt(at(7, 0), 0, home)).toBe('sunset')
  expect(phaseAt(at(12), 0, home)).toBe('day')
  expect(phaseAt(at(16, 0), 0, home)).toBe('sunset')
  expect(phaseAt(at(17, 0), 0, home)).toBe('night')

  // What is not a place is none.
  expect(asPlace(undefined)).toBeUndefined()
  expect(asPlace({ lat: 'north', lon: 2 })).toBeUndefined()
  expect(asPlace({ lat: 95, lon: 2 })).toBeUndefined()
  expect(asPlace({ lat: 10, lon: 20 })?.name).toBe('10, 20')
})
