import { createRequire } from 'module'
import { setTimeout } from 'timers/promises'

import { displayMemoryUsageFromNode } from './util.mjs'

const initialMemoryUsage = process.memoryUsage()

const require = createRequire(import.meta.url)

const api = require(`./index.node`)

let i = 1
// eslint-disable-next-line no-constant-condition
while (true) {
  api.bufferLen()
  api.arrayBufferLen()
  api.bufferConvert(Buffer.from(Array.from({ length: 1024 * 10240 }).fill(1)))
  api.arrayBufferConvert(
    Uint8Array.from(Array.from({ length: 1024 * 10240 }).fill(1)),
  )
  if (i % 10 === 0) {
    await setTimeout(100)
    displayMemoryUsageFromNode(initialMemoryUsage)
  }
  i++
}
