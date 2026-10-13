import { test } from './test.framework.js'
import { syncWords, syncDoubles } from '../index.cjs'

for (const [name, sync, ArrayType, value] of [
  ['words', syncWords, Uint16Array, 0x1234],
  ['doubles', syncDoubles, Float64Array, -2.25],
]) {
  test(`sync empty ${name} leaves the view empty`, (t) => {
    const view = new ArrayType(0)
    t.is(sync(view), undefined)
    t.deepEqual(Array.from(view), [])
  })

  for (const offset of [0, 1]) {
    test(`sync ${name} updates the full view at offset ${offset}`, (t) => {
      const values = [11, 22, 33, 44, 55]
      const backing = new ArrayType(values)
      const view = new ArrayType(
        backing.buffer,
        offset * ArrayType.BYTES_PER_ELEMENT,
        3,
      )
      t.is(sync(view), undefined)
      values.fill(value, offset, offset + view.length)
      t.deepEqual(Array.from(backing), values)
    })
  }
}
