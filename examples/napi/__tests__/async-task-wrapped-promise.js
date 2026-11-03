import { createRequire } from 'node:module'

// Tampers with the Promise machinery the way an instrumentation preload or a hostile script can,
// then runs AsyncTasks. No AsyncTask may run the tampered code, and every promise must settle.
// Usage: node <this file> proxy|throwing|constructor|then-accessors
const mode = process.argv[2]
const IntrinsicPromise = globalThis.Promise
const intrinsicThen = IntrinsicPromise.prototype.then
const TASKS = 10

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
  process.exit(2)
}

const uncaught = []
process.on('uncaughtException', (error) => uncaught.push(String(error)))

const require = createRequire(import.meta.url)
const native = require('../index.cjs')

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
  callsDuringTasks,
  values,
  uncaught,
  prototypeIsIntrinsic: promises.every(
    (promise) => Object.getPrototypeOf(promise) === IntrinsicPromise.prototype,
  ),
  promiseStatesFreed: after.promiseStatesFreed - before.promiseStatesFreed,
  dropped: after.dropped - before.dropped,
}
if (
  callsDuringTasks !== 0 ||
  values.length !== TASKS ||
  values.some((value) => value !== 0) ||
  uncaught.length !== 0 ||
  !result.prototypeIsIntrinsic ||
  result.promiseStatesFreed !== TASKS ||
  result.dropped !== TASKS
) {
  console.error(JSON.stringify(result))
  process.exit(1)
}
console.log(`AsyncTasks ignored the ${mode} Promise tampering`)
