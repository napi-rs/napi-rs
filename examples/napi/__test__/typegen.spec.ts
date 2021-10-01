import { readFileSync } from 'fs'
import { join } from 'path'

import test from 'ava'

test('should generate correct type def file', (t) => {
  t.snapshot(readFileSync(join(__dirname, '..', 'index.d.ts'), 'utf8'))
})
