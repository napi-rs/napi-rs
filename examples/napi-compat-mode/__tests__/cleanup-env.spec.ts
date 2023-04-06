import test from 'ava'

const bindings = require('../index.node')

test('should be able to add cleanup hook', (t) => {
  t.notThrows(() => {
    const ret = bindings.addCleanupHook()
    t.is(typeof ret, 'object')
  })
})

test('should be able to remove cleanup hook', (t) => {
  t.notThrows(() => {
    const ret = bindings.addCleanupHook()
    bindings.removeCleanupHook(ret)
  })
})
