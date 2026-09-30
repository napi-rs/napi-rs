// Child process of test-wasi-threads-crash.mjs; see there. argv[2]:
//   exit     start the MultiThread runtime, then process.exit(0) at once
//   dispose  start it, then dispose the binding at once

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
// A worker that fails to load also rejects emnapi's own load promise, which
// nothing handles; report it instead of dying on it.
process.on('unhandledRejection', (error) => {
  process.stderr.write(`unhandled rejection: ${error && error.message}\n`)
})

binding.configureAsyncRuntime({ flavor: 'MultiThread', workerThreads: 2 })
// The first async call starts the runtime: its worker threads are spawned on
// this thread, and each spawn returns as soon as the pool worker is created.
binding.plus100(1).catch(() => {})

if (mode === 'exit') {
  process.stdout.write('exiting\n')
  exitStarted = performance.now()
  process.exit(0)
} else if (mode === 'dispose') {
  binding[Symbol.for('napi.rs.wasi.dispose')]().then(
    () => process.stdout.write('dispose resolved\n'),
    (error) =>
      process.stdout.write(
        `dispose rejected: ${error.message} | cause: ${
          error.cause && error.cause.message
        }\n`,
      ),
  )
} else {
  throw new Error(`unknown mode ${mode}`)
}
