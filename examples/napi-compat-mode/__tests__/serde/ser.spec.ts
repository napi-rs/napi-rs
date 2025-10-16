import { test } from 'node:test'
import assert from 'node:assert'

import { napiVersion } from '../napi-version'

// @ts-expect-error
import bindings from '../../index.node'

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
  test(`serialize ${func} from bindings`, () => {
    // Snapshot: bindings[func]()
  })
}

test('serialize make_bytes_struct', () => {
  assert.deepStrictEqual(bindings.make_bytes_struct(), {
    code: Buffer.from([0, 1, 2, 3]),
    map: 'source map',
  })
})
