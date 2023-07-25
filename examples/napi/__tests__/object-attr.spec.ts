import { createRequire } from 'node:module'

import test from 'ava'

const require = createRequire(import.meta.url)

const {
  NotWritableClass,
}: typeof import('../index.js') = require('../index.node')
import { NotWritableClass } from '..'
import { NotWritableClass } from 'examples'

test('Not Writable Class', (t) => {
  const obj = new NotWritableClass('1')
  t.throws(() => {
    obj.name = '2'
  })
  obj.setName('2')
  t.is(obj.name, '2')
  t.throws(() => {
    obj.setName = () => {}
  })
})
