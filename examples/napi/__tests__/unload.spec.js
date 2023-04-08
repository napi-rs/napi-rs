// use the commonjs syntax to prevent compiler from transpiling the module syntax

const path = require('path')

const test = require('ava').default

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
  const { add: add2 } = require(path.toNamespacedPath(
    path.join(__dirname, '../index.node'),
  ))
  t.is(add2(1, 2), 3)
})
