import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

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
const afterEnter = binding.getRuntimeMetrics()
assert.equal(afterEnter.enterCalls, initial.enterCalls + 1)
assert.equal(afterEnter.exitCalls, initial.exitCalls + 1)
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
}

const afterAsync = binding.getRuntimeMetrics()
const expectedAsyncTasks = mode === 'native' ? 7 : 6
assert.ok(afterAsync.spawnCalls >= beforeAsync.spawnCalls + expectedAsyncTasks)
assert.ok(
  afterAsync.completedTasks >= beforeAsync.completedTasks + expectedAsyncTasks,
)
assert.ok(
  afterAsync.taskPolls >= beforeAsync.taskPolls + expectedAsyncTasks * 2,
)
assert.ok(afterAsync.wakeCalls >= beforeAsync.wakeCalls + expectedAsyncTasks)

const beforeLifecycle = binding.getRuntimeMetrics()
binding.shutdownRuntime()
const afterShutdown = binding.getRuntimeMetrics()
assert.equal(afterShutdown.shutdownCalls, beforeLifecycle.shutdownCalls + 1)

binding.startRuntime()
const afterStart = binding.getRuntimeMetrics()
assert.equal(afterStart.startCalls, beforeLifecycle.startCalls + 1)
assert.equal(await binding.asyncDouble(21), 42)
