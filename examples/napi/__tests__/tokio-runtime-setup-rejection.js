import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const binding = require('../index.cjs')
const timeoutMilliseconds = 5_000

async function readFileEventually(path, label) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error
      }
    }
    await delay(10)
  }
  throw new Error(`timed out waiting for ${label}`)
}

const directory = await mkdtemp(join(tmpdir(), 'napi-tokio-setup-rejection-'))
try {
  const iteratorDropPath = join(directory, 'iterator-drop')
  const iterator = new binding.AsyncIteratorFailedSendProbe(iteratorDropPath)[
    Symbol.asyncIterator
  ]()
  let shutdownCompleted = false
  const request = iterator.next({
    get value() {
      binding.shutdownRuntime()
      shutdownCompleted = true
      return 7
    },
  })

  await assert.rejects(request, /cancel/i)
  assert.equal(
    shutdownCompleted,
    true,
    'async iterator argument conversion must complete runtime shutdown',
  )
  assert.match(
    await readFileEventually(iteratorDropPath, 'iterator failed-send drop'),
    /GenericFailure[\s\S]*inside an AsyncRuntime operation/,
  )

  const asyncBlockOrderPath = join(directory, 'async-block-order')
  let rejected
  assert.doesNotThrow(() => {
    rejected = binding.stoppedTokioAsyncBlockCleanupOrder(asyncBlockOrderPath)
  })
  assert.ok(rejected instanceof Promise)
  await assert.rejects(rejected, /stopped|not running|shutting down/i)
  assert.equal(
    await readFileEventually(
      asyncBlockOrderPath,
      'stopped Tokio AsyncBlock cleanup order',
    ),
    'future=true\nresolver=true\nshutdown=Ok',
  )

  console.log('Tokio setup rejection lifecycle passed')
} finally {
  await rm(directory, { recursive: true, force: true })
}
