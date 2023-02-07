import { readFileSync } from 'fs'
import { join } from 'path'

import test from 'ava'

test('should generate correct type def file', (t) => {
  if (process.env.WASI_TEST) {
    t.pass()
  } else {
    t.snapshot(readFileSync(join(__dirname, '..', 'index.d.ts'), 'utf8'))
  }
})
