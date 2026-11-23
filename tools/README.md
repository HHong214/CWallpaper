# tools: look at a wallpaper without the app

Nobody can see the desktop app from here. A wallpaper that is a GPU shader
(a file written against `'claude-code/shader'`) is run on the CPU instead, and
pictures and a video are written to `tools/out/` (git ignores it).

Node 24 and, for video, `ffmpeg` on the PATH. Nothing is installed.

| File | What it is |
|---|---|
| `preview.mjs` | the command line: one frame, a sheet, a video, or every frame's luminance |
| `render.mjs` | the renderer behind it (steps the passes frame by frame) |
| `shader-standin.mjs` | the stand-in for `'claude-code/shader'` |
| `loader.mjs` | the Node hook that maps that import to the stand-in |
| `png.mjs` | a PNG writer on Node's own `zlib` |
| `svg-to-png.mjs` | renders an SVG with headless Chrome |
| `examples/ascii.ts` | a worked example, the first shader this was built on |
| `tests/` | smoke tests |

## Run

One frame (it steps every earlier frame first, so buffers hold what they would):

```
node tools/preview.mjs tools/examples/ascii.ts --at 1 --size 960x540 --out tools/out/ascii-1s.png
```

Six frames in one picture, evenly spaced, the last at `--at + --over` (left to
right, top to bottom):

```
node tools/preview.mjs tools/examples/ascii.ts --sheet 6 --over 6 --size 480x270 --out tools/out/ascii-sheet.png
```

An mp4 (`--rate` pictures a second, default 15; the shader still steps at its own fps):

```
node tools/preview.mjs tools/examples/ascii.ts --video 4 --rate 15 --size 640x360 --out tools/out/ascii.mp4
```

The luminance of every frame, for a later flash check: one `frame-NNNNNN.f32`
a frame (float32 little-endian, width x height, top row first, relative
luminance in linear light over the dark ground) and a `meta.json`:

```
node tools/preview.mjs tools/examples/ascii.ts --frames 3 --raw tools/out/ascii-raw --size 240x135
```

Options: `--at <s>` (default 0), `--size WxH` (the target in pixels, default
960x540, this is `res`), `--points WxH` (the window in points, this is `size`;
default the same as `--size`, so `px` is 1), `--values name=number,...` (the
shader's `values()`, each held to its range, each rounded to 10 bits of it as the
app does), `--composer left,bottom,right,top` (default `0.2,0.05,0.8,0.15`),
`--fps` (default the shader's own), `--out`. The picture is premultiplied, so it
is drawn over the ground colour `10, 13, 26`. Each drawn frame prints the time
it took; a value that was NaN or infinite is drawn as 0 and reported at the end.

Time grows with pixels and with full-size buffers: stepping 180 frames through a
full-size buffer at 960x540 is slow, at 480x270 it is a quarter of that.

A shader that fails stops with one line (`error: ...`). The stand-in refuses what it
cannot do in plain words (see below).

### An SVG

The wallpaper's `Svg` scene is a plain SVG; look at it with headless Chrome:

```
node tools/svg-to-png.mjs scene.svg tools/out/scene.png --size 960x540 --after 2
```

`--after <s>` holds every SMIL and CSS animation at that second. `--background`
is the colour behind it (default `#0a0d1a`). `--size` is at least 640x360:
headless Chrome misplaces the scene in a smaller window. One Chrome at a time:
`tools/out/chrome-profile` is its lock and is deleted afterwards.

### Tests

```
node --test tools/tests/
```

(`tools/tests/index.js` exists only because Node 24 loads a folder argument as one
module. `node --test tools/tests/*.test.mjs` runs the same tests.)

## What a shader file must keep to run both in the app and here

The app compiles the file and never runs it; here it is plain TypeScript run by
Node (type stripping), against the stand-in. A file runs both ways only if it keeps
to these. The stand-in tells you about the first six; the app (`claude plugin
validate .`) tells you about the rest, and the stand-in does not check them.

1. **Scalar arithmetic only: no `+ - * /` on a vector.** Here a vector is an object and the line throws.
   Wrong: `const c = vec2(a, b) * 2`. Right: `const c = vec2(a * 2, b * 2)`.
2. **One lane at a time: no swizzle of more than one lane.**
   Wrong: `p.point.xy`. Right: `vec2(p.point.x, p.point.y)`.
3. **No `v[i]` on a vector.** Wrong: `c[0]`. Right: `c.x`.
4. **Never write into a vector's lanes.** The app copies a vector; here two names share one.
   Wrong: `const d = c; d.x = 1`. Right: `const d = vec2(1, c.y)`.
5. **Erasable TypeScript only.** Types are removed, nothing is generated.
   Wrong: `enum Mode { A, B }` or `import { Buffer as Buf }`. Right: `const MODE_A = 0` and `import type { Buffer as Buf }`.
6. **Guard what could be NaN or infinite.** The app never has either; here a bad value is drawn as 0 and reported.
   Wrong: `x / d`. Right: `x / max(d, 0.0001)`.
7. **Keep to the app's language.** Not checked here: `while`, `do`, recursion, classes, `new`, `async`,
   strings as values, spread, other imports, a function that sets a top-level `let`, a `for` whose bounds are not known while reading.
   Wrong: `while (i < n) { i++ }`. Right: `for (let i = 0; i < 8; i++) { ... }`.
8. **Ints wrap in the app and are plain numbers here.** Name the result and keep the product under 2^53.
   Wrong: `h * 1664525` (a long hash chain). Right: `int((h & 0xffff) * 1664525)`.
9. **`once` buffers read no time, frame, pointer, values or moving buffer.** Not checked here.
   Wrong: `buffer({ once: true }, p => vec4(sin(time)))`. Right: `buffer({ once: true }, p => vec4(sin(p.uv.x)))`.
10. **Nothing that needs the app's inputs:** `shapes`, `pointer` (and so a `pointers` loop that does anything),
    `scene`, `dx`, `dy`, `fwidth` throw here (`pointerCount` is 0). Draw without them, or check that part in the app.
11. **Draw `p.point`, not `p.cell`, for anything the reader sees in points.** A buffer's cell is in texels, the
    picture's is in pixels, and a window of 1512x945 points is not 1512x945 pixels (`--points`, `--size`).
    Wrong: `floor(p.cell.x / 7)` in a picture. Right: `floor(p.point.x / 7)`.
12. **Numbers are 32-bit floats in the app and 64-bit here.** Do not lean on the last digits.
    Wrong: `a == b` on two computed floats. Right: `abs(a - b) < 0.0001`.

How the stand-in matches the type file: every function it lists works on numbers (and lane by lane on
vectors); `mod` has the sign of `b`, `quot` cuts toward zero, `atan(y, x)`, `step(edge, x)` is 0 below the
edge, `smoothstep` takes its edges in either order, `table(...).at` clamps, `values` are held to their
range. A `buffer` without `float` keeps 0 to 1 in 8 bits; `float: 16` rounds to half precision; `repeat`
runs it more than once a frame (with `turn`); `once` runs on frame 0 only; a buffer is read as it was after its
last run (it can read itself); `filter: 'mipmap'` reads as `'linear'` (the lod is ignored).
