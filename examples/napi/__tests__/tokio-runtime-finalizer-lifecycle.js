import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate as nextTurn } from 'node:timers/promises'

import { requireLifecycleFixture } from './lifecycle-fixture.js'

const require = createRequire(import.meta.url)
const { fixture: lifecycle } = requireLifecycleFixture(require, '../index.cjs')
const directory = await mkdtemp(join(tmpdir(), 'napi-runtime-live-finalizer-'))
const resultPath = join(directory, 'result')

try {
  lifecycle.createRuntimeLifecycleFinalizer(resultPath)
  await assert.rejects(access(resultPath))

  for (let attempt = 0; attempt < 100; attempt++) {
    global.gc()
    await nextTurn()
    try {
      if ((await readFile(resultPath, 'utf8')) === '3') {
        break
      }
    } catch {}
  }

  assert.equal(await readFile(resultPath, 'utf8'), '3')
} finally {
  await rm(directory, { recursive: true, force: true })
}
