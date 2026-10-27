import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const native = require('../index.cjs')

// The rejected payload's `Drop` takes the write lock of the threadsafe function
// that rejected it. If the payload were dropped while the call still held its
// read lock, this call would never return.
console.log(
  `dropped ${native.issue3655RejectedPayloadLocksHandle(() => {})} rejected payload`,
)
