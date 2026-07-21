import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import {
  BINDING_MISMATCH_CODE,
  CURRENT_THREAD_TASK_HOST_CONTRACT_VERSION,
  MAX_HOST_TIMEOUT_MS,
  installCurrentThreadHosts,
} from './index.js'

const HOST_INSTALLATIONS_KEY = Symbol.for(
  '@napi-rs/async-runtime/current-thread-hosts/v4',
)

function createBindingHarness() {
  const state = {
    activeRegistrations: new Set(),
    reservedRegistrations: new Set(),
    nextRegistrationLow: 1,
    version: CURRENT_THREAD_TASK_HOST_CONTRACT_VERSION,
  }
  const calls = {
    getVersion: 0,
    isActive: [],
    registerTaskHost: [],
    registerTimerHost: [],
    reserve: 0,
    unregisterTaskHost: [],
    unregisterTimerHost: [],
  }
  const callbacks = {
    schedule: undefined,
    cancel: undefined,
  }
  const binding = {
    getCurrentThreadTaskHostContractVersion: () => {
      calls.getVersion += 1
      return state.version
    },
    isCurrentThreadHostRegistrationActive: (high, low) => {
      calls.isActive.push([high, low])
      return state.activeRegistrations.has(`${high}:${low}`)
    },
    reserveCurrentThreadHostRegistration: () => {
      calls.reserve += 1
      const registration = { high: 0, low: state.nextRegistrationLow++ }
      state.reservedRegistrations.add(
        `${registration.high}:${registration.low}`,
      )
      return registration
    },
    registerCurrentThreadTaskHost: (high, low) => {
      calls.registerTaskHost.push([high, low])
      if (!state.reservedRegistrations.delete(`${high}:${low}`)) {
        throw new TypeError('task-host registration was not reserved')
      }
      state.activeRegistrations.add(`${high}:${low}`)
    },
    registerTimerHost: (high, low, schedule, cancel) => {
      calls.registerTimerHost.push([high, low])
      if (!state.reservedRegistrations.delete(`${high}:${low}`)) {
        throw new TypeError('timer-host registration was not reserved')
      }
      callbacks.schedule = schedule
      callbacks.cancel = cancel
      state.activeRegistrations.add(`${high}:${low}`)
    },
    unregisterCurrentThreadTaskHost: (high, low) => {
      calls.unregisterTaskHost.push([high, low])
      state.reservedRegistrations.delete(`${high}:${low}`)
      state.activeRegistrations.delete(`${high}:${low}`)
    },
    unregisterTimerHost: (high, low) => {
      calls.unregisterTimerHost.push([high, low])
      state.reservedRegistrations.delete(`${high}:${low}`)
      state.activeRegistrations.delete(`${high}:${low}`)
    },
  }
  return { binding, callbacks, calls, state }
}

function createFakeTimerHost() {
  let nextHandle = 1
  const pending = new Map()
  const host = {
    pending,
    setTimeout: (callback, delay) => {
      const handle = nextHandle++
      pending.set(handle, { callback, delay })
      return handle
    },
    clearTimeout: (handle) => {
      pending.delete(handle)
    },
    fireNext: () => {
      const [handle] = pending.keys()
      const entry = pending.get(handle)
      pending.delete(handle)
      entry.callback()
    },
    nextDelay: () => {
      const [entry] = pending.values()
      return entry?.delay
    },
  }
  return host
}

function stubGlobalTimers(t, setTimeoutImpl, clearTimeoutImpl) {
  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  globalThis.setTimeout = setTimeoutImpl
  globalThis.clearTimeout = clearTimeoutImpl
  t.after(() => {
    globalThis.setTimeout = realSetTimeout
    globalThis.clearTimeout = realClearTimeout
  })
}

function captureConsoleErrors(t) {
  const reported = []
  const realConsoleError = console.error
  console.error = (error) => {
    reported.push(error)
  }
  t.after(() => {
    console.error = realConsoleError
  })
  return reported
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, HOST_INSTALLATIONS_KEY)
})

