import b from 'benny'

const { benchAsyncTask, benchThreadsafeFunction } = require('./index.node')

const buffer = Buffer.from('hello 🚀 rust!')

export const benchAsync = () =>
  b.suite(
    'Async task',
    b.add('spawn task', async () => {
      await benchAsyncTask(buffer)
    }),
    b.add('thread safe function', async () => {
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
    b.cycle(),
    b.complete(),
  )
