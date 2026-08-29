import test from 'ava'

import { createPanickingClosureFunction } from '../index'

test('create_function_from_closure: panic in the closure becomes a JS error', (t) => {
  const data = createPanickingClosureFunction()
  const err = t.throws(() => data.handle())
  t.true(err!.message.includes('boom from closure'))
})
