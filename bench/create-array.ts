import b from 'benny'

const {
  createArrayJson,
  createArray,
  createArrayWithSerdeTrait,
} = require('./index.node')

export const benchCreateArray = () =>
  b.suite(
    'createArray',
    b.add('createArrayJson', () => {
      JSON.parse(createArrayJson())
    }),
    b.add('create array for loop', () => {
      createArray()
    }),

    b.add('create array with serde trait', () => {
      createArrayWithSerdeTrait()
    }),

    b.cycle(),
    b.complete(),
  )
