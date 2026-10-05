// Child process of test-wasi-threads-crash.mjs; see there. argv[2]:
//   exit     start the MultiThread runtime, then process.exit(0) at once
//   dispose  start it, then dispose the binding at once
//   dispose-sleep
//            CurrentThread instead: arm a 60 s sleep, which holds a host
//            timeout on this thread, start one idle thread, and dispose once
//            its worker reported the failed load (see `disposeAfterCrash`)

const mode = process.argv[2]
const binding = require('./shared_async_runtime.wasi.cjs')

// Registered after the loader's own 'exit' listener, so it runs once that
// teardown returned: how long the teardown waited in wasm.
let exitStarted
process.on('exit', () => {
  if (exitStarted !== undefined) {
    process.stdout.write(
      `exit teardown took ${Math.round(performance.now() - exitStarted)} ms\n`,
    )
  }
})
function dispose() {
  binding[Symbol.for('napi.rs.wasi.dispose')]().then(
    () => process.stdout.write('dispose resolved\n'),
    (error) =>
      process.stdout.write(
        `dispose rejected: ${error.message} | cause: ${
          error.cause && error.cause.message
        }\n`,
      ),
  )
}

// Up to @emnapi/wasi-threads 2.1.0, a worker that fails to load also rejects
// at the thread spawn site, and nothing handles that rejection; report it
// instead of dying on it. 2.2.0 prints the failure there instead (emnapi#239).
process.on('unhandledRejection', (error) => {
  process.stderr.write(`unhandled rejection: ${error && error.message}\n`)
})

// "dispose-sleep" disposes once the pool worker's load failed, so the disposal
// starts after the crash instead of being overtaken by it. The trigger is that
// Worker's 'error' event, reached through Node's public process 'worker' event:
// it is the event the loader's own onCreateWorker listener latches the crash
// on, and the worker raised the shared crash flag before it posted the error,
// so dispose() sees the crash when it starts. It holds on both emnapi versions,
// unlike the spawn-site report above. The binding gives a host nothing else:
// it exposes no crash flag, and its calls keep resolving after the crash; only
// dispose() reports it.
function disposeAfterCrash() {
  let crashSeen = false
  process.on('worker', (worker) => {
    worker.on('error', (error) => {
      process.stdout.write(`pool worker error: ${error && error.message}\n`)
      if (!crashSeen) {
        crashSeen = true
        dispose()
      }
    })
  })
}

if (mode === 'dispose-sleep') {
  disposeAfterCrash()
  binding.configureAsyncRuntime({ flavor: 'CurrentThread' })
  const started = performance.now()
  binding.sleepThenAdd(1, 2, 60_000).then(
    (sum) => process.stdout.write(`sleep resolved: ${sum}\n`),
    (error) => process.stdout.write(`sleep rejected: ${error.message}\n`),
  )
  process.on('exit', () => {
    process.stdout.write(
      `exited after ${Math.round(performance.now() - started)} ms\n`,
    )
  })
  // CurrentThread runs everything else on this thread; this is the one wasm
  // thread, and its worker is the one that fails to load.
  process.stdout.write(`idle thread started: ${binding.spawnIdleThread()}\n`)
  return
}

binding.configureAsyncRuntime({ flavor: 'MultiThread', workerThreads: 2 })
// The first async call starts the runtime: its worker threads are spawned on
// this thread, and each spawn returns as soon as the pool worker is created.
binding.plus100(1).catch(() => {})

if (mode === 'exit') {
  process.stdout.write('exiting\n')
  exitStarted = performance.now()
  process.exit(0)
} else if (mode === 'dispose') {
  dispose()
} else {
  throw new Error(`unknown mode ${mode}`)
}
