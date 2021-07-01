import test from 'ava'

import { napiVersion } from '../napi-version'

const bindings = require('../../index.node')

const testFunc = [
  'make_num_77',
  'make_num_32',
  'make_str_hello',
  'make_num_array',
  'make_buff',
  'make_obj',
  'make_map',
  'make_bytes_struct',
]

if (napiVersion >= 6) {
  // bigint inside
  testFunc.push('make_object')
}

for (const func of testFunc) {
  test(`serialize ${func} from bindings`, (t) => {
    t.snapshot(bindings[func]())
  })
}

test('serialize make_bytes_struct', (t) => {
  t.deepEqual(bindings.make_bytes_struct(), {
    code: Buffer.from([0, 1, 2, 3]),
    map: 'source map',
  })
})

test('makes empty enum from rust to js', (t) => {
  t.deepEqual(bindings.make_empty_enum(), 'Empty')
})

test('makes tuple enum from rust to js', (t) => {
  t.deepEqual(bindings.make_tuple_enum(), {
    Tuple: [1, '2'],
  })
})

test('makes struct enum from rust to js', (t) => {
  t.deepEqual(bindings.make_struct_enum(), {
    Struct: { a: 127, b: [1, 2, 3] },
  })
})

test('makes value enum from rust to js', (t) => {
  t.deepEqual(bindings.make_value_enum(), {
    Value: ['a', 'b', 'c'],
  })
})
