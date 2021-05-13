import b from 'benny'

const {
  getArrayFromJson,
  getArrayFromJsArray,
  getArrayWithForLoop,
} = require('./index.node')

const FIXTURE = Array.from({ length: 1000 }).fill(42)

export const benchGetArray = () =>
  b.suite(
    'getArrayFromJs',
    b.add('get array from json string', () => {
      getArrayFromJson(JSON.stringify(FIXTURE))
    }),
    b.add('get array from serde', () => {
      getArrayFromJsArray(FIXTURE)
    }),

    b.add('get array with for loop', () => {
      getArrayWithForLoop(FIXTURE)
    }),

    b.cycle(),
    b.complete(),
  )
