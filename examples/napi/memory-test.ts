import { AsyncThrowClass } from './index.cjs'

function test() {
  const asyncThrowClass = new AsyncThrowClass()
  asyncThrowClass.asyncThrowError().catch((err) => {
    console.error(err)
  })
  return new WeakRef(asyncThrowClass)
}

const wr = test()

setInterval(() => {
  global.gc?.()
  if (wr.deref() === undefined) {
    console.info('No leak')
    process.exit(0)
  }
}, 1000)
