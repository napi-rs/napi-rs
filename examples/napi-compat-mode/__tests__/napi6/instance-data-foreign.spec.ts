import test from 'ava'

import { napiVersion } from '../napi-version'

// @ts-expect-error
import bindings from '../../index.node'

// `napi_set_instance_data` is a per-env slot any code in the process can
// overwrite. A payload this addon never registered must be rejected by
// `get_instance_data` instead of being dereferenced.

test('should throw if instance data was set by foreign code', (t) => {
  if (napiVersion >= 6) {
    bindings.setForeignInstanceData()
    t.throws(bindings.getInstanceData)
    t.throws(bindings.getWrongTypeInstanceData)
  } else {
    t.is(bindings.setForeignInstanceData, undefined)
  }
})
