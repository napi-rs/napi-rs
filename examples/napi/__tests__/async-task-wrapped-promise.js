import { createRequire } from 'node:module'

// Replaces globalThis.Promise before the addon loads, the way an instrumentation preload does,
// then runs AsyncTasks. The addon must not cache the replacement: no AsyncTask may call it or
// settle through the resolving functions it hands out. Usage: node <this file> proxy|throwing
const mode = process.argv[2]
const IntrinsicPromise = globalThis.Promise
const TASKS = 10

let constructs = 0
let wrappedSettles = 0

if (mode === 'proxy') {
  // Same prototype, and every promise is a real intrinsic one; only the resolving functions the
  // executor sees are wrapped.
  globalThis.Promise = new Proxy(IntrinsicPromise, {
    construct(target, [executor]) {
      constructs++
      return Reflect.construct(target, [
        (resolve, reject) =>
          executor(
            (value) => {
              wrappedSettles++
              resolve(value)
            },
            (reason) => {
              wrappedSettles++
              reject(reason)
            },
          ),
      ])
    },
  })
} else if (mode === 'throwing') {
  // A plain function wrapper sharing the prototype, whose resolving functions throw.
  function Wrapped(executor) {
    constructs++
    return new IntrinsicPromise((_resolve, _reject) =>
      executor(
        () => {
          wrappedSettles++
          throw new Error('wrapper resolve threw')
        },
        () => {
          wrappedSettles++
          throw new Error('wrapper reject threw')
        },
      ),
    )
  }
  Wrapped.prototype = IntrinsicPromise.prototype
  globalThis.Promise = Wrapped
} else {
  console.error(`unknown mode ${mode}`)
  process.exit(2)
}

const uncaught = []
process.on('uncaughtException', (error) => uncaught.push(String(error)))

const require = createRequire(import.meta.url)
const native = require('../index.cjs')

const constructsAtLoad = constructs
const before = native.asyncTaskSettleCounters()
const promises = []
for (let i = 0; i < TASKS; i++) {
  promises.push(native.asyncTaskCounted())
}
const constructsDuringTasks = constructs - constructsAtLoad

const timeout = setTimeout(() => {
  console.error('AsyncTask promise still pending after 5000 ms')
  process.exit(1)
}, 5000)
const values = await IntrinsicPromise.all(promises)
clearTimeout(timeout)

const after = native.asyncTaskSettleCounters()
const result = {
  constructsDuringTasks,
  wrappedSettles,
  values,
  uncaught,
  // The fallback (`napi_create_promise`) promise never goes through the resolver release.
  resolversReleased: after.resolversReleased - before.resolversReleased,
  dropped: after.dropped - before.dropped,
}
if (
  constructsDuringTasks !== 0 ||
  wrappedSettles !== 0 ||
  values.some((value) => value !== 0) ||
  uncaught.length !== 0 ||
  result.resolversReleased !== 0 ||
  result.dropped !== TASKS
) {
  console.error(JSON.stringify(result))
  process.exit(1)
}
console.log(`AsyncTasks ignored the ${mode} Promise wrapper`)