test('installs the task host and timer host through reserve/register/liveness', () => {
  const { binding, callbacks, calls } = createBindingHarness()

  const dispose = installCurrentThreadHosts(binding)

  assert.equal(typeof dispose, 'function')
  assert.deepEqual(calls.registerTaskHost, [[0, 1]])
  assert.deepEqual(calls.registerTimerHost, [[0, 2]])
  assert.equal(calls.reserve, 2)
  assert.equal(typeof callbacks.schedule, 'function')
  assert.equal(typeof callbacks.cancel, 'function')
})

test('rejects a binding with an incomplete host contract before registering', () => {
  const { binding, calls } = createBindingHarness()
  delete binding.registerTimerHost
  delete binding.getCurrentThreadTaskHostContractVersion

  assert.throws(
    () => installCurrentThreadHosts(binding),
    (error) =>
      error.code === BINDING_MISMATCH_CODE &&
      /registerTimerHost, getCurrentThreadTaskHostContractVersion/.test(
        error.message,
      ),
  )
  assert.equal(calls.reserve, 0)
  assert.equal(calls.registerTaskHost.length, 0)
})

test('rejects a contract-version mismatch before reserving', () => {
  const { binding, calls, state } = createBindingHarness()
  state.version = 3

  assert.throws(
    () => installCurrentThreadHosts(binding),
    (error) =>
      error.code === BINDING_MISMATCH_CODE &&
      /contract version 3, but this package requires version 4/.test(
        error.message,
      ),
  )
  assert.equal(calls.reserve, 0)
  assert.equal(calls.registerTaskHost.length, 0)
  assert.equal(calls.registerTimerHost.length, 0)
})

test('rejects a non-numeric contract version with a typed description', () => {
  const { binding, state } = createBindingHarness()
  state.version = undefined

  assert.throws(
    () => installCurrentThreadHosts(binding),
    (error) =>
      error.code === BINDING_MISMATCH_CODE &&
      /a value of type undefined/.test(error.message),
  )
})

test('deduplicates repeated installs against the same binding', () => {
  const { binding, calls } = createBindingHarness()

  const disposeFirst = installCurrentThreadHosts(binding)
  const disposeSecond = installCurrentThreadHosts(binding)

  assert.equal(calls.getVersion, 2)
  assert.deepEqual(calls.registerTaskHost, [[0, 1]])
  assert.deepEqual(calls.registerTimerHost, [[0, 2]])

  disposeSecond()
  assert.equal(calls.unregisterTaskHost.length, 0)
  assert.equal(calls.unregisterTimerHost.length, 0)

  disposeFirst()
  assert.deepEqual(calls.unregisterTimerHost, [[0, 2]])
  assert.deepEqual(calls.unregisterTaskHost, [[0, 1]])
})

test('replaces natively evicted registrations exactly once', () => {
  const { binding, calls } = createBindingHarness()

  installCurrentThreadHosts(binding)
  binding.unregisterCurrentThreadTaskHost(0, 1)
  binding.unregisterTimerHost(0, 2)

  installCurrentThreadHosts(binding)
  installCurrentThreadHosts(binding)

  assert.deepEqual(calls.registerTaskHost, [
    [0, 1],
    [0, 3],
  ])
  assert.deepEqual(calls.registerTimerHost, [
    [0, 2],
    [0, 4],
  ])
  for (const probed of [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
  ]) {
    assert.ok(
      calls.isActive.some(
        ([high, low]) => high === probed[0] && low === probed[1],
      ),
      `expected a liveness probe for ${probed.join(':')}`,
    )
  }
})

test('continues installing when the realm-global deduplication slot is hostile', (t) => {
  const { binding, calls } = createBindingHarness()
  const realGlobalThis = globalThis
  const spoofedRegistry = new Proxy(new WeakMap(), {})
  const blockedGlobal = new Proxy(realGlobalThis, {
    defineProperty(target, key, descriptor) {
      if (key === HOST_INSTALLATIONS_KEY) return false
      return Reflect.defineProperty(target, key, descriptor)
    },
    get(target, key) {
      if (key === HOST_INSTALLATIONS_KEY) return spoofedRegistry
      return Reflect.get(target, key, target)
    },
  })
  globalThis.globalThis = blockedGlobal
  t.after(() => {
    Object.defineProperty(realGlobalThis, 'globalThis', {
      configurable: true,
      value: realGlobalThis,
      writable: true,
    })
  })

  installCurrentThreadHosts(binding)
  installCurrentThreadHosts(binding)

  assert.deepEqual(calls.registerTaskHost, [[0, 1]])
  assert.deepEqual(calls.registerTimerHost, [[0, 2]])
})

