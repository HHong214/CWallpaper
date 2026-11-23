// Tests for Kiki's own look and motion: the picture `kiki.svg(settings, now)` of hooks/wallpapers/kiki/index.ts
// (the Wallpaper `kiki` of the registry, core-registry.test.ts). In 1.9.0 these two tests drew the picture through
// the Backdrop after `/wallpaper time night` and `/wallpaper motion ...`; the Backdrop passes the picture on as it
// is, so they now ask for the picture itself, with settings built by hand (the shape of core-options.test.ts).
// Every rule they pin is the old test's, unchanged: every moving part has its rule, the sea and the clouds glide,
// motion light rests only the shooting star, the night sky is alive, the sea keeps no glitter column, the small
// clouds are round underneath, and the camera bobs the world but not Kiki.
//
// Until hooks/wallpapers/kiki/index.ts exists this file fails to load as a whole.
import { expect, test } from 'claude-code/testing'

import { kiki } from '../hooks/wallpapers/kiki/index'

// The picture is as the mod draws it, without the invisible mark a wake draw adds to a moving one.
const WAKE_MARK = /<g id="kw[0-9a-z]+"\/>/g
const bare = (source: string): string => source.replace(WAKE_MARK, '')
// Local noon; the time of day is given, so the clock does not matter.
const NOON = new Date(2026, 5, 15, 12, 0, 0).getTime()

/** The settings of Kiki on, as `readSettings({})` gives them, with a motion and a time of day. */
const settingsOf = (motion: string, time: string) =>
  ({
    on: true,
    wallpaper: 'kiki',
    motion,
    clear: 100,
    blur: 0,
    dim: 30,
    colors: true,
    fps: false,
    own: { kiki: { time, spinner: true }, blackhole: {} },
  }) as never

