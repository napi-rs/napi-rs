'use strict'

// CurrentThread host installation for napi-rs async-runtime bindings.
//
// A binding built with the napi-rs shared async runtime drives CurrentThread
// runnable wakes through a fresh host turn instead of polling inline from an
// arbitrary Rust Waker call, and delegates timers to the host environment's
// paired setTimeout/clearTimeout. This module installs both hosts against a
// caller-provided binding exports object using the contract-v4
// reserve -> register -> liveness-check -> (rollback) sequence:
//
// - `reserveCurrentThreadHostRegistration()` returns a { high, low } identity
//   that must be split into two u32 halves (the reserved zero identity is
//   invalid).
// - `registerCurrentThreadTaskHost(high, low)` / `registerTimerHost(high,
//   low, schedule, cancel)` consume that reservation exactly once.
// - `isCurrentThreadHostRegistrationActive(high, low)` confirms the
//   registration is live; an inactive registration is rolled back through the
//   matching `unregister*` export so no host survives without a teardown
//   owner.
//
// Registration is safe and required from every thread that loads the binding:
// the process-global driver registry takes one registration per importing
// env, the same timer is raced across every live registrant, and a registrant
// that dies with its env is evicted natively. Duplicate installs against the
// same binding are deduplicated through a realm-global registry keyed by the
// binding's `registerCurrentThreadTaskHost` identity.

const {
  BindingMismatchError,
  isBindingMismatchError,
  markBindingMismatchError,
} = require('./binding-mismatch-error.cjs')

const CURRENT_THREAD_TASK_HOST_CONTRACT_VERSION = 4

// Node.js caps a single setTimeout delay at 2^31 - 1 milliseconds; longer
// host timeouts are split into chained chunks.
const MAX_HOST_TIMEOUT_MS = 2_147_483_647

const NativeError = Error
const defineProperty = Object.defineProperty
const getProperty = Reflect.get
const construct = Reflect.construct

const CURRENT_THREAD_HOST_INSTALLATIONS = Symbol.for(
  '@napi-rs/async-runtime/current-thread-hosts/v4',
)
const LOCAL_CURRENT_THREAD_HOST_INSTALLATIONS = new WeakMap()

function getCurrentThreadHostInstallations() {
  try {
    const existing = Reflect.get(
      globalThis,
      CURRENT_THREAD_HOST_INSTALLATIONS,
      globalThis,
    )
    WeakMap.prototype.get.call(existing, getCurrentThreadHostInstallations)
    if (
      existing !== null &&
      (typeof existing === 'object' || typeof existing === 'function')
    ) {
      return existing
    }
  } catch {
    // A hostile global accessor must not prevent this environment from
    // installing the native hosts it needs for CurrentThread progress.
  }

  const installations = new WeakMap()
  try {
    if (
      Reflect.defineProperty(globalThis, CURRENT_THREAD_HOST_INSTALLATIONS, {
        configurable: true,
        value: installations,
      })
    ) {
      return installations
    }
  } catch {
    // Duplicate native host registrations are safe. Fall back to this module
    // instance's cache when the realm-global deduplication slot is
    // unavailable.
  }
  return LOCAL_CURRENT_THREAD_HOST_INSTALLATIONS
}

function readHostRegistration(registration, hostLabel, contractVersion) {
  let high
  let low
  let readFailed = false
  let readError
  try {
    if (
      registration === null ||
      (typeof registration !== 'object' && typeof registration !== 'function')
    ) {
      throw new TypeError('registration is not an object')
    }
    high = Reflect.get(registration, 'high', registration)
    low = Reflect.get(registration, 'low', registration)
  } catch (error) {
    readFailed = true
    readError = error
  }
  if (
    typeof high !== 'number' ||
    !Number.isInteger(high) ||
    high < 0 ||
    high > 0xffff_ffff ||
    typeof low !== 'number' ||
    !Number.isInteger(low) ||
    low < 0 ||
    low > 0xffff_ffff ||
    (high === 0 && low === 0)
  ) {
    throw new BindingMismatchError(
      `The provided binding returned an invalid CurrentThread ${hostLabel} ` +
        `registration for contract version ${contractVersion}.`,
      readFailed ? { cause: readError } : undefined,
    )
  }
  return [high, low]
}

