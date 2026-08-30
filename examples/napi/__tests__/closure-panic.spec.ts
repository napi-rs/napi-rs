import test from 'ava'

import { createPanickingClosureFunction } from '../index.cjs'

test('create_function_from_closure: panic in the closure becomes a JS error', (t) => {
  if (process.env.SKIP_UNWIND_TEST) {
    t.pass('no unwind runtime')
    return
  }
  const data = createPanickingClosureFunction()
  const err = t.throws(() => data.handle())
  // On WASI targets panics cannot be caught: the trap surfaces as a
  // catchable `RuntimeError: unreachable` without the panic message.
  if (!process.env.WASI_TEST) {
    t.true(err!.message.includes('boom from closure'))
  }
})
