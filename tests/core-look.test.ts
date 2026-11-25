// Tests for W3, the fallback of the look (CONTRACT-wallpaper.md W3 and W-d3, with WORKED.md part 3): the pure
// function `setLook` of hooks/core/look.ts. The test kit cannot make the mod's own `$.theme.set` fail, so the
// decision lives in a function that is handed its two outside calls. Written before the code: until
// hooks/core/look.ts exists this file fails to load as a whole.
//
// NAMES THIS FILE PINS (WORKED.md part 3):
//   export type LookIo = { set: (look: Look) => Promise<{ isDrawn: boolean; reason?: string }>; toast: (text: string) => void }
//   export type LookSet = { isSet: boolean; why: string }
//   export async function setLook(io: LookIo, look: Look): Promise<LookSet>
// It calls `io.set(look)`. Answered: `{ isSet: true, why }`, `why` '' when drawn, else the reason. Thrown with a
// message that holds `scene`: exactly one more call, the same look with `backdrop.id` in place of `backdrop.scene`
// and every other key equal; its answer is treated the same way, and a second throw like any other error. Any other
// error: no further call, `io.toast` once with a text holding the message, `{ isSet: false, why: <the message> }`.
// A thrown value that is not an Error is read as its text. It never throws and never changes the look it is given.
import { expect, test } from 'claude-code/testing'

import { setLook } from '../hooks/core/look'

type Answer = { isDrawn: boolean; reason?: string }
type Look = Record<string, unknown> & { backdrop?: Record<string, unknown> }

const GLASS = { blur: 0.1, opacity: 0.01, tint: 'rgba(0,0,0,0)' }
const COLORS = { label: 'Black hole', roles: { accent: '#D97757' }, dark: { gray: { anchors: ['#000000', '#ffffff'] } } }
const LOOK = (): Look => ({ backdrop: { scene: 'blackhole', glass: { ...GLASS } }, colors: JSON.parse(JSON.stringify(COLORS)), overrideColorScheme: 'dark' })
const SCENE_ERROR = "unknown key 'scene' in backdrop"
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** An io whose n-th `set` gives the n-th answer: an Answer is returned, anything else is thrown. */
function rig(answers: unknown[]) {
  const calls: Look[] = []
  const toasts: string[] = []
  const io = {
    set: async (look: Look): Promise<Answer> => {
      calls.push(copy(look))
      const a = answers[calls.length - 1]
      if (a && typeof a === 'object' && 'isDrawn' in a) return a as Answer
      if (a === undefined) return { isDrawn: true }
      throw a
    },
    toast: (text: string): void => { toasts.push(String(text)) },
  }
  return { calls, toasts, io }
}

const run = (io: unknown, look: Look) => setLook(io as never, look as never)

test('W-d3: answered at once: one call with the look, no toast, isSet true and why empty', async () => {
  const r = rig([{ isDrawn: true }])
  const got = await run(r.io, LOOK())
  expect(got).toEqual({ isSet: true, why: '' })
  expect(r.calls).toEqual([LOOK()])
  expect(r.toasts).toEqual([])
})

test('W-d3: answered but not drawn: one call, no toast, isSet true and why the reason', async () => {
  const r = rig([{ isDrawn: false, reason: 'the backdrop is hidden' }])
  const got = await run(r.io, LOOK())
  expect(got).toEqual({ isSet: true, why: 'the backdrop is hidden' })
  expect(r.calls.length).toBe(1)
  expect(r.toasts).toEqual([])
})

test('W-d3: thrown naming scene, then answered: exactly two calls, the second the same look with the scene as id, no toast', async () => {
  const r = rig([new Error(SCENE_ERROR), { isDrawn: true }])
  const got = await run(r.io, LOOK())
  expect(got).toEqual({ isSet: true, why: '' })
  expect(r.calls.length).toBe(2)
  expect(r.calls[0]).toEqual(LOOK())
  // The second: backdrop.id in place of backdrop.scene; the glass, the colours and the scheme kept.
  expect(r.calls[1]).toEqual({ backdrop: { id: 'blackhole', glass: GLASS }, colors: COLORS, overrideColorScheme: 'dark' })
  expect('scene' in (r.calls[1]?.backdrop ?? {})).toBe(false)
  expect(r.toasts).toEqual([])
})

test('W-d3: thrown naming scene, with a look that names no scheme: the second call names none either', async () => {
  const r = rig([new Error(SCENE_ERROR), { isDrawn: true }])
  const look: Look = { backdrop: { scene: 'kiki', glass: false }, colors: { label: 'Kiki night' } }
  await run(r.io, look)
  expect(r.calls[1]).toEqual({ backdrop: { id: 'kiki', glass: false }, colors: { label: 'Kiki night' } })
  expect('overrideColorScheme' in (r.calls[1] ?? {})).toBe(false)
})

test('W-d3: thrown naming scene twice: two calls, one toast, isSet false', async () => {
  const r = rig([new Error(SCENE_ERROR), new Error(SCENE_ERROR)])
  const got = await run(r.io, LOOK())
  expect(r.calls.length).toBe(2)
  expect(r.toasts.length).toBe(1)
  expect(got.isSet).toBe(false)
  expect(got.why.includes('scene')).toBe(true)
})

test('W-d3: thrown with another message: one call, one toast holding the message, isSet false and why the message', async () => {
  const r = rig([new Error('the app is busy')])
  const got = await run(r.io, LOOK())
  expect(r.calls.length).toBe(1)
  expect(r.toasts.length).toBe(1)
  expect(r.toasts[0]?.includes('the app is busy')).toBe(true)
  expect(got).toEqual({ isSet: false, why: 'the app is busy' })
})

test('W-d3: a thrown string is read as its text: another text is not tried again, one naming scene is', async () => {
  const other = rig(['the app is busy'])
  expect(await run(other.io, LOOK())).toEqual({ isSet: false, why: 'the app is busy' })
  expect(other.calls.length).toBe(1)
  expect(other.toasts.length).toBe(1)
  expect(other.toasts[0]?.includes('the app is busy')).toBe(true)
  const scene = rig([SCENE_ERROR, { isDrawn: true }])
  expect(await run(scene.io, LOOK())).toEqual({ isSet: true, why: '' })
  expect(scene.calls.length).toBe(2)
  expect(scene.toasts).toEqual([])
})

test('W-d3: the look passed in is unchanged afterwards, on every path', async () => {
  for (const answers of [[{ isDrawn: true }], [new Error(SCENE_ERROR), { isDrawn: true }], [new Error(SCENE_ERROR), new Error(SCENE_ERROR)], [new Error('the app is busy')]]) {
    const look = LOOK()
    const before = copy(look)
    await run(rig(answers).io, look)
    expect(look).toEqual(before)
    expect('scene' in (look.backdrop ?? {})).toBe(true)
  }
})
