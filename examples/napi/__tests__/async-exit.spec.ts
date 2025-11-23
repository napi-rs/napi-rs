import test from 'ava'

import { fetch } from '../index.cjs'

test('async napi functions let the process exit', async (t) => {
  const response = await fetch('https://httpbin.org/delay/1')
  const json = (await response.json()) as { url: string }
  t.is(json.url, 'https://httpbin.org/delay/1')
})
