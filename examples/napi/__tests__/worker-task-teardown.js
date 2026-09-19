import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Terminating a Worker while its `AsyncTask`s are still in flight delivers the
// `napi_async_work` complete callback while the env is draining. Every
// JS-entry call in `complete` — `napi_*_deferred` included — then fails with
// `napi_pending_exception`, and routing that failure through
// `JsError::throw_into` used to hit a debug assertion that aborted the whole
// process (napi-rs#3535).
async function main() {
  for (let i = 0; i < 10; i++) {
    const worker = new Worker(
      join(__dirname, 'worker-task-teardown-worker.js'),
      {
        env: process.env,
      },
    )
    await new Promise((resolve) => {
      worker.once('message', resolve)
      worker.once('error', resolve)
    })
    await worker.terminate()
  }
  console.log('survived AsyncTask settlement during worker teardown')
}

await main()
