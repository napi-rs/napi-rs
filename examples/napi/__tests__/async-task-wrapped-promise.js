import { createRequire } from 'node:module'
import { Worker, isMainThread } from 'node:worker_threads'

// Tampers with the Promise machinery the way an instrumentation preload or a hostile script can,
// then runs AsyncTasks. No AsyncTask may run the tampered code, and every promise must settle.
// Usage: node <this file> proxy|throwing|constructor|then-accessors [main|worker]
// `worker` runs the same checks in a worker, whose env settles through the thenable; the main
// thread settles through the deferred.
const mode = process.argv[2]
const thread = process.argv[3] ?? 'main'
const TASKS = 10

if (thread !== 'main' && thread !== 'worker') {
  console.error(`unknown thread ${thread}`)
  process.exitCode = 2
} else if (isMainThread && thread === 'worker') {
  // The tampering must land in the worker's own realm, before its load of the addon.
  const worker = new Worker(new URL(import.meta.url), {
    argv: [mode, 'worker'],
    env: process.env,
  })
  worker.on('error', (error) => {
    console.error(error)
    process.exitCode = 1
  })
  worker.on('exit', (code) => {
    if (code !== 0) process.exitCode = code
  })
} else {
  await runChecks()
}

async function runChecks() {
  const IntrinsicPromise = globalThis.Promise
  const intrinsicThen = IntrinsicPromise.prototype.then

  let userCalls = 0
  const restore = []

  function installThrowingWrapper() {
    // A plain function wrapper sharing the prototype, whose resolving functions throw.
    function Wrapped(executor) {
      userCalls++
      return new IntrinsicPromise((_resolve, _reject) =>
        executor(
          () => {
            userCalls++
            throw new Error('wrapper resolve threw')
          },
          () => {
            userCalls++
            throw new Error('wrapper reject threw')
          },
        ),
      )
    }
    Wrapped.prototype = IntrinsicPromise.prototype
    return Wrapped
  }

  // Installed before the addon loads, as a preload would.
  if (mode === 'proxy') {
    // Same prototype, and every promise is a real intrinsic one; only the resolving functions the
    // executor sees are wrapped.
    globalThis.Promise = new Proxy(IntrinsicPromise, {
      construct(target, [executor]) {
        userCalls++
        return Reflect.construct(target, [
          (resolve, reject) =>
            executor(
              (value) => {
                userCalls++
                resolve(value)
              },
              (reason) => {
                userCalls++
                reject(reason)
              },
            ),
        ])
      },
    })
  } else if (mode === 'throwing') {
    globalThis.Promise = installThrowingWrapper()
  } else if (mode === 'constructor') {
    // The wrapper also claims the intrinsic prototype's `constructor`, so it is strict-equal to
    // what `Promise.prototype.constructor` reads.
    const Wrapped = installThrowingWrapper()
    const descriptor = Object.getOwnPropertyDescriptor(
      IntrinsicPromise.prototype,
      'constructor',
    )
    Wrapped.prototype.constructor = Wrapped
    globalThis.Promise = Wrapped
    restore.push(() =>
      Object.defineProperty(
        IntrinsicPromise.prototype,
        'constructor',
        descriptor,
      ),
    )
  } else if (mode !== 'then-accessors') {
    console.error(`unknown mode ${mode}`)
    process.exitCode = 2
    return
  }

  const uncaught = []
  process.on('uncaughtException', (error) => uncaught.push(String(error)))

  const require = createRequire(import.meta.url)
  const native = require('../index.cjs')
  const expectedMode = isMainThread ? 'deferred' : 'thenable'
  const settleMode = native.asyncTaskPromiseSettleMode()

  if (mode === 'then-accessors') {
    // Installed after the load, since the loader itself awaits: an `Object.prototype.then`
    // accessor that throws on every get and set, and a replaced `Promise.prototype.then`.
    // oxlint-disable-next-line unicorn/no-thenable
    Object.defineProperty(Object.prototype, 'then', {
      configurable: true,
      get() {
        userCalls++
        throw new Error('Object.prototype.then getter ran')
      },
      set(_value) {
        userCalls++
        throw new Error('Object.prototype.then setter ran')
      },
    })
    // oxlint-disable-next-line unicorn/no-thenable
    IntrinsicPromise.prototype.then = function then(...args) {
      userCalls++
      return intrinsicThen.apply(this, args)
    }
    restore.push(() => {
      delete Object.prototype.then
      // oxlint-disable-next-line unicorn/no-thenable
      IntrinsicPromise.prototype.then = intrinsicThen
    })
  }

  const before = native.asyncTaskSettleCounters()
  const callsBefore = userCalls
  const promises = []
  for (let i = 0; i < TASKS; i++) {
    promises.push(native.asyncTaskCounted())
  }

  const timeout = setTimeout(() => {
    console.error('AsyncTask promise still pending after 5000 ms')
    process.exit(1)
  }, 5000)
  // `await` on a native promise whose `constructor` is the intrinsic reads no `then`; otherwise it
  // calls the intrinsic `Promise.prototype.then`, which only `then-accessors` replaces (and there
  // the `constructor` is the intrinsic one).
  const values = []
  for (const promise of promises) {
    values.push(await promise)
  }
  clearTimeout(timeout)
  const callsDuringTasks = userCalls - callsBefore
  for (const undo of restore) undo()

  const after = native.asyncTaskSettleCounters()
  const result = {
    settleMode,
    callsDuringTasks,
    values,
    uncaught,
    prototypeIsIntrinsic: promises.every(
      (promise) =>
        Object.getPrototypeOf(promise) === IntrinsicPromise.prototype,
    ),
    promiseStatesFreed: after.promiseStatesFreed - before.promiseStatesFreed,
    dropped: after.dropped - before.dropped,
    wrappersCompiled:
      after.promiseWrappersCompiled - before.promiseWrappersCompiled,
    wrapperFallbacks:
      after.promiseWrapperFallbacks - before.promiseWrapperFallbacks,
  }
  if (
    settleMode !== expectedMode ||
    callsDuringTasks !== 0 ||
    values.length !== TASKS ||
    values.some((value) => value !== 0) ||
    uncaught.length !== 0 ||
    !result.prototypeIsIntrinsic ||
    // Deferred mode creates no promise state.
    result.promiseStatesFreed !== (expectedMode === 'thenable' ? TASKS : 0) ||
    result.dropped !== TASKS ||
    // A thenable-mode env compiles its promise wrapper at its first task, in the tampered realm,
    // and makes every promise with it.
    result.wrappersCompiled !== (expectedMode === 'thenable' ? 1 : 0) ||
    result.wrapperFallbacks !== 0
  ) {
    console.error(JSON.stringify(result))
    process.exitCode = 1
    return
  }
  console.log(`AsyncTasks ignored the ${mode} Promise tampering (${thread})`)
}
