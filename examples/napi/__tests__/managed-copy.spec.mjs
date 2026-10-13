import { test } from './test.framework.js'
import {
  copiedBytes,
  copiedWords,
  copiedClamped,
  copiedBuffer,
  copiedDoubles,
} from '../index.cjs'

for (const [name, copy, values] of [
  ['bytes', copiedBytes, [1, 2, 255]],
  ['words', copiedWords, [1, 255, 65535]],
  ['clamped', copiedClamped, [1, 2, 255]],
  ['buffer', copiedBuffer, [1, 2, 255]],
  ['doubles', copiedDoubles, [1.5, -2.25, 1e20]],
]) {
  for (const input of [values, [], [values[0]]]) {
    test(`managed ${name} copy preserves ${input.length} values`, (t) => {
      const output = copy(input)
      const actual =
        output instanceof ArrayBuffer ? new Uint8Array(output) : output
      t.deepEqual(Array.from(actual), input)
    })
  }
  test(`managed ${name} copy rejects non-array input`, (t) => {
    t.throws(() => copy('invalid'))
  })
}