function isHostRegistrationActive(
  registration,
  isRegistrationActive,
  hostLabel,
  contractVersion,
) {
  let active
  let readFailed = false
  let readError
  try {
    active = isRegistrationActive(...registration)
  } catch (error) {
    readFailed = true
    readError = error
  }
  if (typeof active !== 'boolean') {
    throw new BindingMismatchError(
      `The provided binding returned an invalid CurrentThread ${hostLabel} ` +
        `liveness result for contract version ${contractVersion}.`,
      readFailed ? { cause: readError } : undefined,
    )
  }
  return active
}

function readAsyncRuntimeHostExport(binding, exportName) {
  try {
    return Reflect.get(binding, exportName)
  } catch (error) {
    throw new BindingMismatchError(
      `The provided binding async-runtime host export ${exportName} could ` +
        `not be read. Ensure the binding and @napi-rs/async-runtime host ` +
        `contract versions match.`,
      { cause: error },
    )
  }
}

function invokeAsyncRuntimeHostReporter(exportName, reporter) {
  try {
    return Reflect.apply(reporter, undefined, [])
  } catch (error) {
    throw new BindingMismatchError(
      `The provided binding async-runtime host export ${exportName} threw ` +
        `while reporting. Ensure the binding and @napi-rs/async-runtime ` +
        `host contract versions match.`,
      { cause: error },
    )
  }
}

function captureTimerHandleMethod(handle, key, name) {
  if (
    handle === null ||
    (typeof handle !== 'object' && typeof handle !== 'function')
  ) {
    return undefined
  }
  try {
    const method = Reflect.get(handle, key, handle)
    if (typeof method !== 'function') return undefined
    return {
      identity: method,
      name,
      run: () => {
        Reflect.apply(method, handle, [])
      },
    }
  } catch {
    return undefined
  }
}

function captureTimerHandleFallbacks(handle) {
  const cancel = []
  const identities = new Set()
  for (const method of [
    captureTimerHandleMethod(
      handle,
      Symbol.dispose,
      'timeout[Symbol.dispose]()',
    ),
    captureTimerHandleMethod(handle, 'close', 'timeout.close()'),
  ]) {
    if (!method || identities.has(method.identity)) continue
    identities.add(method.identity)
    cancel.push(method)
  }
  return {
    cancel,
    unref: captureTimerHandleMethod(handle, 'unref', 'timeout.unref()'),
  }
}

function reportTimerCancellationError(error) {
  try {
    const consoleHost = Reflect.get(globalThis, 'console', globalThis)
    if (
      consoleHost === null ||
      (typeof consoleHost !== 'object' && typeof consoleHost !== 'function')
    ) {
      return
    }
    const report = Reflect.get(consoleHost, 'error', consoleHost)
    if (typeof report === 'function') {
      Reflect.apply(report, consoleHost, [error])
    }
  } catch {
    // Error reporting is best effort and must not escape timer cancellation.
  }
}

function createAggregateError(errors, message, cause) {
  try {
    const AggregateErrorHost = getProperty(
      globalThis,
      'AggregateError',
      globalThis,
    )
    if (typeof AggregateErrorHost === 'function') {
      return construct(AggregateErrorHost, [errors, message, { cause }])
    }
  } catch {
    // Fall through to an ordinary Error that preserves the aggregate payload.
  }

  const fallback = new NativeError(message, { cause })
  defineProperty(fallback, 'errors', {
    configurable: true,
    value: errors,
    writable: true,
  })
  return fallback
}

/**
 * Install the CurrentThread task host and timer host against the provided
 * async-runtime binding exports.
 *
 * Duplicate installs against the same binding reuse the live registrations
 * recorded in the realm-global deduplication registry; natively evicted
 * registrations are replaced. Failures roll back every registration created
 * by this call. Returns an idempotent disposer that unregisters exactly the
 * registrations this call created (a fully deduplicated call returns a
 * no-op disposer).
 */
