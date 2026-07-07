import { existsSync } from 'node:fs'
import { createRequire, Module } from 'node:module'
import { parentPort } from 'node:worker_threads'
import { setTimeout as delay } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const retained = []
let native
let lifecycle

const LOAD_PHASE_HOOK_READY = 1
const LOAD_PHASE_NATIVE_ENTERED = 2
const LOAD_PHASE_NATIVE_RELEASED = 3
const LOAD_PHASE_NATIVE_COMPLETED = 4
const LOAD_PHASE_INDEX = 0
const LOAD_LOADER_PROCEED_INDEX = 1
const LOAD_NATIVE_PROCEED_INDEX = 2
const LOAD_GATE_TIMEOUT = 10_000
const TSFN_TEARDOWN_JS_CALLBACK_INDEX = 3
const TSFN_TEARDOWN_COUNTER_COUNT = 9
const TSFN_BLOCKING_CALLBACK_ENTERED_INDEX = 0
const TSFN_BLOCKING_CALLBACK_MASK_INDEX = 4
const TSFN_BLOCKING_COMPLETED_INDEX = 5
const TSFN_BLOCKING_UNEXPECTED_INDEX = 6
const TSFN_BLOCKING_COUNTER_COUNT = 7
const TSFN_BLOCKING_CALLBACK_MASK = 0b111

function loadNative() {
  if (!native) {
    native = require('../index.cjs')
    lifecycle = native
  }
  return native
}

function findNativeModule(addon) {
  const nativeModule = Object.values(require.cache).find(
    (loadedModule) =>
      loadedModule?.filename?.endsWith('.node') &&
      loadedModule.exports?.asyncMultiTwo === addon.asyncMultiTwo,
  )
  if (!nativeModule) {
    throw new Error('loaded native binding was not found in the require cache')
  }
  return nativeModule
}

function loadNativeAgain() {
  const addon = loadNative()
  const nativeModule = findNativeModule(addon)
  const duplicateModule = new Module(`${nativeModule.filename}:duplicate`)
  duplicateModule.filename = nativeModule.filename
  process.dlopen(duplicateModule, nativeModule.filename)
  retained.push(duplicateModule)
  return {
    binding: duplicateModule.exports,
    lifecycle: duplicateModule.exports,
  }
}

function failNativeLoadAgain() {
  const nativeModule = findNativeModule(loadNative())
  const failedModule = new Module(`${nativeModule.filename}:failed`)
  const initializationError = new Error(
    'intentional duplicate process.dlopen initialization failure',
  )
  failedModule.filename = nativeModule.filename
  // Node holds its native-addon loader mutex while this setter runs, so a recursive
  // process.dlopen here would deadlock before napi_register_module_v1 is reached.
  failedModule.exports = new Proxy(
    {},
    {
      set(target, property, value) {
        Reflect.set(target, property, value)
        throw initializationError
      },
    },
  )

  let observedError
  try {
    process.dlopen(failedModule, nativeModule.filename)
  } catch (error) {
    observedError = error
  }
  if (observedError !== initializationError) {
    throw new Error(
      'failed duplicate process.dlopen did not preserve the initialization error',
    )
  }
  const exportedNames = Object.keys(failedModule.exports)
  if (exportedNames.length !== 1) {
    throw new Error(
      `failed duplicate process.dlopen retained ${exportedNames.length} exports`,
    )
  }
  retained.push(failedModule)
  return exportedNames[0]
}