test('every moving part has its rule, the sea and clouds glide, and motion light rests only the shooting star', () => {
  // The picture Kiki's wallpaper makes at night in a motion, as the mod draws it (without the wake marks).
  const picture = (motion: string): string => bare(kiki.svg(settingsOf(motion, 'night'), NOON))
  const rects = (s: string): number => (s.match(/v\d+h-\d+z/g) ?? []).length
  // The classes a picture animates, Kiki's own (h-) or the world's.
  const animated = (s: string): Set<string> => new Set([...s.matchAll(/class="([^"]+)"/g)].flatMap(m => (m[1] ?? '').split(' ')))
  // Kiki's own group, <g class="h-fl"> to its matching </g>.
  const kikiOf = (s: string): string => {
    const start = s.indexOf('<g class="h-fl">')
    if (start < 0) return ''
    let depth = 0
    for (let i = start; i < s.length; ) {
      if (s.startsWith('</g>', i)) {
        depth -= 1
        i += 4
        if (depth === 0) return s.slice(start, i)
      } else if (s.startsWith('<g', i) && /[\s>]/.test(s[i + 2] ?? '')) {
        depth += 1
        i += 2
      } else {
        i += 1
      }
    }
    return ''
  }
  // Every class the picture animates has its rule in its sheet (a part whose
  // rule went missing, as the sea's once did, would stand still).
  const unruled = (s: string): string[] => {
    const css = [...s.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1] ?? '').join('')
    return [...animated(s)].filter(c => c !== 'h-z' && !css.includes(`.${c}{animation:`))
  }

  const smooth = picture('smooth')
  expect(smooth.startsWith('<svg')).toBe(true)
  expect(unruled(smooth)).toEqual([])
  // Smooth: the clouds drift (two strips, each drawn twice).
  expect(smooth.includes('<use')).toBe(true)
  // The rule each class runs, by its keyframes' name, and a keyframes' whole text.
  const sheetOf = (s: string): string => [...s.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1] ?? '').join('')
  const rulesOf = (s: string): Map<string, string> =>
    new Map([...sheetOf(s).matchAll(/\.([\w-]+)\{animation:([^}]*)\}/g)].map(m => [m[1] ?? '', m[2] ?? ''] as const))
  const keyframesOf = (s: string, name: string): string => {
    const css = sheetOf(s)
    const at = css.indexOf(`@keyframes ${name}{`)
    if (at < 0) return ''
    let depth = 0
    for (let i = css.indexOf('{', at); i < css.length; i += 1) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}' && (depth -= 1) === 0) return css.slice(at, i + 1)
    }
    return ''
  }
  // The sea's crests glide: three bands (far, middle, near), each a linear
  // slide over one 64-px repeat that ends where the next repeat starts, so the
  // loop has no jump, and no step-end anywhere on it: about 1.5, 2.5 and 4 art
  // pixels a second. The art px a second of each band's glide:
  const glide = (s: string): number[] =>
    [...rulesOf(s).values()].filter(r => r.startsWith('w-sw ')).map(r => {
      expect(r).toMatch(/^w-sw [\d.]+s linear infinite( -[\d.]+s)?$/)
      return 64 / Number(/^w-sw ([\d.]+)s/.exec(r)?.[1])
    })
  expect(glide(smooth).map(v => Math.round(v * 10) / 10).sort((a, b) => a - b)).toEqual([1.5, 2.5, 4])
  expect(keyframesOf(smooth, 'w-sw')).toBe('@keyframes w-sw{to{transform:translateX(64px)}}')
  // The cloud strips drift linearly, the far one over 110 s, the near one over 70 s.
  const drift = (s: string): string[] => [...rulesOf(s).values()].filter(r => r.startsWith('w-dr ')).sort()
  expect(drift(smooth)).toEqual(['w-dr 110s linear infinite', 'w-dr 70s linear infinite'])
  expect(keyframesOf(smooth, 'w-dr')).toBe('@keyframes w-dr{to{transform:translateX(320px)}}')
  // Night smooth has the beam's sweep (six frames over 4.8 s) and the shooting star.
  const flashes = (s: string): string[] => [...rulesOf(s).values()].filter(r => /^w-f6-\d 4\.8s /.test(r) || r.startsWith('w-ss '))
  expect(flashes(smooth).length).toBe(7)
  expect(keyframesOf(smooth, 'w-ss').length > 0).toBe(true)

  const light = picture('light')
  expect(light.startsWith('<svg')).toBe(true)
  expect(unruled(light)).toEqual([])
  // Light: calmer, not still. The sea's crests glide and the cloud strips
  // drift just as in smooth (the same rules, the strips each drawn twice);
  // only the shooting star rests; the lighthouse sweeps and the camera bobs as
  // in smooth. Everything it animates smooth animates too, and Kiki and the
  // cat move the same in both.
  expect(light.includes('<use')).toBe(true)
  for (const id of ['w-cf', 'w-cn']) expect(light.includes(`<use href="#${id}"/>`)).toBe(true)
  expect(glide(light).sort((a, b) => a - b)).toEqual(glide(smooth).sort((a, b) => a - b))
  expect(keyframesOf(light, 'w-sw')).toBe(keyframesOf(smooth, 'w-sw'))
  expect(drift(light)).toEqual(drift(smooth))
  expect(keyframesOf(light, 'w-dr')).toBe(keyframesOf(smooth, 'w-dr'))
  // The lighthouse: the same six-frame sweep as smooth; the shooting star alone is gone.
  const sweep = (s: string): string[] => flashes(s).filter(r => r.startsWith('w-f6-')).sort()
  expect(sweep(light).length).toBe(6)
  expect(sweep(light)).toEqual(sweep(smooth))
  expect(flashes(light).some(r => r.startsWith('w-ss '))).toBe(false)
  expect(keyframesOf(light, 'w-ss')).toBe('')
  // The camera bobs in light as in smooth, by the same rule (read in the
  // sheet's text: the reduced-motion rule reuses the camera's class).
  expect(sheetOf(smooth).includes('{animation:w-cam ')).toBe(true)
  expect(keyframesOf(light, 'w-cam')).toBe(keyframesOf(smooth, 'w-cam'))
  expect(sheetOf(light).includes('{animation:w-cam 4.2s ease-in-out infinite alternate -3.15s}')).toBe(true)
  expect([...animated(light)].every(c => animated(smooth).has(c))).toBe(true)
  expect(animated(light).size < animated(smooth).size).toBe(true)
  expect(rects(light) < rects(smooth)).toBe(true)
  expect(light.length < smooth.length).toBe(true)
  expect(kikiOf(light).length > 0 && kikiOf(light) === kikiOf(smooth)).toBe(true)
  // The beam's frames are drawn in light just as in smooth: its first frame
  // (w-f6-0 at 4.8s) sits in a group of its own that sweeps.
  const beamClass = smooth.match(/\.(w-[0-9a-z]+)\{animation:w-f6-0 4\.8s /)?.[1] ?? ''
  const beamFirst = smooth.match(new RegExp(`<g class="${beamClass}">([\\s\\S]*?)</g>`))?.[1] ?? ''
  expect(beamClass.length > 0 && beamFirst.length > 0).toBe(true)
  expect(light.includes(`>${beamFirst}</g>`)).toBe(true)

  // The night sky is alive.
  // Every filled pixel of a picture's paths, with whether it lies inside an
  // animated group (one with a class; the shared defs and the sheet left out).
  // The paths are the art's own: rectangles drawn as M/m x y h w v h h -w z.
  const pixelsOf = (s: string, animatedBy?: (rule: string) => boolean): { x: number; y: number; hex: string; moving: boolean; mine: boolean }[] => {
    const rules = rulesOf(s)
    // the camera's classes, by the sheet's text (its reduced-motion rule
    // reuses the class, so the map above holds 'none' for it)
    const camera = new Set([...sheetOf(s).matchAll(/\.([\w-]+)\{animation:w-cam /g)].map(m => m[1] ?? ''))
    const body = s.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<defs>[\s\S]*?<\/defs>/g, '')
    const out: { x: number; y: number; hex: string; moving: boolean; mine: boolean }[] = []
    const stack: { moving: boolean; mine: boolean }[] = [{ moving: false, mine: false }]
    for (const m of body.matchAll(/<(\/?)(g|path)\b([^>]*?)(\/?)>/g)) {
      const top = stack[stack.length - 1] ?? { moving: false, mine: false }
      if (m[1] === '/') { stack.pop(); continue }
      if (m[2] === 'g') {
        if (m[4] === '/') continue
        const cs = (/class="([^"]+)"/.exec(m[3] ?? '')?.[1] ?? '').split(' ').filter(c => c !== '')
        const mine = cs.some(c => animatedBy?.(rules.get(c) ?? '') === true)
        // the camera's bob moves the whole world: not what makes a part move
        const own = cs.filter(c => !camera.has(c))
        stack.push({ moving: top.moving || own.length > 0, mine: top.mine || mine })
        continue
      }
      const hex = /fill="#([0-9a-f]{6})"/.exec(m[3] ?? '')?.[1] ?? ''
      const d = /d="([^"]*)"/.exec(m[3] ?? '')?.[1] ?? ''
      let px = 0
      let py = 0
      let w = 0
      for (const r of d.matchAll(/([Mm])(-?\d+) (-?\d+)h(\d+)v(\d+)h-\d+z/g)) {
        const [x0, y0] = r[1] === 'M' ? [Number(r[2]), Number(r[3])] : [px + Number(r[2]), py + Number(r[3])]
        px = x0
        py = y0
        w = Number(r[4])
        for (let y = y0; y < y0 + Number(r[5]); y += 1) for (let x = x0; x < x0 + w; x += 1) out.push({ x, y, hex, moving: top.moving, mine: top.mine })
      }
    }
    return out
  }
  // The night's star tones (bright, mid, faint).
  const STAR = new Set(['f6edc4', '8e96d8', '4b56a0'])
  for (const shown of [smooth, light]) {
    const px = pixelsOf(shown, rule => /^w-t[sw] /.test(rule))
    // No star is left in the still sky: away from the moon and the
    // lighthouse (whose shade and lamp share star tones), no still pixel above
    // the sea has a star's tone. (The cloud strips' moonlit rims share those
    // tones; both settings move them.)
    {
      const stillStars = px.filter(p => !p.moving && STAR.has(p.hex) && p.y < 106 && Math.hypot(p.x - 255, p.y - 28) > 9 && !(p.x >= 258 && p.x <= 275 && p.y >= 78))
      expect(stillStars.length).toBe(0)
    }
    // ...and the field is all there, twinkling in its groups.
    expect(px.filter(p => p.mine && STAR.has(p.hex)).length > 120).toBe(true)
    // The moon's glow breathes: two wider halos in its glow tone, each hidden
    // at first and shown in steps.
    const halos = px.filter(p => p.hex === '2e3a7a' && p.moving)
    expect(halos.length > 20).toBe(true)
    const rules = rulesOf(shown)
    expect([...rules.values()].filter(r => /^w-hb[01] [\d.]+s step-end infinite/.test(r)).length).toBe(2)
    // Curly wind: four gusts, each riding on its own rule with six frames
    // that come and go in steps; never all four at once over their shared round.
    const rides = [...rules.values()].filter(r => r.startsWith('w-qt '))
    expect(rides.length).toBe(4)
    for (let f = 0; f < 6; f += 1) expect([...rules.values()].filter(r => r.startsWith(`w-q${f} `)).length).toBe(4)
    const timing = rides.map(r => /([\d.]+)s step-end infinite (-?[\d.]+)s/.exec(r)).map(m => [Number(m?.[1]), Number(m?.[2])] as const)
    let most = 0
    for (let t = 0; t < 126; t += 0.05) {
      most = Math.max(most, timing.filter(([p, d]) => ((((t - d) % p) + p) % p) / p < 0.42).length)
    }
    expect(most).toBe(3)
    const gusts = pixelsOf(shown, rule => /^w-q\d /.test(rule)).filter(p => p.mine)
    expect(gusts.length > 300).toBe(true)
    // A group that starts hidden shows itself: its own keyframes turn it
    // visible. (A visible frame inside a group hidden for good may never
    // show, as the gusts' rides once were.)
    const sheet = [...shown.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1] ?? '').join('')
    const shows = (name: string): boolean => {
      const at = sheet.indexOf(`@keyframes ${name}{`)
      if (at < 0) return false
      let depth = 0
      for (let i = sheet.indexOf('{', at); i < sheet.length; i += 1) {
        if (sheet[i] === '{') depth += 1
        else if (sheet[i] === '}' && (depth -= 1) === 0) return sheet.slice(at, i).includes('visibility:visible')
      }
      return false
    }
    const hiddenForGood = [...shown.matchAll(/<g class="([^"]+)"[^>]*\svisibility="hidden"/g)]
      .map(m => m[1] ?? '')
      .filter(cs => !cs.split(' ').some(c => shows((rules.get(c) ?? '').split(' ')[0] ?? '')))
    expect(hiddenForGood).toEqual([])
  }

  // Still: none of it. Every gust and halo starts hidden, and a still picture
  // keeps no hidden part (nor any class).
  const off = picture('off')
  expect(off.includes('visibility="hidden"')).toBe(false)
  expect(off.includes('class="')).toBe(false)
  expect(off.length > 0 && off.length < light.length).toBe(true)
})