test('rejects a malformed task-host reservation before installation', () => {
  const { binding, calls } = createBindingHarness()
  binding.reserveCurrentThreadHostRegistration = () => undefined

  assert.throws(
    () => installCurrentThreadHosts(binding),
    (error) =>
      error.code === BINDING_MISMATCH_CODE &&
      /invalid CurrentThread task-host registration for contract version 4/.test(
        error.message,
      ),
  )
  assert.equal(calls.registerTaskHost.length, 0)
  assert.equal(calls.registerTimerHost.length, 0)
})

test('rejects the reserved zero task-host registration', () => {
  const { binding, calls } = createBindingHarness()
  binding.reserveCurrentThreadHostRegistration = () => ({ high: 0, low: 0 })

  assert.throws(
    () => installCurrentThreadHosts(binding),
    (error) =>
      error.code === BINDING_MISMATCH_CODE &&
      /invalid CurrentThread task-host registration for contract version 4/.test(
        error.message,
      ),
  )
  assert.equal(calls.registerTaskHost.length, 0)
  assert.equal(calls.registerTimerHost.length, 0)
})

test('rolls back an inactive task-host registration', () => {
  const { binding, calls, state } = createBindingHarness()
  binding.registerCurrentThreadTaskHost = (high, low) => {
    calls.registerTaskHost.push([high, low])
    state.reservedRegistrations.delete(`${high}:${low}`)
  }

  assert.throws(
    () => installCurrentThreadHosts(binding),
    (error) =>
      error.code === BINDING_MISMATCH_CODE &&
      /inactive CurrentThread task-host registration/.test(error.message),
  )
  assert.deepEqual(calls.unregisterTaskHost, [[0, 1]])
  assert.equal(calls.registerTimerHost.length, 0)
})

test('rejects a malformed timer-host reservation and rolls back the task host', () => {
  const { binding, calls } = createBindingHarness()
  const realReserve = binding.reserveCurrentThreadHostRegistration
  let reserveCalls = 0
  binding.reserveCurrentThreadHostRegistration = () => {
    reserveCalls += 1
    if (reserveCalls === 2) return undefined
    return realReserve()
  }

  assert.throws(
    () => installCurrentThreadHosts(binding),
    (error) =>
      error.code === BINDING_MISMATCH_CODE &&
      /invalid CurrentThread timer-host registration for contract version 4/.test(
        error.message,
      ),
  )
  assert.deepEqual(calls.unregisterTaskHost, [[0, 1]])
  assert.equal(calls.registerTimerHost.length, 0)
})

test('rolls back both hosts when timer registration fails', () => {
  const { binding, calls } = createBindingHarness()
  const timerError = new Error('timer registration failed')
  binding.registerTimerHost = () => {
    throw timerError
  }

  assert.throws(
    () => installCurrentThreadHosts(binding),
    (error) => error === timerError,
  )
  assert.deepEqual(calls.unregisterTimerHost, [[0, 2]])
  assert.deepEqual(calls.unregisterTaskHost, [[0, 1]])
})

test('rollback preserves timer and cleanup failures in an aggregate', () => {
  const { binding, calls } = createBindingHarness()
  const timerError = new Error('timer registration failed')
  const cleanupError = new Error('task host rollback failed')
  binding.registerTimerHost = () => {
    throw timerError
  }
  const realUnregisterTaskHost = binding.unregisterCurrentThreadTaskHost
  let unregisterTaskHostCalls = 0
  binding.unregisterCurrentThreadTaskHost = (high, low) => {
    unregisterTaskHostCalls += 1
    if (unregisterTaskHostCalls === 1) {
      throw cleanupError
    }
    realUnregisterTaskHost(high, low)
  }

  assert.throws(
    () => installCurrentThreadHosts(binding),
    (error) =>
      error.cause === timerError &&
      Array.isArray(error.errors) &&
      error.errors.length === 2 &&
      error.errors[0] === timerError &&
      error.errors[1] === cleanupError,
  )
  assert.deepEqual(calls.unregisterTimerHost, [[0, 2]])
})

