import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const first = require('../index.cjs')

// Added before the second registration below, so it runs after Node closed
// that registration's custom-GC threadsafe function: Node runs env cleanup
// hooks last added first.
first.dropHeldFunctionRefsAtTeardown()

// Register the addon a second time in this env (unload.spec.js loads it twice
// too). The registration creates its own custom-GC threadsafe function, and
// the references made below are released through it.
const addonPath = Object.keys(require.cache).find((file) =>
  file.endsWith('.node'),
)
if (!addonPath) {
  throw new Error('the native addon was not loaded through require')
}
const second = { exports: {} }
process.dlopen(second, addonPath)
second.exports.holdFunctionRefsOnThread([() => {}, () => {}, () => {}])
