import { readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const mode = process.argv[2]
const loaderFile = process.argv[3]
const loaderPath = fileURLToPath(new URL(`../${loaderFile}`, import.meta.url))

/**
 * Records how each task settled, in completion order, so the spec can tell a
 * cancelled task from one that ran. A task that never settles leaves nothing
 * here at all — which is the defect: `dispose()` used to tear the environment
 * down with the work still outstanding, so its completion callback could never
 * run and its promise hung forever.
 */
const settled = []
function track(name, promise) {
  return promise.then(
    () => settled.push(`${name}:resolved`),
    (error) => settled.push(`${name}:rejected:${error?.name ?? 'unknown'}`),
  )
}

function report() {
  process.stdout.write(`settled ${JSON.stringify(settled)}\n`)
  // The emnapi waiting-request counter references a MessagePort while any async
  // work is outstanding. One left here means a promise was stranded, and it is
  // also what keeps the process from ever exiting.
  const ports = process
    .getActiveResourcesInfo()
    .filter((resource) => resource === 'MessagePort').length
  process.stdout.write(`ports ${ports}\n`)
  process.stdout.write('drain complete\n')
}

if (mode === 'rollback') {
  // The rollback runs on the one path where instantiation never returned, so
  // `__napiModule` was never assigned — while the async work a module-init hook
  // started is already outstanding. Reproduce exactly that, the way #3526's
  // harness does, but without awaiting the task first.
  const copyPath = fileURLToPath(
    new URL(`../.wasi-async-work-drain-${process.pid}.cjs`, import.meta.url),
  )
  const source = await readFile(loaderPath, 'utf8')
  const anchor = 'module.exports = __napiModule.exports\n'
  if (source.split(anchor).length - 1 !== 1) {
    throw new Error(
      'the generated loader no longer aliases __napiModule.exports exactly once',
    )
  }
  await writeFile(
    copyPath,
    source.replace(
      anchor,
      `const __rollbackTestExports = __napiModule.exports
Object.defineProperty(__rollbackTestExports, '__clearNapiModule', {
  value: function () { __napiModule = undefined },
  enumerable: false,
})
module.exports = __rollbackTestExports
`,
    ),
  )
  try {
    const binding = require(copyPath)
    track('t0', binding.asyncTaskVoidReturn())
    binding.__clearNapiModule()
    // The real catch block starts the rollback without awaiting it and rethrows
    // the initialization error at the caller, who carries on.
    await binding[Symbol.for('napi.rs.wasi.dispose')]().catch(() => {})
    process.stdout.write('caller survived the failed initialization\n')
    report()
  } finally {
    await rm(copyPath, { force: true })
  }
} else {
  const binding = require(loaderPath)
  const dispose = binding[Symbol.for('napi.rs.wasi.dispose')]

  if (mode === 'settles') {
    // One task, never awaited: outstanding at the moment disposal starts.
    track('t0', binding.asyncTaskVoidReturn())
  } else if (mode === 'cancel-queued') {
    // More than any pool starts at once, disposed in the same tick, so work is
    // still queued and `napi_cancel_async_work` can take it.
    for (let index = 0; index < 16; index += 1) {
      track(`t${index}`, binding.asyncTaskVoidReturn())
    }
  } else if (mode === 'executing') {
    // `withoutAbortController` sleeps 100ms in `compute`. Yield first so a pool
    // thread has actually picked it up: cancellation then refuses, and the
    // drain has to wait for it to finish instead.
    track('d0', binding.withoutAbortController(1, 2))
    await new Promise((resolve) => setTimeout(resolve, 60))
  } else {
    throw new Error(`unsupported mode: ${mode}`)
  }

  await dispose()
  report()
}
