import assert from 'node:assert/strict'
import { setImmediate as nextTurn } from 'node:timers/promises'

import {
  RuntimeLifecycleFinalize,
  runtimeLifecycleFinalizeResult,
} from '../index.cjs'

function createCollectableInstance() {
  new RuntimeLifecycleFinalize()
}

createCollectableInstance()

for (let attempt = 0; attempt < 100; attempt++) {
  global.gc()
  await nextTurn()
  if (runtimeLifecycleFinalizeResult() === 3) {
    break
  }
}

assert.equal(runtimeLifecycleFinalizeResult(), 3)