function installCurrentThreadHosts(binding, options) {
  if (
    binding === null ||
    (typeof binding !== 'object' && typeof binding !== 'function')
  ) {
    throw new TypeError(
      'installCurrentThreadHosts requires the binding exports object',
    )
  }
  const installTimerHost = options?.installTimerHost !== false

  const getCurrentThreadTaskHostContractVersion = readAsyncRuntimeHostExport(
    binding,
    'getCurrentThreadTaskHostContractVersion',
  )
  const isCurrentThreadHostRegistrationActive = readAsyncRuntimeHostExport(
    binding,
    'isCurrentThreadHostRegistrationActive',
  )
  const registerCurrentThreadTaskHost = readAsyncRuntimeHostExport(
    binding,
    'registerCurrentThreadTaskHost',
  )
  const registerTimerHost = readAsyncRuntimeHostExport(
    binding,
    'registerTimerHost',
  )
  const reserveCurrentThreadHostRegistration = readAsyncRuntimeHostExport(
    binding,
    'reserveCurrentThreadHostRegistration',
  )
  const unregisterCurrentThreadTaskHost = readAsyncRuntimeHostExport(
    binding,
    'unregisterCurrentThreadTaskHost',
  )
  const unregisterTimerHost = readAsyncRuntimeHostExport(
    binding,
    'unregisterTimerHost',
  )

  const hostFunctions = {
    isCurrentThreadHostRegistrationActive,
    registerCurrentThreadTaskHost,
    registerTimerHost,
    reserveCurrentThreadHostRegistration,
    unregisterCurrentThreadTaskHost,
    unregisterTimerHost,
  }
  const hostFunctionEntries = Object.entries(hostFunctions)
  const completeHostContract = hostFunctionEntries.every(
    ([, value]) => typeof value === 'function',
  )

  if (
    !completeHostContract ||
    typeof getCurrentThreadTaskHostContractVersion !== 'function'
  ) {
    const invalidExports = hostFunctionEntries
      .filter(([, value]) => typeof value !== 'function')
      .map(([name]) => name)
      .concat(
        typeof getCurrentThreadTaskHostContractVersion === 'function'
          ? []
          : ['getCurrentThreadTaskHostContractVersion'],
      )
      .join(', ')
    throw new BindingMismatchError(
      `The provided binding exposes an incomplete async-runtime host ` +
        `contract. Missing or invalid exports: ${invalidExports}. Ensure ` +
        `the binding and @napi-rs/async-runtime host contract versions ` +
        `match.`,
    )
  }

  let hostInstallation
  let taskHostRegistration
  let timerHostRegistration
  let disposeActiveTimers
  try {
    const actualVersion = invokeAsyncRuntimeHostReporter(
      'getCurrentThreadTaskHostContractVersion',
      getCurrentThreadTaskHostContractVersion,
    )
    if (actualVersion !== CURRENT_THREAD_TASK_HOST_CONTRACT_VERSION) {
      const actualVersionDescription =
        typeof actualVersion === 'number'
          ? String(actualVersion)
          : `a value of type ${actualVersion === null ? 'null' : typeof actualVersion}`
      throw new BindingMismatchError(
        `The provided binding uses async-runtime task-host contract version ` +
          `${actualVersionDescription}, but this package requires version ` +
          `${CURRENT_THREAD_TASK_HOST_CONTRACT_VERSION}. Ensure the binding ` +
          `and @napi-rs/async-runtime host contract versions match.`,
      )
    }
    const hostInstallations = getCurrentThreadHostInstallations()
    const hostIdentity = registerCurrentThreadTaskHost
    hostInstallation = WeakMap.prototype.get.call(
      hostInstallations,
      hostIdentity,
    )
    if (!hostInstallation) {
      hostInstallation = {}
      WeakMap.prototype.set.call(
        hostInstallations,
        hostIdentity,
        hostInstallation,
      )
    }
    const storedTaskHostRegistration = hostInstallation.taskHostRegistration
    if (
      !storedTaskHostRegistration ||
      !isHostRegistrationActive(
        storedTaskHostRegistration,
        isCurrentThreadHostRegistrationActive,
        'task-host',
        CURRENT_THREAD_TASK_HOST_CONTRACT_VERSION,
      )
    ) {
      hostInstallation.taskHostRegistration = undefined
      taskHostRegistration = readHostRegistration(
        reserveCurrentThreadHostRegistration(),
        'task-host',
        CURRENT_THREAD_TASK_HOST_CONTRACT_VERSION,
      )
      registerCurrentThreadTaskHost(...taskHostRegistration)
      if (
        !isHostRegistrationActive(
          taskHostRegistration,
          isCurrentThreadHostRegistrationActive,
          'task-host',
          CURRENT_THREAD_TASK_HOST_CONTRACT_VERSION,
        )
      ) {
        throw new BindingMismatchError(
          `The provided binding returned an inactive CurrentThread ` +
            `task-host registration for contract version ` +
            `${CURRENT_THREAD_TASK_HOST_CONTRACT_VERSION}.`,
        )
      }
      hostInstallation.taskHostRegistration = taskHostRegistration
    }

    if (installTimerHost) {
      timerHostInstallation: {
        const storedTimerHostRegistration =
          hostInstallation.timerHostRegistration
        if (
          storedTimerHostRegistration &&
          isHostRegistrationActive(
            storedTimerHostRegistration,
            isCurrentThreadHostRegistrationActive,
            'timer-host',
            CURRENT_THREAD_TASK_HOST_CONTRACT_VERSION,
          )
        ) {
          break timerHostInstallation
        }
        hostInstallation.timerHostRegistration = undefined
        timerHostRegistration = readHostRegistration(
          reserveCurrentThreadHostRegistration(),
          'timer-host',
          CURRENT_THREAD_TASK_HOST_CONTRACT_VERSION,
        )

        const active = new Map()

        const armTimer = (id, timer) => {
          const delay = Math.min(timer.remainingMs, MAX_HOST_TIMEOUT_MS)
          const handle = Reflect.apply(timer.setTimeoutHost, globalThis, [
            () => {
              if (active.get(id) !== timer) return
              timer.remainingMs -= delay
              if (timer.remainingMs > 0) {
                try {
                  armTimer(id, timer)
                } catch (error) {
                  active.delete(id)
                  timer.reject(error)
                }
                return
              }
              active.delete(id)
              timer.resolve()
            },
            delay,
          ])
          timer.handle = handle
          const fallbacks = captureTimerHandleFallbacks(handle)
          timer.cancelHandleFallbacks = fallbacks.cancel
          timer.unrefHandle = fallbacks.unref
        }

        registerTimerHost(
          ...timerHostRegistration,
          (id, ms) =>
            new Promise((resolve, reject) => {
              if (!timerHostRegistration) {
                throw new TypeError(
                  'The CurrentThread timer host registration is unavailable.',
                )
              }
              const setTimeoutHost = Reflect.get(
                globalThis,
                'setTimeout',
                globalThis,
              )
              const clearTimeoutHost = Reflect.get(
                globalThis,
                'clearTimeout',
                globalThis,
              )
              if (
                typeof setTimeoutHost !== 'function' ||
                typeof clearTimeoutHost !== 'function'
              ) {
                throw new TypeError(
                  'The CurrentThread timer host requires callable global ' +
                    'setTimeout and clearTimeout functions.',
                )
              }
              const timer = {
                cancelHandleFallbacks: [],
                clearTimeoutHost,
                handle: undefined,
                remainingMs: Math.max(ms, 0),
                reject,
                resolve,
                setTimeoutHost,
                unrefHandle: undefined,
              }
              active.set(id, timer)
              try {
                armTimer(id, timer)
              } catch (error) {
                active.delete(id)
                reject(error)
              }
            }),
          (id) => {
            let timer
            try {
              timer = active.get(id)
              if (!timer) return
              active.delete(id)
              if (timer.handle === undefined) {
                timer.resolve()
                return
              }

              try {
                Reflect.apply(timer.clearTimeoutHost, globalThis, [
                  timer.handle,
                ])
                timer.resolve()
                return
              } catch (clearError) {
                const errors = [clearError]
                for (const fallback of timer.cancelHandleFallbacks) {
                  try {
                    fallback.run()
                    reportTimerCancellationError(
                      new Error(
                        `CurrentThread timer ${id} clearTimeout failed; ` +
                          `the timeout was cancelled with ${fallback.name}.`,
                        { cause: clearError },
                      ),
                    )
                    timer.resolve()
                    return
                  } catch (fallbackError) {
                    errors.push(fallbackError)
                  }
                }

                let unreferenced = false
                if (timer.unrefHandle) {
                  try {
                    timer.unrefHandle.run()
                    unreferenced = true
                  } catch (unrefError) {
                    errors.push(unrefError)
                  }
                }
                const cancellationError = createAggregateError(
                  errors,
                  unreferenced
                    ? `CurrentThread timer ${id} could not be cancelled; ` +
                        `the timeout was unreferenced and may still fire.`
                    : `CurrentThread timer ${id} could not be cancelled or ` +
                        `unreferenced.`,
                  clearError,
                )
                if (unreferenced) {
                  reportTimerCancellationError(cancellationError)
                  // The callback may still run, but the active identity check
                  // makes it a no-op and unref prevents it from retaining the
                  // Node process.
                  timer.resolve()
                } else {
                  // Settle the abandoned schedule Promise for local resource
                  // release, then throw through napi-rs's catching
                  // cancellation TSFN so Rust can apply the host's bounded
                  // strike policy.
                  timer.reject(cancellationError)
                  throw cancellationError
                }
              }
            } catch (error) {
              try {
                active.delete(id)
              } catch {
                // The active-timer map is module-owned; deletion cannot
                // realistically fail, but cancellation must keep its own
                // containment boundary.
              }
              reportTimerCancellationError(error)
              if (timer) {
                try {
                  timer.reject(error)
                } catch (settlementError) {
                  reportTimerCancellationError(settlementError)
                }
              }
              throw error
            }
          },
        )
        if (
          !isHostRegistrationActive(
            timerHostRegistration,
            isCurrentThreadHostRegistrationActive,
            'timer-host',
            CURRENT_THREAD_TASK_HOST_CONTRACT_VERSION,
          )
        ) {
          throw new BindingMismatchError(
            `The provided binding returned an inactive CurrentThread ` +
              `timer-host registration for contract version ` +
              `${CURRENT_THREAD_TASK_HOST_CONTRACT_VERSION}.`,
          )
        }
        hostInstallation.timerHostRegistration = timerHostRegistration
        disposeActiveTimers = () => {
          const timers = [...active.values()]
          active.clear()
          for (const timer of timers) {
            try {
              if (timer.handle !== undefined) {
                Reflect.apply(timer.clearTimeoutHost, globalThis, [
                  timer.handle,
                ])
              }
            } catch {
              // Disposal must settle every relay even when the host
              // cancellation API throws; the unregistered native host
              // already ignores this relay.
            } finally {
              timer.resolve()
            }
          }
        }
      }
    }
  } catch (error) {
    const cleanupErrors = []
    if (timerHostRegistration) {
      try {
        unregisterTimerHost(...timerHostRegistration)
        if (hostInstallation?.timerHostRegistration === timerHostRegistration) {
          hostInstallation.timerHostRegistration = undefined
        }
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
    }
    if (taskHostRegistration) {
      try {
        unregisterCurrentThreadTaskHost(...taskHostRegistration)
        if (hostInstallation?.taskHostRegistration === taskHostRegistration) {
          hostInstallation.taskHostRegistration = undefined
        }
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
    }
    if (cleanupErrors.length > 0) {
      const aggregate = createAggregateError(
        [error, ...cleanupErrors],
        'CurrentThread host setup failed and registration rollback did not complete',
        error,
      )
      throw isBindingMismatchError(error)
        ? markBindingMismatchError(aggregate)
        : aggregate
    }
    throw error
  }

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    const disposalErrors = []
    if (timerHostRegistration) {
      try {
        unregisterTimerHost(...timerHostRegistration)
        if (hostInstallation.timerHostRegistration === timerHostRegistration) {
          hostInstallation.timerHostRegistration = undefined
        }
        if (disposeActiveTimers) {
          disposeActiveTimers()
        }
      } catch (disposalError) {
        disposalErrors.push(disposalError)
      }
    }
    if (taskHostRegistration) {
      try {
        unregisterCurrentThreadTaskHost(...taskHostRegistration)
        if (hostInstallation.taskHostRegistration === taskHostRegistration) {
          hostInstallation.taskHostRegistration = undefined
        }
      } catch (disposalError) {
        disposalErrors.push(disposalError)
      }
    }
    if (disposalErrors.length === 1) {
      throw disposalErrors[0]
    }
    if (disposalErrors.length > 1) {
      throw createAggregateError(
        disposalErrors,
        'CurrentThread host disposal did not complete',
        disposalErrors[0],
      )
    }
  }
}

module.exports = {
  CURRENT_THREAD_TASK_HOST_CONTRACT_VERSION,
  MAX_HOST_TIMEOUT_MS,
  installCurrentThreadHosts,
}
