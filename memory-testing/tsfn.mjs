import { createRequire } from 'module'
import { setTimeout } from 'timers/promises'

import { displayMemoryUsageFromNode } from './util.mjs'

const initialMemoryUsage = process.memoryUsage()

const require = createRequire(import.meta.url)

const api = require(`./index.node`)

let i = 1
// eslint-disable-next-line no-constant-condition
while (true) {
  api.leakingFunc(() => {})
  if (i % 100000 === 0) {
    await setTimeout(100)
    global.gc?.()
    displayMemoryUsageFromNode(initialMemoryUsage)
  }
  i++
}
