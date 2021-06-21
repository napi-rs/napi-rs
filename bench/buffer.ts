import b from 'benny'

const { benchCreateBuffer } = require('./index.node')

function createBuffer() {
  const buf = Buffer.allocUnsafe(1024)
  buf[0] = 1
  buf[1] = 2
  return buf
}

export const benchBuffer = () =>
  b.suite(
    'Create buffer',
    b.add('napi-rs', () => {
      benchCreateBuffer()
    }),
    b.add('JavaScript', () => {
      createBuffer()
    }),
    b.cycle(),
    b.complete(),
  )
