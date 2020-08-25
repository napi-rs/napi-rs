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
