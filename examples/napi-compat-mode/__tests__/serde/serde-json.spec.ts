import { test } from 'node:test'
import assert from 'node:assert'

// @ts-expect-error
import bindings from '../../index.node'

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

test('should from json string', () => {
  assert.throws(() => bindings.from_json_string(JSON.stringify(InValidObject)))
  assert.deepStrictEqual(
    ValidObject,
    bindings.from_json_string(JSON.stringify(ValidObject)),
  )
})

test('should convert to json string', () => {
  assert.throws(() => bindings.json_to_string(InValidObject))
  assert.deepStrictEqual(JSON.stringify(ValidObject), bindings.json_to_string(ValidObject))
})
