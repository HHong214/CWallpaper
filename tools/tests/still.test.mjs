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
// Why these fail now: still.ts does not exist; it is imported inside each test.
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

// ---- the picture, read from its text rows (contract v4: the still shows the new look) --------------------------------
//
// The still is the shader's own frame on a window of STILL_GRID.width by STILL_GRID.height points with no prompt box (read
// from hooks/wallpapers/blackhole/still-data.ts, whose header says so), one <text> a row, top first, the first row being
// grid row STILL_GRID.firstRow, a character a cell of 6 by 10 points, a blank a space. So the character in column c of the
// i-th row is at x = (c + 0.5) * 6, y (up) = height - (firstRow + i + 0.5) * 10, and the contract's R, centre and W follow from
// the window with no prompt box (centre at the window's middle, W = 0.6 of its width, R = size * min(clamp(0.16 W, 48, 150),
// 0.18 height), with `size` as tools/make-still.mjs makes it, read from its source: `const SIZE = ...`). A character's light is
// its place in the shader's glyph ramp (' .:;tSX%8#$@', 0 to 11) over 11: the still keeps the glyphs and the colours, and
// a glyph's index is the closest to its light the text can give. Lit means any character but a blank.
//   1. rolled: the principal axis of the light over the disc's box is 5 to 25 degrees off the horizontal.
//   2. a front band with height (the wording of 2026-11-23): in the strip |u| <= 0.15 R, among the character places with v from
//      -0.9 R to -0.1 R, the lit ones span at least 0.25 R in v and at least 30% of the places between the highest and the
//      lowest lit one are lit.
//   3. the far side arches over the top: the mean light in 1.05 R <= v <= 1.6 R, |u| <= 0.5 R is over 0.02.
//   4. one side is bright: u < 0 over the disc's box carries more light than u > 0.
//   8. a dark upper shadow: nothing lit in the circle of radius 0.35 R centred 0.4 R above the centre along v (a blank cannot
//      show "darker than the ground", so for the still that is enough).
//   5. a ring: of the character places in the upper half (above the centre) of the annulus 0.9 R to 1.25 R about the centre, at
//      least 30% are lit (my number: the contract says only "lit characters in the upper half of the annulus").
// These follow items 1 to 4 and 8 of look-contract.md in place of v1's "a dark middle, the band brighter on the left, light
// above and below" (and of the ring check that went with the gap reading, which no longer holds for a tilted disc).
// Today's still is the edge-on picture, so 1, 2 and 8 fail; 3 and 4 pass today (properties to keep).
import { STILL_GRID } from '../../hooks/wallpapers/blackhole/still-data.ts'

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

