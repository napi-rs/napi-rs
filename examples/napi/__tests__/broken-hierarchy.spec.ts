import { copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

import test from 'ava'

import { buildCargoCdylibArtifact } from './helpers/cargo-artifact.js'

// Deferred #1164 test: a BROKEN `#[napi(extends)]` hierarchy must fail FAST —
// never hang — even when the same broken addon is `require()`d concurrently
// from multiple worker_threads. The fixture addon
// (`examples/napi-broken-hierarchy`) hand-registers a class whose parent tag is
// never registered, so `build_hierarchy` returns `Err`. The `Err` paths
// themselves are covered by the `build_hierarchy` unit tests; this proves the
// concurrency guarantee (`CLASS_HIERARCHY.get_or_init` + `FirstRegistrationGuard`):
// every concurrent first load observes the stored `Err` and throws, and no
// worker is ever left blocked in `wait_first_thread_registered`.

const __dirname = join(fileURLToPath(import.meta.url), '..')
const repoRoot = join(__dirname, '..', '..', '..')

// Built + staged as a loadable `.node` in `before`; left undefined (→ tests
// skip) if cargo is unavailable or the build fails in this environment. A
// build/lookup failure still skips gracefully (this fixture is genuinely
// optional in environments without a Rust toolchain), but the reason is
// logged rather than silently swallowed.
let brokenNodePath: string | undefined

test.before((t) => {
  const result = buildCargoCdylibArtifact(repoRoot, 'napi-broken-hierarchy')
  if (result.cargoUnavailable) {
    return
  }
  if (!result.path) {
    t.log(
      'failed to build/locate the napi-broken-hierarchy fixture addon:',
      result.error,
    )
    return
  }
  const staged = join(tmpdir(), `napi-broken-hierarchy-${process.pid}.node`)
  copyFileSync(result.path, staged)
  brokenNodePath = staged
})

const brokenTest = process.env.WASI_TEST ? test.skip : test

interface WorkerLoadResult {
  loaded: boolean
  message?: string
}

interface WorkerHandle {
  worker: Worker
  result: Promise<WorkerLoadResult>
}

// Returns the `Worker` alongside its result promise (rather than just the
// promise) so a caller can `terminate()` it directly — needed both to reject
// on a native crash (no 'message'/'error' ever fires; only 'exit') and to stop
// an in-flight worker if the caller's own hang guard trips first.
function loadInWorker(nodePath: string): WorkerHandle {
  const worker = new Worker(join(__dirname, 'broken-hierarchy-worker.cjs'), {
    workerData: { nodePath },
    env: process.env,
  })
  let settled = false
  const result = new Promise<WorkerLoadResult>((resolve, reject) => {
    worker.once('message', (message: WorkerLoadResult) => {
      settled = true
      void worker.terminate()
      resolve(message)
    })
    worker.once('error', (error) => {
      settled = true
      void worker.terminate()
      reject(error)
    })
    worker.once('exit', (code) => {
      if (!settled) {
        reject(
          new Error(
            `worker exited with code ${code} before reporting a load result (a native crash?)`,
          ),
        )
      }
    })
  })
  return { worker, result }
}

brokenTest(
  'a broken #[napi(extends)] hierarchy fails fast in two concurrent workers and never hangs',
  async (t) => {
    if (!brokenNodePath) {
      t.pass(
        'broken-hierarchy fixture addon was not built (cargo unavailable?); skipping',
      )
      return
    }

    const nodePath = brokenNodePath
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined

    // If the guard were wrong, a worker could block forever waiting for a first
    // registration that already failed. This timeout is far below any real
    // compile/load latency but well above a healthy fail-fast load, so tripping
    // it means a genuine hang.
    const hangGuard = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () =>
          reject(new Error('a worker hung on the broken addon (no fail-fast)')),
        30_000,
      )
    })

    // Keep both `Worker` handles (not just their result promises) so they can
    // be terminated below regardless of which way the race resolves.
    const handles = [loadInWorker(nodePath), loadInWorker(nodePath)]

    try {
      const results = await Promise.race([
        Promise.all(handles.map((handle) => handle.result)),
        hangGuard,
      ])

      for (const result of results) {
        t.false(result.loaded, 'the broken addon must never load successfully')
        t.regex(
          String(result.message),
          /not registered/,
          'both workers observe the hierarchy build error',
        )
      }
    } finally {
      // Terminate any still-active worker before clearing the hang-guard
      // timeout — if the hang guard won the race, both workers would
      // otherwise keep running in the background for the rest of the test
      // process's lifetime. `terminate()` on an already-exited worker is a
      // harmless no-op.
      for (const { worker } of handles) {
        void worker.terminate()
      }
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
    }
  },
)
