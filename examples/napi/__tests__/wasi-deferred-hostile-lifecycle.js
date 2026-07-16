import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

import { Context } from '@emnapi/runtime'

const require = createRequire(import.meta.url)

import { Context } from '@emnapi/runtime'

const wasmBytes = await readFile(
  new URL('../example.wasm32-wasip1.wasm', import.meta.url),
)
const wasmModule = await WebAssembly.compile(wasmBytes)
const originalDestroy = Context.prototype.destroy
const originalSuppressDestroy = Context.prototype.suppressDestroy
const originalInstantiate = WebAssembly.instantiate
let destroyHook
let suppressDestroyHook
let loaderId = 0

Context.prototype.destroy = function interceptedDestroy(...args) {
  const runOriginal = () => Reflect.apply(originalDestroy, this, args)
  return destroyHook ? destroyHook.call(this, runOriginal) : runOriginal()
}

Context.prototype.suppressDestroy = function interceptedSuppressDestroy(
  ...args
) {
  const runOriginal = () => Reflect.apply(originalSuppressDestroy, this, args)
  return suppressDestroyHook
    ? suppressDestroyHook.call(this, runOriginal)
    : runOriginal()
}

function loadDeferred() {
  loaderId += 1
  return import(`../example.wasip1-deferred.js?hostile-lifecycle=${loaderId}`)
}

async function settleWithin(promise, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), 5_000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