function loadNativeAtSynchronizedBoundary(loadControl) {
  if (!(loadControl instanceof SharedArrayBuffer)) {
    throw new TypeError('load-runtime requires shared load control')
  }
  const control = new Int32Array(loadControl)
  if (control.length < 3) {
    throw new RangeError('load-runtime shared load control is too small')
  }
  const originalNodeLoader = require.extensions['.node']
  if (typeof originalNodeLoader !== 'function') {
    throw new TypeError('Node native module loader is unavailable')
  }

  let intercepted = false
  require.extensions['.node'] = function synchronizedNodeLoader(
    module,
    filename,
  ) {
    if (!intercepted) {
      intercepted = true
      Atomics.store(control, LOAD_PHASE_INDEX, LOAD_PHASE_HOOK_READY)
      Atomics.notify(control, LOAD_PHASE_INDEX)
      if (
        Atomics.wait(
          control,
          LOAD_LOADER_PROCEED_INDEX,
          0,
          LOAD_GATE_TIMEOUT,
        ) === 'timed-out'
      ) {
        throw new Error('timed out waiting to enter native addon loading')
      }

      const exportsDescriptor = Object.getOwnPropertyDescriptor(
        module,
        'exports',
      )
      if (
        !exportsDescriptor ||
        !('value' in exportsDescriptor) ||
        !exportsDescriptor.configurable
      ) {
        throw new Error('native module exports property cannot be instrumented')
      }
      let moduleExports = exportsDescriptor.value
      let nativeEntered = false
      Object.defineProperty(module, 'exports', {
        configurable: true,
        enumerable: exportsDescriptor.enumerable,
        get() {
          if (!nativeEntered) {
            nativeEntered = true
            Atomics.store(control, LOAD_PHASE_INDEX, LOAD_PHASE_NATIVE_ENTERED)
            Atomics.notify(control, LOAD_PHASE_INDEX)
            if (
              Atomics.wait(
                control,
                LOAD_NATIVE_PROCEED_INDEX,
                0,
                LOAD_GATE_TIMEOUT,
              ) === 'timed-out'
            ) {
              throw new Error(
                'timed out inside the native module loader entry gate',
              )
            }
            Atomics.store(control, LOAD_PHASE_INDEX, LOAD_PHASE_NATIVE_RELEASED)
            Atomics.notify(control, LOAD_PHASE_INDEX)
          }
          return moduleExports
        },
        set(value) {
          moduleExports = value
        },
      })
      try {
        return Reflect.apply(originalNodeLoader, this, [module, filename])
      } finally {
        Object.defineProperty(module, 'exports', {
          ...exportsDescriptor,
          value: moduleExports,
        })
      }
    }
    return Reflect.apply(originalNodeLoader, this, [module, filename])
  }

  try {
    const addon = loadNative()
    if (!intercepted) {
      throw new Error('native addon load bypassed the .node loader hook')
    }
    Atomics.store(control, LOAD_PHASE_INDEX, LOAD_PHASE_NATIVE_COMPLETED)
    Atomics.notify(control, LOAD_PHASE_INDEX)
    return addon
  } finally {
    require.extensions['.node'] = originalNodeLoader
  }
}

async function waitForTsfnBlockingCompletion(counters) {
  const deadline = Date.now() + LOAD_GATE_TIMEOUT
  while (
    Atomics.load(counters, TSFN_BLOCKING_COMPLETED_INDEX) === 0 &&
    Atomics.load(counters, TSFN_BLOCKING_UNEXPECTED_INDEX) === 0 &&
    Date.now() < deadline
  ) {
    await delay(1)
  }
  if (Atomics.load(counters, TSFN_BLOCKING_UNEXPECTED_INDEX) !== 0) {
    throw new Error('native TSFN blocking regression reported an error')
  }
  if (Atomics.load(counters, TSFN_BLOCKING_COMPLETED_INDEX) !== 1) {
    throw new Error('native TSFN blocking regression timed out')
  }
  if (
    Atomics.load(counters, TSFN_BLOCKING_CALLBACK_MASK_INDEX) !==
    TSFN_BLOCKING_CALLBACK_MASK
  ) {
    throw new Error('not all bounded TSFN payload callbacks executed')
  }
}

