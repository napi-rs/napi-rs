import { createRequire } from 'module'

import { displayMemoryUsageFromNode } from './util.mjs'

const initialMemoryUsage = process.memoryUsage()

const require = createRequire(import.meta.url)

const { MemoryHolder } = require(`./index.node`)

const sleep = () =>
  new Promise((resolve) => {
    setTimeout(() => {
      resolve()
    }, 1000)
  })

let i = 1
// eslint-disable-next-line no-constant-condition
while (true) {
  const holder = new MemoryHolder(1024 * 1024)
  for (const _ of Array.from({ length: 100 })) {
    const child = holder.createReference()
    child.count()
  }
  if (i % 100 === 0) {
    displayMemoryUsageFromNode(initialMemoryUsage)
    await sleep()
    global.gc()
  }
  i++
}
