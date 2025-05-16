import { createRequire } from 'node:module'

import { bench } from 'vitest'

const require = createRequire(import.meta.url)

const { benchCreateBuffer } = require('./index.node')

function createBuffer() {
  const buf = Buffer.allocUnsafe(1024)
  buf[0] = 1
  buf[1] = 2
  return buf
}

bench('napi-rs', () => {
  benchCreateBuffer()
})

bench('JavaScript', () => {
  createBuffer()
})
