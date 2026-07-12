import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MAX_HOST_TIMEOUT_MS,
  registerWorkerdCurrentThreadTaskHost,
  registerWorkerdTimerHost,
} from './index.js'

function createBindingHarness() {
  const state = {
    activeRegistrations: new Set(),
    reservedRegistrations: new Set(),
    nextRegistrationLow: 1,
    version: 4,
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

test('task host: registers through reserve/register/liveness and disposes exactly once', () => {
  const { binding, calls, state } = createBindingHarness()

  const dispose = registerWorkerdCurrentThreadTaskHost(binding)

  assert.deepEqual(calls.registerTaskHost, [[0, 1]])
  assert.ok(state.activeRegistrations.has('0:1'))

  dispose()
  dispose()
  assert.deepEqual(calls.unregisterTaskHost, [[0, 1]])
})

test('task host: rejects a contract-version mismatch', () => {
  const { binding, calls, state } = createBindingHarness()
  state.version = 5

  assert.throws(
    () => registerWorkerdCurrentThreadTaskHost(binding),
    (error) =>
      error instanceof TypeError &&
      /contract version 5, but version 4 is required/.test(error.message),
  )
  assert.equal(calls.reserve, 0)
})

test('task host: rejects a binding without task hosting exports', () => {
  const { binding } = createBindingHarness()
  delete binding.registerCurrentThreadTaskHost

  assert.throws(
    () => registerWorkerdCurrentThreadTaskHost(binding),
    (error) =>
      error instanceof TypeError &&
      /does not support CurrentThread task hosting/.test(error.message),
  )
})

test('task host: rejects the reserved zero registration', () => {
  const { binding, calls } = createBindingHarness()
  binding.reserveCurrentThreadHostRegistration = () => ({ high: 0, low: 0 })

  assert.throws(
    () => registerWorkerdCurrentThreadTaskHost(binding),
    (error) =>
      error instanceof TypeError &&
      /invalid host registration/.test(error.message),
  )
  assert.equal(calls.registerTaskHost.length, 0)
})

test('task host: rolls back an inactive registration', () => {
  const { binding, calls, state } = createBindingHarness()
  binding.registerCurrentThreadTaskHost = (high, low) => {
    calls.registerTaskHost.push([high, low])
    state.reservedRegistrations.delete(`${high}:${low}`)
  }

  assert.throws(
    () => registerWorkerdCurrentThreadTaskHost(binding),
    (error) =>
      error instanceof TypeError &&
      /inactive task host registration/.test(error.message),
  )
  assert.deepEqual(calls.unregisterTaskHost, [[0, 1]])
})

test('task host: aggregates setup and rollback failures', () => {
  const { binding, calls, state } = createBindingHarness()
  binding.registerCurrentThreadTaskHost = (high, low) => {
    calls.registerTaskHost.push([high, low])
    state.reservedRegistrations.delete(`${high}:${low}`)
  }
  const cleanupError = new Error('rollback failed')
  binding.unregisterCurrentThreadTaskHost = () => {
    throw cleanupError
  }

  assert.throws(
    () => registerWorkerdCurrentThreadTaskHost(binding),
    (error) =>
      error instanceof AggregateError &&
      /Managed workerd task-host setup failed and rollback did not complete/.test(
        error.message,
      ) &&
      error.errors.length === 2 &&
      /inactive task host registration/.test(error.errors[0].message) &&
      error.errors[1] === cleanupError &&
      error.cause === error.errors[0],
  )
})

test('timer host: returns a no-op disposer without global timer functions', (t) => {
  const { binding, calls } = createBindingHarness()
  stubGlobalTimers(t, undefined, undefined)

  const dispose = registerWorkerdTimerHost(binding)

  assert.equal(typeof dispose, 'function')
  assert.doesNotThrow(dispose)
  assert.equal(calls.getVersion, 0)
  assert.equal(calls.reserve, 0)
})

test('timer host: rejects a contract-version mismatch', () => {
  const { binding, calls, state } = createBindingHarness()
  state.version = 5

  assert.throws(
    () => registerWorkerdTimerHost(binding),
    (error) =>
      error instanceof TypeError &&
      /contract version 5, but version 4 is required/.test(error.message),
  )
  assert.equal(calls.reserve, 0)
})

test('timer host: rejects a binding without exact disposal exports', () => {
  const { binding } = createBindingHarness()
  delete binding.unregisterTimerHost

  assert.throws(
    () => registerWorkerdTimerHost(binding),
    (error) =>
      error instanceof TypeError &&
      /does not support exact timer-host disposal/.test(error.message),
  )
})

test('timer host: schedules and fires a timer', async (t) => {
  const { binding, callbacks } = createBindingHarness()
  const host = createFakeTimerHost()
  stubGlobalTimers(t, host.setTimeout, host.clearTimeout)

  registerWorkerdTimerHost(binding)
  const relay = callbacks.schedule(1, 5_000)
  assert.equal(host.pending.size, 1)
  assert.equal(host.nextDelay(), 5_000)

  host.fireNext()
  assert.equal(await relay, undefined)
  assert.equal(host.pending.size, 0)
})

test('timer host: cancellation resolves the relay and clears the timeout', async (t) => {
  const { binding, callbacks } = createBindingHarness()
  const host = createFakeTimerHost()
  stubGlobalTimers(t, host.setTimeout, host.clearTimeout)

  registerWorkerdTimerHost(binding)
  const relay = callbacks.schedule(2, 5_000)
  callbacks.cancel(2)

  assert.equal(await relay, undefined)
  assert.equal(host.pending.size, 0)
})

test('timer host: rescheduling an id cancels and settles the previous relay', async (t) => {
  const { binding, callbacks } = createBindingHarness()
  const host = createFakeTimerHost()
  stubGlobalTimers(t, host.setTimeout, host.clearTimeout)

  registerWorkerdTimerHost(binding)
  const first = callbacks.schedule(3, 5_000)
  const second = callbacks.schedule(3, 7_000)

  assert.equal(await first, undefined)
  assert.equal(host.pending.size, 1)
  assert.equal(host.nextDelay(), 7_000)

  host.fireNext()
  assert.equal(await second, undefined)
})

test('timer host: supports the legacy single-argument schedule contract', async (t) => {
  const { binding, callbacks } = createBindingHarness()
  const host = createFakeTimerHost()
  stubGlobalTimers(t, host.setTimeout, host.clearTimeout)

  registerWorkerdTimerHost(binding)
  const relay = callbacks.schedule(50)
  assert.equal(host.pending.size, 1)

  host.fireNext()
  assert.equal(await relay, undefined)
})

test('timer host: splits delays above the host timeout limit', async (t) => {
  const { binding, callbacks } = createBindingHarness()
  const host = createFakeTimerHost()
  stubGlobalTimers(t, host.setTimeout, host.clearTimeout)

  registerWorkerdTimerHost(binding)
  const relay = callbacks.schedule(5, MAX_HOST_TIMEOUT_MS + 10)
  let settled = false
  void relay.then(() => {
    settled = true
  })

  assert.equal(host.nextDelay(), MAX_HOST_TIMEOUT_MS)
  host.fireNext()
  await Promise.resolve()
  assert.equal(settled, false)
  assert.equal(host.nextDelay(), 10)

  host.fireNext()
  assert.equal(await relay, undefined)
})

test('timer host: contains cancellation failures and still settles the relay', async (t) => {
  const { binding, callbacks } = createBindingHarness()
  const host = createFakeTimerHost()
  stubGlobalTimers(t, host.setTimeout, () => {
    throw new Error('clearTimeout failed')
  })

  registerWorkerdTimerHost(binding)
  const relay = callbacks.schedule(6, 5_000)

  assert.doesNotThrow(() => callbacks.cancel(6))
  assert.equal(await relay, undefined)
})

test('timer host: dispose unregisters, settles outstanding timers, and is idempotent', async (t) => {
  const { binding, callbacks, calls } = createBindingHarness()
  const host = createFakeTimerHost()
  stubGlobalTimers(t, host.setTimeout, host.clearTimeout)

  const dispose = registerWorkerdTimerHost(binding)
  const relay = callbacks.schedule(7, 60_000)
  const legacyRelay = callbacks.schedule(30_000)
  assert.equal(host.pending.size, 2)

  dispose()

  assert.deepEqual(calls.unregisterTimerHost, [[0, 1]])
  assert.equal(await relay, undefined)
  assert.equal(await legacyRelay, undefined)
  assert.equal(host.pending.size, 0)

  assert.equal(await callbacks.schedule(8, 10), undefined)
  assert.equal(host.pending.size, 0)

  dispose()
  assert.equal(calls.unregisterTimerHost.length, 1)
})

test('timer host: rolls back an inactive registration through dispose', (t) => {
  const { binding, calls, state } = createBindingHarness()
  const host = createFakeTimerHost()
  stubGlobalTimers(t, host.setTimeout, host.clearTimeout)
  binding.registerTimerHost = (high, low) => {
    calls.registerTimerHost.push([high, low])
    state.reservedRegistrations.delete(`${high}:${low}`)
  }

  assert.throws(
    () => registerWorkerdTimerHost(binding),
    (error) =>
      error instanceof TypeError &&
      /inactive timer host registration/.test(error.message),
  )
  assert.deepEqual(calls.unregisterTimerHost, [[0, 1]])
})
