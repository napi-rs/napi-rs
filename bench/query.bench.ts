import { createRequire } from 'node:module'

import { bench } from 'vitest'

const require = createRequire(import.meta.url)

const { query, engine } = require('./index.node')

const e = engine('model A {}')

bench('query * 100', async () => {
  await Promise.all(Array.from({ length: 100 }).map(() => query(e)))
})

bench('query * 1', async () => {
  await query(e)
})
