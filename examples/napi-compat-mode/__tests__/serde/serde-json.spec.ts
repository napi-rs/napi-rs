import test from 'ava'

const bindings = require('../../index.node')

const ValidObject = {
  a: 1,
  b: [-1.2, 1.1, 2.2, 3.3],
  c: 'Hi',
}

const InValidObject = {
  a: -1,
  b: [-1, 1.1, 2.2, 3.3],
  c: 'Hello',
}

test('should from json string', (t) => {
  t.throws(() => bindings.from_json_string(JSON.stringify(InValidObject)))
  t.deepEqual(
    ValidObject,
    bindings.from_json_string(JSON.stringify(ValidObject)),
  )
})

test('should convert to json string', (t) => {
  t.throws(() => bindings.json_to_string(InValidObject))
  t.deepEqual(JSON.stringify(ValidObject), bindings.json_to_string(ValidObject))
})
