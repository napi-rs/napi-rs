import {
  Animal,
  Kind,
  asyncMultiTwo,
  tsfnReturnPromise,
} from './index.wasi-browser'

console.info(new Animal(Kind.Cat, 'Tom'))
asyncMultiTwo(200).then((res) => {
  console.info(res)
})
const value = await tsfnReturnPromise((err, value) => {
  if (err) {
    throw err
  }
  return Promise.resolve(value + 2)
})

console.info(value)
