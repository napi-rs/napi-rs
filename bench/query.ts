import b from 'benny'

const { query, engine } = require('./index.node')

const e = engine('model A {}')

export const benchQuery = () =>
  b.suite(
    'Query',
    b.add('napi-rs', async () => {
      await Promise.all(Array.from({ length: 100 }).map(() => query(e)))
    }),
    b.add('neon', async () => {
      await query(e)
    }),

    b.cycle(),
    b.complete(),
  )
