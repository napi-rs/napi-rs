import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const loaderPath = resolve(process.argv[2])
const scenario = process.argv[3]

assert.ok(
  scenario === 'primitive-rejection' || scenario === 'occupied-cause-removal',
  `unsupported cleanup preservation scenario: ${scenario}`,
)

const loaderRequire = createRequire(loaderPath)
const wasmRuntime = loaderRequire('@napi-rs/wasm-runtime')
const emnapiRuntime = loaderRequire('@emnapi/runtime')
const instantiateNapiModuleSync = wasmRuntime.instantiateNapiModuleSync
const createContext = emnapiRuntime.createContext
const removeListener = process.removeListener
const initialBeforeExitListeners = new Set(process.rawListeners('beforeExit'))
const cleanupError = new Error(`${scenario} cleanup failed`)
const existingCause = new Error('existing primary cause')
const primaryError =
  scenario === 'primitive-rejection'
    ? 17
    : new Error('initialization failed', { cause: existingCause })
let destroyAttempts = 0
let uncaughtCleanup
let resolveUncaught
const uncaught = new Promise((resolveUncaughtPromise) => {
  resolveUncaught = resolveUncaughtPromise
})

process.once('uncaughtException', (error) => {
  uncaughtCleanup = error
  resolveUncaught()
})
wasmRuntime.instantiateNapiModuleSync = () => {
  throw primaryError
}
emnapiRuntime.createContext = () => ({
  suppressDestroy() {},
  destroy() {
    destroyAttempts += 1
    if (destroyAttempts > 1) {
      return
    }
    return scenario === 'primitive-rejection'
      ? Promise.reject(cleanupError)
      : Promise.resolve()
  },
})
if (scenario === 'occupied-cause-removal') {
  process.removeListener = function (event, listener) {
    if (
      event === 'beforeExit' &&
      listener.name === '__destroyEmnapiContextBeforeExit'
    ) {
      throw cleanupError
    }
    return Reflect.apply(removeListener, this, [event, listener])
  }
}

let observedPrimary
try {
  loaderRequire(loaderPath)
  assert.fail('generated WASI loader unexpectedly initialized')
} catch (error) {
  observedPrimary = error
}
assert.strictEqual(observedPrimary, primaryError)

const timeout = setTimeout(() => {
  resolveUncaught()
}, 5_000)
timeout.unref()
await uncaught
clearTimeout(timeout)

assert.strictEqual(uncaughtCleanup, cleanupError)
if (scenario === 'occupied-cause-removal') {
  assert.strictEqual(primaryError.cause, existingCause)
}
assert.strictEqual(destroyAttempts, 1)

process.removeListener = removeListener
const generatedBeforeExitListeners = process
  .rawListeners('beforeExit')
  .filter((listener) => !initialBeforeExitListeners.has(listener))
  .filter(
    (listener) =>
      (listener.listener ?? listener).name ===
      '__destroyEmnapiContextBeforeExit',
  )
assert.equal(generatedBeforeExitListeners.length, 1)
Reflect.apply(generatedBeforeExitListeners[0], process, [0])
await new Promise((resolveImmediate) => setImmediate(resolveImmediate))

assert.equal(
  process
    .rawListeners('beforeExit')
    .filter((listener) => !initialBeforeExitListeners.has(listener)).length,
  0,
)
assert.equal(destroyAttempts, scenario === 'primitive-rejection' ? 2 : 1)

wasmRuntime.instantiateNapiModuleSync = instantiateNapiModuleSync
emnapiRuntime.createContext = createContext
process.stdout.write(`eager cleanup preservation passed: ${scenario}\n`)
