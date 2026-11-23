// Node module hook: maps the import 'claude-code/shader' to tools/shader-standin.mjs,
// so a shader file is imported as it is. Registered by tools/render.mjs:
//   register('./loader.mjs', import.meta.url)
export async function resolve(specifier, context, next) {
  if (specifier === 'claude-code/shader') {
    return { url: new URL('./shader-standin.mjs', import.meta.url).href, shortCircuit: true }
  }
  return next(specifier, context)
}
