import { createRequire } from 'node:module'

import { bench } from 'vitest'

const require = createRequire(import.meta.url)

const {
  getArrayFromJson,
  getArrayFromJsArray,
  getArrayWithForLoop,
} = require('./index.node')

const FIXTURE = Array.from({ length: 1000 }).fill(42)

bench('get array from json string', () => {
  getArrayFromJson(JSON.stringify(FIXTURE))
})

bench('get array from serde', () => {
  getArrayFromJsArray(FIXTURE)
})

bench('get array with for loop', () => {
  getArrayWithForLoop(FIXTURE)
})
