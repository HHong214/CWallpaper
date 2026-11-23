// `node --test tools/tests/` (a folder) makes Node 24 load the folder as one module.
// This file is that module: it loads the test files here. `node --test tools/tests/*.test.mjs` works too.
// The black hole's flash run is slow (minutes: see its header): it is imported only with SLOW set,
// `SLOW=1 node --test tools/tests/` (PowerShell: `$env:SLOW = '1'; node --test tools/tests/`).
const files = [
  './standin.test.mjs',
  './preview.test.mjs',
  './flash.test.mjs',
  './blackhole.test.mjs',
  './still.test.mjs',
  './manifest.test.mjs',
]
if (process.env.SLOW) files.push('./blackhole-flash.test.mjs')
Promise.all(files.map(f => import(f))).catch(e => {
  console.error(e)
  process.exitCode = 1
})
