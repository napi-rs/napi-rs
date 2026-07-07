import assert from 'node:assert/strict'
import { once } from 'node:events'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

import {
  findPureRuntimeBinding,
  runPureRuntimeReloadLifecycle,
} from './pure-runtime-lifecycle.mjs'

const mode = process.argv[2] ?? 'native'
assert.ok(mode === 'native' || mode === 'wasi', `Unknown test mode: ${mode}`)

const require = createRequire(import.meta.url)
const bindingFile =
  mode === 'wasi' ? './custom_async_runtime.wasi.cjs' : './index.cjs'

if (mode === 'wasi') {
  const [source, declarations] = await Promise.all([
    readFile(
      new URL('./custom_async_runtime.wasi.cjs', import.meta.url),
      'utf8',
    ),
    readFile(new URL('./index.d.cts', import.meta.url), 'utf8'),
  ])
  assert.match(source, /node:worker_threads/)
  assert.match(source, /\bWorker\b/)
  assert.match(source, /shared:\s*true/)
  assert.match(source, /onCreateWorker/)
  assert.doesNotMatch(source, /retainTaskWaker/)
  assert.doesNotMatch(declarations, /retainTaskWaker/)
}

const binding = require(bindingFile)
const nativeBindingFile =
  mode === 'native'
    ? Object.keys(require.cache).find(
        (filename) =>
          filename.endsWith('.node') &&
          filename.includes('custom_async_runtime'),
      )
    : undefined

async function assertIteratorSetupRejects(binding, pattern, phase) {
  for (const [method, argument] of [
    ['next', undefined],
    ['return', undefined],
    ['throw', new Error(`${phase} iterator throw`)],
  ]) {
    const iterator = new binding.RuntimeAsyncIterator()[Symbol.asyncIterator]()
    let promise
    assert.doesNotThrow(() => {
      promise = iterator[method](argument)
    }, `${method}() must not throw synchronously while the runtime is ${phase}`)
    assert.ok(
      promise instanceof Promise,
      `${method}() must return a Promise while the runtime is ${phase}`,
    )
    await assert.rejects(
      promise,
      pattern,
      `${method}() must reject while the runtime is ${phase}`,
    )
  }
}