parentPort.on(
  'message',
  async ({
    type,
    enteredPath,
    releasePath,
    teardownBlocker,
    loadControl,
    tsfnTeardownState,
    tsfnScenario,
    tsfnBlockingState,
    tsfnBlockingGate,
    postFinalizeEnteredPath,
    postFinalizeReleasePath,
    postFinalizeCompletedPath,
    retirementCompletedPath,
    runtimeFinalizerPath,
    asyncFinalizerPath,
    duplicateLoad,
  }) => {
    try {
      switch (type) {
        case 'hold-pending-work': {
          const addon = loadNative()
          if (!runtimeFinalizerPath || !asyncFinalizerPath) {
            throw new TypeError(
              'hold-pending-work requires finalizer result paths',
            )
          }
          let duplicateResult
          let duplicateInFlightResult
          let failedDuplicateExport
          if (duplicateLoad) {
            const duplicateLoadError = new TypeError(
              'duplicate process.dlopen Error identity',
              {
                cause: new Error('duplicate process.dlopen Error cause'),
              },
            )
            const duplicateLoadErrorMarker = {
              source: 'original-worker-error',
            }
            Object.defineProperty(duplicateLoadError, 'lifecycleMarker', {
              configurable: true,
              enumerable: false,
              value: duplicateLoadErrorMarker,
            })
            lifecycle.stashErrorAcrossDuplicateLoad(duplicateLoadError)
            lifecycle.stashBufferAcrossDuplicateLoad(Buffer.from([11, 22, 33]))
            lifecycle.stashTypedArrayAcrossDuplicateLoad(
              Uint8Array.from([44, 55, 66]),
            )
            const duplicateInFlight = new addon.Bird(
              'duplicate-load-in-flight',
            ).getNameAsync()
            failedDuplicateExport = failNativeLoadAgain()
            const duplicate = loadNativeAgain()
            duplicateResult = await duplicate.binding.asyncMultiTwo(2)
            duplicateInFlightResult = await duplicateInFlight
            const originalAnimal = addon.Animal.withKind(addon.Kind.Dog)
            const duplicateAnimal = duplicate.binding.Animal.withKind(
              duplicate.binding.Kind.Dog,
            )
            const originalBird =
              originalAnimal.returnOtherClassWithCustomConstructor()
            const duplicateBird =
              duplicateAnimal.returnOtherClassWithCustomConstructor()
            if (
              !(originalBird instanceof addon.Bird) ||
              originalBird instanceof duplicate.binding.Bird ||
              originalBird.name !== 'parrot'
            ) {
              throw new Error(
                'original addon callback used the duplicate environment class constructor',
              )
            }
            if (
              !(duplicateBird instanceof duplicate.binding.Bird) ||
              duplicateBird instanceof addon.Bird ||
              duplicateBird.name !== 'parrot'
            ) {
              throw new Error(
                'duplicate addon callback used the original environment class constructor',
              )
            }
            let thrownError
            try {
              duplicate.lifecycle.throwErrorAcrossDuplicateLoad()
            } catch (error) {
              thrownError = error
            }
            if (!(thrownError instanceof Error)) {
              throw new Error(
                'duplicate process.dlopen did not rebuild the foreign-env Error',
              )
            }
            if (thrownError === duplicateLoadError) {
              throw new Error(
                'duplicate process.dlopen reused a foreign-env Error reference',
              )
            }
            if (
              !thrownError.message.includes(
                'duplicate process.dlopen Error identity',
              ) ||
              !thrownError.cause?.message.includes(
                'duplicate process.dlopen Error cause',
              )
            ) {
              throw new Error(
                'duplicate process.dlopen discarded rebuilt Error diagnostics',
              )
            }
            if (thrownError.lifecycleMarker !== undefined) {
              throw new Error(
                'duplicate process.dlopen unexpectedly retained a foreign Error property',
              )
            }
            for (const [name, take] of [
              ['Buffer', duplicate.lifecycle.takeBufferAcrossDuplicateLoad],
              [
                'TypedArray',
                duplicate.lifecycle.takeTypedArrayAcrossDuplicateLoad,
              ],
            ]) {
              let conversionError
              try {
                take()
              } catch (error) {
                conversionError = error
              }
              if (
                !(conversionError instanceof Error) ||
                !conversionError.message.includes('different napi_env')
              ) {
                throw new Error(
                  `duplicate process.dlopen ${name} conversion did not reject its foreign napi_env`,
                )
              }
            }
          }
          if (enteredPath && releasePath && retirementCompletedPath) {
            lifecycle.configureTokioThreadStopFileBarrier(
              enteredPath,
              releasePath,
              retirementCompletedPath,
            )
          }
          retained.push(
            lifecycle.createRuntimeLifecycleFinalizer(runtimeFinalizerPath),
          )
          retained.push(
            lifecycle.pendingAsyncBlockWithTerminalFinalizer(
              asyncFinalizerPath,
            ),
          )
          if (!(tsfnTeardownState instanceof SharedArrayBuffer)) {
            throw new TypeError(
              'hold-pending-work requires shared TSFN teardown state',
            )
          }
          const tsfnTeardownCounters = new Int32Array(tsfnTeardownState)
          if (tsfnTeardownCounters.length < TSFN_TEARDOWN_COUNTER_COUNT) {
            throw new RangeError('TSFN teardown state is too small')
          }
          lifecycle.prepareTsfnTeardownRegression(
            () =>
              Atomics.add(
                tsfnTeardownCounters,
                TSFN_TEARDOWN_JS_CALLBACK_INDEX,
                1,
              ),
            tsfnTeardownCounters,
            'clean',
          )
          parentPort.postMessage({
            type: 'ready',
            duplicateResult,
            duplicateInFlightResult,
            failedDuplicateExport,
          })
          Atomics.wait(new Int32Array(teardownBlocker), 0, 0)
          break
        }
        case 'hold-tsfn-scenario': {
          loadNative()
          let tsfnTeardownCounters
          if (tsfnScenario !== 'cleanup-blocked-call') {
            if (!(tsfnTeardownState instanceof SharedArrayBuffer)) {
              throw new TypeError(
                'hold-tsfn-scenario requires shared TSFN teardown state',
              )
            }
            tsfnTeardownCounters = new Int32Array(tsfnTeardownState)
            if (tsfnTeardownCounters.length < TSFN_TEARDOWN_COUNTER_COUNT) {
              throw new RangeError('TSFN teardown state is too small')
            }
          }
          let tsfnBlockingCounters
          if (
            tsfnScenario === 'pending-payload' ||
            tsfnScenario === 'cleanup-blocked-call'
          ) {
            if (!(tsfnBlockingState instanceof SharedArrayBuffer)) {
              throw new TypeError(
                `${tsfnScenario} requires shared TSFN blocking state`,
              )
            }
            if (!(tsfnBlockingGate instanceof SharedArrayBuffer)) {
              throw new TypeError(
                `${tsfnScenario} requires a shared TSFN callback gate`,
              )
            }
            tsfnBlockingCounters = new Int32Array(tsfnBlockingState)
            if (tsfnBlockingCounters.length < TSFN_BLOCKING_COUNTER_COUNT) {
              throw new RangeError('TSFN blocking state is too small')
            }
            const callbackGate = new Int32Array(tsfnBlockingGate)
            lifecycle.prepareTsfnBlockingCallRegression(
              (value) => {
                if (value === 0) {
                  Atomics.store(
                    tsfnBlockingCounters,
                    TSFN_BLOCKING_CALLBACK_ENTERED_INDEX,
                    1,
                  )
                  Atomics.notify(
                    tsfnBlockingCounters,
                    TSFN_BLOCKING_CALLBACK_ENTERED_INDEX,
                  )
                  if (
                    Atomics.wait(callbackGate, 0, 0, LOAD_GATE_TIMEOUT) ===
                    'timed-out'
                  ) {
                    Atomics.add(
                      tsfnBlockingCounters,
                      TSFN_BLOCKING_UNEXPECTED_INDEX,
                      1,
                    )
                  }
                }
                if (value < 0 || value > 2) {
                  Atomics.add(
                    tsfnBlockingCounters,
                    TSFN_BLOCKING_UNEXPECTED_INDEX,
                    1,
                  )
                  return
                }
                Atomics.or(
                  tsfnBlockingCounters,
                  TSFN_BLOCKING_CALLBACK_MASK_INDEX,
                  1 << value,
                )
                Atomics.notify(
                  tsfnBlockingCounters,
                  TSFN_BLOCKING_CALLBACK_MASK_INDEX,
                )
              },
              tsfnBlockingCounters,
              tsfnScenario === 'cleanup-blocked-call',
            )
          }
          if (tsfnScenario === 'cleanup-blocked-call') {
            parentPort.postMessage({ type: 'ready' })
            break
          }
          if (tsfnBlockingCounters) {
            await waitForTsfnBlockingCompletion(tsfnBlockingCounters)
          }
          lifecycle.prepareTsfnTeardownRegression(
            () =>
              Atomics.add(
                tsfnTeardownCounters,
                TSFN_TEARDOWN_JS_CALLBACK_INDEX,
                1,
              ),
            tsfnTeardownCounters,
            tsfnScenario,
            postFinalizeEnteredPath,
            postFinalizeReleasePath,
            postFinalizeCompletedPath,
          )
          parentPort.postMessage({ type: 'ready' })
          Atomics.wait(new Int32Array(teardownBlocker), 0, 0)
          break
        }
        case 'load-runtime': {
          loadNativeAtSynchronizedBoundary(loadControl)
          if (retirementCompletedPath && !existsSync(retirementCompletedPath)) {
            throw new Error(
              'replacement addon loaded before the previous Tokio runtime retired',
            )
          }
          parentPort.postMessage({
            type: 'loaded',
          })
          break
        }
        case 'verify-restart': {
          const addon = loadNative()
          const result = await addon.asyncMultiTwo(2)
          parentPort.postMessage({
            type: 'verified',
            result,
          })
          break
        }
        default:
          throw new TypeError(`Unknown message type: ${type}`)
      }
    } catch (error) {
      parentPort.postMessage({
        type: 'error',
        message: error instanceof Error ? error.stack : String(error),
      })
    }
  },
)
