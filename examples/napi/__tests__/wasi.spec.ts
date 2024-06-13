import test from 'ava'

import { spawnThreadInThread } from '../index.cjs'

test('spawnThreadInThread should be fine', async (t) => {
  await new Promise((resolve, reject) => {
    spawnThreadInThread((err, num) => {
      if (err) {
        reject(err)
      } else {
        t.is(num, 42)
        resolve(void 0)
      }
      return 0
    })
  })
  t.pass()
})