test('the sea keeps no glitter column, the small clouds are round underneath, and the camera bobs the world but not Kiki', () => {
  const picture = (phase: string, motion: string): string => bare(kiki.svg(settingsOf(motion, phase), NOON))
  const sheetOf = (s: string): string => [...s.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1] ?? '').join('')
  // The rules a class runs, the reduced-motion overrides left out.
  const REDUCED = /@media \(prefers-reduced-motion:reduce\)\{(?:[^{}]*\{[^}]*\})*\}/g
  const rulesOf = (s: string): Map<string, string> =>
    new Map([...sheetOf(s).replace(REDUCED, '').matchAll(/\.([\w-]+)\{animation:([^}]*)\}/g)].map(m => [m[1] ?? '', m[2] ?? ''] as const))
  // The painted pixels of some markup's paths, with their colour (M/m x y h w v h h -w z rectangles).
  const paint = (markup: string): { x: number; y: number; hex: string }[] => {
    const out: { x: number; y: number; hex: string }[] = []
    for (const m of markup.matchAll(/<path fill="#([0-9a-f]{6})" d="([^"]*)"/g)) {
      let px = 0
      let py = 0
      for (const r of (m[2] ?? '').matchAll(/([Mm])(-?\d+) (-?\d+)h(\d+)v(\d+)h-\d+z/g)) {
        px = r[1] === 'M' ? Number(r[2]) : px + Number(r[2])
        py = r[1] === 'M' ? Number(r[3]) : py + Number(r[3])
        for (let y = py; y < py + Number(r[5]); y += 1) for (let x = px; x < px + Number(r[4]); x += 1) out.push({ x, y, hex: m[1] ?? '' })
      }
    }
    return out
  }
  const bodyOf = (s: string): string => s.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<defs>[\s\S]*?<\/defs>/g, '')
  /** Where each group whose class runs a matching rule opens and closes, and how many such groups hold it. */
  const groupsRunning = (s: string, test: (rule: string) => boolean): { open: number; close: number; depth: number }[] => {
    const rules = rulesOf(s)
    const out: { open: number; close: number; depth: number }[] = []
    const stack: { at: number; mine: boolean; depth: number }[] = []
    let inside = 0
    for (const m of s.matchAll(/<(\/?)g\b([^>]*?)(\/?)>/g)) {
      if (m[3] === '/') continue
      if (m[1] === '/') {
        const top = stack.pop()
        if (top?.mine) {
          out.push({ open: top.at, close: m.index ?? 0, depth: top.depth })
          inside -= 1
        }
        continue
      }
      const cs = (/class="([^"]+)"/.exec(m[2] ?? '')?.[1] ?? '').split(' ')
      const mine = cs.some(c => test(rules.get(c) ?? ''))
      if (mine) inside += 1
      stack.push({ at: m.index ?? 0, mine, depth: inside })
    }
    return out
  }
  const isCam = (rule: string): boolean => rule.startsWith('w-cam ')

  // The glints of each phase's water (world.ts wG and wG2): below the first
  // rows of the sea nothing else wears them.
  const GLINT: Record<string, readonly string[]> = { day: ['ffffff', 'c3dcf7'], sunset: ['ffe0a0', 'f2a06a'], night: ['dcd2a6', '8e96d8'] }
  for (const phase of ['day', 'sunset', 'night'] as const) {
    for (const motion of ['smooth', 'light', 'off'] as const) {
      const s = picture(phase, motion)
      const body = bodyOf(s)
      // No long column of light on the sea under the sun or moon (it read as a
      // stripe painted down the picture): every glint frame together, no
      // 20-px wide column holds glints in more than a dozen rows (the old
      // column held them in 60), and only a handful of glints in all.
      const glints = paint(body).filter(p => p.y >= 116 && (GLINT[phase] ?? []).includes(p.hex))
      let most = 0
      for (let a = 0; a < 320; a += 2) most = Math.max(most, new Set(glints.filter(p => p.x >= a && p.x < a + 20).map(p => p.y)).size)
      expect(most <= 12).toBe(true)
      expect(glints.length < 120).toBe(true)

      if (motion === 'off') {
        // Still: no camera, nothing that moves.
        expect(s.includes('w-cam')).toBe(false)
        expect(s.includes('class="')).toBe(false)
        continue
      }
      const rules = rulesOf(s)
      const cams = [...rules.values()].filter(isCam)
      {
        // Smooth and light alike (the bob was asked for, and light only rests
        // the beam and the shooting star). The camera: one rule, on Kiki's own float's beat (hero.ts h-fl: 4.2 s
        // each way, -2.1 s) and an eighth of a round ahead of her, so the two
        // never drift apart; translateY only, three quarters of a pixel each way.
        expect(cams).toEqual(['w-cam 4.2s ease-in-out infinite alternate -3.15s'])
        expect(sheetOf(s).includes('h-fl 4.2s ease-in-out -2.1s infinite alternate')).toBe(true)
        expect(sheetOf(s).includes('@keyframes w-cam{from{transform:translateY(-0.75px)}to{transform:translateY(0.75px)}}')).toBe(true)
        // ...and it rests for those who ask for less motion, as Kiki's float does.
        const camClass = [...rules.entries()].find(([, r]) => isCam(r))?.[0] ?? ''
        expect(sheetOf(s).includes(`@media (prefers-reduced-motion:reduce){.${camClass}{animation:none}}`)).toBe(true)
        // Two camera groups, one inside the other (the near layers bob a
        // pixel and a half each way, the sky half that), and Kiki's group outside both.
        const groups = groupsRunning(s, isCam)
        const outer = groups.filter(g => g.depth === 1)
        const inner = groups.filter(g => g.depth === 2)
        expect(outer.length >= 1 && inner.length >= 1).toBe(true)
        expect(inner.every(i => outer.some(o => o.open < i.open && i.close < o.close))).toBe(true)
        const kiki = s.indexOf('<g class="h-fl">')
        expect(kiki > 0).toBe(true)
        expect(groups.every(g => kiki < g.open || kiki > g.close)).toBe(true)
        // The sky sits in the outer group alone, ahead of the inner one.
        expect(s.indexOf('<path', outer[0]?.open ?? 0) < (inner[0]?.open ?? 0)).toBe(true)
      }
      // Overscan: the picture is painted on past its top and bottom edges by
      // more than the camera moves (a pixel and a half), all the way across, so no
      // empty edge shows as it bobs.
      const px = paint(body)
      for (const y of [-3, -2, -1, 180, 181, 182]) {
        const xs = new Set(px.filter(p => p.y === y).map(p => p.x))
        expect([...Array(320).keys()].every(x => xs.has(x))).toBe(true)
      }
      if (motion === 'smooth' && phase === 'day') {
        // The small drifting clouds are round underneath, never cut flat: in
        // each cloud of the two strips the last row is narrower than its
        // widest row by a good margin.
        for (const id of ['w-cf', 'w-cn']) {
          const strip = new RegExp(`<g id="${id}">([\\s\\S]*?)</g>`).exec(s)?.[1] ?? ''
          const cloud = paint(strip)
          expect(cloud.length > 100).toBe(true)
          const key = (x: number, y: number): string => `${x},${y}`
          const left = new Map(cloud.map(p => [key(p.x, p.y), p] as const))
          let clouds = 0
          for (const start of cloud) {
            if (!left.has(key(start.x, start.y))) continue
            left.delete(key(start.x, start.y))
            const todo = [start]
            const rows = new Map<number, number>()
            for (let p = todo.pop(); p !== undefined; p = todo.pop()) {
              rows.set(p.y, (rows.get(p.y) ?? 0) + 1)
              for (let dy = -1; dy <= 1; dy += 1) {
                for (let dx = -1; dx <= 1; dx += 1) {
                  const q = left.get(key(p.x + dx, p.y + dy))
                  if (q === undefined) continue
                  left.delete(key(q.x, q.y))
                  todo.push(q)
                }
              }
            }
            const bottom = rows.get(Math.max(...rows.keys())) ?? 0
            const widest = Math.max(...rows.values())
            expect(bottom * 10 <= widest * 6).toBe(true)
            clouds += 1
          }
          expect(clouds >= 3).toBe(true)
        }
      }
    }
  }
})
