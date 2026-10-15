import test from 'ava'

import { convertU32Array, eitherUint16OrFloat64Array } from '../index.cjs'

// Pins that a typed array argument which fails conversion (wrong element
// type, or not a typed array at all) is not kept alive by the native side.
// `FromNapiValue` for `Uint32Array` and its siblings takes a strong reference
// before it checks the type, and the error paths used to return without
// deleting it, so the value was never collected (and on wasm emnapi's copy of
// its buffer was never freed). Through `Either<Uint16Array, Float64Array>`
// that happened on calls that succeed.

async function getGc(): Promise<(() => void) | undefined> {
  const { setFlagsFromString } = await import('node:v8')
  const { runInNewContext } = await import('node:vm')
  // setFlagsFromString does not update the current context's global; the
  // exposed gc must be pulled out of a freshly created context.
  setFlagsFromString('--expose-gc')
  return runInNewContext('gc') as undefined | (() => void)
}

async function collect(gc: () => void, collected: Set<string>, count: number) {
  for (let i = 0; i < 50 && collected.size < count; i++) {
    gc()
    // FinalizationRegistry callbacks need a task turn.
    await new Promise((resolve) => setImmediate(resolve))
  }
}

test('a typed array argument that fails conversion can be collected', async (t) => {
  const gc = await getGc()
  if (!gc) {
    t.pass('gc not exposed; skipping')
    return
  }
  const collected = new Set<string>()
  const registry = new FinalizationRegistry<string>((name) => {
    collected.add(name)
  })
  const errors: string[] = []
  // Keep the inputs inside this function so nothing else holds them.
  ;(() => {
    const matching = new Uint32Array([1, 2])
    registry.register(matching, 'matching Uint32Array')
    t.deepEqual(convertU32Array(matching), [1, 2])
    const wrongType = new Float64Array(2)
    registry.register(wrongType, 'Float64Array')
    try {
      convertU32Array(wrongType as unknown as Uint32Array)
    } catch (e) {
      errors.push((e as Error).message)
    }
    const notTypedArray = [1, 2]
    registry.register(notTypedArray, 'plain Array')
    try {
      convertU32Array(notTypedArray as unknown as Uint32Array)
    } catch (e) {
      errors.push((e as Error).message)
    }
  })()
  t.deepEqual(errors, [
    'Expected Uint32Array, got Float64Array',
    'Get TypedArray info failed',
  ])
  const expected = ['Float64Array', 'matching Uint32Array', 'plain Array']
  await collect(gc, collected, expected.length)
  // 'matching Uint32Array' shows GC ran; the other two leaked before the fix.
  t.deepEqual([...collected].sort(), expected)
})

test('a typed array argument that a failed Either variant saw can be collected', async (t) => {
  const gc = await getGc()
  if (!gc) {
    t.pass('gc not exposed; skipping')
    return
  }
  const collected = new Set<string>()
  const registry = new FinalizationRegistry<string>((name) => {
    collected.add(name)
  })
  ;(() => {
    const uint16 = new Uint16Array([1, 2])
    registry.register(uint16, 'Uint16Array')
    t.is(eitherUint16OrFloat64Array(uint16), 'Uint16Array [1, 2]')
    // `Uint16Array` is tried first and fails, then `Float64Array` succeeds.
    const float64 = new Float64Array([1.5, 2.5])
    registry.register(float64, 'Float64Array')
    t.is(eitherUint16OrFloat64Array(float64), 'Float64Array [1.5, 2.5]')
  })()
  const expected = ['Float64Array', 'Uint16Array']
  await collect(gc, collected, expected.length)
  // 'Uint16Array' shows GC ran; the Float64Array leaked before the fix.
  t.deepEqual([...collected].sort(), expected)
})
