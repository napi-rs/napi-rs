import test from 'ava'

// @ts-expect-error
import bindings from '../index.node'

test('should get napi version', (t) => {
  const napiVersion = bindings.getNapiVersion()
  t.true(typeof napiVersion === 'number')
  t.is(`${napiVersion}`, process.versions.napi!)
})
