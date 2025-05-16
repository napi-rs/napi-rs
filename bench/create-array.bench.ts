import { createRequire } from 'node:module'

import { bench } from 'vitest'

const require = createRequire(import.meta.url)

const {
  createArrayJson,
  createArray,
  createArrayWithSerdeTrait,
} = require('./index.node')

bench('createArrayJson', () => {
  JSON.parse(createArrayJson())
})

bench('create array for loop', () => {
  createArray()
})

bench('create array with serde trait', () => {
  createArrayWithSerdeTrait()
})