try {
  {
    const deferred = await loadDeferred()
    const first = await deferred.instantiate(wasmModule)
    destroyHook = async function asyncReentrantDestroy(runOriginal) {
      await Promise.resolve()
      await Promise.resolve()
      await deferred.dispose()
      return runOriginal()
    }
    await assert.rejects(
      settleWithin(deferred.dispose(), 'async reentrant singleton cleanup'),
      (error) => {
        assert.equal(error.code, 'ERR_NAPI_WASI_LIFECYCLE_REENTRY')
        return true
      },
    )
    destroyHook = undefined
    await deferred.dispose()

    const replacement = await deferred.instantiate(wasmModule)
    assert.notStrictEqual(replacement, first)
    await deferred.dispose()
  }

  {
    const deferred = await loadDeferred()
    const registrationError = new Error(
      'intentional beforeExit registration failure',
    )
    destroyHook = async function registrationRollbackDestroy(runOriginal) {
      await Promise.resolve()
      await Promise.resolve()
      await deferred.dispose()
      return runOriginal()
    }
    function failBeforeExitRegistration(event, listener) {
      if (
        event === 'beforeExit' &&
        listener.name === '__destroyManagedEmnapiContextsBeforeExit'
      ) {
        process.removeListener('newListener', failBeforeExitRegistration)
        throw registrationError
      }
    }
    process.on('newListener', failBeforeExitRegistration)
    try {
      await assert.rejects(
        settleWithin(
          deferred.instantiate(wasmModule),
          'registration rollback cleanup',
        ),
        (error) => {
          assert.strictEqual(error, registrationError)
          return true
        },
      )
    } finally {
      process.removeListener('newListener', failBeforeExitRegistration)
      destroyHook = undefined
      await deferred.dispose().catch(() => {})
    }
  }

  {
    const initialBeforeExitListeners = new Set(
      process.rawListeners('beforeExit'),
    )
    const deferred = await loadDeferred()
    const registrationError = new Error(
      'intentional repeated beforeExit registration failure',
    )
    const rollbackError = new Error('intentional registration rollback failure')
    let registrationFailures = 0
    let destroyAttempts = 0
    function failBeforeExitRegistrationTwice(event, listener) {
      if (
        event !== 'beforeExit' ||
        listener.name !== '__destroyManagedEmnapiContextsBeforeExit'
      ) {
        return
      }
      registrationFailures += 1
      if (registrationFailures === 2) {
        process.removeListener('newListener', failBeforeExitRegistrationTwice)
      }
      throw registrationError
    }
    destroyHook = function retainedRegistrationRollback(runOriginal) {
      destroyAttempts += 1
      if (destroyAttempts === 1) {
        throw rollbackError
      }
      return runOriginal()
    }
    process.on('newListener', failBeforeExitRegistrationTwice)
    try {
      await assert.rejects(deferred.instantiate(wasmModule), (error) => {
        assert.strictEqual(error, registrationError)
        assert.strictEqual(error.cause, rollbackError)
        return true
      })
      await new Promise((resolve) => setImmediate(resolve))
      const ownedBeforeExitListeners = process
        .rawListeners('beforeExit')
        .filter((listener) => !initialBeforeExitListeners.has(listener))
      assert.equal(registrationFailures, 2)
      assert.equal(ownedBeforeExitListeners.length, 1)
      ownedBeforeExitListeners[0](0)
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(destroyAttempts, 2)
    } finally {
      process.removeListener('newListener', failBeforeExitRegistrationTwice)
      destroyHook = undefined
      await deferred.dispose().catch(() => {})
    }
  }

  {
    const initialBeforeExitListeners = new Set(
      process.rawListeners('beforeExit'),
    )
    const deferred = await loadDeferred()
    const initializationError = new Error(
      'intentional pending automatic initialization failure',
    )
    const rollbackError = new Error(
      'intentional pending automatic rollback failure',
    )
    let releaseInstantiation
    let markInstantiationStarted
    const instantiationStarted = new Promise((resolve) => {
      markInstantiationStarted = resolve
    })
    const instantiationGate = new Promise((resolve) => {
      releaseInstantiation = resolve
    })
    let destroyAttempts = 0
    let markCleanupFinished
    const cleanupFinished = new Promise((resolve) => {
      markCleanupFinished = resolve
    })
    WebAssembly.instantiate = async () => {
      markInstantiationStarted()
      await instantiationGate
      throw initializationError
    }
    destroyHook = async function pendingAutomaticRollback(runOriginal) {
      destroyAttempts += 1
      if (destroyAttempts === 1) {
        throw rollbackError
      }
      await Promise.resolve()
      await Promise.resolve()
      await assert.rejects(deferred.dispose(), (error) => {
        assert.equal(error.code, 'ERR_NAPI_WASI_LIFECYCLE_REENTRY')
        return true
      })
      const result = runOriginal()
      markCleanupFinished()
      return result
    }
    try {
      const pending = deferred.instantiate(wasmModule)
      await instantiationStarted
      const ownedBeforeExitListeners = process
        .rawListeners('beforeExit')
        .filter((listener) => !initialBeforeExitListeners.has(listener))
      assert.equal(ownedBeforeExitListeners.length, 1)
      ownedBeforeExitListeners[0](0)
      releaseInstantiation()
      await assert.rejects(pending, (error) => {
        assert.strictEqual(error, initializationError)
        assert.strictEqual(error.cause, rollbackError)
        return true
      })
      await settleWithin(
        cleanupFinished,
        'pending automatic rollback reentry cleanup',
      )
      assert.equal(destroyAttempts, 2)
    } finally {
      WebAssembly.instantiate = originalInstantiate
      destroyHook = undefined
      await deferred.dispose().catch(() => {})
    }
  }

  {
    const initialBeforeExitListeners = new Set(
      process.rawListeners('beforeExit'),
    )
    const deferred = await loadDeferred()
    const initializationError = new Error(
      'intentional joined cleanup initialization failure',
    )
    const rollbackError = new Error(
      'intentional joined cleanup rollback failure',
    )
    const cleanupError = new Error('intentional joined public cleanup failure')
    let destroyAttempts = 0
    destroyHook = function joinedCleanupRollback(runOriginal) {
      destroyAttempts += 1
      if (destroyAttempts === 1) {
        throw rollbackError
      }
      return runOriginal()
    }
    WebAssembly.instantiate = async () => {
      throw initializationError
    }
    try {
      await assert.rejects(deferred.createInstance(wasmModule), (error) => {
        assert.strictEqual(error, initializationError)
        assert.strictEqual(error.cause, rollbackError)
        return true
      })
    } finally {
      WebAssembly.instantiate = originalInstantiate
    }

    let releaseCleanup
    let markCleanupStarted
    const cleanupStarted = new Promise((resolve) => {
      markCleanupStarted = resolve
    })
    const cleanupGate = new Promise((resolve) => {
      releaseCleanup = resolve
    })
    destroyHook = async function joinedPublicCleanup() {
      destroyAttempts += 1
      markCleanupStarted()
      await cleanupGate
      throw cleanupError
    }
    let uncaughtError
    const captureUncaughtError = (error) => {
      uncaughtError = error
    }
    process.once('uncaughtException', captureUncaughtError)
    try {
      const cleanup = deferred.dispose()
      await cleanupStarted
      const ownedBeforeExitListeners = process
        .rawListeners('beforeExit')
        .filter((listener) => !initialBeforeExitListeners.has(listener))
      assert.equal(ownedBeforeExitListeners.length, 1)
      ownedBeforeExitListeners[0](0)
      releaseCleanup()
      await assert.rejects(cleanup, (error) => {
        assert.strictEqual(error, cleanupError)
        return true
      })
      await new Promise((resolve) => setImmediate(resolve))
      assert.strictEqual(uncaughtError, undefined)
      assert.equal(destroyAttempts, 2)
    } finally {
      process.removeListener('uncaughtException', captureUncaughtError)
      destroyHook = undefined
      await deferred.dispose().catch(() => {})
    }
  }

  {
    const deferred = await loadDeferred()
    const retainedInitializationError = new Error(
      'intentional retained singleton initialization failure',
    )
    const retainedRollbackError = new Error(
      'intentional retained singleton rollback failure',
    )
    const contextlessInitializationError = new Error(
      'intentional contextless singleton initialization failure',
    )
    let destroyAttempts = 0
    destroyHook = function staleDefaultDestroyer(runOriginal) {
      destroyAttempts += 1
      if (destroyAttempts === 1) {
        throw retainedRollbackError
      }
      return runOriginal()
    }
    WebAssembly.instantiate = async () => {
      throw retainedInitializationError
    }
    try {
      await assert.rejects(deferred.instantiate(wasmModule), (error) => {
        assert.strictEqual(error, retainedInitializationError)
        assert.strictEqual(error.cause, retainedRollbackError)
        return true
      })
    } finally {
      WebAssembly.instantiate = originalInstantiate
    }

    try {
      const failedInstantiation = deferred.instantiate(
        Promise.reject(contextlessInitializationError),
      )
      const cleanup = deferred.dispose()
      await assert.rejects(failedInstantiation, (error) => {
        assert.strictEqual(error, contextlessInitializationError)
        return true
      })
      await assert.rejects(cleanup, (error) => {
        assert.strictEqual(error, contextlessInitializationError)
        return true
      })
      assert.equal(
        destroyAttempts,
        2,
        'contextless singleton failure must not exclude an older retained owner',
      )
    } finally {
      destroyHook = undefined
      await deferred.dispose().catch(() => {})
    }
  }

  {
    const initialBeforeExitListeners = new Set(
      process.rawListeners('beforeExit'),
    )
    const deferred = await loadDeferred()
    const suppressionError = new Error(
      'intentional deferred suppressDestroy failure',
    )
    const rollbackError = new Error(
      'intentional deferred suppressDestroy rollback failure',
    )
    let destroyAttempts = 0
    suppressDestroyHook = function failDeferredSuppressDestroy() {
      throw suppressionError
    }
    destroyHook = function deferredSuppressionRollback(runOriginal) {
      destroyAttempts += 1
      if (destroyAttempts === 1) {
        throw rollbackError
      }
      return runOriginal()
    }
    try {
      await assert.rejects(deferred.createInstance(wasmModule), (error) => {
        assert.strictEqual(error, suppressionError)
        assert.strictEqual(error.cause, rollbackError)
        return true
      })
      suppressDestroyHook = undefined
      const ownedBeforeExitListeners = process
        .rawListeners('beforeExit')
        .filter((listener) => !initialBeforeExitListeners.has(listener))
      assert.equal(ownedBeforeExitListeners.length, 1)
      ownedBeforeExitListeners[0](0)
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(destroyAttempts, 2)
    } finally {
      suppressDestroyHook = undefined
      destroyHook = undefined
      await deferred.dispose().catch(() => {})
    }
  }

  {
    const initialBeforeExitListeners = new Set(
      process.rawListeners('beforeExit'),
    )
    const eagerPath = require.resolve('../example.wasip1.cjs')
    const { Context: EagerContext } = require('@emnapi/runtime')
    const originalEagerDestroy = EagerContext.prototype.destroy
    const originalEagerSuppressDestroy = EagerContext.prototype.suppressDestroy
    const suppressionError = new Error(
      'intentional eager suppressDestroy failure',
    )
    const registrationError = new Error(
      'intentional eager beforeExit registration failure',
    )
    const rollbackError = new Error(
      'intentional eager suppressDestroy rollback failure',
    )
    let registrationFailures = 0
    let destroyAttempts = 0
    function failEagerBeforeExitRegistrationTwice(event, listener) {
      if (
        event !== 'beforeExit' ||
        listener.name !== '__destroyEmnapiContextBeforeExit'
      ) {
        return
      }
      registrationFailures += 1
      if (registrationFailures === 2) {
        process.removeListener(
          'newListener',
          failEagerBeforeExitRegistrationTwice,
        )
      }
      throw registrationError
    }
    EagerContext.prototype.suppressDestroy =
      function failEagerSuppressDestroy() {
        throw suppressionError
      }
    EagerContext.prototype.destroy = function eagerSuppressionRollback() {
      destroyAttempts += 1
      if (destroyAttempts === 1) {
        throw rollbackError
      }
      return Reflect.apply(originalEagerDestroy, this, [])
    }
    process.on('newListener', failEagerBeforeExitRegistrationTwice)
    delete require.cache[eagerPath]
    try {
      assert.throws(
        () => require(eagerPath),
        (error) => {
          assert.strictEqual(error, suppressionError)
          assert.strictEqual(error.cause, registrationError)
          assert.strictEqual(error.cause.cause, rollbackError)
          return true
        },
      )
      await new Promise((resolve) => setImmediate(resolve))
      const ownedBeforeExitListeners = process
        .rawListeners('beforeExit')
        .filter((listener) => !initialBeforeExitListeners.has(listener))
      assert.equal(registrationFailures, 2)
      assert.equal(ownedBeforeExitListeners.length, 1)
      ownedBeforeExitListeners[0](0)
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(destroyAttempts, 2)
    } finally {
      delete require.cache[eagerPath]
      process.removeListener(
        'newListener',
        failEagerBeforeExitRegistrationTwice,
      )
      EagerContext.prototype.destroy = originalEagerDestroy
      EagerContext.prototype.suppressDestroy = originalEagerSuppressDestroy
    }
  }

  {
    const deferred = await loadDeferred()
    const instance = await deferred.createInstance(wasmModule)
    const thenGetterError = new Error('intentional destroy then getter failure')
    let firstAttempt = true
    destroyHook = function hostileThenDestroy(runOriginal) {
      if (firstAttempt) {
        firstAttempt = false
        // oxlint-disable-next-line unicorn/no-thenable -- Exercise a hostile then getter.
        return Object.defineProperty({}, 'then', {
          get() {
            throw thenGetterError
          },
        })
      }
      return runOriginal()
    }
    await assert.rejects(instance.dispose(), (error) => {
      assert.strictEqual(error, thenGetterError)
      return true
    })
    await instance.dispose()
    destroyHook = undefined
  }

  {
    const deferred = await loadDeferred()
    const instance = await deferred.createInstance(wasmModule)
    destroyHook = async function recursiveInstanceDestroy(runOriginal) {
      await Promise.resolve()
      await Promise.resolve()
      await instance.dispose()
      return runOriginal()
    }
    await assert.rejects(
      settleWithin(instance.dispose(), 'recursive independent cleanup'),
      (error) => {
        assert.equal(error.code, 'ERR_NAPI_WASI_LIFECYCLE_REENTRY')
        return true
      },
    )
    destroyHook = undefined
    await instance.dispose()
  }

  {
    const deferred = await loadDeferred()
    const singleton = await deferred.instantiate(wasmModule)
    const independent = await deferred.createInstance(wasmModule)
    let releaseCleanup
    let markCleanupStarted
    const cleanupStarted = new Promise((resolve) => {
      markCleanupStarted = resolve
    })
    const cleanupGate = new Promise((resolve) => {
      releaseCleanup = resolve
    })
    destroyHook = async function isolatedIndependentDestroy(runOriginal) {
      markCleanupStarted()
      await cleanupGate
      return runOriginal()
    }
    const cleanup = independent.dispose()
    await cleanupStarted
    assert.strictEqual(await deferred.instantiate(wasmModule), singleton)
    releaseCleanup()
    await cleanup
    destroyHook = undefined
    await deferred.dispose()
  }

  {
    const deferred = await loadDeferred()
    await deferred.instantiate(wasmModule)
    destroyHook = async function recursiveInstantiateDestroy(runOriginal) {
      await Promise.resolve()
      await Promise.resolve()
      await deferred.instantiate(wasmModule)
      return runOriginal()
    }
    await assert.rejects(
      settleWithin(deferred.dispose(), 'recursive singleton instantiation'),
      (error) => {
        assert.equal(error.code, 'ERR_NAPI_WASI_LIFECYCLE_REENTRY')
        return true
      },
    )
    destroyHook = undefined
    await deferred.dispose()
  }

  {
    const deferred = await loadDeferred()
    await deferred.instantiate(wasmModule)
    let releaseCleanup
    let markCleanupStarted
    const cleanupStarted = new Promise((resolve) => {
      markCleanupStarted = resolve
    })
    const cleanupGate = new Promise((resolve) => {
      releaseCleanup = resolve
    })
    destroyHook = async function gatedDestroy(runOriginal) {
      markCleanupStarted()
      await cleanupGate
      return runOriginal()
    }
    const firstDispose = deferred.dispose()
    await cleanupStarted
    await assert.rejects(deferred.dispose(), (error) => {
      assert.equal(error.code, 'ERR_NAPI_WASI_LIFECYCLE_REENTRY')
      return true
    })
    const rejectedModuleError = new Error(
      'intentional rejected input during cleanup',
    )
    await assert.rejects(
      deferred.instantiate(Promise.reject(rejectedModuleError)),
      (error) => {
        assert.equal(error.code, 'ERR_NAPI_WASI_LIFECYCLE_REENTRY')
        return true
      },
    )
    releaseCleanup()
    await firstDispose
    destroyHook = undefined
  }

  {
    const deferred = await loadDeferred()
    const cleanupError = new Error(
      'intentional pending singleton cleanup failure',
    )
    let releaseInstantiation
    let markInstantiationStarted
    const instantiationStarted = new Promise((resolve) => {
      markInstantiationStarted = resolve
    })
    const instantiationGate = new Promise((resolve) => {
      releaseInstantiation = resolve
    })
    let destroyAttempts = 0
    WebAssembly.instantiate = async (...args) => {
      markInstantiationStarted()
      await instantiationGate
      return Reflect.apply(originalInstantiate, WebAssembly, args)
    }
    destroyHook = function pendingSingletonDestroy(runOriginal) {
      destroyAttempts += 1
      if (destroyAttempts === 1) {
        throw cleanupError
      }
      return runOriginal()
    }
    try {
      const pending = deferred.instantiate(wasmModule)
      await instantiationStarted
      const cleanup = deferred.dispose()
      releaseInstantiation()
      await pending
      await assert.rejects(cleanup, (error) => {
        assert.strictEqual(error, cleanupError)
        return true
      })
      assert.equal(
        destroyAttempts,
        1,
        'one public disposal must not retry the same singleton context',
      )
      await deferred.dispose()
      assert.equal(destroyAttempts, 2)
    } finally {
      WebAssembly.instantiate = originalInstantiate
      destroyHook = undefined
      await deferred.dispose().catch(() => {})
    }
  }

  {
    const deferred = await loadDeferred()
    const initializationError = new Error(
      'intentional pending public initialization failure',
    )
    const rollbackError = new Error(
      'intentional pending public rollback failure',
    )
    let releaseInstantiation
    let markInstantiationStarted
    const instantiationStarted = new Promise((resolve) => {
      markInstantiationStarted = resolve
    })
    const instantiationGate = new Promise((resolve) => {
      releaseInstantiation = resolve
    })
    let destroyAttempts = 0
    WebAssembly.instantiate = async () => {
      markInstantiationStarted()
      await instantiationGate
      throw initializationError
    }
    destroyHook = function pendingPublicRollback(runOriginal) {
      destroyAttempts += 1
      if (destroyAttempts === 1) {
        throw rollbackError
      }
      return runOriginal()
    }
    try {
      const pending = deferred.instantiate(wasmModule)
      await instantiationStarted
      const cleanup = deferred.dispose()
      releaseInstantiation()
      await assert.rejects(pending, (error) => {
        assert.strictEqual(error, initializationError)
        assert.strictEqual(error.cause, rollbackError)
        return true
      })
      await assert.rejects(cleanup, (error) => {
        assert.strictEqual(error, initializationError)
        return true
      })
      assert.equal(
        destroyAttempts,
        1,
        'one public disposal must not retry a pending initialization rollback',
      )
      await deferred.dispose()
      assert.equal(destroyAttempts, 2)
    } finally {
      WebAssembly.instantiate = originalInstantiate
      destroyHook = undefined
      await deferred.dispose().catch(() => {})
    }
  }

  {
    const deferred = await loadDeferred()
    const firstInitializationError = new Error(
      'intentional first retained initialization failure',
    )
    const secondInitializationError = new Error(
      'intentional second retained initialization failure',
    )
    const firstRollbackError = new Error(
      'intentional first retained rollback failure',
    )
    const secondRollbackError = new Error(
      'intentional second retained rollback failure',
    )
    const retryError = new Error('intentional retained retry failure')
    const contexts = []
    const attempts = new Map()
    let releaseFirstCleanup
    let markFirstCleanupStarted
    const firstCleanupStarted = new Promise((resolve) => {
      markFirstCleanupStarted = resolve
    })
    const firstCleanupGate = new Promise((resolve) => {
      releaseFirstCleanup = resolve
    })
    let releaseSecondCleanup
    let markSecondCleanupStarted
    const secondCleanupStarted = new Promise((resolve) => {
      markSecondCleanupStarted = resolve
    })
    const secondCleanupGate = new Promise((resolve) => {
      releaseSecondCleanup = resolve
    })

    destroyHook = function multipleRetainedDestroy(runOriginal) {
      let contextIndex = contexts.indexOf(this)
      if (contextIndex === -1) {
        contexts.push(this)
        contextIndex = contexts.length - 1
      }
      const attempt = (attempts.get(this) ?? 0) + 1
      attempts.set(this, attempt)
      if (attempt === 1) {
        throw contextIndex === 0 ? firstRollbackError : secondRollbackError
      }
      if (contextIndex === 0 && attempt === 2) {
        markFirstCleanupStarted()
        return firstCleanupGate.then(() => {
          throw retryError
        })
      }
      if (contextIndex === 1 && attempt === 2) {
        markSecondCleanupStarted()
        return secondCleanupGate.then(runOriginal)
      }
      return runOriginal()
    }
    WebAssembly.instantiate = async () => {
      throw firstInitializationError
    }
    try {
      await assert.rejects(deferred.createInstance(wasmModule), (error) => {
        assert.strictEqual(error, firstInitializationError)
        assert.strictEqual(error.cause, firstRollbackError)
        return true
      })
    } finally {
      WebAssembly.instantiate = originalInstantiate
    }

    let cleanupSettled = false
    const cleanup = deferred.dispose().then(
      () => {
        cleanupSettled = true
      },
      (error) => {
        cleanupSettled = true
        throw error
      },
    )
    await firstCleanupStarted

    WebAssembly.instantiate = async () => {
      throw secondInitializationError
    }
    try {
      await assert.rejects(deferred.createInstance(wasmModule), (error) => {
        assert.strictEqual(error, secondInitializationError)
        assert.strictEqual(error.cause, secondRollbackError)
        return true
      })
    } finally {
      WebAssembly.instantiate = originalInstantiate
    }
    releaseFirstCleanup()
    await secondCleanupStarted
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(
      cleanupSettled,
      false,
      'public disposal must await every retained context after one fails',
    )
    releaseSecondCleanup()
    await assert.rejects(cleanup, (error) => {
      assert.strictEqual(error, retryError)
      return true
    })
    assert.deepEqual(
      contexts.map((context) => attempts.get(context)),
      [2, 2],
    )

    destroyHook = function finalRetainedDestroy(runOriginal) {
      attempts.set(this, (attempts.get(this) ?? 0) + 1)
      return runOriginal()
    }
    await deferred.dispose()
    assert.deepEqual(
      contexts.map((context) => attempts.get(context)),
      [3, 2],
    )
    destroyHook = undefined
  }

  {
    const deferred = await loadDeferred()
    await deferred.instantiate(wasmModule)
    const initializationError = new Error(
      'intentional independent initialization failure',
    )
    const retainedCleanupError = new Error(
      'intentional retained independent cleanup failure',
    )
    const singletonCleanupError = new Error(
      'intentional singleton cleanup failure',
    )
    let retainedContext
    let retainedCleanupAttempts = 0
    let failSingletonCleanup = true

    destroyHook = function failedCleanupDestroy(runOriginal) {
      if (retainedContext === undefined) {
        retainedContext = this
        retainedCleanupAttempts += 1
        throw retainedCleanupError
      }
      if (this === retainedContext) {
        retainedCleanupAttempts += 1
        return runOriginal()
      }
      if (failSingletonCleanup) {
        failSingletonCleanup = false
        throw singletonCleanupError
      }
      return runOriginal()
    }
    WebAssembly.instantiate = async () => {
      throw initializationError
    }
    try {
      await assert.rejects(deferred.createInstance(wasmModule), (error) => {
        assert.strictEqual(error, initializationError)
        assert.strictEqual(error.cause, retainedCleanupError)
        return true
      })
    } finally {
      WebAssembly.instantiate = originalInstantiate
    }
    assert.equal(retainedCleanupAttempts, 1)

    await assert.rejects(deferred.dispose(), (error) => {
      assert.strictEqual(error, singletonCleanupError)
      return true
    })
    assert.equal(
      retainedCleanupAttempts,
      2,
      'default cleanup failure must not skip retained independent cleanup',
    )

    await deferred.dispose()
    destroyHook = undefined
  }
} finally {
  WebAssembly.instantiate = originalInstantiate
  Context.prototype.destroy = originalDestroy
  Context.prototype.suppressDestroy = originalSuppressDestroy
}

process.stdout.write('deferred hostile lifecycle passed\n')