async function startRuntimeAfterRetirement(binding) {
  const deadline = Date.now() + 5000

  for (;;) {
    try {
      binding.startRuntime()
      return
    } catch (error) {
      if (
        error?.code !== 'WouldDeadlock' ||
        error?.message !== 'Tokio runtime is still shutting down' ||
        Date.now() >= deadline
      ) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}

const initial = binding.getRuntimeMetrics()

assert.equal(binding.isWasm(), mode === 'wasi')
assert.equal(initial.tokioRuntimeEnabled, true)
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

const beforeBlockingSpawn = binding.getRuntimeMetrics()
assert.equal(binding.spawnBlockingValue(41), 42)
const afterBlockingSpawn = binding.getRuntimeMetrics()
assert.equal(
  afterBlockingSpawn.spawnBlockingCalls,
  beforeBlockingSpawn.spawnBlockingCalls + 1,
)

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
  afterAsync.synchronousSpawnCompletions >=
    beforeAsync.synchronousSpawnCompletions + expectedAsyncTasks,
)
assert.ok(
  afterAsync.completedTasks >= beforeAsync.completedTasks + expectedAsyncTasks,
)
assert.ok(
  afterAsync.taskPolls >= beforeAsync.taskPolls + expectedAsyncTasks * 2,
)
assert.ok(afterAsync.wakeCalls >= beforeAsync.wakeCalls + expectedAsyncTasks)

const runtimeIterator = new binding.RuntimeAsyncIterator(3)[
  Symbol.asyncIterator
]()
assert.deepEqual(
  await Promise.all([
    runtimeIterator.next(),
    runtimeIterator.next(),
    runtimeIterator.next(),
    runtimeIterator.next(),
  ]),
  [
    { done: false, value: 0 },
    { done: false, value: 1 },
    { done: false, value: 2 },
    { done: true, value: undefined },
  ],
)

binding.rejectNextSpawn()
await assert.rejects(
  binding.asyncDouble(1),
  /backend rejected the task submission.*stopped or saturated/i,
)

const beforeLifecycle = binding.getRuntimeMetrics()
const cancelled = binding.asyncNever()
let cancelledIteratorCoercions = 0
const cancelledIterator = new binding.RuntimeAsyncIterator()[
  Symbol.asyncIterator
]()
const cancelledIteratorRequest = cancelledIterator.throw({
  [Symbol.toPrimitive]() {
    cancelledIteratorCoercions++
    return 'cancelled iterator throw'
  },
})
const cancelledIteratorRejection = assert.rejects(
  cancelledIteratorRequest,
  /cancel/i,
)
binding.shutdownRuntime()
await assert.rejects(cancelled, /cancel/i)
await cancelledIteratorRejection
await new Promise((resolve) => setImmediate(resolve))
await new Promise((resolve) => setImmediate(resolve))
assert.equal(
  cancelledIteratorCoercions,
  0,
  'runtime cancellation must prevent queued async iterator hook admission',
)
let stoppedGeneratedPromise
assert.doesNotThrow(() => {
  stoppedGeneratedPromise = binding.asyncDouble(21)
})
assert.ok(stoppedGeneratedPromise instanceof Promise)
await assert.rejects(stoppedGeneratedPromise, /not running/i)
const afterShutdown = binding.getRuntimeMetrics()
assert.equal(afterShutdown.shutdownCalls, beforeLifecycle.shutdownCalls + 1)
assert.throws(() => binding.runtimeContextAdd(1), /not running/i)
assert.throws(() => binding.blockOnValue(1), /not running/i)
await assertIteratorSetupRejects(binding, /not running/i, 'stopped')

if (mode === 'native') {
  assert.ok(
    nativeBindingFile,
    'native binding must be present in require.cache',
  )
  const worker = new Worker(
    `
      const { parentPort } = require('node:worker_threads')
      try {
        const binding = require(${JSON.stringify(nativeBindingFile)})
        Promise.resolve().then(() => binding.asyncDouble(21)).then(
          () => parentPort.postMessage({ loaded: true, errors: [] }),
          (error) => {
            const errors = []
            let current = error
            while (current) {
              errors.push(String(current))
              current = current.cause
            }
            parentPort.postMessage({ loaded: true, errors })
          },
        )
      } catch (error) {
        const errors = []
        let current = error
        while (current) {
          errors.push(String(current))
          current = current.cause
        }
        parentPort.postMessage({ loaded: false, errors })
      }
    `,
    { eval: true },
  )
  const [result] = await once(worker, 'message')
  assert.equal(result.loaded, true)
  assert.match(result.errors.join('\n'), /cancel|stopped|not running/i)
  await worker.terminate()
  assert.equal(
    binding.getRuntimeMetrics().startCalls,
    afterShutdown.startCalls,
    'loading a new worker must not undo explicit shutdown',
  )
}

await startRuntimeAfterRetirement(binding)
const afterStart = binding.getRuntimeMetrics()
assert.equal(afterStart.startCalls, beforeLifecycle.startCalls + 1)
assert.equal(await binding.asyncDouble(21), 42)

if (mode === 'native') {
  const restoredWorker = new Worker(
    `
      const { parentPort } = require('node:worker_threads')
      const binding = require(${JSON.stringify(nativeBindingFile)})
      binding.asyncDouble(21).then((value) => parentPort.postMessage(value))
    `,
    { eval: true },
  )
  assert.deepEqual(await once(restoredWorker, 'message'), [42])
  await restoredWorker.terminate()

  const missingResult = spawnSync(
    process.execPath,
    [
      '-e',
      `
        const binding = require(${JSON.stringify(nativeBindingFile)})
        const timeout = setTimeout(
          () => {
            console.error('timed out waiting for Tokio-backed async operation')
            process.exitCode = 1
          },
          5000,
        )
        ;(async () => {
          if (binding.getRuntimeMetrics().runtimeRegistrationCalls !== 0) {
            throw new Error('missing-registration fixture unexpectedly registered a custom backend')
          }
          const value = await binding.asyncDouble(21)
          if (value !== 42) {
            throw new Error(\`unexpected Tokio-backed result: \${value}\`)
          }
          console.log('combined missing registration used built-in Tokio')
        })().then(
          () => clearTimeout(timeout),
          (error) => {
            clearTimeout(timeout)
            console.error(error)
            process.exitCode = 1
          },
        )
      `,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, NAPI_CUSTOM_RUNTIME_TEST_MISSING: '1' },
    },
  )
  assert.equal(
    missingResult.signal,
    null,
    'missing runtime must not abort Node',
  )
  assert.equal(
    missingResult.status,
    0,
    `${missingResult.stdout}\n${missingResult.stderr}`,
  )
  assert.match(missingResult.stdout, /used built-in Tokio/)

  const probeDirectory = await mkdtemp(
    join(tmpdir(), 'napi-custom-runtime-registration-'),
  )
  try {
    for (const scenario of [
      {
        env: {
          NAPI_CUSTOM_RUNTIME_TEST_DUPLICATE: '1',
          NAPI_CUSTOM_RUNTIME_TEST_DUPLICATE_PROBE_STARTED: join(
            probeDirectory,
            'duplicate-started',
          ),
          NAPI_CUSTOM_RUNTIME_TEST_DUPLICATE_PROBE_STOPPED: join(
            probeDirectory,
            'duplicate-stopped',
          ),
        },
        pattern: /more than once/i,
        started: join(probeDirectory, 'duplicate-started'),
        stopped: join(probeDirectory, 'duplicate-stopped'),
      },
      {
        env: {
          NAPI_CUSTOM_RUNTIME_TEST_START_ERROR: '1',
          NAPI_CUSTOM_RUNTIME_TEST_START_PROBE_STARTED: join(
            probeDirectory,
            'start-error-started',
          ),
          NAPI_CUSTOM_RUNTIME_TEST_START_PROBE_STOPPED: join(
            probeDirectory,
            'start-error-stopped',
          ),
        },
        pattern: /injected custom runtime start error/i,
        started: join(probeDirectory, 'start-error-started'),
        stopped: join(probeDirectory, 'start-error-stopped'),
      },
    ]) {
      const result = spawnSync(
        process.execPath,
        ['-e', `require(${JSON.stringify(nativeBindingFile)})`],
        {
          encoding: 'utf8',
          env: { ...process.env, ...scenario.env },
          timeout: 20_000,
        },
      )
      const output = `${result.stdout}\n${result.stderr}`
      assert.equal(result.error, undefined, result.error?.stack)
      assert.equal(result.signal, null, output)
      assert.notEqual(result.status, 0, 'injected registration must fail')
      assert.match(output, scenario.pattern)
      await access(scenario.started)
      await access(scenario.stopped)
    }
  } finally {
    await rm(probeDirectory, { recursive: true, force: true })
  }

  const retryResult = spawnSync(
    process.execPath,
    [
      '-e',
      `
        process.env.NAPI_CUSTOM_RUNTIME_TEST_START_ERROR = '1'
        try {
          require(${JSON.stringify(nativeBindingFile)})
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
        const binding = require(${JSON.stringify(nativeBindingFile)})
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

  const lifecycleResult = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('./runtime-lifecycle-helper.mjs', import.meta.url)),
      nativeBindingFile,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        NAPI_CUSTOM_RUNTIME_LIFECYCLE_TEST: '1',
      },
      timeout: 40_000,
    },
  )
  assert.equal(lifecycleResult.error, undefined, lifecycleResult.error?.stack)
  assert.equal(
    lifecycleResult.signal,
    null,
    `${lifecycleResult.stdout}\n${lifecycleResult.stderr}`,
  )
  assert.equal(
    lifecycleResult.status,
    0,
    `${lifecycleResult.stdout}\n${lifecycleResult.stderr}`,
  )
  assert.match(lifecycleResult.stdout, /combined runtime lifecycle passed/)

  for (let index = 0; index < 20; index++) {
    const worker = new Worker(
      `
        const { parentPort } = require('node:worker_threads')
        const binding = require(${JSON.stringify(nativeBindingFile)})
        binding.asyncNever()
        parentPort.postMessage('pending')
      `,
      { eval: true },
    )
    assert.deepEqual(await once(worker, 'message'), ['pending'])
    await worker.terminate()
  }
  assert.equal(await binding.asyncDouble(11), 22)

  const unpolledProbeDirectory = await mkdtemp(
    join(tmpdir(), 'napi-custom-runtime-unpolled-drop-'),
  )
  try {
    const resultPath = join(unpolledProbeDirectory, 'result')
    binding.deferNextSpawnDrain()
    const unpolled = binding.unpolledShutdownOnDrop(resultPath)
    binding.shutdownRuntime()
    await assert.rejects(unpolled, /cancel/i)
    assert.match(
      await readFile(resultPath, 'utf8'),
      /GenericFailure[\s\S]*inside an AsyncRuntime operation/,
    )
    await startRuntimeAfterRetirement(binding)
    assert.equal(await binding.asyncDouble(13), 26)
  } finally {
    await rm(unpolledProbeDirectory, { recursive: true, force: true })
  }

  const pureBuild = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./build.mjs', import.meta.url)), '--pure-only'],
    {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      encoding: 'utf8',
      timeout: 180_000,
    },
  )
  assert.equal(pureBuild.error, undefined, pureBuild.error?.stack)
  assert.equal(
    pureBuild.signal,
    null,
    `${pureBuild.stdout}\n${pureBuild.stderr}`,
  )
  assert.equal(pureBuild.status, 0, `${pureBuild.stdout}\n${pureBuild.stderr}`)

  await runPureRuntimeReloadLifecycle(await findPureRuntimeBinding())
}
