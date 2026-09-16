import { readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

if (mode.startsWith('deferred-')) {
  // The deferred (workerd) loader is a WASI loader too, with its own
  // per-instance lifecycle: it instantiates the same async-work plugin, and its
  // disposal destroyed the context without draining. It is threadless, so
  // `compute` runs on the JavaScript thread and outstanding work is always
  // queued rather than executing while this runs.
  const loaderUrl = new URL(`../${loaderFile}`, import.meta.url)
  const wasm = new WebAssembly.Module(
    await readFile(
      fileURLToPath(new URL('../example.wasm32-wasip1.wasm', import.meta.url)),
    ),
  )

  if (mode === 'deferred-rollback') {
    // Reproduce the one state the rollback exists for: registration has run
    // with a live environment, a module-init hook started async work whose
    // promise escaped into JavaScript, and only then did the load fail.
    const copyPath = fileURLToPath(
      new URL(`../.deferred-rollback-${process.pid}.js`, import.meta.url),
    )
    const source = await readFile(fileURLToPath(loaderUrl), 'utf8')
    const anchor =
      '__napiStampBindingTarget(__napiModule.exports, __napiBindingTarget)\n'
    if (source.split(anchor).length - 1 !== 1) {
      throw new Error('the deferred loader no longer stamps exactly once')
    }
    await writeFile(
      copyPath,
      source.replace(
        anchor,
        `${anchor}globalThis.__rollbackTask = __napiModule.exports.asyncTaskVoidReturn()
    throw new Error('injected initialization failure')
`,
      ),
    )
    try {
      const loader = await import(pathToFileURL(copyPath).href)
      await loader.createInstance(wasm).then(
        () => {
          throw new Error('expected the injected failure to reject')
        },
        () => {
          process.stdout.write('caller survived the failed initialization\n')
        },
      )
      await track('t0', globalThis.__rollbackTask)
      report()
    } finally {
      await rm(copyPath, { force: true })
    }
  } else {
    const loader = await import(loaderUrl.href)
    const instance = await loader.createInstance(wasm)
    if (mode === 'deferred-settles') {
      track('t0', instance.exports.asyncTaskVoidReturn())
    } else if (mode === 'deferred-cancel-queued') {
      for (let index = 0; index < 16; index += 1) {
        track(`t${index}`, instance.exports.asyncTaskVoidReturn())
      }
    } else {
      throw new Error(`unsupported mode: ${mode}`)
    }
    await instance.dispose()
    process.stdout.write(`disposed ${instance.disposed}\n`)
    report()
  }
} else if (mode === 'rollback') {
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
  // Set by a mode that disposes on its own schedule.
  let disposed = false

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
    // Wait for the real transition, not for a guessed delay: how long a pool
    // thread takes to pick work up is a property of the machine, and a sleep
    // that is long enough here can be too short on a slow runner — where the
    // work is still queued, the cancel succeeds, and the task rejects instead.
    // `asyncTaskIsExecuting` flips inside `compute`, which is strictly after
    // the point `napi_cancel_async_work` can still take the work, so disposal
    // from here always has to wait rather than cancel.
    track('d0', binding.asyncTaskSignalWhenExecuting(100))
    while (!binding.asyncTaskIsExecuting()) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
  } else if (mode === 'dispose-from-completion') {
    // Settling a task runs addon code that can re-enter JavaScript, and that
    // JavaScript can dispose. `AsyncTaskFinally::resolve` does
    // `obj.set("resolve", true)`, so this setter runs synchronously inside the
    // completion callback — before the deferred is settled and before the
    // task's `finally` hook. A disposal started from here must not conclude
    // that nothing is outstanding and tear the environment down from inside
    // that frame: the promise would never settle and `finally` would never run.
    const hooks = {}
    let disposal
    // Wait for the setter itself, never for a clock: how long the completion
    // callback takes to arrive is a property of the machine, and a wait that is
    // long enough on one is too short on another — where the setter has not run
    // yet, `disposal` is still undefined, and awaiting it would pass
    // vacuously while the work is in fact still outstanding.
    let disposalStarted
    const started = new Promise((resolve) => {
      disposalStarted = resolve
    })
    Object.defineProperty(hooks, 'resolve', {
      configurable: true,
      get: () => true,
      set() {
        disposal = dispose()
        disposalStarted()
      },
    })
    track('t0', binding.asyncTaskFinally(hooks))
    await started
    await disposal
    // `finally` unrefs the ObjectRef the task holds; without it the addon also
    // reports a leak on the way out.
    process.stdout.write(`finally ${hooks.finally === true}\n`)
    disposed = true
  } else {
    throw new Error(`unsupported mode: ${mode}`)
  }

  if (!disposed) {
    await dispose()
  }
  report()
}
