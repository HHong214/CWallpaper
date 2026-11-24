// Tests for the still picture that sits under the black hole shader: hooks/wallpapers/blackhole/still.ts.
// Run: node --test tools/tests/
//
// Contract ("The still"): `stillSvg(settings)` gives an SVG string of at most 124,000 characters, with no
// animation, nothing the app refuses (the list in the repository's tests/blackhole-svg.test.ts), and the same
// picture as a frame of the shader: a dark middle, the ring, the band brighter on the left, light above and below.
//
// WHAT THESE TESTS EXPECT THE BUILDER TO PROVIDE
//   hooks/wallpapers/blackhole/still.ts   a named export `stillSvg(settings)` returning a string. It is called here as
//   stillSvg({}), so every field of `settings` must be optional with its own default. It is also called twice
//   to see that it is pure (the same string back).
//
// CAN THE MODULE BE IMPORTED UNDER NODE AS IT STANDS? Yes, if it keeps to what Node 24 runs (v24.20.0 here
// strips types and runs a `.ts` file with no flag; checked with a probe file):
//   - erasable TypeScript only: types, `import type`, interfaces and `as` are fine; no enums, no namespaces, no
//     parameter properties, no `import x = require(...)`, no decorators;
//   - every import of a file is written with its extension (`import { rows } from './still-data.ts'`);
//     an extensionless `./still-data` fails under Node (ERR_MODULE_NOT_FOUND);
//   - no import of 'claude-code/...' (nothing maps it here: only the shader tests load that, through the stand-in),
//     no JSX, no path alias from tsconfig;
//   - a plain `export function stillSvg` (a data file it imports follows the same rules).
// A failing import is reported with those rules in its message.
//
// HOW THE PICTURE'S STRUCTURE IS READ (the contract says "the SVG's own text rows"; this is the reading the tests
// take, and the builder must keep to it):
//   - the picture is drawn as characters, ONE `<text>` ELEMENT PER ROW, rows in order from the top; the row is
//     the element's text content (any <tspan> tags dropped) with its spaces kept, so a character's column is its
//     index in the row. A blank character is a space (or &#160;). Any other character is lit; a character's
//     weight is its place in the ramp ` .:-=+*#%@` (a character not in it weighs 5).
//   - the dark middle: a column (the hole's middle) that sits inside an internal gap (4 or more spaces with a lit
//     character before and after on the same row) on at least 3 consecutive rows, then 1 to 4 rows where it is lit
//     (the band), then at least 3 more consecutive rows inside a gap. Gaps elsewhere (between arcs of light) are
//     ignored: the pair of runs that fits best is taken.
//   - the ring and the light: lit rows above the first of those rows and below the last, more lit characters above
//     than below.
//   - the band: the rows between them. Its left half (columns left of the hole's middle) weighs at least 5% more
//     than its right.
//
// CONTRACT v5: the still is the frame at the high angle (level, a whole black circle with a ring, white-hot inside): the structure tests are at the end of this file (S1 to S3). Where they stand on the present still is in their messages.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, it } from 'node:test'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const STILL = path.join(ROOT, 'hooks', 'wallpapers', 'blackhole', 'still.ts')
const CAP = 124_000

async function still() {
  let mod
  try {
    mod = await import(pathToFileURL(STILL).href)
  } catch (e) {
    throw new Error(
      `${STILL} could not be imported under Node: ${e && e.message}. It must be erasable TypeScript only (no enum, namespace, ` +
        `parameter property), import its own files with the .ts extension, import nothing from 'claude-code/...', and have no JSX.`,
    )
  }
  assert.equal(typeof mod.stillSvg, 'function', 'still.ts must export a function stillSvg')
  const svg = mod.stillSvg({})
  assert.equal(typeof svg, 'string', 'stillSvg({}) must return a string')
  return { svg, stillSvg: mod.stillSvg }
}