test('rollback aggregates keep the mismatch code when the setup failure was a mismatch', () => {
  const { binding, calls, state } = createBindingHarness()
  binding.registerTimerHost = (high, low) => {
    calls.registerTimerHost.push([high, low])
    state.reservedRegistrations.delete(`${high}:${low}`)
  }
  const timerCleanupError = new Error('timer host rollback failed')
  const taskCleanupError = new Error('task host rollback failed')
  binding.unregisterTimerHost = () => {
    throw timerCleanupError
  }
  binding.unregisterCurrentThreadTaskHost = () => {
    throw taskCleanupError
  }

  assert.throws(
    () => installCurrentThreadHosts(binding),
    (error) =>
      error.code === BINDING_MISMATCH_CODE &&
      Array.isArray(error.errors) &&
      error.errors.length === 3 &&
      error.errors[0].code === BINDING_MISMATCH_CODE &&
      /inactive CurrentThread timer-host registration/.test(
        error.errors[0].message,
      ) &&
      error.errors[1] === timerCleanupError &&
      error.errors[2] === taskCleanupError &&
      error.cause === error.errors[0],
  )
})

test('skips the timer host when installTimerHost is false', () => {
  const { binding, callbacks, calls } = createBindingHarness()

  const dispose = installCurrentThreadHosts(binding, {
    installTimerHost: false,
  })

  assert.equal(calls.reserve, 1)
  assert.deepEqual(calls.registerTaskHost, [[0, 1]])
  assert.equal(calls.registerTimerHost.length, 0)
  assert.equal(callbacks.schedule, undefined)

  dispose()
  assert.deepEqual(calls.unregisterTaskHost, [[0, 1]])
  assert.equal(calls.unregisterTimerHost.length, 0)
})

test('cancellation clears the host timeout and resolves its relay', async (t) => {
  const { binding, callbacks } = createBindingHarness()
  const host = createFakeTimerHost()
  stubGlobalTimers(t, host.setTimeout, host.clearTimeout)
  installCurrentThreadHosts(binding)

  const relay = callbacks.schedule(7, 60_000)
  assert.equal(host.pending.size, 1)

  callbacks.cancel(7)

  assert.equal(await relay, undefined)
  assert.equal(host.pending.size, 0)
})

test('splits delays above the host timeout limit into chained chunks', async (t) => {
  const { binding, callbacks } = createBindingHarness()
  const host = createFakeTimerHost()
  stubGlobalTimers(t, host.setTimeout, host.clearTimeout)
  installCurrentThreadHosts(binding)

  const relay = callbacks.schedule(8, MAX_HOST_TIMEOUT_MS + 25)
  let settled = false
  void relay.then(() => {
    settled = true
  })

  assert.equal(host.nextDelay(), MAX_HOST_TIMEOUT_MS)
  host.fireNext()
  await Promise.resolve()
  assert.equal(settled, false)
  assert.equal(host.nextDelay(), 25)

  host.fireNext()
  assert.equal(await relay, undefined)
  assert.equal(host.pending.size, 0)
})

test('rejects its relay when a chained timer cannot be armed', async (t) => {
  const { binding, callbacks } = createBindingHarness()
  const host = createFakeTimerHost()
  const armError = new Error('setTimeout failed')
  let setTimeoutCalls = 0
  stubGlobalTimers(
    t,
    (callback, delay) => {
      setTimeoutCalls += 1
      if (setTimeoutCalls === 2) {
        throw armError
      }
      return host.setTimeout(callback, delay)
    },
    host.clearTimeout,
  )
  installCurrentThreadHosts(binding)

  const relay = callbacks.schedule(9, MAX_HOST_TIMEOUT_MS + 1)
  host.fireNext()

  await assert.rejects(relay, (error) => error === armError)
})

