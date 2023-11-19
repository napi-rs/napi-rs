// use the commonjs syntax to prevent compiler from transpiling the module syntax

import { createRequire } from 'node:module'
import * as path from 'node:path'

import test from 'ava'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(new URL(import.meta.url).pathname)

test('unload module', (t) => {
  const { add } = require('../index.node')
  t.is(add(1, 2), 3)
  delete require.cache[require.resolve('../index.node')]
  const { add: add2 } = require('../index.node')
  t.is(add2(1, 2), 3)
})

test('load module multi times', (t) => {
  const { add } = require('../index.node')
  t.is(add(1, 2), 3)
  const { add: add2 } = require(
    path.toNamespacedPath(path.join(__dirname, '../index.node')),
  )
  t.is(add2(1, 2), 3)
})
