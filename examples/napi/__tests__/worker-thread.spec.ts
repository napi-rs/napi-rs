import { spawnSync } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { setTimeout } from 'node:timers/promises'

import test from 'ava'
import type { ExecutionContext } from 'ava'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const require = createRequire(import.meta.url)
const native = require('../index.cjs')
const { Animal, Kind, DEFAULT_COST, asyncMultiTwo, shutdownRuntime } = native

const concurrency =
  (process.platform === 'win32' ||
    process.platform === 'darwin' ||
    (process.platform === 'linux' &&
      (process.arch === 'x64' || process.arch === 'arm64') &&
      // @ts-expect-error
      process?.report?.getReport()?.header?.glibcVersionRuntime)) &&
  // 32-bit (ia32) targets such as i686 Windows cannot hold 20 concurrent worker
  // isolates plus the off-thread Error drops' spawned OS threads in a single
  // ~2 GB address space; keep them at 1 like the other constrained targets
  // (napi-rs#3368).
  process.arch !== 'ia32' &&
  !process.env.WASI_TEST &&
  !process.env.ASAN_OPTIONS
    ? 20
    : 1

async function withTimeout<T>(
  promise: Promise<T>,
  timeout: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = globalThis.setTimeout(() => {
          reject(new Error(message))
        }, timeout)
      }),
    ])
  } finally {
    if (timer !== undefined) {
      globalThis.clearTimeout(timer)
    }
  }
}

test.after(() => {
  if (process.platform !== 'win32') {
    shutdownRuntime()
  }
})

test('should be able to require in worker thread', async (t) => {
  await Promise.all(
    Array.from({ length: concurrency }).map(() => {
      const w = new Worker(join(__dirname, 'worker.js'), {
        env: process.env,
      })
      return new Promise<void>((resolve, reject) => {
        w.postMessage({ type: 'require' })
        w.on('message', (msg) => {
          t.is(msg, Animal.withKind(Kind.Cat).whoami() + DEFAULT_COST)
          resolve()
        })
        w.on('error', (err) => {
          reject(err)
        })
      })
        .then(() => setTimeout(100))
        .then(() => w.terminate())
        .then(() => {
          t.pass()
        })
    }),
  )
})

test.serial.skipIf(Boolean(process.env.WASI_TEST))(
  'worker teardown runs pending async block terminal finalizers exactly once',
  async (t) => {
    for (let iteration = 1; iteration <= 3; iteration++) {
      const directory = await mkdtemp(
        join(tmpdir(), `napi-async-terminal-finalizer-${iteration}-`),
      )
      const resultPath = join(directory, 'finalized')
      const worker = new Worker(join(__dirname, 'worker.js'), {
        env: process.env,
      })
      try {
        await new Promise<void>((resolve, reject) => {
          worker.postMessage({ type: 'async:terminal-finalizer', resultPath })
          worker.once('message', (message) => {
            t.is(message, 'pending')
            resolve()
          })
          worker.once('error', reject)
        })
        await worker.terminate()

        const deadline = Date.now() + 2_000
        while (Date.now() < deadline) {
          try {
            t.is(await readFile(resultPath, 'utf8'), 'finalized')
            break
          } catch {
            await setTimeout(10)
          }
        }
        t.is(await readFile(resultPath, 'utf8'), 'finalized')
      } finally {
        await worker.terminate().catch(() => {})
        await rm(directory, { recursive: true, force: true })
      }
    }
  },
)

