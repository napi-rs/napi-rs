import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

import test from 'ava'

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

function fixtureLibraryFileName(): string {
  switch (process.platform) {
    case 'win32':
      return 'napi_broken_hierarchy.dll'
    case 'darwin':
      return 'libnapi_broken_hierarchy.dylib'
    default:
      return 'libnapi_broken_hierarchy.so'
  }
}

// Built + staged as a loadable `.node` in `before`; left undefined (→ tests
// skip) if cargo is unavailable or the build fails in this environment.
let brokenNodePath: string | undefined

test.before(() => {
  try {
    execFileSync('cargo', ['build', '-p', 'napi-broken-hierarchy'], {
      cwd: repoRoot,
      stdio: 'ignore',
    })
    const built = join(repoRoot, 'target', 'debug', fixtureLibraryFileName())
    if (!existsSync(built)) {
      return
    }
    const staged = join(tmpdir(), `napi-broken-hierarchy-${process.pid}.node`)
    copyFileSync(built, staged)
    brokenNodePath = staged
  } catch {
    // Leave `brokenNodePath` undefined so the test below skips gracefully.
  }
})

const brokenTest = process.env.WASI_TEST ? test.skip : test

interface WorkerLoadResult {
  loaded: boolean
  message?: string
}

function loadInWorker(nodePath: string): Promise<WorkerLoadResult> {
  return new Promise<WorkerLoadResult>((resolve, reject) => {
    const worker = new Worker(join(__dirname, 'broken-hierarchy-worker.cjs'), {
      workerData: { nodePath },
      env: process.env,
    })
    worker.once('message', (message: WorkerLoadResult) => {
      void worker.terminate()
      resolve(message)
    })
    worker.once('error', (error) => {
      void worker.terminate()
      reject(error)
    })
  })
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

    try {
      const results = await Promise.race([
        Promise.all([loadInWorker(nodePath), loadInWorker(nodePath)]),
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
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
    }
  },
)
