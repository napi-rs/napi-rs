import { parentPort } from 'node:worker_threads'

import native from '../index.cjs'

const isWasiTest = !!process.env.WASI_TEST

parentPort.on('message', ({ type }) => {
  switch (type) {
    case 'require':
      parentPort.postMessage(
        native.Animal.withKind(native.Kind.Cat).whoami() + native.DEFAULT_COST,
      )
      break
    case 'async:buffer':
      Promise.all(
        Array.from({ length: isWasiTest ? 2 : 100 }).map(() =>
          native.bufferPassThrough(Buffer.from([1, 2, 3])),
        ),
      )
        .then(() => {
          parentPort.postMessage('done')
        })
        .catch((e) => {
          throw e
        })
      break
    case 'async:arraybuffer':
      Promise.all(
        Array.from({ length: isWasiTest ? 2 : 100 }).map(() =>
          native.arrayBufferPassThrough(Uint8Array.from([1, 2, 3])),
        ),
      )
        .then(() => {
          parentPort.postMessage('done')
        })
        .catch((e) => {
          throw e
        })

      break
    case 'constructor':
      let ellie
      for (let i = 0; i < (isWasiTest ? 10 : 1000); i++) {
        ellie = new native.Animal(native.Kind.Cat, 'Ellie')
      }
      parentPort.postMessage(ellie.name)
      break
    default:
      throw new TypeError(`Unknown message type: ${type}`)
  }
})
