import { createRequire } from 'node:module'

import { bench } from 'vitest'

const require = createRequire(import.meta.url)

const { noop: napiNoop } = require('./index.node')

function noop() {}

bench('napi-rs', () => {
  napiNoop()
})

bench('JavaScript', () => {
  noop()
})
