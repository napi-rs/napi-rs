import b from 'benny'

const { query, engine } = require('./index.node')

const e = engine('model A {}')

export const benchQuery = () =>
  b.suite(
    'Query',
    b.add('query * 100', async () => {
      await Promise.all(Array.from({ length: 100 }).map(() => query(e)))
    }),
    b.add('query * 1', async () => {
      await query(e)
    }),

    b.cycle(),
    b.complete(),
  )
