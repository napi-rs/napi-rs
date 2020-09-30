import b from 'benny'

const { plus } = require('./index.node')

function plusJavascript(a: number, b: number) {
  return a + b
}

export const benchPlus = () =>
  b.suite(
    'Plus number',
    b.add('napi-rs', () => {
      plus(1, 100)
    }),
    b.add('JavaScript', () => {
      plusJavascript(1, 100)
    }),

    b.cycle(),
    b.complete(),
  )
