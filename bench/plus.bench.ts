import { createRequire } from 'node:module'

import { bench } from 'vitest'

const require = createRequire(import.meta.url)

const { plus } = require('./index.node')

function plusJavascript(a: number, b: number) {
  return a + b
}

bench('napi-rs', () => {
  plus(1, 100)
})

bench('JavaScript', () => {
  plusJavascript(1, 100)
})
