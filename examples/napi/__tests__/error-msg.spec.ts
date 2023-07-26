import test from 'ava'

import { receiveString } from '..'

test('Function message', (t) => {
  // @ts-expect-error
  t.throws(() => receiveString(function a() {}), {
    message:
      'Failed to convert JavaScript value `function a(..) ` into rust type `String`',
  })
  // @ts-expect-error
  t.throws(() => receiveString(() => {}), {
    message:
      'Failed to convert JavaScript value `function anonymous(..) ` into rust type `String`',
  })
  // @ts-expect-error
  t.throws(() => receiveString(1), {
    message:
      'Failed to convert JavaScript value `Number 1 ` into rust type `String`',
  })
  t.throws(
    () =>
      // @ts-expect-error
      receiveString({
        a: 1,
        b: {
          foo: 'bar',
          s: false,
        },
      }),
    {
      message:
        'Failed to convert JavaScript value `Object {"a":1,"b":{"foo":"bar","s":false}}` into rust type `String`',
    },
  )
  // @ts-expect-error
  t.throws(() => receiveString(Symbol('1')), {
    message:
      'Failed to convert JavaScript value `Symbol` into rust type `String`',
  })

  // @ts-expect-error
  t.throws(() => receiveString(), {
    message:
      'Failed to convert JavaScript value `Undefined` into rust type `String`',
  })

  // @ts-expect-error
  t.throws(() => receiveString(null), {
    message:
      'Failed to convert JavaScript value `Null` into rust type `String`',
  })

  // @ts-expect-error
  t.throws(() => receiveString(100n), {
    message:
      'Failed to convert JavaScript value `BigInt 100 ` into rust type `String`',
  })
})
