// `node --test tools/tests/` (a folder) makes Node 24 load the folder as one module.
// This file is that module: it loads the test files here. `node --test tools/tests/*.test.mjs` works too.
// The black hole's flash runs are slow (minutes: see their headers): it is imported only with SLOW set,
// `SLOW=1 node --test tools/tests/` (PowerShell: `$env:SLOW = '1'; node --test tools/tests/`).
const files = [
  './standin.test.mjs',
  './preview.test.mjs',
  './flash.test.mjs',
  './blackhole.test.mjs',
  './still.test.mjs',
  './manifest.test.mjs',
  './blackhole-geometry.test.mjs',
  './blackhole-stability.test.mjs',
  './blackhole-measure.test.mjs',
  './blackhole-look.test.mjs',
  './blackhole-visible.test.mjs',
]
if (process.env.SLOW) files.push('./blackhole-flash.test.mjs', './blackhole-geometry-flash.test.mjs', './blackhole-spin.test.mjs', './blackhole-calm.test.mjs')
Promise.all(files.map(f => import(f))).catch(e => {
  console.error(e)
  process.exitCode = 1
})
