import test from 'ava'

import {
  float64ArraySync,
  uint16ArraySync,
  uint16ArraySyncAfterCallback,
} from '../index.cjs'

// Pins `TypedArray::sync`, which copies what Rust wrote through `as_mut()`
// back to the JS view: the whole view, at the view's own byteOffset, nothing
// for an empty view, and never more than the elements Rust saw when the view
// came in. `sync()` exists only on wasm, so its bugs show only with the wasm
// binding (CI job test-node-wasi; locally NAPI_RS_FORCE_WASI=true). On native
// these tests still check the `as_mut()` writes.

interface ViewKind<T> {
  readonly BYTES_PER_ELEMENT: number
  new (length: number): T
  new (values: number[]): T
  new (buffer: ArrayBufferLike, byteOffset: number, length: number): T
}

function syncTests<T extends Uint16Array | Float64Array>(
  name: string,
  Kind: ViewKind<T>,
  sync: (view: T) => void,
  value: number,
) {
  test(`${name} sync leaves an empty view empty`, (t) => {
    const view = new Kind(0)
    t.is(sync(view), undefined)
    t.deepEqual(Array.from(view), [])
  })

  for (const offset of [0, 1]) {
    test(`${name} sync updates the whole view at element offset ${offset}`, (t) => {
      const values = [11, 22, 33, 44, 55]
      const backing = new Kind(values)
      const view = new Kind(backing.buffer, offset * Kind.BYTES_PER_ELEMENT, 3)
      t.is(sync(view), undefined)
      values.fill(value, offset, offset + view.length)
      t.deepEqual(Array.from(backing), values)
    })
  }
}

syncTests('Uint16Array', Uint16Array, uint16ArraySync, 0x1234)
syncTests('Float64Array', Float64Array, float64ArraySync, -2.25)

// The view tracks a resizable buffer, and the callback resizes it after Rust
// wrote 3 elements and before `sync()`.
for (const [label, byteLength, expected] of [
  // Rust's 3 elements, then the tail that JS wrote after the grow.
  [
    'stops at the elements Rust saw when JS grew the buffer',
    32,
    Array.from({ length: 16 }, (_, i) => (i < 3 ? 0x1234 : 0x7777)),
  ],
  ['copies only what is left when JS shrank the buffer', 2, [0x1234]],
] as const) {
  test(`Uint16Array sync ${label}`, (t) => {
    // Resizable ArrayBuffers need Node 20+.
    if (typeof ArrayBuffer.prototype.resize !== 'function') {
      t.pass()
      return
    }
    const buffer = new ArrayBuffer(6, { maxByteLength: 64 })
    // No length given, so the view tracks the buffer: 3 elements here.
    const view = new Uint16Array(buffer)
    uint16ArraySyncAfterCallback(view, () => {
      buffer.resize(byteLength)
      view.fill(0x7777, 3)
    })
    t.deepEqual(Array.from(view), expected)
  })
}
