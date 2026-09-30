// Child process of test-wasi-threads-crash.mjs; see there. argv[2]:
//   exit     start the MultiThread runtime, then process.exit(0) at once
//   dispose  start it, then dispose the binding at once
//   dispose-sleep
//            CurrentThread instead: arm a 60 s sleep, which holds a host
//            timeout on this thread, start one idle thread, and dispose once
//            its worker failed to load

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

// A worker that fails to load also rejects emnapi's own load promise, which
// nothing handles; report it instead of dying on it.
let crashSeen = false
process.on('unhandledRejection', (error) => {
  process.stderr.write(`unhandled rejection: ${error && error.message}\n`)
  // The worker raised the loader's crash flag before it reported, so the
  // disposal below takes the crash path.
  if (mode === 'dispose-sleep' && !crashSeen) {
    crashSeen = true
    dispose()
  }
})

if (mode === 'dispose-sleep') {
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
