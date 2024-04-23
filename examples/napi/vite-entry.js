import { Buffer } from 'buffer'

import {
  Animal,
  Kind,
  asyncMultiTwo,
  tsfnReturnPromise,
  __fs,
  asyncTaskReadFile,
} from './example.wasi-browser'

global.Buffer = Buffer

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

__fs.writeFileSync('/test.txt', 'Hello, World!')

asyncTaskReadFile('/test.txt')
  .then((res) => {
    console.log(`readFileAsync: ${res}`)
  })
  .catch((err) => {
    console.error(err)
  })
