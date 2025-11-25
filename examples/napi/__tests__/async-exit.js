import assert from 'node:assert'

import { fetch } from '../index.cjs'

const res = await fetch('https://api.github.com/repos/napi-rs/napi-rs', {
  headers: {
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/json',
    'User-Agent': 'napi-rs/napi-rs',
  },
})

assert(res instanceof Response)

console.info(
  `[${import.meta.filename.split('/').pop()}] All assertions passed.`,
)
