import test from 'ava'
import { testRuntimeReuse } from '../index.js'

test('should be able to reuse custom tokio runtime after shutdown', async (t) => {
  // This test verifies that USER_DEFINED_RT can be reused after shutdown
  // Previously, this would fail because OnceLock only allows one-time initialization
  
  if (typeof testRuntimeReuse === 'function') {
    const result = testRuntimeReuse()
    t.is(result, true, 'Runtime should be successfully reused after shutdown')
  } else {
    // Skip on platforms where this test is not available (e.g., WASM)
    t.pass('Test skipped on this platform')
  }
})