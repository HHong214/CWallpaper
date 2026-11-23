// `node --test tools/tests/` (a folder) makes Node 24 load the folder as one module.
// This file is that module: it loads the test files here. `node --test tools/tests/*.test.mjs` works too.
Promise.all([import('./standin.test.mjs'), import('./preview.test.mjs')]).catch(e => {
  console.error(e)
  process.exitCode = 1
})
