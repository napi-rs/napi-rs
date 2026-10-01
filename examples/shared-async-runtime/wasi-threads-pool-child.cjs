// Child process of test-wasi-threads-pool.mjs; see there. argv[2] is the case.
// Prints one `RESULT <json>` line.

// Count every pool Worker the loader creates, and see each one load and exit.
// The loader reads `Worker` off this module when it is required.
const workerThreads = require('node:worker_threads')
const { Worker } = workerThreads
const workers = []
workerThreads.Worker = class extends Worker {
  constructor(...args) {
    super(...args)
    const record = { loaded: false, exited: false }
    workers.push(record)
    this.on('message', (data) => {
      if (data && data.__emnapi__ && data.__emnapi__.type === 'loaded') {
        record.loaded = true
      }
    })
    this.on('exit', () => {
      record.exited = true
    })
  }
}

// Keep the main thread's instance, to read the export the loader reads.
let instance
const { Instance } = WebAssembly
WebAssembly.Instance = function (...args) {
  const created = Reflect.construct(Instance, args, new.target ?? Instance)
  instance ??= created
  return created
}
WebAssembly.Instance.prototype = Instance.prototype

// Keep emnapi's thread manager, to read its idle pool (`unusedWorkers`).
let manager
const { ThreadManager } = require(
  require.resolve('@emnapi/wasi-threads', {
    paths: [require.resolve('@emnapi/core')],
  }),
)
const { allocateUnusedWorker } = ThreadManager.prototype
ThreadManager.prototype.allocateUnusedWorker = function (...args) {
  manager ??= this
  return Reflect.apply(allocateUnusedWorker, this, args)
}

const binding = require('./shared_async_runtime.wasi.cjs')

const poolWorkers = () => instance.exports.napi_wasm_runtime_pool_workers()
const count = () => ({
  created: workers.length,
  loaded: workers.filter((worker) => worker.loaded).length,
  exited: workers.filter((worker) => worker.exited).length,
})
async function until(condition, label) {
  const deadline = performance.now() + 10_000
  while (!condition()) {
    if (performance.now() > deadline) {
      throw new Error(
        `timed out waiting for ${label}: ${JSON.stringify(count())}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
const allLoaded = () => until(() => count().loaded === workers.length, 'loads')

const result = {}
async function main(mode) {
  const symbol = Symbol.for('napi.rs.wasi.reconcileThreadPool')
  const descriptor = Object.getOwnPropertyDescriptor(binding, symbol)
  result.reconcile = {
    type: typeof descriptor?.value,
    enumerable: descriptor?.enumerable,
    writable: descriptor?.writable,
  }
  result.configureName = binding.configureAsyncRuntime.name
  result.afterLoad = { poolWorkers: poolWorkers(), ...count() }

  if (mode === 'default') {
    return
  }
  if (mode === 'multi-thread') {
    binding.configureAsyncRuntime({ flavor: 'MultiThread', workerThreads: 3 })
    result.afterConfigure = { poolWorkers: poolWorkers(), ...count() }
    await allLoaded()
    result.sum = await binding.plus100(1)
    result.afterCall = count()
  } else if (mode === 'shrink') {
    binding.configureAsyncRuntime({ flavor: 'MultiThread', workerThreads: 3 })
    await allLoaded()
    binding.configureAsyncRuntime({ flavor: 'CurrentThread' })
    result.afterShrink = { poolWorkers: poolWorkers() }
    await until(() => count().exited === 3, 'exits')
    result.sum = await binding.plus100(1)
    result.afterCall = count()
  } else if (mode === 'shrink-queued') {
    binding.configureAsyncRuntime({ flavor: 'MultiThread', workerThreads: 3 })
    // Block this thread while the Workers load, so their 'loaded' messages are
    // still queued when the configure below terminates them.
    const start = performance.now()
    while (performance.now() - start < 250) {}
    binding.configureAsyncRuntime({ flavor: 'CurrentThread' })
    await until(() => count().exited === 3, 'exits')
    await new Promise((resolve) => setTimeout(resolve, 100))
    result.afterShrink = count()
  } else if (mode === 'grow') {
    binding.configureAsyncRuntime({ flavor: 'MultiThread', workerThreads: 2 })
    result.afterConfigure = { poolWorkers: poolWorkers(), ...count() }
    binding.configureAsyncRuntime({ workerThreads: 4 })
    result.afterGrow = { poolWorkers: poolWorkers(), ...count() }
    await allLoaded()
  } else if (mode === 'frozen') {
    binding.configureAsyncRuntime({ flavor: 'MultiThread', workerThreads: 2 })
    await allLoaded()
    result.sum = await binding.plus100(1)
    try {
      binding.configureAsyncRuntime({ workerThreads: 4 })
      result.frozenError = null
    } catch (error) {
      result.frozenError = error.message
    }
    result.afterFrozen = { poolWorkers: poolWorkers(), ...count() }
  } else if (mode === 'started') {
    binding.configureAsyncRuntime({ flavor: 'MultiThread', workerThreads: 3 })
    await allLoaded()
    // The first call builds the backend, which spawns all three pool threads
    // and takes the three idle Workers.
    result.sum = await binding.plus100(1)
    result.afterCall = {
      poolWorkers: poolWorkers(),
      idle: manager.unusedWorkers.length,
      ...count(),
    }
    binding[Symbol.for('napi.rs.wasi.reconcileThreadPool')]()
    result.afterReconcile = {
      poolWorkers: poolWorkers(),
      idle: manager.unusedWorkers.length,
      ...count(),
    }
  } else {
    throw new Error(`unknown mode ${mode}`)
  }
}

main(process.argv[2]).then(
  async () => {
    await binding[Symbol.for('napi.rs.wasi.dispose')]()
    result.disposed = true
    process.stdout.write(`RESULT ${JSON.stringify(result)}\n`)
  },
  (error) => {
    process.stdout.write(`FAILED ${error && error.stack}\n`)
    process.exitCode = 1
  },
)
