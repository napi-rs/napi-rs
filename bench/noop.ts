import b from 'benny'

const { noop: napiNoop } = require('./index.node')

function noop() {}

export const benchNoop = () =>
  b.suite(
    'noop',
    b.add('napi-rs', () => {
      napiNoop()
    }),
    b.add('JavaScript', () => {
      noop()
    }),

    b.cycle(),
    b.complete(),
  )
