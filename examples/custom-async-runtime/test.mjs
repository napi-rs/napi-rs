import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

const mode = process.argv[2] ?? 'native'
assert.ok(mode === 'native' || mode === 'wasi', `Unknown test mode: ${mode}`)

const require = createRequire(import.meta.url)
const bindingFile =
  mode === 'wasi' ? './custom_async_runtime.wasi.cjs' : './index.cjs'

if (mode === 'wasi') {
  const source = await readFile(
    new URL('./custom_async_runtime.wasi.cjs', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(source, /node:worker_threads/)
  assert.doesNotMatch(source, /\bWorker\b/)
  assert.doesNotMatch(source, /SharedArrayBuffer/)
  assert.match(source, /asyncWorkPoolSize:\s*0/)
}

const binding = require(bindingFile)
const initial = binding.getRuntimeMetrics()

assert.equal(binding.isWasm(), mode === 'wasi')
assert.ok(initial.startCalls >= 1)
assert.equal(initial.activeGuards, 0)

assert.equal(binding.runtimeContextIsActive(), true)
assert.equal(binding.runtimeContextAdd(41), 42)
const afterEnter = binding.getRuntimeMetrics()
assert.equal(afterEnter.enterCalls, initial.enterCalls + 2)
assert.equal(afterEnter.exitCalls, initial.exitCalls + 2)
assert.equal(afterEnter.activeGuards, 0)

assert.equal(binding.blockOnValue(41), 42)
const afterBlockOn = binding.getRuntimeMetrics()
assert.equal(afterBlockOn.blockOnCalls, initial.blockOnCalls + 1)
assert.ok(afterBlockOn.blockOnPolls >= initial.blockOnPolls + 2)

const beforeAsync = binding.getRuntimeMetrics()
assert.deepEqual(
  await Promise.all([1, 2, 3, 4].map((value) => binding.asyncDouble(value))),
  [2, 4, 6, 8],
)
assert.equal(await binding.spawnFuture(41), 42)
await assert.rejects(binding.asyncError(), /custom runtime async error/)

if (mode === 'native') {
  await assert.rejects(binding.asyncPanic(), /custom runtime async panic/)
  // A `String` panic payload (here a formatted message) must survive to the
  // rejection instead of collapsing into the generic "Panic in async function".
  await assert.rejects(
    binding.asyncPanicString(7),
    /custom runtime async string panic: 7/,
  )
}

const afterAsync = binding.getRuntimeMetrics()
const expectedAsyncTasks = mode === 'native' ? 8 : 6
assert.ok(afterAsync.spawnCalls >= beforeAsync.spawnCalls + expectedAsyncTasks)
assert.ok(
  afterAsync.completedTasks >= beforeAsync.completedTasks + expectedAsyncTasks,
)
assert.ok(
  afterAsync.taskPolls >= beforeAsync.taskPolls + expectedAsyncTasks * 2,
)
assert.ok(afterAsync.wakeCalls >= beforeAsync.wakeCalls + expectedAsyncTasks)

const beforeLifecycle = binding.getRuntimeMetrics()
const cancelled = binding.asyncNever()
binding.shutdownRuntime()
await assert.rejects(cancelled, /cancel/i)
const afterShutdown = binding.getRuntimeMetrics()
assert.equal(afterShutdown.shutdownCalls, beforeLifecycle.shutdownCalls + 1)

binding.startRuntime()
const afterStart = binding.getRuntimeMetrics()
assert.equal(afterStart.startCalls, beforeLifecycle.startCalls + 1)
assert.equal(await binding.asyncDouble(21), 42)

if (mode === 'native') {
  const bindingPath = fileURLToPath(new URL('./index.cjs', import.meta.url))
  for (const [name, pattern] of [
    [
      'NAPI_CUSTOM_RUNTIME_TEST_MISSING',
      /no AsyncRuntime backend was registered/i,
    ],
    ['NAPI_CUSTOM_RUNTIME_TEST_DUPLICATE', /more than once/i],
  ]) {
    const result = spawnSync(
      process.execPath,
      ['-e', `require(${JSON.stringify(bindingPath)})`],
      {
        encoding: 'utf8',
        env: { ...process.env, [name]: '1' },
      },
    )
    assert.equal(result.signal, null, `${name} must not abort Node`)
    assert.notEqual(result.status, 0, `${name} must fail addon loading`)
    assert.match(`${result.stdout}\n${result.stderr}`, pattern)
  }

  const retryResult = spawnSync(
    process.execPath,
    [
      '-e',
      `
        process.env.NAPI_CUSTOM_RUNTIME_TEST_START_ERROR = '1'
        try {
          require(${JSON.stringify(bindingPath)})
          throw new Error('first addon load unexpectedly succeeded')
        } catch (error) {
          let current = error
          let matched = false
          while (current) {
            if (/injected custom runtime start error/i.test(String(current))) {
              matched = true
              break
            }
            current = current.cause
          }
          if (!matched) throw error
        }
        delete process.env.NAPI_CUSTOM_RUNTIME_TEST_START_ERROR
        const binding = require(${JSON.stringify(bindingPath)})
        if (binding.runtimeContextAdd(41) !== 42) {
          throw new Error('addon did not recover after startup failure')
        }
      `,
    ],
    { encoding: 'utf8' },
  )
  assert.equal(retryResult.signal, null, 'startup retry must not abort Node')
  assert.equal(
    retryResult.status,
    0,
    `${retryResult.stdout}\n${retryResult.stderr}`,
  )

  for (let index = 0; index < 20; index++) {
    const worker = new Worker(
      `
        const { parentPort } = require('node:worker_threads')
        const binding = require(${JSON.stringify(bindingPath)})
        binding.asyncNever()
        parentPort.postMessage('pending')
      `,
      { eval: true },
    )
    assert.deepEqual(await once(worker, 'message'), ['pending'])
    await worker.terminate()
  }
  assert.equal(await binding.asyncDouble(11), 22)
}
