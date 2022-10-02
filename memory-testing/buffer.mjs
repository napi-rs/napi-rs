import { createRequire } from 'module'
import { setTimeout } from 'timers/promises'

import { displayMemoryUsageFromNode } from './util.mjs'

const initialMemoryUsage = process.memoryUsage()

const require = createRequire(import.meta.url)

const api = require(`./index.node`)

let i = 1
const FIXTURE = Buffer.allocUnsafe(1000 * 1000 * 20)
// eslint-disable-next-line no-constant-condition
while (true) {
  api.bufferLen()
  api.arrayBufferLen()
  api.bufferConvert(Buffer.from(FIXTURE))
  api.arrayBufferConvert(Uint8Array.from(FIXTURE))
  api.bufferPassThrough(Buffer.from(FIXTURE))
  api.arrayBufferPassThrough(Uint8Array.from(FIXTURE))
  if (i % 10 === 0) {
    await setTimeout(1000)
    global?.gc?.()
    displayMemoryUsageFromNode(initialMemoryUsage)
  }
  i++
}