describe('the still: a valid, small, still SVG', () => {
  it('is one SVG string under the size cap, the same every time, and well formed', async () => {
    const { svg, stillSvg } = await still()
    assert.ok(svg.length <= CAP, `${svg.length} characters, the cap is ${CAP}`)
    assert.equal(stillSvg({}), svg)
    assert.ok(svg.startsWith('<svg'))
    assert.ok(svg.trimEnd().endsWith('</svg>'))
    const root = /^<svg\b[^>]*>/.exec(svg)?.[0] ?? ''
    assert.ok(root.includes('xmlns="http://www.w3.org/2000/svg"'), 'the root needs xmlns')
    assert.match(root, /\sviewBox="\s*-?[\d.]+[ ,]+-?[\d.]+[ ,]+[\d.]+[ ,]+[\d.]+\s*"/)
    const stack = []
    for (const m of svg.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([A-Za-z][\w:-]*)\b[^>]*?(\/?)>/g)) {
      if (m[3] === '/') continue
      if (m[1] === '/') assert.equal(stack.pop(), m[2], `</${m[2]}> closes the wrong tag`)
      else stack.push(m[2])
    }
    assert.deepEqual(stack, [], 'a tag is never closed')
  })
  it('has no animation', async () => {
    const { svg } = await still()
    const lower = svg.toLowerCase()
    for (const word of ['<animate', '<set ', '<set>', '@keyframes', 'animation', 'animatetransform', 'animatemotion']) {
      assert.equal(lower.includes(word), false, `the still contains ${word}`)
    }
  })
  it('draws nothing the app refuses: nothing that loads or runs, url( only as a local reference, links only to a #fragment, & only in the five basic references', async () => {
    const { svg } = await still()
    const lower = svg.toLowerCase()
    for (const word of ['<image', 'data:', '<script', 'foreignobject', '@font-face', '@import', '<!doctype', '<![cdata[']) {
      assert.equal(lower.includes(word), false, `the still contains ${word}`)
    }
    assert.equal(/url\(\s*(?!["']?#)/i.test(svg), false, 'url( is only allowed as url(#name) or url(\'#name\')')
    for (const m of svg.matchAll(/(?:xlink:)?href\s*=\s*(["'])(.*?)\1/gi)) {
      assert.ok(m[2].startsWith('#'), `href="${m[2]}" is not a local #fragment`)
    }
    assert.equal(/&(?!(?:amp|lt|gt|quot|apos);)/.test(svg), false, 'an & that is not one of the five basic references')
  })
})

// ---- the picture, read from its text rows (contract v5: the still is the frame at the high angle) ----------------------
//
// The still is the shader's own frame on a window of STILL_GRID.width by STILL_GRID.height points with no prompt box (read from
// hooks/wallpapers/blackhole/still-data.ts, whose header says so), one <text> a row, top first, the first row being grid row
// STILL_GRID.firstRow, a character a cell of 6 by 10 points, a blank a space. So the character in column c of the i-th row is at
// x = (c + 0.5) * 6, y (up) = height - (firstRow + i + 0.5) * 10, and the contract's R, centre and W follow from the window with
// no prompt box (centre at the window's middle, W = 0.6 of its width, R = size * min(clamp(0.13 W, 40, 125), 0.15 height), with
// `size` as tools/make-still.mjs makes it, read from its source: `const SIZE = ...`). A character's light is its place in the
// shader's glyph ramp (' .:;tSX%8#$@', 0 to 11) over 11; its colour is its ink (STILL_COLOURS letter a to l into STILL_INKS).
// Lit means any character but a blank.
//   S1. level: the principal axis of the light over the disc's box (|x - cx| <= 0.575 W, |y - cy| <= 0.35 W) is within 4 degrees of
//       the horizontal (contract v5 item 1).
//   S2. a whole black circle with a ring (item 3): no lit character within 0.8 R of the centre, and in each of twelve 30 degree
//       sectors of the annulus 0.95 R to 1.25 R at least 20% of the character places are lit.
//   S3. white-hot inside, red outside (item 5): the character places of the disc, those between 2 R and 4.2 R from the centre in
//       the disc's own plane (the plane radius at the high angle, sqrt(dx^2 + (dy / sin 30)^2), the jets' strip |dx| <= 0.5 R left
//       out), split by plane radius into an inner and an outer third: the inner third's mean light is at least twice the outer's; the
//       inner third's mean ink blue is 0.45 of its mean ink red or more, the outer third's 0.30 or less (means over the lit cells).
// These replace the v4 checks of the still (rolled, the front band, the arch, the bright side, a dark upper shadow, the ring of
// the upper half): the picture is now seen from above and level.
import { STILL_COLOURS, STILL_GRID, STILL_INKS } from '../../hooks/wallpapers/blackhole/still-data.ts'

const GLYPHS = ' .:;tSX%8#$@'
const decode = s =>
  s
    .replace(/&#(?:160|xa0);/gi, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/ /g, ' ')
const textRows = svg => [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(m => decode(m[1].replace(/<[^>]*>/g, '')))
const f3 = v => v.toFixed(3)
const hexLane = (hex, k) => parseInt(hex.slice(1 + 2 * k, 3 + 2 * k), 16) / 255

describe('the still: the frame at the high angle, read from its text rows', () => {
  async function read() {
    const { svg } = await still()
    const rows = textRows(svg)
    assert.ok(rows.length >= 15, `${rows.length} text rows: one <text> element a row, 15 rows at least`)
    const { width, height, cellW, cellH, firstRow } = STILL_GRID
    const SIZE = Number(/const SIZE = ([\d.]+)/.exec(readFileSync(path.join(ROOT, 'tools', 'make-still.mjs'), 'utf8'))?.[1])
    assert.ok(SIZE > 0, 'tools/make-still.mjs has no `const SIZE = ...`')
    const W = 0.6 * width
    const g = { W, cx: width / 2, cy: height / 2, R: SIZE * Math.min(Math.min(Math.max(0.13 * W, 40), 125), 0.15 * height) }
    const litAt = new Map()
    rows.forEach((row, i) => {
      for (let c = 0; c < row.length; c++) {
        if (row[c] === ' ') continue
        const k = GLYPHS.indexOf(row[c])
        const ink = STILL_INKS[(STILL_COLOURS[i]?.charCodeAt(c) ?? 97) - 97] ?? STILL_INKS[0]
        litAt.set(c + ',' + (firstRow + i), { w: (k < 0 ? 6 : k) / 11, ink })
      }
    })
    /** Every character place of the window, { x, y, lit, w (light, 0 for a blank), ink }, y up. */
    const places = []
    for (let row = 0; row < height / cellH; row++) {
      for (let c = 0; c < width / cellW; c++) {
        const cell = litAt.get(c + ',' + row)
        places.push({ x: (c + 0.5) * cellW, y: height - (row + 0.5) * cellH, lit: !!cell, w: cell ? cell.w : 0, ink: cell?.ink })
      }
    }
    return { g, places }
  }
  it('S1. is level: the principal axis of its light is within 4 degrees of the horizontal', async () => {
    const { g, places } = await read()
    const lit = places.filter(c => c.lit && Math.abs(c.x - g.cx) <= 0.575 * g.W && Math.abs(c.y - g.cy) <= 0.35 * g.W)
    let sw = 0
    let sx = 0
    let sy = 0
    for (const c of lit) {
      sw += c.w
      sx += c.w * c.x
      sy += c.w * c.y
    }
    const mx = sx / sw
    const my = sy / sw
    let cxx = 0
    let cyy = 0
    let cxy = 0
    for (const c of lit) {
      cxx += c.w * (c.x - mx) ** 2
      cyy += c.w * (c.y - my) ** 2
      cxy += c.w * (c.x - mx) * (c.y - my)
    }
    const phi = (0.5 * Math.atan2(2 * cxy, cxx - cyy) * 180) / Math.PI
    assert.ok(Math.abs(phi) <= 4, `the still's roll is ${f3(phi)} degrees (needs 4 or less)`)
  })
  it('S2. has a whole black circle with a ring: nothing lit within 0.8 R, and each 30 degree sector of 0.95 R to 1.25 R is 20% lit', async () => {
    const { g, places } = await read()
    const inside = places.filter(c => Math.hypot(c.x - g.cx, c.y - g.cy) < 0.8 * g.R && c.lit)
    const lit = new Float64Array(12)
    const all = new Float64Array(12)
    for (const c of places) {
      const d = Math.hypot(c.x - g.cx, c.y - g.cy) / g.R
      if (d < 0.95 || d > 1.25) continue
      const k = Math.min(11, Math.floor((((Math.atan2(c.y - g.cy, c.x - g.cx) * 180) / Math.PI + 360) % 360) / 30))
      all[k]++
      if (c.lit) lit[k]++
    }
    const fractions = Array.from(all, (n, k) => (n ? lit[k] / n : 0))
    const msg = `${inside.length} lit characters within 0.8 R (needs 0); the twelve ring sectors are ${fractions.map(v => (100 * v).toFixed(0)).join(' ')}% lit (needs 20% each)`
    assert.equal(inside.length, 0, msg)
    assert.ok(Math.min(...fractions) >= 0.2, msg)
  })
  it('S3. is white-hot inside and red outside: the inner third of the disc twice as bright as the outer, blue 0.45 of red inside and 0.30 or less outside', async () => {
    const { g, places } = await read()
    const disc = places
      .map(c => ({ ...c, rho: Math.hypot(c.x - g.cx, (c.y - g.cy) / 0.5) }))
      .filter(c => c.rho >= 2 * g.R && c.rho <= 4.2 * g.R && Math.abs(c.x - g.cx) > 0.5 * g.R)
      .sort((a, b) => a.rho - b.rho)
    const third = Math.floor(disc.length / 3)
    const part = sel => {
      const lit = sel.filter(c => c.lit)
      const mean = k => (lit.length ? lit.reduce((s, c) => s + hexLane(c.ink, k), 0) / lit.length : 0)
      return { light: sel.reduce((s, c) => s + c.w, 0) / Math.max(1, sel.length), red: mean(0), blue: mean(2) }
    }
    const inner = part(disc.slice(0, third))
    const outer = part(disc.slice(disc.length - third))
    const msg = `${disc.length} places in the disc; light inner ${inner.light.toFixed(3)}, outer ${outer.light.toFixed(3)} (needs the inner twice the outer); ink blue over red inner ${f3(inner.blue / Math.max(inner.red, 1e-9))} (needs 0.45 or more), outer ${f3(outer.blue / Math.max(outer.red, 1e-9))} (needs 0.30 or less)`
    assert.ok(disc.length > 300, msg)
    assert.ok(inner.light >= 2 * outer.light, msg)
    assert.ok(inner.blue >= 0.45 * inner.red && outer.blue <= 0.3 * outer.red, msg)
  })
})
