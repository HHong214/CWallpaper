# CWallpaper: instructions for agents

This file is the single source of instructions for this repo. It takes an agent with no memory of earlier work from nothing to a finished new wallpaper. Read all of "Making a wallpaper" and "Rules learned the hard way" before you start.

## The project

CWallpaper (the C is `#D97757`, like the owner's other project CNotes) is a mod for the Claude desktop app. It gives the app a moving wallpaper behind the conversation and repaints the app in matching colours. Plugin `CWallpaper`, marketplace `cwallpaper`, command `/cwallpaper`.

- Where it lives: `Documents\GitHub\CWallpaper` on the owner's machine, public, https://github.com/HHong214/CWallpaper, branch `main`.
- How it reaches the app: the owner installs it from the GitHub repository as `CWallpaper@cwallpaper`. A push reaches the app through `/plugin marketplace update cwallpaper` and then `/reload-plugins`, or by itself once the owner has switched auto-update on for that marketplace.
- **The manifest has no `version`, on purpose.** Every pushed commit is an update. Never add a `version` to `.claude-plugin/plugin.json` or `marketplace.json`. `claude plugin validate .` warns that no version is given, and that the name `CWallpaper` is not kebab-case (it accepts it). Both warnings are expected.
- Two wallpapers exist: `kiki` (kind `svg`, pixel art the app animates itself) and `blackhole` (kind `shader`, an ASCII black hole on the GPU over a still SVG,. It traces no light: it is painted back to front (the far half of the disc, the far jet, the black circle with a thin bright ring, the near half of the disc, the near jet, sparks), level and unrolled. At the high angle the circle and its ring are drawn over the near half, so the hole is whole; the near half fades in over the circle only as the view drops, between about 20 and 12 degrees. The camera's height above the disc swings between 30 and 6 degrees over a minute. The disc runs from 1.25 R to min(4.2 R, 0.546 W), white-hot at the hole and dark red at the rim, turning with the inner part faster. Blue-white jets stream up and down and sparks spiral in. `R = size * min(clamp(0.13 * W, 40, 125), 0.15 * size.y)`).
- Wallpapers are made here, as code, by an agent. A picture or a video of the owner's own is not loaded by the mod any more, and `/cwallpaper picture` says so.
- Settings are plugin options and nothing else, written as `CWallpaper.<key>` (the option whose own key is `wallpaper` is `CWallpaper.wallpaper`). The mod's session values live under `{ plugin: 'CWallpaper', key }`; the settings pane's id is `cwallpaper-settings`; the author on the plugin page is `HHong214`. There is one command, `/cwallpaper`.

What this file is for: from now on an agent makes each wallpaper in this repository, by following it. It also records the lessons that keep a wallpaper light, such as hiding what is not showing.

## Folder map

```
.claude-plugin/plugin.json        the manifest: name, description, types, userConfig (the options; written by tools/sync-manifest.mjs)
.claude-plugin/marketplace.json   marketplace `cwallpaper`, one plugin `CWallpaper`, source ./
hooks/hooks.json                  names the one hooks module: ./register.tsx
hooks/register.tsx                thin wiring: reads options, sets the theme, answers the Backdrop, runs /cwallpaper, draws the pane, adds the cat to the spinner
hooks/core/options.ts             pure: the option model (COMMON, optionSpecs, readSettings, manifestKey)
hooks/core/registry.ts            pure: the Wallpaper type and WALLPAPERS, the one list to add a wallpaper to
hooks/core/commands.ts            pure: `/cwallpaper ...` text to an action, status and help text
hooks/core/pane.ts                pure: the rows of the settings pane
hooks/core/scene.ts               pure: what the Backdrop shows (none, svg or shader) and the shader's values
hooks/make-colors.js, .d.ts       the design system's own colour helper (copied, not edited)
hooks/wallpapers/<id>/index.ts    one folder a wallpaper; index.ts exports its Wallpaper
hooks/wallpapers/kiki/            Kiki: scene.ts joins hero.ts, world.ts, pixels.ts, sun.ts, types.ts
hooks/wallpapers/blackhole/       shader.ts (the GPU shader), still.ts (the still SVG), still-data.ts (written by tools/make-still.mjs)
types/index.d.ts                  the mod's session values ($.state): paneOpen, lookSet, pendingWrites
tests/                            plugin tests, run by `claude plugin test .` (*.test.ts and *.test.tsx)
tools/                            look at a wallpaper without the app, and the checks; see tools/README.md
tools/tests/                      Node tests, run by `node --test tools/tests/`; blackhole-kit.mjs is a helper, not a test file (`drive()` runs the shader frame by frame and changes the window, the prompt box, the values and the frame time between frames); `blackhole-motion.mjs` is a second helper (measuring functions for turn, ring and drift); the quick tests are blackhole-geometry, blackhole-stability, blackhole-look (the view and the black circle), blackhole-visible (motion and texture the eye can see) and blackhole-measure (the measuring functions on made-up fields); the slow ones are blackhole-flash, blackhole-geometry-flash and blackhole-spin (the turn, the ring, the inward drift)
tools/out/                        what the tools write (git ignores it)
docs/wordmark.svg                 the wordmark in README.md
CHANGELOG.md, README.md           for the owner and visitors; update both when a wallpaper is added
```

## Commands

PowerShell on Windows. In Git Bash the same commands work.

| Command | What it does |
|---|---|
| `claude plugin test .` | Runs `tests/` against the mod through the app's own harness (`claude-code/testing`). |
| `node --test tools/tests/` | Node tests of the tools, the shader under the stand-in, the still, the manifest. Quick (142 tests on 2026-11-24); the three slow files are left out. |
| `$env:SLOW = '1'; node --test tools/tests/` | Adds the three slow files of the black hole shader: the turn, the ring and the inward drift (`blackhole-spin.test.mjs`), 6 seconds of frames on two window sizes and a run in the middle of the tilt's swing (`blackhole-flash.test.mjs`) and the flash estimate while its geometry changes (`blackhole-geometry-flash.test.mjs`). Together they took about two and a half minutes on the owner's PC (2026-11-23). In Git Bash: `SLOW=1 node --test tools/tests/`. |
| `claude plugin validate .` | The app's own check of manifest, hooks and shader. Prints each shader's cost or the line it refuses. Must pass. |
| `node tools/sync-manifest.mjs` | Writes `userConfig` in `plugin.json` from the options the code lists. Run after adding a wallpaper or an option. |
| `node tools/sync-manifest.mjs --check` | Says whether `plugin.json` is in step; exits 1 if not. |
| `node tools/make-still.mjs` | Writes `hooks/wallpapers/blackhole/still-data.ts` from a real frame of the black hole shader. Run after the shader changes. It picks, at the high angle of the swing, the frame with the most lit ring. |
| `node tools/make-still.mjs --check` | Says whether that file is what the shader gives now. |
| `node tools/preview.mjs <shader.ts> --at 1 --size 960x540 --out tools/out/a.png` | One frame of a shader on the CPU. `--sheet 6 --over 6` gives six frames in one picture; `--video 4 --rate 15 --out tools/out/a.mp4` a video (needs `ffmpeg`); `--frames 3 --raw tools/out/raw` the luminance of every frame for a flash check. Options are in tools/README.md. |
| `node tools/svg-to-png.mjs <file.svg> tools/out/a.png --size 960x540 --after 2` | Renders an SVG with headless Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe`), every animation held at 2 seconds. `--size` is at least 640x360. One Chrome at a time. |

Node is 24. A `.ts` file runs in Node by type stripping, so files that the tools import use `import type` and write every relative import with its extension (`'./still.ts'`).

## How the app draws a wallpaper

The mod answers the app's `Backdrop` render with a tree. The app gives it to the desktop and mobile apps only; the terminal draws none. The tree holds only `Box`, `Text`, `Svg` and at most one `Shader`.

There are two kinds of wallpaper.

### Kind `svg`

The app draws one `Svg` as an image and animates it itself. All motion is CSS (`@keyframes` in a `<style>` inside the SVG, or SMIL).

Limits of the SVG (`SvgProps`, the Backdrop's type notes):

- At most 131,072 characters. **The mod's own cap is 124,000** (`Wallpaper.svg`, pinned by the tests), so keep to that.
- Pure vector. Refused, and the whole answer with it: a `data:` URL, base64, `<image>`, `feImage`, `foreignObject`, `@font-face`, `@import`, `image-set()`, `src()`, `cross-fade()`, `<?xml-stylesheet`.
- `url()` and `href` only to a local `#fragment`, and no SMIL on an `href`.
- Also refused, as things that could hide the above: a backslash in `<style>` or a tag; a character reference other than `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`; a control character; an XML declaration with an encoding other than UTF-8; a DOCTYPE, ENTITY or CDATA; `<?`; an element inside `<style>`; a `<style>` with no end tag; a tag with an attribute that has no value or whose value holds `<` or `>`.
- Comments are read like the rest. Use `<!-- sky -->` between tags (no `<` or `--` inside) and `/* sky */` in a style. A word such as `href` in a comment is still refused. Keep a CSS comment to plain words: one holding `word(` or `@word` can leave the scene still or undrawn.
- Give the root a `viewBox` and `preserveAspectRatio="xMidYMid slice"` so it fills any screen. Keep the subject away from the middle, where the words sit, and the foot, where the message box sits.
- The app draws the mod's `Svg` as one image, not in an interactive frame (no `isInteractive`).

### Kind `shader`

A GPU shader file (TypeScript written against `'claude-code/shader'`) played over a still `Svg`. The engine reads the file at load and never runs it; it sends the app a checked form. The `Svg` shows alone under Reduce Motion, on mobile, with motion `off`, on an app that plays no shaders, and when the shader fails, flashes or runs too slowly.

The shader's limits (the language notes of `claude-code/shader`; `claude plugin validate .` refuses what breaks them and names the line):

- Allowed: `const`, `let`, functions and arrows (inlined; one may set an enclosing function's `let`, never a top-level one), `if`/`else`, `?:`, `for` with start, end and step known while reading, `for...of` over a written list, `break`, `continue`, `return`, destructuring.
- A loop has at most **64 turns**. Its step and end write nothing but the counter. A list read or written at a run-time index holds at most 16 entries.
- Refused: `while`, `do`, recursion, classes, `new`, `async`, strings as values, spread, any other import or global.
- Numbers are 32-bit floats. No value is ever NaN or infinite, so guard a division by zero.
- A file's numbers, ints and tables hold 16,384 bits in all. Draw many like things with a `for` loop, not an unrolled list.
- `values({ ... })` declares the numbers the mod sends: **at most 8 names**, each with a range, each held to it and rounded to 10 bits. Another name is refused. Send state, never a stream on a timer: what fades, moves or piles up belongs in a `buffer`, stepped with `dt`.
- `claude plugin validate .` prints the cost as one line, for the black hole: `shader hooks/wallpapers/blackhole/shader.ts: runs on any GPU; sharpness 2.00 weak, 2.00 fast, at 30 fps`. A shader that is too dear is refused or runs slowly and the app shows the still.
- **Draw opaque.** The black hole paints its own near-black ground over all of it, so the still under the shader never shows through.
- The `Shader` element's `module` is a string literal relative to the file that holds the element, written in the element itself. A variable, a renamed `Shader`, a path outside the plugin or a missing file leaves the still showing.
- `scene` in this mod gives the tree for a shader wallpaper. It is written with the global `h` because the core imports it and holds no JSX:

```ts
scene: (kit, s) => h(kit.Shader as never, { module: './shader.ts', values: s.values }, h(kit.Svg as never, { source: s.source, alt: s.alt }))
```

- The mod adds two values to every shader scene: `dim` (0 to 0.8) and `speed` (1 for motion smooth, 0.5 for light). The scene takes at most 6 names from the wallpaper's own `values()`, then writes those two over them. So declare `dim` and `speed` in the shader's `values({...})` (the black hole does) and add your own. The black hole's are `calm` and `size`.

### Why the app holds a wallpaper still

The app freezes or stills a scene for these reasons. None can be seen from the mod, so make the still a finished picture.

- Reduce Motion: the desktop draws the SVG with its animation taken out, so give each moving part a resting place and opacity in the plain markup.
- A scene that is too heavy, or a shader that fails, runs too slowly, or is refused.
- A mobile surface may draw a scene still. A scene redrawn on a timer holds still until the redraws stop for five seconds.
- **Flashing.** From the app's own rule (look.md): "A shader that keeps flashing freezes, then stops, and its Svg shows. A spot flashes when it swings between lighter and darker, or between two colors, more than three times a second. It's too much when flashing spots within any 340 by 256 points add up to a patch about 100 points a side, or less in a small window, even if they're thin or scattered." It adds that a light scene gets there with a smaller change than a dark one. Each ring or crest that crosses a spot is one flash.

## Making a wallpaper

Follow these steps in order. Do not skip the tests-first step or the looking steps.

1. **Choose the kind.**
   - `svg`: flat art that moves by CSS (drifting, bobbing, frames switched on a timer). Cheap, always works, no GPU needed. Pick this when the art is drawn shapes or a small cast of frames.
   - `shader`: motion that is computed (streaming, fluid, many tiny moving things). It needs a still SVG too, and a flash check. Pick it only when SVG cannot do the motion.
2. **Plan the picture and its motion** before any file. Write down: the id (lower-case letters and digits, such as `tide`), the label, the aliases, the picture, each moving part and its speed, the still (what shows with motion off), the colours for the app, its own options, and where the words sit (the picture keeps the middle and the foot calm).
3. **Write the tests first**, and watch them fail.
   - `tests/<id>-look.test.ts` (plugin tests, run by `claude plugin test .`, imports from `claude-code/testing`; see `tests/kiki-look.test.ts`): the picture's rules. Length at most 124,000; nothing the app refuses; motion `off` holds no animation; the first frame is the only one visible at time 0; every moving part has its rule.
   - For a shader: `tools/tests/<id>.test.mjs` (Node tests, `node:test`; see `tools/tests/blackhole.test.mjs`): the shader loads under the stand-in and declares its values; the picture is finite, in range and not blank; two frames a second apart differ; the still is at most 124,000 characters. For its flash run copy `tools/tests/blackhole-flash.test.mjs`, and add the file to the list in `tools/tests/index.js`.
   - **Update the tests that pin the list.** `tests/core-registry.test.ts` pins `WALLPAPERS` to `['kiki', 'blackhole']` and their labels; `tools/tests/manifest.test.mjs` pins the exact order of the manifest's keys and that the description names the wallpapers. Both must name the new one.
   - The plugin test runner's hooks module may import only code: no JSON, no `fs`, `process` or `fetch`. Pure logic goes in files with no `$` and no JSX so both runners can import them.
4. **Make the folder** `hooks/wallpapers/<id>/`. Its `index.ts` exports a frozen `Wallpaper` (type in `hooks/core/registry.ts`). It is pure: no engine import, no clock (the time comes in as `now`), no store, never throws, junk in gives the default out. Its fields:
   - `id`: the folder name; the value of the `wallpaper` option.
   - `label`: the name shown ("Black hole").
   - `aliases`: other words `/cwallpaper` takes, any letter case (`['black-hole', 'hole']`).
   - `kind`: `'svg'` or `'shader'`.
   - `options`: its own options (below), with short keys.
   - `colors(settings)`: what `makeColors` takes: `label`, `roles` (`accent`, `danger`, `success`, `warning`, `pro`), and `light.gray.anchors` and `dark.gray.anchors` (surfaces and text colours). Red stays danger, green success, amber warning. If `makeColors` reports a line starting `Desktop won't paint`, the app ignores the colours; the mod shows that line as a toast.
   - `svg(settings, now)`: the SVG string, at most 124,000 characters. For a shader wallpaper, its still picture. It holds no animation when `settings.motion` is `'off'`. Apply `settings.dim` yourself: paint a black `<rect>` of that opacity over everything, last (`veiled` in `kiki/index.ts`). It must end with `</svg>`: the mod inserts an empty `<g id="kw...">` before the last one when it redraws.
   - `moves(settings)`: `false` when `settings.motion === 'off'`.
   - `values?(settings)`: shader wallpapers only: the shader's numbers (see the limits above).
   - `scene?(kit, scene)`: shader wallpapers only: the tree, with the literal module path.
   - `alt?(settings, now)`: what the picture shows, for those who cannot see it. Without it the alt is "The <label> wallpaper."
   - `spinner?(settings, mode)`: optional text added after the app's spinner word in that mode; `undefined` leaves it.
5. **Its own options.** A wallpaper's `options` use SHORT keys (`time`, `size`). Each is `{ key, title, description, type: 'boolean' | 'choice' | 'number', default, choices?, min?, max? }`. Start the title with the label and a colon ("Black hole: size"). The manifest key is `<id><Key>` (`blackholeSize`); `optionSpecs` makes it. Read a value from `settings.own[id][key]` and fall back to the default for anything else. The pane shows only the current wallpaper's options, and a command for another wallpaper's option is refused ("Time of day belongs to Kiki. The wallpaper is Black hole.").
6. **Register it.** In `hooks/core/registry.ts` import it and add it to `WALLPAPERS` (after the others; Kiki stays first, the default). Nothing else in the core changes.
7. **Sync the manifest.** Run `node tools/sync-manifest.mjs`, then `node tools/sync-manifest.mjs --check`. It rewrites `userConfig` only. Edit the manifest's `description` and `keywords` by hand to name the new wallpaper (a test pins that the description names them). Never add `version`.
8. **For a shader**, write `shader.ts` in the subset the preview can run (next section), with its `values`, its passes and its picture. Then make the still: the black hole's still is `tools/make-still.mjs`, which is written for that shader alone (its paths and window are fixed in the file). For a new shader copy it and change those, or draw the still SVG directly. The still is a finished picture: a dark, opaque, honest frame of the shader.
9. **Write the code until the tests pass.** `claude plugin test .` and `node --test tools/tests/`.
10. **Look at it.** The app cannot be seen from here, so use the tools.
    - One frame of a shader: `node tools/preview.mjs hooks/wallpapers/<id>/shader.ts --at 3 --size 960x540 --out tools/out/a.png`, then read the PNG. The preview defaults to a prompt box of `0.2,0.05,0.8,0.15` (`--composer l,b,r,t`) and window points equal to pixels (`--points`).
    - A sheet: `--sheet 6 --over 6`. A video: `--video 6 --rate 15 --out tools/out/a.mp4`.
    - An SVG wallpaper: write its picture to a file, then render it. `node --input-type=module -e "import {writeFileSync} from 'node:fs'; import {WALLPAPERS,findWallpaper} from './hooks/core/registry.ts'; import {readSettings} from './hooks/core/options.ts'; writeFileSync('tools/out/a.svg', findWallpaper('<id>').svg(readSettings({wallpaper:'<id>'}, WALLPAPERS), Date.now()))"`, then `node tools/svg-to-png.mjs tools/out/a.svg tools/out/a.png --after 2`. Render at several `--after` times.
    - **Does it really move?** Cut a time slice from the video: one column of pixels from every frame, side by side, so the horizontal axis is time. `ffmpeg -i tools/out/a.mp4 -vf "format=rgb24,crop=1:ih:320:0,tile=90x1,scale=iw*8:ih:flags=neighbor" -frames:v 1 tools/out/slice.png` (change 320 to the column and 90 to the frame count: seconds times `--rate`). A still scene gives plain vertical stripes; motion gives bent or changing ones. Read the PNG.
    - **Through a blur.** The owner's panels blur the wallpaper. `ffmpeg -i tools/out/a.png -vf gblur=sigma=8 tools/out/blur.png` shows roughly what is left at their setting.
11. **Cost and flashing.**
    - `claude plugin validate .` must pass. For a shader read its cost line (the example is above).
    - An SVG wallpaper must also be measured as an `<img>`: see the rule on opacity and the rule on measuring below. No tool in this repo does it, so make a throwaway page with the SVG as a full-window `<img>` under a few `backdrop-filter: blur` panels, run it in headless Chrome, and compare raster time a second and frames drawn a second with Kiki's, which the owner runs. Say in your report what you measured and how.
    - Flashing: run the estimator, `tools/flash.mjs` (`flashMeter({ width, height, fps, pointsPerSample })`, `add(frame)`, `report()`), on 6 seconds of frames from `node tools/preview.mjs ... --frames 6 --raw tools/out/raw`, on a large window (1512x945) and a small one (800x600), at motion smooth and light. Keep the worst area **under 2,500 square points**, a quarter of the app's limit (10,000). The slow run in `tools/tests/blackhole-flash.test.mjs` does this for the black hole; copy it for a new shader. For an SVG wallpaper render frames with `svg-to-png.mjs`, take each pixel's luminance (`0.2126 r + 0.7152 g + 0.0722 b`) and feed the same meter.
12. **Docs.** Add the wallpaper to the table and the settings table in `README.md`, and an entry to `CHANGELOG.md` (newest first, dated, in the reader's words). Keep this file true.
13. **Release.** Run all of: `claude plugin test .`, `node --test tools/tests/`, `node tools/sync-manifest.mjs --check`, `node tools/make-still.mjs --check` (when the black hole changed), `claude plugin validate .`. Then commit, push to `main`, and tell the owner to run `/plugin marketplace update cwallpaper` and `/reload-plugins` (or wait if auto-update is on). **Ask the owner to look at it in the app and say what you did not see** (see the section on what an agent cannot check).

## Shader files: what the preview can run

The shader file is run twice: by the app (it compiles the file) and by the preview under Node, against `tools/shader-standin.mjs`. A file runs both ways only if it keeps to these rules. The stand-in tells you about 1 to 6; `claude plugin validate .` tells you about 7 to 9. Full text and examples are in `tools/README.md`.

1. Scalar arithmetic only: no `+ - * /` on a vector. Write `vec2(a.x * 2, a.y * 2)`.
2. One lane at a time: no swizzle of more than one lane (`p.point.xy` is wrong).
3. No `v[i]` on a vector; use `.x`, `.y`.
4. Never write into a vector's lanes.
5. Erasable TypeScript only: no `enum`, no value-renaming imports; use `import type`.
6. Guard what could be NaN or infinite (`x / max(d, 0.0001)`).
7. Keep to the app's language: no `while`, `do`, recursion, classes, `new`, `async`, strings as values, spread, other imports; a `for` whose bounds are known while reading.
8. Ints wrap in the app and are plain numbers here: keep a product under 2^53.
9. A `once` buffer reads no time, frame, pointer, values or moving buffer.
10. The preview throws on `shapes`, `pointer`, `scene`, `dx`, `dy`, `fwidth`. Check that part in the app.
11. Draw `p.point`, not `p.cell`, for anything the reader sees in points.
12. Numbers are 32-bit in the app and 64-bit in the preview: never compare computed floats with `==`.

## Rules learned the hard way

Each rule has its reason. Break none of them without telling the owner.

- [ ] **Hide what is not showing.** Frames switched by opacity must also be `visibility:hidden`, in the base rule and in every keyframe stop that sets opacity 0 (`0%{opacity:1;visibility:visible} N%{opacity:0;visibility:hidden}`), with the first frame visible by default. Drawn as an image, a frame at opacity 0 is still painted. Measured with 30 frames of text: 984 ms of drawing a second against 72 after the fix, and 2.8 of 10 steps a second reaching the screen against all 10. `display` in keyframes does not switch frames at all. Kiki's `hero.ts` and `world.ts` do this.
- [ ] **Exactly one frame visible at every instant and at time 0.** Write delays to enough decimals so two frames never overlap or leave a gap. With every animation taken away (motion off, Reduce Motion) the still must be a clean, finished picture.
- [ ] **Measure an animated SVG as an `<img>` before calling it done**, beside a wallpaper the owner already runs (Kiki). Pictures and videos made from stills look perfect and do not exercise the animated SVG. A build that passed 52 tests and looked right in every picture was "really laggy" in the app.
- [ ] **Nothing may blink.** No spot swings lighter and darker more than three times a second. Let slow things pick a character and fast things only change how brightly it is drawn. Keep quick change to a small area. Run the flash estimator and keep the worst area under a quarter of the app's limit (2,500 square points). The first ASCII black hole changed a third of its characters ten times a second and the app held it still after a while.
- [ ] **Motion has to be seen to be believed.** Cut a time slice (step 10). A first version passed every test and did not visibly move.
- [ ] **A wallpaper must not follow anything that moves while the owner types.** Only the prompt box's left and right edges may place it (its width and centre across), never its top or bottom: the box grows with every new line and would move and resize the picture with it. Two frames that differ only in the box's top and bottom must be the same picture.
- [ ] **Nothing follows the prompt box's top or bottom.** The box grows while the owner types. The black hole sits from the window and the box's left and right alone: `W = (right - left) * size.x` (`0.6 * size.x` with no box, and a box under 80 points wide counts as none), centre across `(left + right) / 2 * size.x`, up `0.57 * size.y`, `R = values.size * min(clamp(0.13 * W, 40, 125), 0.15 * size.y)`.
- [ ] **Take a change of geometry while dark.** Latch what the picture is drawn with; when the raw geometry differs by more than 0.4 points, fade out over 0.27 s (still drawn with the old one), stay dark while the inputs move, latch the new one after 0.17 s of stillness, fade in over 0.55 s. A change of pixel size cuts to dark at once. Working every cell out again on each frame of a change flashed at 39,124 against a limit of 2,500 (after the fix: 5 to 46).
- [ ] **Start dark and fade in**, and treat empty or cleared state buffers as a start, so the first frame and a cleared buffer never show a half-worked picture.
- [ ] **No per-frame random term decides what a cell shows.** Fix each cell's offset, give every switch a margin each way (a blank cell lights above one level and goes blank below a lower one), and hold a glyph at least half a second (1 s where bright, 1.8 s in calmer motion), so no dot turns more than three times a second.
- [ ] **Check each colour lane for flicker, not only luminance.** Dim red dots hide in luminance.
- [ ] **Test the changes, not only the settled picture.** Drive the inputs between frames with `drive()` from `tools/tests/blackhole-kit.mjs`: the window, the prompt box, the values, the frame time.
- [ ] **Pin what the eye must see, not only what a measure says.** The first candidates turned at 70 degrees a second by the test and looked still, because the glyphs never changed and the moving light was faint. Measure the change between frames half a second apart, the variety of glyphs, and how many cells change glyph.
- [ ] **Compare with the version the owner liked.** Measure it with the same test and write its numbers into the test's header, so "as good as" is a number.
- [ ] **A view from above the disc needs the shadow measured from its upper half**, since the front of the disc crosses the lower half.
- [ ] **For a look judged by eye, render candidates and let the owner pick before finishing.** The view was chosen from three renders; the first, almost edge-on version looked flat to the owner.
- [ ] **Work a spec's geometry through at each angle before it is pinned.** A disc starting two radii out left a dark almond-shaped gap round the hole (an eye with a pupil) at the high angle, where the owner's picture has the bright disc hugging the hole. The disc now starts at 1.25 R.
- [ ] **Traced light is not needed for a picture that reads as a black hole.** Painted back to front (far disc, far jet, near disc, near jet, sparks, with the black circle and its ring over the near disc at the high angle and the near disc fading in over the circle between about 20 and 12 degrees) it is cheaper (8.15 ms a frame on a weak GPU against 9.6) and lets the viewing angle change.
- [ ] **When the owner gives a picture, describe it part by part in the contract** and check each part against the first render before showing it.
- [ ] **Fine characters vanish behind blurred panels.** At a blur of 8 nothing is left of 6 by 10 point characters; a blur of about 1 keeps them. Say so to the owner. Do not change their setting.
- [ ] **Text in an SVG keeps to a grid only if each run's `textLength` is its character count less one, times the cell, plus one character's advance** (`still.ts`: `(chars.length - 1) * cellW + ADVANCE`), so the browser's own font does not shift the columns.
- [ ] **Settings are plugin options and nothing else.** A wallpaper's own options carry its name (`<id><Key>`, title "Label: ..."). The pane shows only the current wallpaper's. A command for another wallpaper's option is refused. Never keep a setting in `$.state`; it holds only `paneOpen`, `lookSet` and `pendingWrites`, under `CWallpaper`.
- [ ] **Nobody but the owner can see the app.** Use the preview tools, say plainly what was not seen, and never claim a look was checked in the app.
- [ ] **Draw everything yourself.** Copy no art, video or font from elsewhere. Fetch nothing from the web. The mod loads no picture or video of the owner's own.
- [ ] **Redraws are the mod's job, not the wallpaper's.** An `svg` wallpaper that moves is redrawn by `register.tsx` a few seconds after it first shows (3 and 12 seconds, each with a fresh empty `<g id="kw...">` before the last `</svg>`), because the app can leave an image built while the backdrop was hidden standing still. The scene must stay valid with that mark in it. A picture that changes with the clock is redrawn by the minute timer when `svg(settings, now)` gives a different string.
- [ ] **Dim is the wallpaper's own.** An SVG applies `settings.dim` itself (a black veil last). A shader gets it as the value `dim`, and its still applies it with the same number.
- [ ] **Never let the core import the engine.** Files under `hooks/core/` and `hooks/wallpapers/` have no `$`, no JSX, no clock and no store, so the plugin tests and Node can both import them. Only `register.tsx` touches the engine.

## What an agent cannot check

Report these as unverified every time:

- The app's real GPU: how a shader looks and costs in the app, its frame rate, whether the app judges it too dear.
- The app's own flash detector: the estimator in `tools/flash.mjs` follows the app's published rule, not its code.
- How the wallpaper looks behind the real panels, at the owner's blur and clearness, and on a phone.
- The settings pane and the plugin options screen as drawn.
- Reduce Motion and the mobile surface.
- What the app does to a shader's buffers at a resize, and whether it ever changes the pixel size while running (each such change is a short dark moment, by the black hole's rule).
- Motion pacing and feel. A video made from stills is not the app.
- Anything after a push: that `/plugin marketplace update cwallpaper` and `/reload-plugins` picked it up.

## Release

1. Every check in step 13 of "Making a wallpaper" passes.
2. `CHANGELOG.md` has the entry, `README.md` the wallpaper and its settings.
3. Commit with a message that says what the wallpaper is and what changed, push to `main`.
4. Tell the owner to run `/plugin marketplace update cwallpaper` and `/reload-plugins`, and to look.
5. Stop anything you started (a preview, a Chrome) and delete `tools/out/chrome-profile` if a run left it.

No version number is raised, because there is none. Never add one.
