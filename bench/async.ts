import b from 'benny'

const {
  benchAsyncTask,
  benchThreadsafeFunction,
  benchTokioFuture,
} = require('./index.node')

const buffer = Buffer.from('hello 🚀 rust!')

export const benchAsync = () =>
  b.suite(
    'Async task',
    b.add('spawn task', async () => {
      await benchAsyncTask(buffer)
    }),
    b.add('ThreadSafeFunction', async () => {
      await new Promise<number | undefined>((resolve, reject) => {
        benchThreadsafeFunction(buffer, (err?: Error, value?: number) => {
          if (err) {
            reject(err)
          } else {
            resolve(value)
          }
        })
      })
    }),
    b.add('Tokio future to Promise', async () => {
      await benchTokioFuture(buffer)
    }),
    b.cycle(),
    b.complete(),
  )