test('rejects its relay when global timer functions are missing at schedule time', async (t) => {
  const { binding, callbacks } = createBindingHarness()
  installCurrentThreadHosts(binding)
  stubGlobalTimers(t, undefined, undefined)

  await assert.rejects(
    callbacks.schedule(10, 1_000),
    (error) =>
      error instanceof TypeError &&
      /callable global\s+setTimeout and clearTimeout/.test(error.message),
  )
})

test('falls back to the captured close method when clearTimeout throws', async (t) => {
  const { binding, callbacks } = createBindingHarness()
  const host = createFakeTimerHost()
  const clearError = new Error('clearTimeout failed')
  const closeCalls = []
  stubGlobalTimers(
    t,
    (callback, delay) => {
      const inner = host.setTimeout(callback, delay)
      return {
        close: () => {
          closeCalls.push(inner)
          host.clearTimeout(inner)
        },
        unref: () => {},
      }
    },
    () => {
      throw clearError
    },
  )
  const reported = captureConsoleErrors(t)
  installCurrentThreadHosts(binding)

  const relay = callbacks.schedule(11, 60_000)
  assert.equal(host.pending.size, 1)

  assert.doesNotThrow(() => callbacks.cancel(11))
  assert.equal(await relay, undefined)
  assert.equal(host.pending.size, 0)
  assert.equal(closeCalls.length, 1)
  assert.equal(reported.length, 1)
  assert.match(reported[0].message, /timeout\.close\(\)/)
  assert.equal(reported[0].cause, clearError)
})

test('unrefs the handle and resolves when no cancellation mechanism works', async (t) => {
  const { binding, callbacks } = createBindingHarness()
  const host = createFakeTimerHost()
  const clearError = new Error('clearTimeout failed')
  const closeError = new Error('timeout.close failed')
  let unrefCalls = 0
  stubGlobalTimers(
    t,
    (callback, delay) => {
      host.setTimeout(callback, delay)
      return {
        close: () => {
          throw closeError
        },
        unref: () => {
          unrefCalls += 1
        },
      }
    },
    () => {
      throw clearError
    },
  )
  const reported = captureConsoleErrors(t)
  installCurrentThreadHosts(binding)

  const relay = callbacks.schedule(12, 60_000)
  assert.doesNotThrow(() => callbacks.cancel(12))
  assert.equal(await relay, undefined)

  assert.equal(unrefCalls, 1)
  assert.equal(reported.length, 1)
  assert.match(reported[0].message, /unreferenced and may still fire/)
  assert.deepEqual(reported[0].errors, [clearError, closeError])
  assert.equal(reported[0].cause, clearError)
})

test('rethrows and rejects the relay when cancellation cannot cancel or unreference', async (t) => {
  const { binding, callbacks } = createBindingHarness()
  const host = createFakeTimerHost()
  const clearError = new Error('clearTimeout failed')
  const closeError = new Error('timeout.close failed')
  stubGlobalTimers(
    t,
    (callback, delay) => {
      host.setTimeout(callback, delay)
      return {
        close: () => {
          throw closeError
        },
      }
    },
    () => {
      throw clearError
    },
  )
  const reported = captureConsoleErrors(t)
  installCurrentThreadHosts(binding)

  const relay = callbacks.schedule(13, 60_000)
  assert.throws(
    () => callbacks.cancel(13),
    (error) =>
      /could not be cancelled or unreferenced/.test(error.message) &&
      error.cause === clearError &&
      Array.isArray(error.errors) &&
      error.errors[0] === clearError &&
      error.errors[1] === closeError,
  )
  await assert.rejects(relay, (error) =>
    /could not be cancelled or unreferenced/.test(error.message),
  )
  assert.equal(reported.length, 1)
})