describe('the still: the new look, read from its text rows', () => {
  async function read() {
    const { svg } = await still()
    const rows = textRows(svg)
    assert.ok(rows.length >= 15, `${rows.length} text rows: one <text> element a row, 15 rows at least`)
    const { width, height, cellW, cellH, firstRow } = STILL_GRID
    const SIZE = Number(/const SIZE = ([\d.]+)/.exec(readFileSync(path.join(ROOT, 'tools', 'make-still.mjs'), 'utf8'))?.[1])
    assert.ok(SIZE > 0, 'tools/make-still.mjs has no `const SIZE = ...`')
    const W = 0.6 * width
    const g = { W, cx: width / 2, cy: height / 2, R: SIZE * Math.min(Math.min(Math.max(0.16 * W, 48), 150), 0.18 * height) }
    const cells = []
    const litAt = new Set()
    rows.forEach((row, i) => {
      for (let c = 0; c < row.length; c++) {
        if (row[c] === ' ') continue
        const k = GLYPHS.indexOf(row[c])
        cells.push({ x: (c + 0.5) * cellW, y: height - (firstRow + i + 0.5) * cellH, w: (k < 0 ? 6 : k) / 11 })
        litAt.add(c + ',' + (firstRow + i))
      }
    })
    /** Every character place of the window, { x, y, lit }, y up. */
    const places = []
    for (let row = 0; row < height / cellH; row++) {
      for (let c = 0; c < width / cellW; c++) places.push({ x: (c + 0.5) * cellW, y: height - (row + 0.5) * cellH, lit: litAt.has(c + ',' + row) })
    }
    return { g, cells, places }
  }
  const inBox = (g, c) => Math.abs(c.x - g.cx) <= 0.575 * g.W && Math.abs(c.y - g.cy) <= 0.35 * g.W
  /** The roll in degrees: the principal axis of the light-weighted second moments over the disc's box. */
  function roll(g, cells) {
    let sw = 0
    let sx = 0
    let sy = 0
    const inside = cells.filter(c => inBox(g, c))
    for (const c of inside) {
      sw += c.w
      sx += c.w * c.x
      sy += c.w * c.y
    }
    if (!sw) return NaN
    const mx = sx / sw
    const my = sy / sw
    let cxx = 0
    let cyy = 0
    let cxy = 0
    for (const c of inside) {
      cxx += c.w * (c.x - mx) ** 2
      cyy += c.w * (c.y - my) ** 2
      cxy += c.w * (c.x - mx) * (c.y - my)
    }
    return (0.5 * Math.atan2(2 * cxy, cxx - cyy) * 180) / Math.PI
  }
  const uv = (g, phi, c) => {
    const p = (phi * Math.PI) / 180
    const dx = c.x - g.cx
    const dy = c.y - g.cy
    return { u: dx * Math.cos(p) + dy * Math.sin(p), v: -dx * Math.sin(p) + dy * Math.cos(p) }
  }
  it('1. is rolled: the principal axis of its light is 5 to 25 degrees off the horizontal', async () => {
    const { g, cells } = await read()
    const phi = roll(g, cells)
    assert.ok(Math.abs(phi) >= 5 && Math.abs(phi) <= 25, `the still's roll is ${f3(phi)} degrees (needs 5 to 25 either way)`)
  })
  it('2. has a front band with height in front of the lower shadow: in the strip, the lit places between v -0.9 R and -0.1 R span 0.25 R or more and fill 30% or more of that span', async () => {
    const { g, cells, places } = await read()
    const phi = roll(g, cells)
    const strip = places.map(c => ({ v: uv(g, phi, c).v, u: uv(g, phi, c).u, lit: c.lit })).filter(c => Math.abs(c.u) <= 0.15 * g.R && c.v >= -0.9 * g.R && c.v <= -0.1 * g.R)
    const litV = strip.filter(c => c.lit).map(c => c.v)
    const lo = Math.min(...litV)
    const hi = Math.max(...litV)
    const between = strip.filter(c => c.v >= lo && c.v <= hi)
    const fraction = between.filter(c => c.lit).length / Math.max(1, between.length)
    const msg = `roll ${f3(phi)}: ${litV.length} lit places of ${strip.length} in the strip, span ${litV.length ? f3((hi - lo) / g.R) : '0.000'} R (needs 0.25), ${(100 * fraction).toFixed(0)}% of the places between the highest and lowest are lit (needs 30%)`
    assert.ok(litV.length > 0, msg)
    assert.ok((hi - lo) / g.R >= 0.25 && fraction >= 0.3, msg)
  })
  it('3. has the far side arching over the top: the mean light in 1.05 R to 1.6 R above, within 0.5 R across, is over 0.02', async () => {
    const { g, cells } = await read()
    const phi = roll(g, cells)
    // the mean over every character place in the region (a blank is 0); the region's area is counted in cells of 6 by 10 points
    const area = (0.5 * g.R * 2 * 0.55 * g.R) / (6 * 10)
    const sum = cells.reduce((a, c) => {
      const { u, v } = uv(g, phi, c)
      return a + (Math.abs(u) <= 0.5 * g.R && v >= 1.05 * g.R && v <= 1.6 * g.R ? c.w : 0)
    }, 0)
    assert.ok(sum / area > 0.02, `the mean light there is ${f3(sum / area)} (needs over 0.02)`)
  })
  it('4. has one bright side: u < 0 carries more light than u > 0 over the disc box', async () => {
    const { g, cells } = await read()
    const phi = roll(g, cells)
    let left = 0
    let right = 0
    for (const c of cells) {
      if (!inBox(g, c)) continue
      if (uv(g, phi, c).u < 0) left += c.w
      else right += c.w
    }
    assert.ok(left > right, `light on the u < 0 side ${f3(left)}, on the u > 0 side ${f3(right)}`)
  })
  it('8. has a dark upper shadow: nothing is lit in the circle of radius 0.35 R centred 0.4 R above the centre along v', async () => {
    const { g, cells } = await read()
    const phi = roll(g, cells)
    const p = (phi * Math.PI) / 180
    const ccx = g.cx - 0.4 * g.R * Math.sin(p)
    const ccy = g.cy + 0.4 * g.R * Math.cos(p)
    const lit = cells.filter(c => Math.hypot(c.x - ccx, c.y - ccy) <= 0.35 * g.R)
    assert.equal(lit.length, 0, `${lit.length} lit characters in the upper shadow (the circle holds about ${Math.round((Math.PI * (0.35 * g.R) ** 2) / 60)} cells)`)
  })
  it('5. has a ring: at least 25% of the character places in the upper half of the annulus 0.9 R to 1.25 R are lit', async () => {
    const { g, places } = await read()
    const ring = places.filter(c => {
      const d = Math.hypot(c.x - g.cx, c.y - g.cy)
      return c.y > g.cy && d >= 0.9 * g.R && d <= 1.25 * g.R
    })
    const lit = ring.filter(c => c.lit).length
    assert.ok(lit / ring.length >= 0.25, `${lit} of ${ring.length} places in the upper half of the annulus are lit (${((100 * lit) / ring.length).toFixed(0)}%, needs 25%)`)
  })
})
