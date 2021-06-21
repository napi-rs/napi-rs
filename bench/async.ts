import { cpus } from 'os'

import b from 'benny'

const {
  benchAsyncTask,
  benchThreadsafeFunction,
  benchTokioFuture,
} = require('./index.node')

const buffer = Buffer.from('hello 🚀 rust!')

const ALL_THREADS = Array.from({ length: cpus().length })

export const benchAsync = () =>
  b.suite(
    'Async task',
    b.add('spawn task', async () => {
      await Promise.all(ALL_THREADS.map(() => benchAsyncTask(buffer)))
    }),
    b.add('ThreadSafeFunction', async () => {
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
    }),
    b.add('Tokio future to Promise', async () => {
      await Promise.all(ALL_THREADS.map(() => benchTokioFuture(buffer)))
    }),
    b.cycle(),
    b.complete(),
  )
