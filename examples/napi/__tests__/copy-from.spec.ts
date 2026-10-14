import test from 'ava'

import {
  arrayBufferCopyFrom,
  float64ArraySliceCopyFrom,
  uint16ArraySliceCopyFrom,
  uint8ArraySliceCopyFrom,
  uint8ClampedSliceCopyFrom,
} from '../index.cjs'

// Pins the `copy_from` constructors of `ArrayBuffer`, `Uint8ClampedSlice` and
// the typed `*ArraySlice`s: the output must be the right kind and hold every
// input value. They used to skip the copy (the output read 0), and the typed
// ones allocated one byte per element. The fixtures zero their input after the
// copy, so an output that still pointed at the input would read 0 too. On wasm
// the copy must also be synced to JS, which only the wasm binding checks (CI
// job test-node-wasi; locally NAPI_RS_FORCE_WASI=true).

for (const [name, copyFrom, Kind, values] of [
  ['ArrayBuffer', arrayBufferCopyFrom, ArrayBuffer, [1, 2, 255]],
  ['Uint8ArraySlice', uint8ArraySliceCopyFrom, Uint8Array, [1, 2, 255]],
  ['Uint16ArraySlice', uint16ArraySliceCopyFrom, Uint16Array, [1, 255, 65535]],
  [
    'Uint8ClampedSlice',
    uint8ClampedSliceCopyFrom,
    Uint8ClampedArray,
    [1, 2, 255],
  ],
  [
    'Float64ArraySlice',
    float64ArraySliceCopyFrom,
    Float64Array,
    [1.5, -2.25, 1e20],
  ],
] as const) {
  // The 1-value case takes the last value: for the multi-byte types its high
  // byte is not 0, so a sync that copies too few bytes cannot pass.
  for (const [label, input] of [
    ['3 values', [...values]],
    ['no values', []],
    ['1 value', [values[values.length - 1]]],
  ] as const) {
    test(`${name}::copy_from copies ${label}`, (t) => {
      const output = copyFrom([...input])
      // The exact kind: a Uint8Array is not a Uint8ClampedArray, and the
      // Uint8Array case must not be a subclass such as Buffer. Compare the
      // constructors, because ava cannot print a diff of two prototypes.
      t.is(output.constructor, Kind)
      const elements =
        output instanceof ArrayBuffer ? new Uint8Array(output) : output
      t.deepEqual(Array.from(elements), [...input])
    })
  }
}
