import test from 'ava'

import { runPackedRawCliTest } from './raw-cli-test.mjs'

test('packed raw CLI runs without development dependencies and preserves path arguments', async (t) => {
  await runPackedRawCliTest()
  t.pass()
})
