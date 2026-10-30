import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'

const require = createRequire(import.meta.url)
const native = require('../index.cjs')

// `tsfnThrowFromJsCallbackContainsTsfn` runs `block_on(tsfn.call_async(..))` on a
// spawned thread. The callback below starts a worker that loads this addon, and
// the call settles only after that worker exits. So the worker registers the
// addon while the spawned thread is still inside `block_on`. If the registration
// waits for `block_on` to return, neither side can continue.
// `done` settles with the worker's exit code. `call` is the value that the
// callback returns to the spawned thread.
const done = Promise.withResolvers()
const call = Promise.withResolvers()
native
  .tsfnThrowFromJsCallbackContainsTsfn((err) => {
    if (err) {
      done.reject(err)
      return Promise.reject(err)
    }
    const worker = new Worker(
      "require(process.env.NAPI_ADDON_INDEX); require('node:worker_threads').parentPort.postMessage('loaded')",
      {
        eval: true,
        execArgv: [],
        env: {
          ...process.env,
          NAPI_ADDON_INDEX: require.resolve('../index.cjs'),
        },
      },
    )
    worker.once('message', () => worker.terminate())
    worker.once('error', (e) => {
      call.reject(e)
      done.reject(e)
    })
    worker.once('exit', (code) => {
      call.resolve(1)
      done.resolve(code)
    })
    return call.promise
  })
  .catch(done.reject)
const workerExitCode = await done.promise

// The runtime still works after the worker env is gone.
const value = await native.asyncMultiTwo(21)
console.log(
  `worker loaded the addon during block_on (exit ${workerExitCode}), asyncMultiTwo = ${value}`,
)