test.serial.skipIf(Boolean(process.env.WASI_TEST))(
  'worker teardown finalizers cannot stop another environment runtime',
  async (t) => {
    const directory = await mkdtemp(
      join(tmpdir(), 'napi-runtime-finalizer-worker-'),
    )
    const resultPath = join(directory, 'result')
    const worker = new Worker(join(__dirname, 'worker.js'), {
      env: process.env,
    })
    let workerError: Error | undefined
    let rejectWorkerFailure!: (error: Error) => void
    const workerFailure = new Promise<never>((_, reject) => {
      rejectWorkerFailure = reject
    })
    const onWorkerError = (error: Error) => {
      workerError ??= error
      rejectWorkerFailure(error)
    }
    worker.on('error', onWorkerError)
    const exit = new Promise<number>((resolve) => {
      worker.once('exit', resolve)
    })
    let onReady: ((message: unknown) => void) | undefined
    try {
      const ready = new Promise<unknown>((resolve) => {
        onReady = resolve
        worker.once('message', onReady)
      })
      worker.postMessage({ type: 'runtime-finalizer:teardown', resultPath })
      const message = await withTimeout(
        Promise.race([
          ready,
          workerFailure,
          exit.then((code) => {
            throw (
              workerError ??
              new Error(
                `worker exited with code ${code} before runtime finalizer setup`,
              )
            )
          }),
        ]),
        10_000,
        'worker runtime finalizer setup timed out',
      )
      t.deepEqual(message, { type: 'runtime-finalizer-ready' })
      await t.throwsAsync(access(resultPath))

      const termination = worker.terminate()
      await withTimeout(
        Promise.race([Promise.all([exit, termination]), workerFailure]),
        10_000,
        'worker runtime finalizer teardown timed out',
      )
      if (workerError) {
        throw workerError
      }

      t.is(await readFile(resultPath, 'utf8'), '0')
      t.is(await asyncMultiTwo(2), 4)
    } finally {
      if (onReady) {
        worker.off('message', onReady)
      }
      try {
        await withTimeout(
          Promise.resolve(worker.terminate()),
          10_000,
          'worker runtime finalizer cleanup timed out',
        )
      } catch {}
      worker.off('error', onWorkerError)
      await rm(directory, { recursive: true, force: true })
    }
  },
)

test.serial.skipIf(Boolean(process.env.WASI_TEST))(
  'module and public finalizer APIs cannot stop another environment runtime',
  (t) => {
    const result = spawnSync(
      process.execPath,
      [join(__dirname, 'worker-public-finalizers.js')],
      {
        encoding: 'utf8',
        timeout: 30_000,
        env: process.env,
      },
    )
    const output = `${result.stdout}\n${result.stderr}`
    t.is(result.error, undefined, result.error?.stack)
    t.is(result.signal, null, output)
    t.is(result.status, 0, output)
    t.regex(result.stdout, /worker public finalizers passed/)
  },
)

test('custom GC works on worker_threads', async (t) => {
  await Promise.all(
    Array.from({ length: concurrency }).map(() =>
      Promise.all([
        new Promise<Worker>((resolve, reject) => {
          const w = new Worker(join(__dirname, 'worker.js'), {
            env: process.env,
          })
          w.postMessage({
            type: 'async:buffer',
          })
          w.on('message', (msg) => {
            t.is(msg, 'done')
            resolve(w)
          })
          w.on('error', (err) => {
            reject(err)
          })
        }).then((w) => {
          return w.terminate()
        }),
        new Promise<Worker>((resolve, reject) => {
          const w = new Worker(join(__dirname, 'worker.js'), {
            execArgv: [],
          })
          w.postMessage({
            type: 'async:arraybuffer',
          })
          w.on('message', (msg) => {
            t.is(msg, 'done')
            resolve(w)
          })
          w.on('error', (err) => {
            reject(err)
          })
        }).then(async (w) => {
          await setTimeout(100)
          return w.terminate()
        }),
      ]),
    ),
  )
})

// (A) off-thread cross-isolate drop. buffer sub-worker: env:process.env + IMMEDIATE terminate
// (F2/F3 owner-teardown stress). arraybuffer sub-worker: execArgv:[] + setTimeout(100) then terminate.
test('custom GC cross-isolate off-thread drop (napi-rs#3357)', async (t) => {
  await Promise.all(
    Array.from({ length: concurrency }).map(() =>
      Promise.all([
        new Promise<Worker>((resolve, reject) => {
          const w = new Worker(join(__dirname, 'worker.js'), {
            env: process.env,
          })
          w.postMessage({ type: 'async:buffer:consume' })
          w.on('message', (msg) => {
            t.is(msg, 'done')
            resolve(w)
          })
          w.on('error', reject)
        }).then((w) => w.terminate()),
        new Promise<Worker>((resolve, reject) => {
          const w = new Worker(join(__dirname, 'worker.js'), { execArgv: [] })
          w.postMessage({ type: 'async:arraybuffer:consume' })
          w.on('message', (msg) => {
            t.is(msg, 'done')
            resolve(w)
          })
          w.on('error', reject)
        }).then(async (w) => {
          await setTimeout(100)
          return w.terminate()
        }),
      ]),
    ),
  )
})

