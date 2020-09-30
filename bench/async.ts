import b from 'benny'

const { benchAsyncTask } = require('./index.node')

const buffer = Buffer.from('hello 🚀 rust!')

export const benchAsync = () =>
  b.suite(
    'Async task',
    b.add('napi-rs', async () => {
      await benchAsyncTask(buffer)
    }),
    b.cycle(),
    b.complete(),
  )
