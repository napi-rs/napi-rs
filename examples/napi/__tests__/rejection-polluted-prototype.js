// Rejects one `#[napi] async fn` promise while a prototype is polluted, and reports how the
// promise ended. The addon is built with `deferred_trace`, which puts the message and the code of
// the rejection on a trace error: that step must not leave the promise pending.
// Usage: node <this file> <code-setter|descriptor-get>
// * code-setter: a setter on `Error.prototype.code` that throws.
// * descriptor-get: `Object.prototype.get`, which every plain descriptor object inherits.
// Prints one line, `rejection <json>`.
import { writeSync } from 'node:fs'
import { createRequire } from 'node:module'

const native = createRequire(import.meta.url)('../index.cjs')
const kind = process.argv[2]

const uncaught = []
process.on('uncaughtException', (error) =>
  uncaught.push(String(error?.message)),
)
process.on('unhandledRejection', (error) =>
  uncaught.push(String(error?.message)),
)

const promise = native.throwAsyncError()
// After the call, before the rejection is built on this thread.
if (kind === 'code-setter') {
  Object.defineProperty(Error.prototype, 'code', {
    configurable: true,
    get() {
      return undefined
    },
    set() {
      throw new Error('thrown by the code setter')
    },
  })
} else if (kind === 'descriptor-get') {
  Object.defineProperty(Object.prototype, 'get', {
    configurable: true,
    writable: true,
    value() {},
  })
} else {
  throw new Error(`unknown kind ${kind}`)
}

let outcome
const timeout = setTimeout(() => {
  finish({ settled: 'pending' })
}, 10_000)

function finish(result) {
  delete Error.prototype.code
  delete Object.prototype.get
  clearTimeout(timeout)
  writeSync(
    1,
    `rejection ${JSON.stringify({ target: native.__napiBindingTarget, ...result, uncaught })}\n`,
  )
  process.exit(0)
}

promise.then(
  () => finish({ settled: 'fulfilled' }),
  (error) => {
    outcome = {
      settled: 'rejected',
      name: error?.name,
      message: error?.message,
      code: error?.code,
    }
    // One more turn: an exception reported as uncaught arrives after the rejection.
    setTimeout(() => finish(outcome), 50)
  },
)
