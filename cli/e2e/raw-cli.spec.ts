import test from 'ava'

import { runPackedRawCliTest } from './raw-cli-test.mjs'

const packedCliTimeout = process.platform === 'win32' ? 10 * 60_000 : 5 * 60_000

test('packed raw CLI runs without development dependencies and preserves path arguments', async (t) => {
  t.timeout(packedCliTimeout)
  await runPackedRawCliTest()
  t.pass()
})
