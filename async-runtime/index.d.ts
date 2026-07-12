/**
 * JavaScript host protocol for napi-rs bindings built with the shared
 * async runtime (`napi-async-runtime`, CurrentThread flavor).
 *
 * All entry points accept the binding's exports object as a parameter and
 * speak host contract version 4:
 *
 * 1. `reserveCurrentThreadHostRegistration()` returns a `{ high, low }`
 *    identity (two u32 halves; the zero identity is reserved and invalid).
 * 2. `registerCurrentThreadTaskHost(high, low)` /
 *    `registerTimerHost(high, low, schedule, cancel)` consume that
 *    reservation exactly once.
 * 3. `isCurrentThreadHostRegistrationActive(high, low)` confirms the
 *    registration is live; inactive registrations are rolled back through
 *    the matching `unregister*` export.
 */

/**
 * The reservation identity returned by
 * `reserveCurrentThreadHostRegistration`: two unsigned 32-bit halves of a
 * process-unique u64. `{ high: 0, low: 0 }` is reserved and never issued.
 */
export interface HostRegistrationHandle {
  high: number
  low: number
}

/**
 * Structural description of the seven async-runtime host exports a binding
 * built with `napi-async-runtime` exposes.
 */
export interface AsyncRuntimeBinding {
  /** Reports the task-host contract version. This package requires `4`. */
  getCurrentThreadTaskHostContractVersion(): number
  /** Reports whether a previously issued registration is still live. */
  isCurrentThreadHostRegistrationActive(
    registrationHigh: number,
    registrationLow: number,
  ): boolean
  /**
   * Consumes a reservation and installs the native CurrentThread task host
   * for the calling thread's environment.
   */
  registerCurrentThreadTaskHost(
    registrationHigh: number,
    registrationLow: number,
  ): void
  /**
   * Consumes a reservation and installs a timer host driven by the provided
   * callbacks. `schedule` must return a Promise that settles when the timer
   * fires or is cancelled; `cancel` must settle the matching schedule
   * Promise. An unrecoverable cancellation failure must both reject the
   * schedule Promise and throw so the native side's bounded strike policy
   * observes it.
   */
  registerTimerHost(
    registrationHigh: number,
    registrationLow: number,
    schedule: (relayId: number, ms: number) => Promise<void>,
    cancel: (relayId: number) => void,
  ): void
  /** Reserves a registration identity for a subsequent `register*` call. */
  reserveCurrentThreadHostRegistration(): HostRegistrationHandle
  /** Removes a task-host registration. Idempotent on the native side. */
  unregisterCurrentThreadTaskHost(
    registrationHigh: number,
    registrationLow: number,
  ): void
  /** Removes a timer-host registration. Idempotent on the native side. */
  unregisterTimerHost(registrationHigh: number, registrationLow: number): void
}

export interface InstallCurrentThreadHostsOptions {
  /**
   * Install the setTimeout/clearTimeout-backed timer host alongside the
   * task host. Defaults to `true`. Hosts that bridge timers per managed
   * instance instead (for example workerd loaders using
   * `registerWorkerdTimerHost`) should pass `false`.
   */
  installTimerHost?: boolean
}

/** The host contract version this package implements. */
export declare const CURRENT_THREAD_TASK_HOST_CONTRACT_VERSION: 4

/**
 * The maximum delay of a single host `setTimeout`; longer timers are split
 * into chained chunks.
 */
export declare const MAX_HOST_TIMEOUT_MS: 2147483647

/** The `code` carried by {@link BindingMismatchError}. */
export declare const BINDING_MISMATCH_CODE: 'ERR_NAPI_ASYNC_RUNTIME_BINDING_MISMATCH'

/**
 * Thrown when the provided binding does not implement the version-4 host
 * contract this package requires.
 */
export declare class BindingMismatchError extends TypeError {
  readonly code: 'ERR_NAPI_ASYNC_RUNTIME_BINDING_MISMATCH'
}

/**
 * Reports whether an error carries the binding-mismatch `code`, including
 * rollback aggregates whose original failure was a mismatch.
 */
export declare function isBindingMismatchError(
  error: unknown,
): error is BindingMismatchError

/**
 * Install the CurrentThread task host and timer host for the calling
 * thread against the provided binding.
 *
 * Call this once from every thread that loads the binding. Duplicate
 * installs against the same binding reuse the live registrations recorded
 * in a realm-global registry (keyed by the binding's
 * `registerCurrentThreadTaskHost` identity under
 * `Symbol.for('@napi-rs/async-runtime/current-thread-hosts/v4')`);
 * registrations evicted natively are replaced. Failures roll back every
 * registration this call created and rethrow.
 *
 * Returns an idempotent disposer that unregisters exactly the
 * registrations this call created and settles this call's outstanding
 * timer relays; a fully deduplicated call returns a no-op disposer.
 */
export declare function installCurrentThreadHosts(
  binding: AsyncRuntimeBinding,
  options?: InstallCurrentThreadHostsOptions,
): () => void

/**
 * Register one native CurrentThread task host for a managed workerd
 * binding instance. Returns an exact, idempotent disposer.
 */
export declare function registerWorkerdCurrentThreadTaskHost(
  binding: AsyncRuntimeBinding,
): () => void

/**
 * Register the CurrentThread timer bridge for one managed workerd binding
 * instance. Returns an exact, idempotent disposer that unregisters the
 * host and settles all outstanding timers. Returns a no-op disposer when
 * the environment lacks global setTimeout/clearTimeout.
 */
export declare function registerWorkerdTimerHost(
  binding: AsyncRuntimeBinding,
): () => void
