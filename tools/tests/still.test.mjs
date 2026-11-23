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

// ---- the picture, read from its text rows -----------------------------------------------------------------------

const RAMP = ' .:-=+*#%@'
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
function textRows(svg) {
  return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(m => decode(m[1].replace(/<[^>]*>/g, '')))
}
const isLit = ch => ch !== ' ' && ch !== undefined
const weight = ch => (isLit(ch) ? (RAMP.includes(ch) ? RAMP.indexOf(ch) : 5) : 0)
/** Column ranges [a, b) of spaces on a row that have a lit character before and after. */
function innerGaps(row) {
  const gaps = []
  let i = 0
  while (i < row.length) {
    if (row[i] === ' ') {
      let j = i
      while (j < row.length && row[j] === ' ') j++
      if (i > 0 && j < row.length) gaps.push([i, j])
      i = j
    } else i++
  }
  return gaps
}
const inGap = (gaps, c) => gaps.some(([a, b]) => c >= a && c < b)

describe('the still: the same picture as a frame of the shader, read from its text rows', () => {
  async function read() {
    const { svg } = await still()
    const rows = textRows(svg)
    assert.ok(rows.length >= 15, `${rows.length} text rows: the picture is one <text> element a row, 15 rows at least`)
    assert.ok(Math.max(...rows.map(r => r.length)) >= 30, 'the rows are under 30 columns wide')
    const gaps = rows.map(r => innerGaps(r).filter(([a, b]) => b - a >= 4))
    // the hole's columns: those that sit in a gap on the most rows; its middle is the widest run of the best ones
    const width = Math.max(...rows.map(r => r.length))
    const count = Array.from({ length: width }, (_, c) => gaps.reduce((n, g) => n + (inGap(g, c) ? 1 : 0), 0))
    const best = Math.max(...count)
    assert.ok(best >= 6, `no dark middle: no column is inside a gap of 4 or more spaces on more than ${best} rows`)
    let bestRun = [0, 0]
    for (let c = 0; c < width; ) {
      if (count[c] >= 0.6 * best) {
        let d = c
        while (d < width && count[d] >= 0.6 * best) d++
        if (d - c > bestRun[1] - bestRun[0]) bestRun = [c, d]
        c = d
      } else c++
    }
    const middle = Math.floor((bestRun[0] + bestRun[1] - 1) / 2)
    // runs of consecutive rows with the middle column in a gap; the hole is the pair of neighbouring runs (at most 4
    // rows apart: the band between them) whose shorter run is the longest. Other gaps (between arcs of light) are not it.
    const runs = []
    for (let i = 0; i < rows.length; ) {
      if (inGap(gaps[i], middle)) {
        let j = i
        while (j < rows.length && inGap(gaps[j], middle)) j++
        runs.push([i, j - 1])
        i = j
      } else i++
    }
    let pair = null
    for (let k = 0; k + 1 < runs.length; k++) {
      const [a, b] = [runs[k], runs[k + 1]]
      if (b[0] - a[1] - 1 > 4) continue
      const score = Math.min(a[1] - a[0] + 1, b[1] - b[0] + 1)
      if (!pair || score > pair.score) pair = { a, b, score }
    }
    assert.ok(pair, 'no dark middle: no two runs of rows with a gap at the middle column sit either side of a band of 4 rows or fewer')
    const holeRows = []
    for (const [from, to] of [pair.a, pair.b]) for (let i = from; i <= to; i++) holeRows.push(i)
    const bandRows = []
    for (let i = pair.a[1] + 1; i < pair.b[0]; i++) bandRows.push(i)
    return { rows, gaps, middle, holeRows, top: pair.a[0], bottom: pair.b[1], bandRows, above: pair.a, below: pair.b }
  }
  it('has a dark middle: a gap in the rows above the band and in the rows below it, with the band lit between', async () => {
    const { bandRows, middle, rows, above: a, below: b } = await read()
    assert.ok(bandRows.length >= 1, 'no band crosses the dark middle')
    const above = a[1] - a[0] + 1
    const below = b[1] - b[0] + 1
    assert.ok(above >= 3, `${above} rows of dark middle above the band (3 at least)`)
    assert.ok(below >= 3, `${below} rows of dark middle below the band (3 at least)`)
    for (const i of bandRows) assert.ok(isLit(rows[i][middle]), `the band's row ${i} is not lit through the middle column ${middle}`)
  })
  it('has lit rows above the hole and below it, more above than below', async () => {
    const { rows, top, bottom } = await read()
    const litIn = (from, to) => {
      let n = 0
      for (let i = from; i < to; i++) for (const ch of rows[i]) if (isLit(ch)) n++
      return n
    }
    const above = litIn(0, top)
    const below = litIn(bottom + 1, rows.length)
    assert.ok(above > 0, 'nothing is lit above the dark middle')
    assert.ok(below > 0, 'nothing is lit below the dark middle')
    assert.ok(above > below, `lit characters above ${above}, below ${below}`)
  })
  it('has a ring: lit characters on both sides of the dark middle on its rows, and a lit row across its top and bottom', async () => {
    const { rows, holeRows, gaps, middle } = await read()
    for (const i of holeRows) {
      const [a, b] = gaps[i].find(([x, y]) => middle >= x && middle < y)
      assert.ok(rows[i].slice(0, a).trim() !== '' && rows[i].slice(b).trim() !== '', `row ${i}: the gap has nothing lit on both sides`)
    }
    // the row just above the first hole row and the row just below the last are lit across the hole's middle
    const first = holeRows[0]
    const last = holeRows[holeRows.length - 1]
    assert.ok(first > 0 && isLit(rows[first - 1][middle]), 'the ring does not close over the top of the dark middle')
    assert.ok(last + 1 < rows.length && isLit(rows[last + 1][middle]), 'the ring does not close under the dark middle')
  })
  it('has a band brighter on its left half than on its right', async () => {
    const { rows, bandRows, middle } = await read()
    assert.ok(bandRows.length >= 1, 'no band')
    let left = 0
    let right = 0
    for (const i of bandRows) {
      for (let c = 0; c < rows[i].length; c++) {
        if (c < middle) left += weight(rows[i][c])
        else if (c > middle) right += weight(rows[i][c])
      }
    }
    assert.ok(left > 0)
    assert.ok(left > right * 1.05, `band weight: left ${left}, right ${right}`)
  })
})