test("the disposer unregisters this call's hosts and settles outstanding relays", async (t) => {
  const { binding, callbacks, calls } = createBindingHarness()
  const host = createFakeTimerHost()
  stubGlobalTimers(t, host.setTimeout, host.clearTimeout)

  const dispose = installCurrentThreadHosts(binding)
  const relay = callbacks.schedule(14, 60_000)
  assert.equal(host.pending.size, 1)

  dispose()

  assert.deepEqual(calls.unregisterTimerHost, [[0, 2]])
  assert.deepEqual(calls.unregisterTaskHost, [[0, 1]])
  assert.equal(await relay, undefined)
  assert.equal(host.pending.size, 0)

  dispose()
  assert.equal(calls.unregisterTimerHost.length, 1)
  assert.equal(calls.unregisterTaskHost.length, 1)

  installCurrentThreadHosts(binding)
  assert.deepEqual(calls.registerTaskHost, [
    [0, 1],
    [0, 3],
  ])
  assert.deepEqual(calls.registerTimerHost, [
    [0, 2],
    [0, 4],
  ])
})

test('disposal falls back to the captured dispose method when clearTimeout throws', async (t) => {
  const { binding, callbacks } = createBindingHarness()
  const host = createFakeTimerHost()
  const clearError = new Error('clearTimeout failed')
  const disposeCalls = []
  stubGlobalTimers(
    t,
    (callback, delay) => {
      const inner = host.setTimeout(callback, delay)
      return {
        [Symbol.dispose]: () => {
          disposeCalls.push(inner)
          host.clearTimeout(inner)
        },
        unref: () => {},
      }
    },
    () => {
      throw clearError
    },
  )
  const reported = captureConsoleErrors(t)
  const dispose = installCurrentThreadHosts(binding)

  const relay = callbacks.schedule(15, 60_000)
  assert.equal(host.pending.size, 1)

  assert.doesNotThrow(dispose)

  assert.equal(await relay, undefined)
  assert.equal(disposeCalls.length, 1)
  assert.equal(host.pending.size, 0)
  assert.equal(reported.length, 1)
  assert.match(reported[0].message, /timeout\[Symbol\.dispose\]\(\)/)
  assert.equal(reported[0].cause, clearError)
})

test('disposal unrefs the handle when no cancellation mechanism works', async (t) => {
  const { binding, callbacks } = createBindingHarness()
  const host = createFakeTimerHost()
  const clearError = new Error('clearTimeout failed')
  const closeError = new Error('timeout.close failed')
  let unrefCalls = 0
  stubGlobalTimers(
    t,
    (callback, delay) => {
      host.setTimeout(callback, delay)
      return {
        close: () => {
          throw closeError
        },
        unref: () => {
          unrefCalls += 1
        },
      }
    },
    () => {
      throw clearError
    },
  )
  const reported = captureConsoleErrors(t)
  const dispose = installCurrentThreadHosts(binding)

  const relay = callbacks.schedule(16, 60_000)
  assert.doesNotThrow(dispose)

  assert.equal(await relay, undefined)
  assert.equal(unrefCalls, 1)
  assert.equal(reported.length, 1)
  assert.match(reported[0].message, /unreferenced and may still fire/)
  assert.deepEqual(reported[0].errors, [clearError, closeError])
  assert.equal(reported[0].cause, clearError)
})

test('disposal rejects relays it can neither cancel nor unreference and still settles the rest', async (t) => {
  const { binding, callbacks } = createBindingHarness()
  const host = createFakeTimerHost()
  const clearError = new Error('clearTimeout failed')
  const closeError = new Error('timeout.close failed')
  stubGlobalTimers(
    t,
    (callback, delay) => {
      host.setTimeout(callback, delay)
      return {
        close: () => {
          throw closeError
        },
      }
    },
    () => {
      throw clearError
    },
  )
  const reported = captureConsoleErrors(t)
  const dispose = installCurrentThreadHosts(binding)

  const first = callbacks.schedule(17, 60_000)
  const second = callbacks.schedule(18, 60_000)

  assert.doesNotThrow(dispose)

  await assert.rejects(
    first,
    (error) =>
      /could not be cancelled or unreferenced/.test(error.message) &&
      error.cause === clearError &&
      Array.isArray(error.errors) &&
      error.errors[0] === clearError &&
      error.errors[1] === closeError,
  )
  await assert.rejects(second, (error) =>
    /could not be cancelled or unreferenced/.test(error.message),
  )
  assert.equal(reported.length, 2)
})
