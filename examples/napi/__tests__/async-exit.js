import assert from 'node:assert'

import { fetch } from '../index.cjs'

const res = await fetch(process.env.ASYNC_EXIT_URL, {
  headers: {
    Accept: 'application/json',
  },
})

assert(res instanceof Response)

console.info(
  `[${import.meta.filename.split('/').pop()}] All assertions passed.`,
)
