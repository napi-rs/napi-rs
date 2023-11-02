import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

let exports

if (process.env.WASI_TEST) {
  exports = await import('./index.wasi.mjs')
} else {
  exports = require('./index.node')
}

export default exports