// (B) same-thread post-teardown drop (guards must_fix #1). Worker stashes JS-origin Buffers in a
// Rust thread_local on its OWN JS thread; on terminate the env tears down (aborted=true), then the
// thread exits and the stashed Buffers drop on the OWNER thread AFTER teardown -> must no-op.
test('custom GC same-thread post-teardown drop (napi-rs#3357 must_fix #1)', async (t) => {
  await Promise.all(
    Array.from({ length: concurrency }).map(() =>
      Promise.all(
        ['stash:buffer:teardown', 'stash:arraybuffer:teardown'].map((type) =>
          new Promise<Worker>((resolve, reject) => {
            const w = new Worker(join(__dirname, 'worker.js'), {
              env: process.env,
            })
            w.postMessage({ type })
            w.on('message', (msg) => {
              t.is(msg, 'done')
              resolve(w)
            })
            w.on('error', reject)
          }).then((w) => w.terminate()),
        ),
      ),
    ),
  )
})

function testOffThreadErrorRelease(t: ExecutionContext, type: string) {
  const result = spawnSync(
    process.execPath,
    [
      '--expose-gc',
      join(__dirname, 'worker-error-lifecycle.js'),
      type,
      String(concurrency),
    ],
    {
      encoding: 'utf8',
      env: process.env,
      timeout: 120_000,
    },
  )
  const output = `${result.stdout}\n${result.stderr}`
  t.is(result.error, undefined, result.error?.stack)
  t.is(result.signal, null, output)
  t.is(result.status, 0, output)
  t.regex(result.stdout, /worker Error lifecycle passed/)
}

// (C) JS-derived `Error`s own a napi_ref; releasing them off the JS thread must be
// routed through the custom GC like buffers (napi-rs#3368). Each worker interleaves
// one off-thread release path with JS-thread GlobalHandles churn and reports
// completion only after every native drop has finished.
test.serial(
  'JS-derived Error value released off-thread (napi-rs#3368)',
  (t) => {
    testOffThreadErrorRelease(t, 'error:value:offthread')
  },
)

test.serial(
  'JS-derived Promise rejection released off-thread (napi-rs#3368)',
  (t) => {
    testOffThreadErrorRelease(t, 'error:reject:offthread')
  },
)

test.serial(
  'cloned JS-derived Error released off-thread (napi-rs#3368)',
  (t) => {
    testOffThreadErrorRelease(t, 'error:clone:threads')
  },
)

// (D) same-thread post-teardown Error drop: stashed on the worker's own JS thread,
// dropped at thread-exit after env teardown -> aborted (leak) path (napi-rs#3368).
test('JS-derived Error same-thread post-teardown drop (napi-rs#3368)', async (t) => {
  await Promise.all(
    Array.from({ length: concurrency }).map(() =>
      new Promise<Worker>((resolve, reject) => {
        const w = new Worker(join(__dirname, 'worker.js'), {
          env: process.env,
        })
        w.postMessage({ type: 'stash:error:teardown' })
        w.on('message', (msg) => {
          t.is(msg, 'done')
          resolve(w)
        })
        w.on('error', reject)
      }).then((w) => w.terminate()),
    ),
  )
})

test('should be able to new Class in worker thread concurrently', async (t) => {
  await Promise.all(
    Array.from({ length: concurrency }).map(() => {
      const w = new Worker(join(__dirname, 'worker.js'), {
        env: process.env,
      })
      return new Promise<void>((resolve, reject) => {
        w.postMessage({ type: 'constructor' })
        w.on('message', (msg) => {
          t.is(msg, 'Ellie')
          resolve()
        })
        w.on('error', (err) => {
          reject(err)
        })
      })
        .then(() => setTimeout(100))
        .then(() => w.terminate())
        .then(() => {
          t.pass()
        })
    }),
  )
})
