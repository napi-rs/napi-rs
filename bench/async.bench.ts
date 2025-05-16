import { cpus } from 'node:os'
import { createRequire } from 'node:module'

import { bench } from 'vitest'

const require = createRequire(import.meta.url)

const {
  benchAsyncTask,
  benchThreadsafeFunction,
  benchTokioFuture,
} = require('./index.node')

const buffer = Buffer.from('hello 🚀 rust!')

const ALL_THREADS = Array.from({ length: cpus().length })

bench('spawn task', async () => {
  await Promise.all(ALL_THREADS.map(() => benchAsyncTask(buffer)))
})

bench('ThreadSafeFunction', async () => {
  await Promise.all(
    ALL_THREADS.map(
      () =>
        new Promise<number | undefined>((resolve, reject) => {
          benchThreadsafeFunction(buffer, (err?: Error, value?: number) => {
            if (err) {
              reject(err)
            } else {
              resolve(value)
            }
          })
        }),
    ),
  )
})

bench('Tokio future to Promise', async () => {
  await Promise.all(ALL_THREADS.map(() => benchTokioFuture(buffer)))
})
