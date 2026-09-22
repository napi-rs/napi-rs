import {
  BINDING_TARGET_STAMP_HELPER,
  NAPI_BINDING_TARGET_EXPORT,
  NAPI_BINDING_TARGET_STAMP_FN,
} from './binding-target.js'

const WASI_DISPOSE_SYMBOL = 'napi.rs.wasi.dispose'
const WASI_ROLLBACK_REGISTRY_SYMBOL = 'napi.rs.wasi.rollback.registry.v1'

/**
 * `Context.destroy()` disables JavaScript calls *before* it runs cleanup hooks
 * (`setStopping` -> `setCanCallIntoJs(false)` -> `runCleanup`), and the
 * threadsafe function's cleanup hook then drains its queue with a null env and
 * discards it. So `napi_prepare_wasm_env_cleanup` has to run while the
 * environment is still live — before `destroy()`, never from a hook inside it.
 *
 * The loaders already order their own teardown that way. A `destroy()` called
 * by anyone else — an embedder or test harness holding the context, emnapi's
 * own `beforeExit` auto-destroy on a host where `suppressDestroy()` is absent —
 * would skip the barrier and discard exactly the settlements it exists to
 * cancel and deliver. Own the ordering on the object rather than on each call
 * site: shadow `destroy` once at creation, so every caller gets the barrier.
 *
 * The barrier is reentrant-hostile, so the wrapper has to be reentrancy-aware.
 * `napi_prepare_wasm_env_cleanup` settles the promises it cancels synchronously,
 * under a non-reentrant lifecycle mutex on the Rust side; a V8 promise hook
 * (`promiseHooks.onSettled`, or the `async_hooks` hook `AsyncLocalStorage`
 * installs) that calls `destroy()` therefore re-enters this wrapper from inside
 * the barrier, and calling the barrier again aborts the whole wasm instance.
 * While a prepare is in flight the nested `destroy()` is a no-op rather than a
 * deferred one: the frame that started the barrier destroys the moment it
 * returns, still synchronously, and `Context.destroy()` is typed `void`, so
 * answering `undefined` loses nothing a caller could have observed. Letting the
 * nested call through instead would tear the environment down mid-barrier and
 * strand every settlement the barrier had not reached yet.
 *
 * Defensive, not strict: a context whose `destroy` cannot be read or redefined
 * is returned unchanged rather than failing the load. A barrier that throws
 * still propagates, exactly as it does from `__destroyEmnapiContext`.
 *
 * This is NOT a replacement for `dispose()`: only the disposal chain yields
 * event-loop turns until `napi_wasm_env_cleanup_pending` reads zero, so a
 * direct `destroy()` still cannot wait for a settlement queued by another
 * thread. It delivers everything the barrier settles on this thread.
 */
const emnapiContextDestroyWrapper = `
function __wrapEmnapiContextDestroyForSettlement(
  context,
  prepareEnvCleanup,
  isPreparingEnvCleanup,
) {
  let destroy
  try {
    destroy = context.destroy
  } catch {
    return context
  }
  if (typeof destroy !== 'function') {
    return context
  }
  try {
    Object.defineProperty(context, 'destroy', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: function () {
        // Reentered from a promise hook that fired inside the barrier: the
        // frame running it destroys as soon as it returns.
        if (isPreparingEnvCleanup?.()) {
          return
        }
        prepareEnvCleanup?.()
        return Reflect.apply(destroy, this, arguments)
      },
    })
  } catch {}
  return context
}
`

/**
 * Host teardown must run while the environment can still accept N-API calls,
 * and after the settlement drain: the drain is what lets the barrier's queued
 * promise settlements reach JavaScript, and the task host is what publishes the
 * CurrentThread turns they may still need. `__destroyEmnapiContext` is the
 * single funnel every teardown path reaches — `dispose()`, the initialization
 * rollback, and the CJS 'exit' handler — and it is reached only after
 * `__startWasiDisposal` / the rollback have already prepared and drained, so
 * one call there covers all three.
 */
const createEmnapiContextLifecycle = (asyncRuntime: boolean) => {
  const currentThreadHosts = asyncRuntime
    ? `
let __currentThreadHostsDisposer

function __reportCurrentThreadHostDisposalError(error) {
  try {
    const consoleHost = globalThis.console
    if (consoleHost && typeof consoleHost.error === 'function') {
      consoleHost.error(error)
    }
  } catch {}
}

/**
 * Unregister the CurrentThread task and timer hosts this loader installed.
 * Idempotent, and never throws: an unregister failure must not abort
 * \`Context.destroy()\`, which would retain the whole environment over a
 * bookkeeping error. The failure is reported instead.
 */
function __disposeCurrentThreadHosts() {
  const dispose = __currentThreadHostsDisposer
  if (dispose === undefined) {
    return
  }
  __currentThreadHostsDisposer = undefined
  try {
    dispose()
  } catch (error) {
    __reportCurrentThreadHostDisposalError(error)
  }
}
`
    : ''
  const disposeCurrentThreadHosts = asyncRuntime
    ? '  __disposeCurrentThreadHosts()\n'
    : ''

  return `
const __wasiDisposeSymbol = Symbol.for('${WASI_DISPOSE_SYMBOL}')
const __wasiWorkers = new Set()
// The thread manager has to be reachable *before* anything that can throw
// during load or registration. Initialization can fail after the pool has
// already spawned workers, and the rollback still has to mark their
// terminations as expected — but \`__napiModule\` is assigned only when
// instantiation RETURNS, so on exactly that path it is still undefined. A
// plugin factory runs while the emnapi module is being created, before the
// wasm is loaded and before any registration function runs, and its context
// carries the very same manager instance.
let __wasiThreadManager

function __captureWasiThreadManager(context) {
  if (context && context.PThread) {
    __wasiThreadManager = context.PThread
  }
  return {}
}

function __getWasiThreadManager() {
  const manager =
    __wasiThreadManager !== undefined
      ? __wasiThreadManager
      : __napiModule
        ? __napiModule.PThread
        : undefined
  if (manager && typeof manager.terminateWorker === 'function') {
    return manager
  }
  return undefined
}
let __napiInstance
let __emnapiContextDestroyed = false
let __emnapiContextDestroyPromise
let __emnapiWasmEnvCleanupPrepared = false
let __emnapiWasmEnvCleanupPreparing = false
// The closer for a barrier that is parked between \`…_begin\` and \`…_finish\`,
// set only while that window is open. \`__emnapiWasmEnvCleanupPreparing\` cannot
// tell those two apart on its own: it is raised both for a purely synchronous
// frame — which must not be re-entered, and which nothing outside it can
// finish — and across this window, which spans real event-loop turns, so a
// caller that cannot yield can land in the middle of one. That caller can close
// this window, because \`…_finish\` is idempotent and joins, which is exactly
// what the single call does. See \`__prepareWasmEnvCleanup\`.
let __finishParkedWasmEnvCleanup
// Raised while a caller that can still yield is driving the barrier, so the
// queue it leaves behind is expected rather than lost. See
// \`__reportUnreachedWasmEnvSettlements\`.
let __emnapiWasmEnvCleanupYielding = false
let __emnapiWasmEnvSettlementLossReported = false
let __emnapiWasmEnvCleanupRan = false
let __emnapiWasmEnvCleanupDrained = false
let __emnapiWasmEnvCleanupDrainPromise
let __wasiDisposed = false
let __wasiAsyncWorkDrainPromise
let __wasiDisposePromise
let __completeWasiDisposal = function () {}
// Overridden by loader flavors that have a last-resort reclaim for a rollback
// that stopped short of destroying the context. See
// \`__rollbackWasiInitialization\`.
let __retainWasiRollbackForRetry = function () {}
${currentThreadHosts}
function __isThenable(value) {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof value.then === 'function'
  )
}

function __createCleanupError(errors, message) {
  if (errors.length === 1) {
    return errors[0]
  }
  const __AggregateError = globalThis.AggregateError
  if (typeof __AggregateError === 'function') {
    return new __AggregateError(errors, message)
  }
  const error = new Error(message)
  error.errors = errors
  return error
}

function __attachCleanupErrors(error, cleanupErrors) {
  if (cleanupErrors.length === 0) {
    return error
  }
  const cleanupError = __createCleanupError(
    cleanupErrors,
    'WASI binding cleanup failed',
  )
  try {
    if (
      error &&
      (typeof error === 'object' || typeof error === 'function')
    ) {
      if (error.cause === undefined) {
        error.cause = cleanupError
        if (error.cause === cleanupError) {
          return error
        }
      }
      if (Array.isArray(error.cleanupErrors)) {
        error.cleanupErrors.push(cleanupError)
        return error
      } else {
        const attachedCleanupErrors = [cleanupError]
        error.cleanupErrors = attachedCleanupErrors
        if (error.cleanupErrors === attachedCleanupErrors) {
          return error
        }
      }
    }
  } catch {}
  const aggregate = __createCleanupError(
    [error, cleanupError],
    'WASI binding initialization and cleanup failed',
  )
  try {
    aggregate.cause = error
  } catch {}
  return aggregate
}
${emnapiContextDestroyWrapper}
function __isPreparingWasmEnvCleanup() {
  return __emnapiWasmEnvCleanupPreparing
}

function __prepareWasmEnvCleanup() {
  if (__emnapiWasmEnvCleanupPrepared) {
    return
  }
  // A handshake parked between its two halves is one this frame can close, and
  // must: every caller of this function is about to destroy the context, and
  // the turns the poll is waiting for will not come — an 'exit' teardown is
  // the last thing the process runs, and \`Context.destroy()\` takes the
  // environment away. Closing it here runs \`…_finish\`, which is the call that joins, so
  // this degrades to exactly the single call below. Leaving it open instead
  // destroys the context with the barrier still raised, the runtime never
  // joined and the workers never drained.
  const finishParked = __finishParkedWasmEnvCleanup
  if (finishParked !== undefined) {
    finishParked()
    __reportUnreachedWasmEnvSettlements()
    return
  }
  if (__emnapiWasmEnvCleanupPreparing) {
    return
  }
  const prepare = __napiInstance?.exports?.napi_prepare_wasm_env_cleanup
  if (typeof prepare === 'function') {
    // The addon settles the promises it cancels synchronously, under a
    // non-reentrant lifecycle mutex: anything a promise hook calls from in
    // here must not reach this export again.
    __emnapiWasmEnvCleanupPreparing = true
    try {
      prepare()
    } finally {
      __emnapiWasmEnvCleanupPreparing = false
    }
    __emnapiWasmEnvCleanupRan = true
    __reportUnreachedWasmEnvSettlements()
  }
  __emnapiWasmEnvCleanupPrepared = true
}

/**
 * Say so when the barrier leaves settlements queued and nothing is left that
 * could deliver them.
 *
 * Only the disposal chain yields the event-loop turns @emnapi/core needs to
 * dispatch its queue. Every other caller of the barrier destroys in the same
 * turn — a raw \`Context.destroy()\`, the 'exit' teardown — and
 * \`Context.destroy()\` runs the threadsafe function's cleanup hook, which drains
 * that queue with a null env and discards it. The promises those settlements
 * were for then hang forever, silently.
 *
 * Loud, once, and never throwing: this runs from inside \`Context.destroy()\`,
 * emnapi's own beforeExit destroy included, where throwing would take the whole
 * teardown down with it. Destroying anyway is still the right trade — the queue
 * is already unreachable by then.
 */
function __reportUnreachedWasmEnvSettlements() {
  if (__emnapiWasmEnvCleanupYielding || __emnapiWasmEnvSettlementLossReported) {
    return
  }
  const pending = __napiInstance?.exports?.napi_wasm_env_cleanup_pending
  if (typeof pending !== 'function') {
    return
  }
  let queued
  try {
    queued = pending()
  } catch {
    return
  }
  if (!queued) {
    return
  }
  __emnapiWasmEnvSettlementLossReported = true
  try {
    const consoleHost = globalThis.console
    if (consoleHost && typeof consoleHost.error === 'function') {
      consoleHost.error(
        "napi-rs: the wasm environment is being destroyed with " +
          queued +
          " queued promise settlement(s). Context.destroy() discards them, so those promises never settle. Dispose with binding[Symbol.for('${WASI_DISPOSE_SYMBOL}')]() instead: only it yields the event-loop turns the settlements need.",
      )
    }
  } catch {}
}

// Mirror the primitive @emnapi/core schedules its threadsafe-function dispatch
// on, so the drain turns below interleave with that dispatch instead of racing
// ahead of it on a faster queue.
const __scheduleMacrotask = (function () {
  if (typeof setImmediate === 'function') {
    return function (callback) {
      setImmediate(callback)
    }
  }
  const __MessageChannel = globalThis.MessageChannel
  if (typeof __MessageChannel === 'function') {
    return function (callback) {
      const channel = new __MessageChannel()
      channel.port1.onmessage = function () {
        channel.port1.onmessage = null
        try {
          channel.port1.close()
        } catch {}
        try {
          channel.port2.close()
        } catch {}
        callback()
      }
      channel.port2.postMessage(null)
    }
  }
  return function (callback) {
    setTimeout(callback, 0)
  }
})()

// A real, *referenced* timer, for waits that must let the whole host make
// progress between looks — the async-work drain polls the addon rather than
// interleaving with the @emnapi/core dispatch, so a zero-delay macrotask there
// would spin the loop instead of yielding it. Falls back to the macrotask
// scheduler on a host without timers.
function __scheduleTimer(callback, delay) {
  const setTimer = globalThis.setTimeout
  if (typeof setTimer !== 'function') {
    __scheduleMacrotask(callback)
    return
  }
  try {
    setTimer(callback, delay)
  } catch {
    __scheduleMacrotask(callback)
  }
}

// A real, referenced timer rather than a zero-delay macrotask, for the same
// reason the async-work drain uses one: this polls the addon instead of
// interleaving with the @emnapi/core dispatch, so a zero-delay turn would spin
// the loop instead of yielding it.
const __WASM_RUNTIME_WORK_POLL_INTERVAL_MS = 1
// Set once a timer scheduled by the poll has actually arrived. See
// \`__yieldWasmRuntimePollTurn\`.
let __wasmRuntimePollTimerArrived = false

/**
 * One turn of the runtime-work poll.
 *
 * \`__scheduleTimer\` falls back to the macrotask scheduler when \`setTimeout\` is
 * missing or throws, but not when it is present, returns a handle and never
 * fires — fake timers in a test suite that disposes from an \`afterEach\`, or a
 * host whose timers belong to an IO context that is already gone. That host
 * would park this poll forever, and the poll is unbounded, so nothing would
 * ever call \`…_finish\`.
 *
 * Arm both primitives until a timer has been seen to arrive, and let whichever
 * lands first end the turn; the loser resolves nothing. A host with working
 * timers therefore pays the double arming for the first turn or two — the
 * macrotask wins the race, but the timer behind it still arrives and is
 * recorded — and paces on the timer alone from then on, instead of spinning the
 * loop on a zero-delay queue. A host whose timers never arrive keeps both, and
 * the macrotask is what keeps the poll moving.
 */
function __yieldWasmRuntimePollTurn() {
  if (__wasmRuntimePollTimerArrived) {
    return new Promise((resolve) => {
      __scheduleTimer(resolve, __WASM_RUNTIME_WORK_POLL_INTERVAL_MS)
    })
  }
  return new Promise((resolve) => {
    let settled = false
    const settle = () => {
      if (settled) {
        return
      }
      settled = true
      resolve()
    }
    __scheduleTimer(() => {
      __wasmRuntimePollTimerArrived = true
      settle()
    }, __WASM_RUNTIME_WORK_POLL_INTERVAL_MS)
    __scheduleMacrotask(settle)
  })
}

/**
 * The barrier for callers that can yield: \`__prepareWasmEnvCleanup\` with real
 * event-loop turns in the middle.
 *
 * \`napi_prepare_wasm_env_cleanup\` waits — it returns only once the addon's
 * async runtime has quiesced, and on \`wasm32-wasip1-threads\` the thread it
 * waits on is this one, the only thread that can give a running blocking
 * closure the JavaScript turn *it* is waiting for. A single call there can wait
 * for work that can never finish. The addon's two-phase form splits that:
 * \`…_begin\` stops the runtime without joining and reports whether anything is
 * still live, \`napi_wasm_runtime_work_pending\` answers that question again
 * without blocking, and \`…_finish\` joins. The turns yielded in between are the
 * entire point.
 *
 * The poll has no deadline, for the same reason the async-work drain below has
 * none: giving up means calling \`…_finish\`, which joins on this thread, and the
 * work it would join is the work that is waiting for a turn from this thread —
 * so a bound does not end the wait, it only moves it somewhere the JavaScript
 * thread can no longer be reached. A blocking closure that never returns keeps
 * the disposal promise pending instead, exactly as a task whose \`execute\` never
 * returns already keeps an *undisposed* process alive. The host contract is in
 * \`crates/async-runtime/README.md\`: a blocking closure must never wait on a
 * JavaScript turn. The process-exit path still blocks in \`…_finish\`, because it
 * has no turns left to give (see \`__prepareWasmEnvCleanup\`).
 *
 * Feature-detected like every other export in this teardown, so an addon built
 * against a napi crate that predates the split keeps the single blocking call.
 * Returns nothing whenever the handshake finished without yielding, which keeps
 * an idle disposal synchronous.
 */
function __prepareWasmEnvCleanupWithTurns() {
  if (__emnapiWasmEnvCleanupPrepared || __emnapiWasmEnvCleanupPreparing) {
    return
  }
  const exports = __napiInstance?.exports
  const begin = exports?.napi_prepare_wasm_env_cleanup_begin
  const finish = exports?.napi_prepare_wasm_env_cleanup_finish
  if (typeof begin !== 'function' || typeof finish !== 'function') {
    // No split to use. The settlement drain still follows this, so the queue
    // the single call leaves behind is expected rather than lost.
    __emnapiWasmEnvCleanupYielding = true
    try {
      __prepareWasmEnvCleanup()
    } finally {
      __emnapiWasmEnvCleanupYielding = false
    }
    return
  }
  const workPending = exports?.napi_wasm_runtime_work_pending
  // The in-flight flag stays raised across the turns below, so a \`destroy()\`
  // from one of the JavaScript handlers they run is the same no-op it is inside
  // the single call: the barrier is up and the runtime is mid-teardown, and
  // destroying between the halves would strand exactly what this delivers.
  __emnapiWasmEnvCleanupPreparing = true
  let live
  try {
    live = begin()
  } catch (error) {
    __emnapiWasmEnvCleanupPreparing = false
    throw error
  }
  __emnapiWasmEnvCleanupRan = true
  const finishCleanup = () => {
    if (__emnapiWasmEnvCleanupPrepared) {
      // Already closed by a caller that could not yield — the 'exit' teardown
      // reached \`__prepareWasmEnvCleanup\` while this poll was parked. \`…_finish\`
      // is idempotent, but the flags it lowers are not: running it again here
      // would clear a \`preparing\` some later barrier had raised.
      return
    }
    __finishParkedWasmEnvCleanup = undefined
    try {
      finish()
    } finally {
      __emnapiWasmEnvCleanupPreparing = false
    }
    __emnapiWasmEnvCleanupPrepared = true
  }
  if (!live || typeof workPending !== 'function') {
    finishCleanup()
    return
  }
  // Publish the closer before yielding: from here until \`finishCleanup\` runs,
  // a caller that cannot yield is entitled to end this handshake itself.
  __finishParkedWasmEnvCleanup = finishCleanup
  return (async () => {
    // Unbounded, exactly like the async-work drain below. The wait ends when
    // the addon reports its runtime work finished; the turns spent here are
    // what let that happen at all.
    for (;;) {
      await __yieldWasmRuntimePollTurn()
      try {
        if (!workPending()) {
          return
        }
      } catch {
        // A trap is the only way this fails, and a trapped instance has no
        // reachable work left. Stop polling and finish.
        return
      }
    }
  })().then(finishCleanup, finishCleanup)
}

// Turns to wait for while the addon still reports queued settlements. Reaching
// zero is the only success. A counter still nonzero at this bound rejects the
// disposal as retryable (\`ERR_NAPI_WASI_CLEANUP_PENDING\`) rather than
// destroying the context over a still-queued settlement — the wait stays
// bounded either way.
const __WASM_ENV_CLEANUP_DRAIN_TURNS = 128
// Without \`napi_wasm_env_cleanup_pending\` the queue is not observable. Fall
// back to the number of turns @emnapi/core needs to coalesce and dispatch a
// call made on this thread (two), plus a margin.
const __WASM_ENV_CLEANUP_BLIND_DRAIN_TURNS = 4

/**
 * \`napi_prepare_wasm_env_cleanup\` only *queues* the promise settlements of the
 * tasks it cancelled: \`napi_call_threadsafe_function\` appends to the
 * threadsafe-function queue, and @emnapi/core dispatches that queue from a
 * macrotask — two coalescing turns later, even for a call made on this very
 * thread. \`Context.destroy()\` then runs the threadsafe function's cleanup hook,
 * which drains the queue with a null env and *discards* whatever is still in it.
 *
 * So destroying without yielding first strands exactly the promises the barrier
 * exists to settle. Yield real event-loop turns until the addon reports the
 * queue empty; microtask checkpoints cannot help, no number of them lets a
 * macrotask run.
 *
 * Returns nothing when there is nothing to wait for, which keeps disposal
 * synchronous in the common case.
 *
 * The "already drained" flag is set only once a wait has actually finished.
 * Scheduling a macrotask can fail — a host-provided or patched \`setImmediate\`
 * that throws is enough — and a disposal that rejects stays retryable, so
 * marking the drain complete up front would make the retry skip it and destroy
 * the context with the barrier's settlements still queued.
 *
 * A wait that runs out of turns with the counter still nonzero rejects with
 * \`ERR_NAPI_WASI_CLEANUP_PENDING\` for the same reason: at that point
 * "finished" is indistinguishable from the stranding above, and destroying
 * would discard the very settlement the wait was for. The rejection leaves the
 * flag unset and disposal retryable.
 */
function __drainWasmEnvCleanup() {
  if (__emnapiWasmEnvCleanupDrained || !__emnapiWasmEnvCleanupRan) {
    return
  }
  if (__emnapiWasmEnvCleanupDrainPromise) {
    return __emnapiWasmEnvCleanupDrainPromise
  }
  const pending = __napiInstance?.exports?.napi_wasm_env_cleanup_pending
  const observable = typeof pending === 'function'
  if (observable) {
    let queued
    try {
      queued = pending()
    } catch {
      __emnapiWasmEnvCleanupDrained = true
      return
    }
    if (!queued) {
      __emnapiWasmEnvCleanupDrained = true
      return
    }
  }
  const limit = observable
    ? __WASM_ENV_CLEANUP_DRAIN_TURNS
    : __WASM_ENV_CLEANUP_BLIND_DRAIN_TURNS
  const drainPromise = (async () => {
    let queued = 0
    for (let turn = 0; turn < limit; turn++) {
      await new Promise((resolve) => {
        __scheduleMacrotask(resolve)
      })
      if (!observable) {
        continue
      }
      try {
        queued = pending()
      } catch {
        return
      }
      if (!queued) {
        return
      }
    }
    if (!observable) {
      // Blind wait: without \`napi_wasm_env_cleanup_pending\` the bound IS the
      // contract — there is nothing to consult, so finishing the turns is
      // finishing the drain.
      return
    }
    // The counter is still nonzero after every turn the bound allows. The wait
    // stays bounded — but claiming success here would be indistinguishable from
    // the stranding this drain exists to prevent: disposal would go on to
    // destroy the context, whose cleanup hook discards the still-queued
    // settlement with a null env, and the promise it was for hangs forever.
    // Reject instead, as a retryable cleanup failure: the drained flag stays
    // unset, dispose() (and the rollback) decline to destroy, and a later
    // dispose() runs the drain again — by which time the queue has usually been
    // delivered. A counter that is somehow stuck nonzero therefore costs each
    // attempt at most another bounded wait and a rejection, never a stranded
    // promise; the process-exit teardown still reclaims the context.
    const drainError = new Error(
      'the wasm environment still reports ' +
        queued +
        ' queued settlement(s) after ' +
        limit +
        ' event-loop turns; the context was not destroyed - retry dispose() to wait for the queue again',
    )
    drainError.code = 'ERR_NAPI_WASI_CLEANUP_PENDING'
    throw drainError
  })().then(
    (value) => {
      // Set only when the wait actually finished AND the queue was seen empty
      // (or is unobservable): a drain that timed out with settlements still
      // queued rejects above and must stay repeatable.
      __emnapiWasmEnvCleanupDrained = true
      __emnapiWasmEnvCleanupDrainPromise = undefined
      return value
    },
    (error) => {
      __emnapiWasmEnvCleanupDrainPromise = undefined
      throw error
    },
  )
  __emnapiWasmEnvCleanupDrainPromise = drainPromise
  return drainPromise
}

function __destroyEmnapiContext() {
  if (__emnapiContextDestroyed || __emnapiContext === undefined) {
    __emnapiContextDestroyed = true
    return
  }
  if (__emnapiContextDestroyPromise) {
    return __emnapiContextDestroyPromise
  }

${disposeCurrentThreadHosts}\
  __prepareWasmEnvCleanup()
  if (__isPreparingWasmEnvCleanup()) {
    // Reached from inside the synchronous barrier — a promise hook one of the
    // settlements above ran, which is the reentrancy the destroy wrapper
    // exists for. \`Context.destroy()\` below would hit that wrapper's in-flight
    // no-op and answer \`undefined\`, and recording that as a completed destroy
    // is what makes the frame that *did* start the barrier skip the real one
    // afterwards, leaving the context retained with its cleanup hooks unrun.
    // Refuse instead: nothing is flagged, and that frame destroys for real the
    // moment it returns. The deferred loader carries the same backstop. A
    // parked handshake cannot get here — \`__prepareWasmEnvCleanup\` closes one
    // rather than skipping it.
    return
  }
  const result = __emnapiContext.destroy()
  if (!__isThenable(result)) {
    __emnapiContextDestroyed = true
    return
  }

  const destroyPromise = Promise.resolve(result).then(
    (value) => {
      __emnapiContextDestroyed = true
      return value
    },
    (error) => {
      __emnapiContextDestroyPromise = undefined
      throw error
    },
  )
  __emnapiContextDestroyPromise = destroyPromise
  return destroyPromise
}

/**
 * Holds the event loop open until \`work\` settles.
 *
 * Nothing else can: the pool workers are deliberately unreferenced so an idle
 * binding cannot keep a process alive, and referencing them again for the
 * termination does not hold either — emnapi unreferences a worker the moment it
 * reports \`async-thread-ready\`, which for a worker that was still starting
 * lands *after* the termination began. Without a handle of its own, an
 * \`await dispose()\` with nothing else pending exits the process with its
 * promise unsettled, and everything after the \`await\` is skipped.
 *
 * The timer is cleared as soon as the work settles, so this never outlives the
 * disposal that asked for it.
 */
function __keepEventLoopAliveUntil(work) {
  const setTimer = globalThis.setInterval
  const clearTimer = globalThis.clearInterval
  if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') {
    return work
  }
  let timer
  try {
    timer = setTimer(function () {}, 50)
  } catch {
    return work
  }
  const release = function () {
    try {
      clearTimer(timer)
    } catch {}
  }
  return work.then(
    (value) => {
      release()
      return value
    },
    (error) => {
      release()
      throw error
    },
  )
}

// How often to re-read \`napi_wasm_async_work_pending\` while waiting. The wait
// ends when the addon reports zero, so this only decides how promptly disposal
// notices — not how long it waits.
const __WASI_ASYNC_WORK_POLL_INTERVAL_MS = 1

/**
 * Settles this addon's outstanding \`napi_async_work\` before the teardown that
 * would strand it.
 *
 * \`napi_prepare_wasm_env_cleanup\` does not cover async work, and nothing about
 * it is observable from JavaScript: the threadless archive resolves
 * \`napi_*_async_work\` through the \`@emnapi/core\` plugins, but the threaded one
 * links the C \`async_work.c\` on the uv threadpool, so there the wasm neither
 * imports nor exports those symbols and the only brackets a loader could watch
 * (\`_emnapi_ctx_*_waiting_request_counter\`) are shared with threadsafe
 * functions. The addon is the one place both flavors go through, so it answers
 * for both, through the same kind of handshake the settlement drain uses:
 *
 *   - \`napi_wasm_cancel_pending_async_work()\` cancels what no thread has
 *     started. Those completion callbacks run with \`napi_cancelled\`, which
 *     napi-rs turns into a promise rejected with an \`AbortError\`.
 *   - \`napi_wasm_async_work_pending()\` counts what is still owed a completion
 *     callback. Work already executing refuses cancellation and stays counted
 *     until it finishes normally — which it can, because this runs before the
 *     barrier, before \`Context.destroy()\` and before anything is terminated.
 *
 * Both exports are optional: an addon built against a napi crate that predates
 * them drains nothing and keeps the previous behavior, exactly as the
 * \`napi_wasm_env_cleanup_pending\` handshake degrades.
 *
 * Returns nothing when there is nothing outstanding, which keeps disposal
 * synchronous in the common case. The promise it returns otherwise never
 * rejects.
 *
 * The wait has no deadline, and that is the point: giving up would destroy the
 * environment with a completion callback still owed, which is the stranding
 * this exists to prevent. A task whose \`execute\` never returns already keeps an
 * *undisposed* process alive in exactly the same way, so disposal inherits that
 * rather than inventing a bound it cannot honor.
 *
 * Safe to call from inside a completion callback, which is reachable: settling
 * a task runs addon code that can re-enter JavaScript — a setter on the value
 * being handed back, a threadsafe-function callback — and that JavaScript can
 * call \`dispose()\`. Two things make it terminate rather than wait on itself:
 *
 *   - The addon keeps a work registered until its completion callback
 *     *finishes*, so the count read here is at least one and this takes the
 *     polling path instead of declaring the environment drained and tearing it
 *     down from inside the frame that is still settling a promise.
 *   - The poll is a timer, so it cannot run until the callback has returned to
 *     the host — by which time that work has left the registry. The count the
 *     next poll reads is the one taken after the callback finished.
 *
 * \`__disposeWasiBinding\` hands every caller the same in-flight promise, so the
 * nested call joins this disposal rather than starting a second one.
 */
function __drainWasiAsyncWork() {
  if (__wasiAsyncWorkDrainPromise !== undefined) {
    return __wasiAsyncWorkDrainPromise
  }
  const exports = __napiInstance?.exports
  const pending = exports?.napi_wasm_async_work_pending
  const cancelPending = exports?.napi_wasm_cancel_pending_async_work
  if (typeof pending !== 'function' || typeof cancelPending !== 'function') {
    return
  }

  const readPending = () => {
    try {
      return pending()
    } catch (error) {
      // A trap is the only way this call fails: it reads a counter and cannot
      // allocate or call back into JavaScript. A trapped instance can no longer
      // run anything, so its outstanding work is unreachable by definition —
      // there is nothing left to wait for, and refusing to dispose would only
      // keep a dead instance and its stuck counter alive. Best-effort here is
      // the honest answer, and it is what disposal did before this drain
      // existed.
      //
      // Only a trap. Anything else means the export is not what this loader
      // thinks it is, which is a defect worth surfacing rather than disposing
      // over.
      if (error instanceof globalThis.WebAssembly.RuntimeError) {
        return 0
      }
      throw error
    }
  }

  if (!readPending()) {
    return
  }
  try {
    cancelPending()
  } catch {
    // Cancellation is an optimization: it bounds the wait by the work already
    // executing. Failing it only means waiting for the whole queue instead.
  }
  if (!readPending()) {
    return
  }

  const drainPromise = __keepEventLoopAliveUntil(
    (async () => {
      while (readPending()) {
        await new Promise((resolve) => {
          __scheduleTimer(resolve, __WASI_ASYNC_WORK_POLL_INTERVAL_MS)
        })
      }
    })(),
  ).then(
    () => {
      __wasiAsyncWorkDrainPromise = undefined
    },
    (error) => {
      // A wait that could not run is not a wait that finished. The only way
      // here is a host whose timers and macrotask primitives all refuse, and
      // the work is still outstanding — reporting success would destroy the
      // environment over it, which is the stranding this exists to prevent.
      // Reject instead: disposal stays retryable, and the context is not
      // destroyed. Clearing the memo first is what makes the retry re-run this.
      __wasiAsyncWorkDrainPromise = undefined
      throw error
    },
  )
  __wasiAsyncWorkDrainPromise = drainPromise
  return drainPromise
}

/**
 * \`@emnapi/wasi-threads\` counts a worker exit as expected only when its own
 * thread manager performed the termination. A bare \`worker.terminate()\` reaches
 * the manager's \`exit\` listener instead, which reports
 * \`worker (tid = N) sent an error! ... stopped with exit code 1\` and rethrows
 * inside the emit — aborting the \`once('exit')\` that backs the terminate
 * promise, so disposal never settles and the process dies with an uncaught
 * exception. Mark the termination through the manager first.
 *
 * The manager comes from \`__getWasiThreadManager\`, not from \`__napiModule\`:
 * the initialization rollback runs on the one path where instantiation never
 * returned, so \`__napiModule\` is still undefined there while the workers it
 * spawned are already registered and loaded.
 *
 * Not \`terminateAllThreads()\`: that one recreates the pool it just shut down.
 */
function __terminateWasiWorkers() {
  const cleanupErrors = []
  const pending = []
  const threadManager = __getWasiThreadManager()

  for (const worker of __wasiWorkers) {
    let result
    try {
      if (threadManager) {
        threadManager.terminateWorker(worker)
        // \`terminateWorker\` leaves behind a reporter that logs every message
        // still queued on the port, which Node flushes on exit. Nothing is
        // listening for those any more.
        worker.onmessage = undefined
      }
      result = worker.terminate()
    } catch (error) {
      cleanupErrors.push(error)
      continue
    }
    if (__isThenable(result)) {
      pending.push(
        Promise.resolve(result).then(
          () => {
            __wasiWorkers.delete(worker)
          },
          (error) => {
            cleanupErrors.push(error)
          },
        ),
      )
    } else {
      __wasiWorkers.delete(worker)
    }
  }

  const finish = () => {
    if (cleanupErrors.length > 0) {
      throw __createCleanupError(
        cleanupErrors,
        'Failed to terminate WASI workers',
      )
    }
  }
  return pending.length > 0
    ? __keepEventLoopAliveUntil(Promise.all(pending)).then(finish)
    : finish()
}

function __finishWasiDisposal() {
  const workerResult = __terminateWasiWorkers()
  if (__isThenable(workerResult)) {
    return Promise.resolve(workerResult).then(__completeWasiDisposal)
  }
  return __completeWasiDisposal()
}

function __continueWasiDisposal() {
  const destroyResult = __destroyEmnapiContext()
  if (__isThenable(destroyResult)) {
    return Promise.resolve(destroyResult).then(__finishWasiDisposal)
  }
  return __finishWasiDisposal()
}

function __drainWasmEnvForWasiDisposal() {
  const drainResult = __drainWasmEnvCleanup()
  if (__isThenable(drainResult)) {
    return Promise.resolve(drainResult).then(__continueWasiDisposal)
  }
  return __continueWasiDisposal()
}

function __cleanUpWasmEnvForWasiDisposal() {
  // Run the pre-teardown barrier — yielding the turns its two-phase form asks
  // for, when the addon has one — then let the settlements it queued actually
  // reach JavaScript, and only then destroy the environment. Doing any two of
  // these back to back is what strands them.
  const prepareResult = __prepareWasmEnvCleanupWithTurns()
  if (__isThenable(prepareResult)) {
    return Promise.resolve(prepareResult).then(__drainWasmEnvForWasiDisposal)
  }
  return __drainWasmEnvForWasiDisposal()
}

function __startWasiDisposal() {
  // Outstanding \`napi_async_work\` goes first, while the environment is still
  // completely live: the completion callbacks run addon code, and everything
  // after this point takes that away from them — the barrier shuts the async
  // runtime down, \`Context.destroy()\` stops JavaScript calls, and terminating
  // the pool threads removes what would have reported the work finished.
  const asyncWorkResult = __drainWasiAsyncWork()
  if (__isThenable(asyncWorkResult)) {
    return Promise.resolve(asyncWorkResult).then(
      __cleanUpWasmEnvForWasiDisposal,
    )
  }
  return __cleanUpWasmEnvForWasiDisposal()
}

/**
 * Disposes this generated WASI binding.
 *
 * Access this function with:
 * binding[Symbol.for('${WASI_DISPOSE_SYMBOL}')]()
 */
function __disposeWasiBinding() {
  if (__wasiDisposePromise) {
    return __wasiDisposePromise
  }
  if (__wasiDisposed) {
    return Promise.resolve()
  }

  let resolveDispose
  let rejectDispose
  const disposePromise = new Promise((resolve, reject) => {
    resolveDispose = resolve
    rejectDispose = reject
  })
  __wasiDisposePromise = disposePromise

  let result
  try {
    result = __startWasiDisposal()
  } catch (error) {
    __wasiDisposePromise = undefined
    rejectDispose(error)
    return disposePromise
  }

  Promise.resolve(result).then(
    (value) => {
      __wasiDisposed = true
      resolveDispose(value)
    },
    (error) => {
      __wasiDisposePromise = undefined
      rejectDispose(error)
    },
  )
  return disposePromise
}

function __publishWasiDispose(exports) {
  Object.defineProperty(exports, __wasiDisposeSymbol, {
    configurable: false,
    enumerable: false,
    value: __disposeWasiBinding,
    writable: false,
  })
}

function __finishWasiInitializationRollback(cleanupErrors) {
  let workerResult
  try {
    workerResult = __terminateWasiWorkers()
  } catch (cleanupError) {
    cleanupErrors.push(cleanupError)
    return cleanupErrors
  }
  if (__isThenable(workerResult)) {
    return Promise.resolve(workerResult)
      .catch((cleanupError) => {
        cleanupErrors.push(cleanupError)
      })
      .then(() => cleanupErrors)
  }
  return cleanupErrors
}

function __destroyContextForWasiRollback(cleanupErrors) {
  let destroyResult
  try {
    destroyResult = __destroyEmnapiContext()
  } catch (cleanupError) {
    cleanupErrors.push(cleanupError)
    return __finishWasiInitializationRollback(cleanupErrors)
  }
  if (__isThenable(destroyResult)) {
    return Promise.resolve(destroyResult)
      .catch((cleanupError) => {
        cleanupErrors.push(cleanupError)
      })
      .then(() => __finishWasiInitializationRollback(cleanupErrors))
  }
  return __finishWasiInitializationRollback(cleanupErrors)
}

/**
 * Leaves a rollback that could not reach the queued settlements undestroyed, and
 * hands it to whatever this flavor has that can still reclaim it.
 */
function __retainFailedWasiRollback(cleanupErrors) {
  try {
    __retainWasiRollbackForRetry()
  } catch (cleanupError) {
    cleanupErrors.push(cleanupError)
  }
  return cleanupErrors
}

/**
 * Initialization can fail *after* registration has already run, and registration
 * runs with a live environment: a module-init hook can start async work and then
 * return an error, and the promise it created may already have escaped into
 * JavaScript. The barrier cancels that work and *queues* the settlement, so this
 * path needs the same drain the ordinary disposal does — destroying without
 * yielding discards the queue with a null env and strands the promise.
 *
 * Stays synchronous when nothing is queued, which covers every failure before
 * \`beforeInit\`: there is no instance to run the barrier on, so nothing to drain.
 *
 * A barrier or drain that did *not* finish stops the rollback short of
 * destroying, which is what \`dispose()\` already does — a rejected drain there
 * never reaches \`__continueWasiDisposal\`. Destroying anyway is the worse of the
 * two trades, and not because of what it saves:
 *
 *   - It cannot deliver the settlements. \`Context.destroy()\` runs the
 *     threadsafe function's cleanup hook, which drains the queue with a null env
 *     and discards it, so a promise that already escaped into JavaScript hangs
 *     forever with nothing left that could ever settle it.
 *   - It saves less than it looks. \`Context.destroy()\` stops JavaScript calls
 *     and runs cleanup hooks; it does not free the wasm instance or its Memory,
 *     which this module's scope holds either way. What stopping short retains is
 *     the emnapi context's bookkeeping and its un-run cleanup hooks.
 *   - Retry is not theoretical. A rollback that records a cleanup error is
 *     already kept in the process-wide registry above, so re-\`require()\`ing this
 *     file replays it instead of re-instantiating — and the \`6e15de6f\` flag fix
 *     means the replay drains again rather than skipping it. Destroying first is
 *     what makes that retained record useless.
 *
 * The residual cost is honest: the CJS flavor hands the context to its
 * \`process.on('exit')\` teardown, so a process that never retries still reclaims
 * it on the way out. The ESM browser flavor has no equivalent — a module that
 * throws while evaluating is permanently errored, so re-importing rethrows
 * without re-running this file — and there the context stays until the realm
 * goes away. That is the deliberate choice: a hung promise is a silent liveness
 * bug with no upper bound, while the retained bookkeeping is bounded by the page.
 */
function __rollbackWasiInitialization() {
  // The environment teardown this rollback performs, kept nested so it cannot
  // be reached without the async-work drain below running first.
  function __rollbackWasmEnvForWasiInitialization() {
    const cleanupErrors = []
    let prepareResult
    try {
      prepareResult = __prepareWasmEnvCleanupWithTurns()
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError)
      return __retainFailedWasiRollback(cleanupErrors)
    }
    if (__isThenable(prepareResult)) {
      return Promise.resolve(prepareResult).then(
        () => __drainWasmEnvForWasiRollback(cleanupErrors),
        (cleanupError) => {
          cleanupErrors.push(cleanupError)
          return __retainFailedWasiRollback(cleanupErrors)
        },
      )
    }
    return __drainWasmEnvForWasiRollback(cleanupErrors)
  }

  // The settlement drain of the rollback above, reached either straight away or
  // after the barrier's two-phase form has yielded its turns. A barrier that
  // did not finish never gets here: it retains instead, exactly as a drain that
  // did not finish does.
  function __drainWasmEnvForWasiRollback(cleanupErrors) {
    let drainResult
    try {
      drainResult = __drainWasmEnvCleanup()
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError)
      return __retainFailedWasiRollback(cleanupErrors)
    }
    if (__isThenable(drainResult)) {
      return Promise.resolve(drainResult).then(
        () => __destroyContextForWasiRollback(cleanupErrors),
        (cleanupError) => {
          cleanupErrors.push(cleanupError)
          return __retainFailedWasiRollback(cleanupErrors)
        },
      )
    }
    return __destroyContextForWasiRollback(cleanupErrors)
  }

  // Same reason as \`__startWasiDisposal\`: a module-init hook can start async
  // work before the load goes on to fail, and this rollback tears down exactly
  // what those completions need. Settle them while everything is still live,
  // before the barrier and the teardown above take that away.
  //
  // A drain that could not finish leaves async work possibly outstanding, and
  // destroying the context over it would strand exactly what this rollback is
  // there to settle. Stop short and retain instead — the same trade
  // \`__rollbackWasmEnvForWasiInitialization\` makes for the settlement drain, so
  // the context stays reclaimable by a retry or by this flavor's own
  // last-resort teardown.
  const __retainAfterAsyncWorkDrainFailure = (cleanupError) =>
    __retainFailedWasiRollback([cleanupError])
  let asyncWorkResult
  try {
    asyncWorkResult = __drainWasiAsyncWork()
  } catch (cleanupError) {
    return __retainAfterAsyncWorkDrainFailure(cleanupError)
  }
  if (__isThenable(asyncWorkResult)) {
    return Promise.resolve(asyncWorkResult).then(
      __rollbackWasmEnvForWasiInitialization,
      __retainAfterAsyncWorkDrainFailure,
    )
  }
  return __rollbackWasmEnvForWasiInitialization()
}
`
}

export const createWasiBrowserBinding = (
  wasiFilename: string,
  initialMemory = 4000,
  maximumMemory = 65536,
  fs = false,
  asyncInit = false,
  buffer = false,
  errorEvent = false,
  threads = true,
  // `platformArchABI` of the flavor this loader belongs to. Defaults from
  // `threads` so callers that predate the parameter keep their identity.
  platformArchABI = threads ? 'wasm32-wasi' : 'wasm32-wasip1',
  asyncRuntime = false,
) => {
  // Threaded builds always get a pre-created worker pool (see
  // `reuseWorkerOption` below), and pool pre-creation is asynchronous, so
  // they always initialize asynchronously.
  const effectiveAsyncInit = asyncInit || threads
  const asyncRuntimeImport = asyncRuntime
    ? `import { installCurrentThreadHosts as __installCurrentThreadHosts } from '@napi-rs/async-runtime'\n`
    : ''
  const installAsyncRuntimeHosts = asyncRuntime
    ? `  __currentThreadHostsDisposer = __installCurrentThreadHosts(
    __napiModule.exports,
  )
`
    : ''
  const fsImport = fs
    ? buffer
      ? `import { memfs, Buffer } from '@napi-rs/wasm-runtime/fs'`
      : `import { memfs } from '@napi-rs/wasm-runtime/fs'`
    : ''
  const bufferImport = buffer && !fs ? `import { Buffer } from 'buffer'` : ''
  const wasiCreation = fs
    ? `
export const { fs: __fs, vol: __volume } = memfs()

const __wasi = new __WASI({
  version: 'preview1',
  fs: __fs,
  preopens: {
    '/': '/',
  },
})`
    : `
const __wasi = new __WASI({
  version: 'preview1',
})`

  const workerFsHandler = fs
    ? `      worker.addEventListener('message', __wasmCreateOnMessageForFsProxy(__fs))\n`
    : ''

  const workerErrorHandler = errorEvent
    ? `      worker.addEventListener('message', (event) => {
        if (event.data && typeof event.data === 'object' && event.data.type === 'error') {
          const __CustomEvent = globalThis.CustomEvent
          if (
            typeof globalThis.dispatchEvent === 'function' &&
            typeof __CustomEvent === 'function'
          ) {
            globalThis.dispatchEvent(
              new __CustomEvent('napi-rs-worker-error', { detail: event.data }),
            )
          }
        }
      })
`
    : ''

  const emnapiInjectBuffer = buffer
    ? '  __emnapiContext.features.Buffer = Buffer\n'
    : ''
  const emnapiInstantiateImport = effectiveAsyncInit
    ? `instantiateNapiModule as __emnapiInstantiateNapiModule`
    : `instantiateNapiModuleSync as __emnapiInstantiateNapiModuleSync`
  const emnapiInstantiateCall = effectiveAsyncInit
    ? `await __emnapiInstantiateNapiModule`
    : `__emnapiInstantiateNapiModuleSync`
  // The `reuseWorker` pool is what lets addon Rust code spawn threads while
  // the calling thread is blocked inside the wasm call: a browser cannot
  // start a worker until the blocking thread returns to its event loop, so
  // a thread spawned mid-call can never boot and the caller deadlocks
  // waiting for it. With a pre-created pool, spawning is only a message to
  // an already-running worker.
  //
  // Its size comes from `navigator.hardwareConcurrency` at runtime (logical
  // cores, floored at 2, with a fallback for privacy-fuzzed or missing
  // values): a constant undersizes both ends of the range — big desktops
  // leave parallelism on the table, and a fuzzed "2 cores" would
  // oversubscribe.
  //
  // The reuse pool is sized as `__asyncWorkPoolSize + __workerPoolSize`
  // because emnapi's async-work pool draws its workers from the SAME reuse
  // pool: the async reservation must be included or async-work
  // initialization can starve the reuse pool before addon threads spawn.
  //
  // `strict` is deliberately NOT set. Review suggested it so exhaustion
  // errors instead of allocating a fresh worker, but it breaks
  // spawn-and-return workloads (e.g. `testWorkers` in examples/napi, which
  // spawns workers and joins them on a helper thread): at exhaustion their
  // `std::thread::spawn` panics on EAGAIN. Without `strict` the fallback
  // allocates a fresh worker, which boots normally once the spawning
  // parent returns to its event loop — and for joins inside a blocked
  // call, the pre-created pool is what those calls draw from anyway.
  const workerPoolSizeBinding = threads
    ? `const __asyncWorkPoolSize = 4
const __workerPoolSize = Math.max(
  2,
  globalThis.navigator?.hardwareConcurrency ?? 4,
)

`
    : ''
  const reuseWorkerOption = threads
    ? `    reuseWorker: { size: __asyncWorkPoolSize + __workerPoolSize },\n`
    : ''
  const workerRuntimeImport = threads
    ? `  createOnMessage as __wasmCreateOnMessageForFsProxy,\n`
    : ''
  const memoryName = threads ? '__sharedMemory' : '__wasmMemory'
  const asyncWorkPoolOption = `    asyncWorkPoolSize: ${threads ? '__asyncWorkPoolSize' : 0},
`
  // Which archive a build links decides who implements async work and
  // threadsafe functions — see `emnapi_link_library` in
  // `crates/build/src/wasi.rs`. Without threads it is `emnapi-basic-napi-rs`,
  // the "basic" model: both stay wasm imports, and the `@emnapi/core`
  // JavaScript plugins below are what resolves them; without the plugins
  // instantiation fails with a LinkError naming the missing import. With
  // threads it is `emnapi-napi-rs-mt`, the full composition, whose C
  // `async_work.c` / `threadsafe_function.c` run on the uv threadpool inside
  // the wasm — it imports none of those symbols, so the plugins are inert
  // there. They are passed in both modes because only the archive knows which
  // applies, and a plugin nothing imports costs nothing.
  //
  // This is why the async-work drain on the disposal path cannot live here:
  // with threads there is no JavaScript seam at all, so `__drainWasiAsyncWork`
  // asks the addon instead.
  const emnapiPluginImport = `  emnapiAsyncWorkPlugin as __emnapiAsyncWorkPlugin,\n  emnapiTSFNPlugin as __emnapiTSFNPlugin,\n`
  const emnapiPluginOption = `    plugins: [
      __captureWasiThreadManager,
      __emnapiAsyncWorkPlugin,
      __emnapiTSFNPlugin,
    ],\n`
  const workerOption = threads
    ? `    onCreateWorker() {
      const worker = new Worker(new URL('./wasi-worker-browser.mjs', import.meta.url), {
        type: 'module',
      })
      __wasiWorkers.add(worker)
${workerFsHandler}
${workerErrorHandler}
      return worker
    },
`
    : ''

  return `import {
${emnapiPluginImport}\
${workerRuntimeImport}\
  ${emnapiInstantiateImport},
  WASI as __WASI,
} from '@napi-rs/wasm-runtime'
import { createContext as __emnapiCreateContext } from '@emnapi/runtime'
${asyncRuntimeImport}\
${fsImport}
${bufferImport}
export const __napiBindingTarget = '${platformArchABI}'
${BINDING_TARGET_STAMP_HELPER}
${wasiCreation}

const __wasmUrl = new URL('./${wasiFilename}.wasm', import.meta.url).href
const __wasmResponse = await globalThis.fetch(__wasmUrl)
if (!__wasmResponse.ok) {
  throw new Error(
    'Failed to fetch WASI module ' +
      __wasmUrl +
      ': ' +
      __wasmResponse.status +
      ' ' +
      (__wasmResponse.statusText || 'Unknown Status'),
  )
}
const __wasmFile = await __wasmResponse.arrayBuffer()

const ${memoryName} = new WebAssembly.Memory({
  initial: ${initialMemory},
  maximum: ${maximumMemory},
${threads ? '  shared: true,\n' : ''}\
})
${workerPoolSizeBinding}\
let __emnapiContext
${createEmnapiContextLifecycle(asyncRuntime)}
let __wasiModule
let __napiModule

try {
  __emnapiContext = __wrapEmnapiContextDestroyForSettlement(
    __emnapiCreateContext({ autoDestroy: false }),
    __prepareWasmEnvCleanup,
    __isPreparingWasmEnvCleanup,
  )
  __emnapiContext.suppressDestroy()
  ${emnapiInjectBuffer}
  ;({
    instance: __napiInstance,
    module: __wasiModule,
    napiModule: __napiModule,
  } = ${emnapiInstantiateCall}(__wasmFile, {
    context: __emnapiContext,
${asyncWorkPoolOption}\
${reuseWorkerOption}\
${emnapiPluginOption}\
    wasi: __wasi,
${workerOption}\
    overwriteImports(importObject) {
      importObject.env = {
        ...importObject.env,
        ...importObject.napi,
        ...importObject.emnapi,
        memory: ${memoryName},
      }
      return importObject
    },
    beforeInit({ instance }) {
      __napiInstance = instance
      for (const name of Object.keys(instance.exports)) {
        if (name.startsWith('__napi_register__')) {
          instance.exports[name]()
        }
      }
    },
  }))
  __publishWasiDispose(__napiModule.exports)
${installAsyncRuntimeHosts}\
  // The default export hands out this object; a named module export does not
  // travel with it, so carry the marker on the binding itself too. After the
  // host install, which hands the same object to addon-provided registration
  // functions that may put anything on it, and inside this \`try\`, so a claimed
  // name fails the load through the rollback below rather than past it.
  ${NAPI_BINDING_TARGET_STAMP_FN}(__napiModule.exports, __napiBindingTarget)
} catch (error) {
  const cleanupErrors = await __rollbackWasiInitialization()
  throw __attachCleanupErrors(error, cleanupErrors)
}
`
}

/**
 * Module-scope prelude of the deferred loader: the compiled-in memory
 * descriptor, the per-module instance counters, and the resolver that turns a
 * `createInstance()` options bag into the one `WebAssembly.Memory` that
 * instance runs on.
 *
 * Nothing here allocates — workerd bans allocation in global scope, so the
 * Memory itself is created inside `__createInstance`.
 */
const DEFERRED_MEMORY_PREAMBLE = (
  initialMemory: number,
  maximumMemory: number,
) => `
export const WASM_MEMORY = Object.freeze({
  initialPages: ${initialMemory},
  maximumPages: ${maximumMemory},
  pageBytes: 65536,
  initialBytes: ${initialMemory} * 65536,
  maximumBytes: ${maximumMemory} * 65536,
})

let __createdInstances = 0
let __liveInstances = 0

/**
 * Counters for instances created by THIS module evaluation, not process-wide:
 * a second bundled copy of this loader keeps its own. Only successfully
 * created instances are counted, and \`liveInstances\` drops when an instance's
 * \`dispose()\` resolves.
 *
 * \`declaredInitialMemoryBytes\` is declared address space, not a host's
 * committed-memory metric; pair it with host telemetry rather than treating it
 * as a quota.
 */
export function getDeferredRuntimeStats() {
  return Object.freeze({
    createdInstances: __createdInstances,
    liveInstances: __liveInstances,
    declaredInitialMemoryBytes: WASM_MEMORY.initialBytes,
  })
}

const __arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength',
).get
const __memoryBufferGetter = Object.getOwnPropertyDescriptor(
  WebAssembly.Memory.prototype,
  'buffer',
).get
// One managed initialization per Memory, success or failure: an attempt that
// throws may already have written into linear memory, so the bytes are not a
// clean slate for a second instance. Module-local, like the counters above.
const __claimedMemories = new WeakSet()

function __resolveInstanceMemory(__options) {
  const __provided = __options == null ? undefined : __options.memory
  if (__provided === undefined || __provided === null) {
    // Page counts are handed to the engine unvalidated: it already rejects a
    // negative, over-4GiB or below-maximum value with a precise message, and a
    // second set of bounds here would only drift from it.
    const __allocated = new WebAssembly.Memory({
      initial:
        __options != null && __options.initialMemoryPages !== undefined
          ? __options.initialMemoryPages
          : WASM_MEMORY.initialPages,
      maximum:
        __options != null && __options.maximumMemoryPages !== undefined
          ? __options.maximumMemoryPages
          : WASM_MEMORY.maximumPages,
    })
    // Claimed like a caller-provided one. The handle publishes it as
    // \`instance.memory\`, so handing it back to \`createInstance()\` is as easy
    // as passing your own twice, and it would put two live instances on one
    // linear memory: each initialization rewrites the emnapi/WASI state the
    // other is still running on.
    __claimedMemories.add(__allocated)
    return __allocated
  }
  if (
    __options.initialMemoryPages !== undefined ||
    __options.maximumMemoryPages !== undefined
  ) {
    throw new TypeError(
      'Pass either memory or initialMemoryPages/maximumMemoryPages, not both',
    )
  }
  let __buffer
  try {
    // Brand check: the getter throws for anything that is not a genuine
    // WebAssembly.Memory, including a cross-realm look-alike object.
    __buffer = Reflect.apply(__memoryBufferGetter, __provided, [])
  } catch {
    throw new TypeError('memory must be an unshared WebAssembly.Memory')
  }
  try {
    // Throws for a SharedArrayBuffer. This loader has no threads, and shared
    // growth does not detach: external views handed to the addon would
    // silently outlive the bytes they describe.
    Reflect.apply(__arrayBufferByteLengthGetter, __buffer, [])
  } catch {
    throw new TypeError(
      'The deferred loader requires an unshared WebAssembly.Memory',
    )
  }
  // The intrinsic getters above accept a genuine Memory from ANY realm, but
  // the loader's dependencies do not: \`WASI.setMemory\` in
  // \`@napi-rs/wasm-runtime\` and emnapi identify a Memory with a realm-local
  // \`instanceof\`. A Memory built in another realm (a \`node:vm\` context, a
  // same-origin iframe) would pass every check here and only fail deep inside
  // initialization. Reject it up front, and before the claim below, so the
  // caller keeps it usable in the realm that made it.
  if (!(__provided instanceof WebAssembly.Memory)) {
    throw new TypeError(
      'memory must be a WebAssembly.Memory created in the same realm as this loader',
    )
  }
  if (__claimedMemories.has(__provided)) {
    throw new TypeError(
      'This WebAssembly.Memory has already been used for a deferred initialization attempt and cannot be reused, including after a failed initialization or a disposal',
    )
  }
  // Last step, after every check: a rejected option bag must leave the Memory
  // unclaimed, or a caller could not fix the call and retry with it.
  __claimedMemories.add(__provided)
  return __provided
}
`

export const createWasiDeferredBrowserBinding = (
  wasiFilename: string,
  // Fed by `napi.wasm.threadlessInitialMemory ?? napi.wasm.initialMemory`.
  // 64 MiB leaves headroom for JS/runtime state under workerd's 128 MiB
  // isolate limit. The regular Node/browser loaders retain their historical
  // 4,000-page default.
  initialMemory = 1024,
  maximumMemory = 65536,
  buffer = false,
  // Deferred loaders are only emitted for non-threaded flavors, so the
  // default matches the only flavor `napi build` generates one for.
  platformArchABI = 'wasm32-wasip1',
  asyncRuntime = false,
) => {
  const bufferImport = buffer ? `import { Buffer } from 'buffer'` : ''
  const emnapiInjectBuffer = buffer
    ? '    __emnapiContext.features.Buffer = Buffer\n'
    : ''
  // This flavor creates N independent instances per realm, each with its own
  // emnapi context and its own `napiModule.exports`, so it uses the
  // per-instance helpers rather than `installCurrentThreadHosts`: those return
  // exact, idempotent disposers with no realm-global dedup, roll themselves
  // back on a setup failure, and degrade to a no-op disposer when the realm has
  // no `setTimeout`/`clearTimeout`.
  // The `/workerd` subpath, not the barrel: the barrel's `index.cjs` also
  // requires `current-thread-hosts.cjs`, whose realm-global registry and Node
  // timer-handle bookkeeping this flavor never executes, and a CJS barrel is
  // not tree-shakeable out of a worker bundle.
  const asyncRuntimeImport = asyncRuntime
    ? `import {
  registerWorkerdCurrentThreadTaskHost as __registerWorkerdCurrentThreadTaskHost,
  registerWorkerdTimerHost as __registerWorkerdTimerHost,
} from '@napi-rs/async-runtime/workerd'
`
    : ''
  // `__createManagedEmnapiContext` calls `__prepareEnvCleanup?.()` on EVERY
  // destroy path (dispose(), managed beforeExit, module lifecycle), so a second
  // hook next to it covers them all with one edit.
  const managedHostDisposeParam = asyncRuntime ? '  __disposeHosts,\n' : ''
  const managedHostDisposeCall = asyncRuntime
    ? `      __disposeHosts?.()\n`
    : ''
  const instanceHostState = asyncRuntime
    ? `  let __disposeInstanceHosts
  const __reportInstanceHostDisposalError = (__error) => {
    try {
      const __consoleHost = globalThis.console
      if (__consoleHost && typeof __consoleHost.error === 'function') {
        __consoleHost.error(__error)
      }
    } catch {}
  }
  // Runs between the settlement drain and \`Context.destroy()\`; never throws,
  // for the same reason the eager loaders' disposer does not.
  const __disposeHostsBeforeDestroy = () => {
    const __dispose = __disposeInstanceHosts
    if (__dispose === undefined) {
      return
    }
    __disposeInstanceHosts = undefined
    __dispose()
  }
`
    : ''
  const installInstanceHosts = asyncRuntime
    ? `    const __disposeTaskHost = __registerWorkerdCurrentThreadTaskHost(
      __napiModule.exports,
    )
    try {
      const __disposeTimerHost = __registerWorkerdTimerHost(
        __napiModule.exports,
      )
      __disposeInstanceHosts = () => {
        try {
          __disposeTimerHost()
        } catch (__error) {
          __reportInstanceHostDisposalError(__error)
        }
        try {
          __disposeTaskHost()
        } catch (__error) {
          __reportInstanceHostDisposalError(__error)
        }
      }
    } catch (__error) {
      try {
        __disposeTaskHost()
      } catch (__cleanupError) {
        __attachCleanupError(__error, __cleanupError)
      }
      throw __error
    }
`
    : ''
  const managedHostDisposeArg = asyncRuntime
    ? '    __disposeHostsBeforeDestroy,\n'
    : ''
  return `import {
  emnapiAsyncWorkPlugin as __emnapiAsyncWorkPlugin,
  emnapiTSFNPlugin as __emnapiTSFNPlugin,
  instantiateNapiModule as __emnapiInstantiateNapiModule,
  WASI as __WASI,
} from '@napi-rs/wasm-runtime'
import { createContext as __emnapiCreateContext } from '@emnapi/runtime'
${asyncRuntimeImport}\
${bufferImport}
${DEFERRED_MEMORY_PREAMBLE(initialMemory, maximumMemory)}
export const __napiBindingTarget = '${platformArchABI}'
${BINDING_TARGET_STAMP_HELPER}

/**
 * Deferred, workerd-safe instantiation: no top-level I/O, no compile-from-bytes.
 * Accepts ONLY a precompiled WebAssembly.Module, or a Promise resolving to one
 * (e.g. \`import mod from './${wasiFilename}.wasm'\` under a CompiledWasm
 * module rule / wrangler module import). Byte buffers, URLs and Response
 * objects are rejected: they require dynamic Wasm compilation, which
 * Cloudflare Workers disallows.
 */
async function __resolveModule(__wasmInput) {
  const __module = await __wasmInput
  // Brand check, not \`instanceof\`: \`WebAssembly.Module.imports\` throws unless
  // its argument is a genuine WebAssembly.Module, so prototype-spoofed byte
  // buffers are rejected while cross-realm Module instances are accepted.
  try {
    WebAssembly.Module.imports(__module)
  } catch {
    throw new TypeError(
      "instantiate() and createInstance() expect a precompiled WebAssembly.Module (or a Promise resolving to one), " +
        "e.g. import mod from './${wasiFilename}.wasm' under a CompiledWasm module rule / wrangler module import. " +
        "Byte buffers, URLs and Response objects require dynamic Wasm compilation, which Cloudflare Workers disallows.",
    )
  }
  return __module
}

let __normalizedModules

function __rememberNormalizedModule(__module, __normalizedModule) {
  if (!__normalizedModules) {
    __normalizedModules = new WeakMap()
  }
  __normalizedModules.set(__module, __normalizedModule)
  return __normalizedModule
}

async function __normalizeModuleForEmnapi(__module) {
  if (__module instanceof WebAssembly.Module) {
    return __module
  }
  if (__normalizedModules) {
    const __normalizedModule = __normalizedModules.get(__module)
    if (__normalizedModule) {
      return __normalizedModule
    }
  }
  // @emnapi/core currently performs realm-local \`instanceof\` checks after
  // accepting the module. Structured cloning preserves compiled code without
  // compiling bytes and produces a Module owned by the current realm.
  if (typeof structuredClone === 'function') {
    try {
      const __normalizedModule = structuredClone(__module)
      if (__normalizedModule instanceof WebAssembly.Module) {
        return __rememberNormalizedModule(__module, __normalizedModule)
      }
    } catch {}
  }
  // MessageChannel uses the same structured-clone semantics and covers older
  // browser/Node hosts that expose it but not the structuredClone function.
  if (typeof MessageChannel === 'function') {
    let __channel
    try {
      __channel = new MessageChannel()
      const __normalizedModule = await new Promise((resolve, reject) => {
        __channel.port1.onmessage = (event) => resolve(event.data)
        __channel.port1.onmessageerror = () =>
          reject(new TypeError('Failed to clone WebAssembly.Module'))
        try {
          __channel.port2.postMessage(__module)
        } catch (error) {
          reject(error)
        }
      })
      if (__normalizedModule instanceof WebAssembly.Module) {
        return __rememberNormalizedModule(__module, __normalizedModule)
      }
    } catch {
    } finally {
      try {
        __channel?.port1.close()
      } catch {}
      try {
        __channel?.port2.close()
      } catch {}
    }
  }
  // Last-resort compatibility for genuine, extensible foreign Modules.
  try {
    Object.setPrototypeOf(__module, WebAssembly.Module.prototype)
  } catch {}
  if (__module instanceof WebAssembly.Module) {
    return __module
  }
  throw new TypeError(
    'This host cannot normalize a cross-realm WebAssembly.Module; ' +
      'provide structuredClone or MessageChannel support.',
  )
}
${emnapiContextDestroyWrapper}
function __captureEmnapiAutoDestroyListener(__process) {
  if (
    !__process ||
    typeof __process.prependListener !== 'function' ||
    typeof __process.removeListener !== 'function'
  ) {
    return
  }
  let __autoDestroyListener
  const __captureListener = (__event, __listener) => {
    if (__event === 'beforeExit' && __autoDestroyListener === undefined) {
      __autoDestroyListener = __listener
    }
  }
  try {
    // Run before existing newListener hooks so a hook that registers its own
    // beforeExit listener cannot be mistaken for emnapi's registration.
    __process.prependListener('newListener', __captureListener)
  } catch {
    return
  }
  return () => {
    try {
      __process.removeListener('newListener', __captureListener)
    } catch {}
    if (__autoDestroyListener !== undefined) {
      try {
        __process.removeListener('beforeExit', __autoDestroyListener)
      } catch {}
    }
  }
}

function __attachCleanupError(__error, __cleanupError) {
  try {
    if (
      __error &&
      (typeof __error === 'object' || typeof __error === 'function') &&
      __error.cause === undefined
    ) {
      __error.cause = __cleanupError
    }
  } catch {}
}

// Mirror the primitive @emnapi/core schedules its threadsafe-function dispatch
// on, so the drain turns below interleave with that dispatch instead of racing
// ahead of it on a faster queue.
const __scheduleMacrotask = (function () {
  if (typeof setImmediate === 'function') {
    return function (__callback) {
      setImmediate(__callback)
    }
  }
  const __MessageChannel = globalThis.MessageChannel
  if (typeof __MessageChannel === 'function') {
    return function (__callback) {
      const __channel = new __MessageChannel()
      __channel.port1.onmessage = function () {
        __channel.port1.onmessage = null
        try {
          __channel.port1.close()
        } catch {}
        try {
          __channel.port2.close()
        } catch {}
        __callback()
      }
      __channel.port2.postMessage(null)
    }
  }
  return function (__callback) {
    setTimeout(__callback, 0)
  }
})()

// Turns to wait for while the addon still reports queued settlements. Reaching
// zero is the only success. A counter still nonzero at this bound rejects the
// disposal as retryable (\`ERR_NAPI_WASI_CLEANUP_PENDING\`) rather than
// destroying the context over a still-queued settlement — the wait stays
// bounded either way.
const __WASM_ENV_CLEANUP_DRAIN_TURNS = 128
// Without \`napi_wasm_env_cleanup_pending\` the queue is not observable. Fall
// back to the number of turns @emnapi/core needs to coalesce and dispatch a
// call made on this thread (two), plus a margin.
const __WASM_ENV_CLEANUP_BLIND_DRAIN_TURNS = 4

/**
 * \`napi_prepare_wasm_env_cleanup\` only *queues* the promise settlements of the
 * tasks it cancelled: \`napi_call_threadsafe_function\` appends to the
 * threadsafe-function queue, and @emnapi/core dispatches that queue from a
 * macrotask — two coalescing turns later, even for a call made on this very
 * thread. \`Context.destroy()\` then runs the threadsafe function's cleanup hook,
 * which drains the queue with a null env and *discards* whatever is still in it.
 *
 * So destroying without yielding first strands exactly the promises the barrier
 * exists to settle. Yield real event-loop turns until the addon reports the
 * queue empty; microtask checkpoints cannot help, no number of them lets a
 * macrotask run.
 *
 * Returns nothing when there is nothing to wait for, which keeps disposal
 * synchronous in the common case.
 */
function __drainWasmEnvCleanup(__instance) {
  const __pending = __instance?.exports.napi_wasm_env_cleanup_pending
  const __observable = typeof __pending === 'function'
  if (__observable) {
    let __queued
    try {
      __queued = __pending()
    } catch {
      return
    }
    if (!__queued) {
      return
    }
  }
  const __limit = __observable
    ? __WASM_ENV_CLEANUP_DRAIN_TURNS
    : __WASM_ENV_CLEANUP_BLIND_DRAIN_TURNS
  return (async () => {
    let __queued = 0
    for (let __turn = 0; __turn < __limit; __turn++) {
      await new Promise((resolve) => {
        __scheduleMacrotask(resolve)
      })
      if (!__observable) {
        continue
      }
      try {
        __queued = __pending()
      } catch {
        return
      }
      if (!__queued) {
        return
      }
    }
    if (!__observable) {
      // Blind wait: without \`napi_wasm_env_cleanup_pending\` the bound IS the
      // contract — there is nothing to consult, so finishing the turns is
      // finishing the drain.
      return
    }
    // The counter is still nonzero after every turn the bound allows. The wait
    // stays bounded — but claiming success here would be indistinguishable from
    // the stranding this drain exists to prevent: disposal would go on to
    // destroy the context, whose cleanup hook discards the still-queued
    // settlement with a null env, and the promise it was for hangs forever.
    // Reject instead, as a retryable cleanup failure: \`__prepareForDisposal\`
    // leaves its drained flag unset, dispose() (and the instantiation-failure
    // path) decline to destroy, and a later dispose() runs the drain again — by
    // which time the queue has usually been delivered. A counter that is
    // somehow stuck nonzero therefore costs each attempt at most another
    // bounded wait and a rejection, never a stranded promise; the managed
    // beforeExit destroyer still reclaims the context.
    const __drainError = new Error(
      'the wasm environment still reports ' +
        __queued +
        ' queued settlement(s) after ' +
        __limit +
        ' event-loop turns; the context was not destroyed - retry dispose() to wait for the queue again',
    )
    __drainError.code = 'ERR_NAPI_WASI_CLEANUP_PENDING'
    throw __drainError
  })()
}

// A real, *referenced* timer for the async-work wait below, which polls the
// addon rather than interleaving with the @emnapi/core dispatch: a zero-delay
// macrotask there would spin the loop instead of yielding it. Falls back to the
// macrotask scheduler on a host without timers.
function __scheduleTimer(__callback, __delay) {
  const __setTimer = globalThis.setTimeout
  if (typeof __setTimer !== 'function') {
    __scheduleMacrotask(__callback)
    return
  }
  try {
    __setTimer(__callback, __delay)
  } catch {
    __scheduleMacrotask(__callback)
  }
}

// A real, referenced timer rather than a zero-delay macrotask, for the same
// reason the async-work wait uses one: this polls the addon instead of
// interleaving with the @emnapi/core dispatch, so a zero-delay turn would spin
// the loop instead of yielding it.
const __WASM_RUNTIME_WORK_POLL_INTERVAL_MS = 1
// Set once a timer scheduled by the poll has actually arrived. See
// \`__yieldWasmRuntimePollTurn\`.
let __wasmRuntimePollTimerArrived = false

/**
 * One turn of the runtime-work poll.
 *
 * \`__scheduleTimer\` falls back to the macrotask scheduler when \`setTimeout\` is
 * missing or throws, but not when it is present, returns a handle and never
 * fires — fake timers in a test suite that disposes from an \`afterEach\`, or a
 * host whose timers belong to an IO context that is already gone, which is
 * reachable for this flavor in particular. That host would park this poll
 * forever, and the poll is unbounded, so nothing would ever call \`…_finish\`.
 *
 * Arm both primitives until a timer has been seen to arrive, and let whichever
 * lands first end the turn; the loser resolves nothing. A host with working
 * timers therefore pays the double arming for the first turn or two — the
 * macrotask wins the race, but the timer behind it still arrives and is
 * recorded — and paces on the timer alone from then on, instead of spinning the
 * loop on a zero-delay queue. A host whose timers never arrive keeps both, and
 * the macrotask is what keeps the poll moving.
 */
function __yieldWasmRuntimePollTurn() {
  if (__wasmRuntimePollTimerArrived) {
    return new Promise((resolve) => {
      __scheduleTimer(resolve, __WASM_RUNTIME_WORK_POLL_INTERVAL_MS)
    })
  }
  return new Promise((resolve) => {
    let __settled = false
    const __settle = () => {
      if (__settled) {
        return
      }
      __settled = true
      resolve()
    }
    __scheduleTimer(() => {
      __wasmRuntimePollTimerArrived = true
      __settle()
    }, __WASM_RUNTIME_WORK_POLL_INTERVAL_MS)
    __scheduleMacrotask(__settle)
  })
}

/**
 * Yield event-loop turns until the addon reports its runtime work finished.
 *
 * The window between \`napi_prepare_wasm_env_cleanup_begin\` and
 * \`…_finish\` — the turns are the entire point of splitting the barrier, because
 * on a threaded artifact the work \`…_finish\` joins can itself be waiting for a
 * JavaScript turn from this very thread.
 *
 * Unbounded, for the same reason the async-work wait above is: giving up means
 * calling \`…_finish\`, which joins on this thread, and the work it would join is
 * the work waiting for a turn from this thread — so a bound does not end the
 * wait, it only moves it somewhere the JavaScript thread can no longer be
 * reached. A blocking closure that never returns keeps the disposal promise
 * pending instead. The host contract is in \`crates/async-runtime/README.md\`: a
 * blocking closure must never wait on a JavaScript turn.
 */
async function __pollWasmRuntimeWork(__workPending) {
  for (;;) {
    await __yieldWasmRuntimePollTurn()
    try {
      if (!__workPending()) {
        return
      }
    } catch {
      // A trap is the only way this fails, and a trapped instance has no
      // reachable work left. Stop polling and finish.
      return
    }
  }
}

// How often to re-read \`napi_wasm_async_work_pending\` while waiting. The wait
// ends when the addon reports zero, so this only decides how promptly disposal
// notices — not how long it waits.
const __WASI_ASYNC_WORK_POLL_INTERVAL_MS = 1

/**
 * Settles this instance's outstanding \`napi_async_work\` before the teardown
 * that would strand it.
 *
 * The same hole the eager loaders had, and the same fix: the environment
 * cleanup barrier covers promise settlements queued on the threadsafe-function
 * queue and says nothing about \`napi_async_work\`, so destroying the context
 * with a work still outstanding leaves its completion callback with nowhere to
 * run and its promise unsettled forever.
 *
 * This flavor is threadless, so \`compute\` runs on the JavaScript thread inside
 * the macrotask that dequeued it: while this is running, any outstanding work
 * is queued rather than executing, and \`napi_wasm_cancel_pending_async_work\`
 * can take all of it. The poll is still what decides when the drain is done —
 * cancellation delivers those completions from a later macrotask, not
 * synchronously.
 *
 * Per instance, from that instance's own exports: two instances of this loader
 * have separate registries and must not wait on each other.
 *
 * Both exports are optional, so an addon built against a napi crate that
 * predates them keeps the previous behavior.
 *
 * Returns nothing when there is nothing outstanding, which keeps disposal
 * synchronous in the common case. No deadline: giving up would destroy the
 * environment with a completion callback still owed.
 */
function __drainInstanceAsyncWork(__instance) {
  const __exports = __instance?.exports
  const __pending = __exports?.napi_wasm_async_work_pending
  const __cancelPending = __exports?.napi_wasm_cancel_pending_async_work
  if (typeof __pending !== 'function' || typeof __cancelPending !== 'function') {
    return
  }

  const __readPending = () => {
    try {
      return __pending()
    } catch (__error) {
      // A trap is the only way this call fails: it reads a counter and cannot
      // allocate or call back into JavaScript. A trapped instance can no longer
      // run anything, so its outstanding work is unreachable by definition and
      // best-effort is the honest answer. Anything else means the export is not
      // what this loader thinks it is — a defect worth surfacing.
      if (__error instanceof globalThis.WebAssembly.RuntimeError) {
        return 0
      }
      throw __error
    }
  }

  if (!__readPending()) {
    return
  }
  try {
    __cancelPending()
  } catch {
    // Cancellation only bounds the wait. Failing it means waiting for the queue
    // to run instead, which the poll below already does.
  }
  if (!__readPending()) {
    return
  }

  return (async () => {
    while (__readPending()) {
      await new Promise((__resolve) => {
        __scheduleTimer(__resolve, __WASI_ASYNC_WORK_POLL_INTERVAL_MS)
      })
    }
  })()
}

function __createLifecycleReentryError(__operation) {
  const __error = new Error(
    __operation +
      '() cannot run while an emnapi Context.destroy() call is still active; await the original cleanup promise instead.',
  )
  __error.code = 'ERR_NAPI_WASI_LIFECYCLE_REENTRY'
  return __error
}

const __managedEmnapiContextDestroyers = new Set()
let __managedCleanupProcess
let __managedBeforeExitListener
let __managedDestroyPromise
let __managedDestroyersInFlight
let __managedBeforeExitRegistrationRetryCount = 0
let __managedBeforeExitRegistrationRetryScheduled = false
let __moduleLifecycleDestroyDepth = 0

function __removeManagedEmnapiCleanupListeners() {
  const __process = __managedCleanupProcess
  const __beforeExitListener = __managedBeforeExitListener
  __managedCleanupProcess = undefined
  __managedBeforeExitListener = undefined
  __managedBeforeExitRegistrationRetryCount = 0
  if (__process && __beforeExitListener) {
    try {
      __process.removeListener('beforeExit', __beforeExitListener)
    } catch {}
  }
}

function __scheduleManagedBeforeExitListenerRegistration() {
  if (
    !__managedCleanupProcess ||
    __managedBeforeExitListener ||
    __managedEmnapiContextDestroyers.size === 0 ||
    __managedBeforeExitRegistrationRetryScheduled ||
    __managedBeforeExitRegistrationRetryCount >= 3
  ) {
    return
  }
  __managedBeforeExitRegistrationRetryScheduled = true
  __managedBeforeExitRegistrationRetryCount++
  queueMicrotask(() => {
    __managedBeforeExitRegistrationRetryScheduled = false
    if (
      !__managedCleanupProcess ||
      __managedBeforeExitListener ||
      __managedEmnapiContextDestroyers.size === 0
    ) {
      return
    }
    try {
      __registerManagedBeforeExitListener()
    } catch {}
  })
}

function __registerManagedBeforeExitListener() {
  if (!__managedCleanupProcess || __managedBeforeExitListener) {
    return
  }
  try {
    __managedCleanupProcess.once(
      'beforeExit',
      __destroyManagedEmnapiContextsBeforeExit,
    )
  } catch (error) {
    __scheduleManagedBeforeExitListenerRegistration()
    throw error
  }
  __managedBeforeExitListener = __destroyManagedEmnapiContextsBeforeExit
  __managedBeforeExitRegistrationRetryCount = 0
}

function __settleManagedEmnapiContextDestroy(__promise) {
  if (__managedDestroyPromise === __promise) {
    __managedDestroyPromise = undefined
    __managedDestroyersInFlight = undefined
  }
  if (__managedEmnapiContextDestroyers.size === 0) {
    __removeManagedEmnapiCleanupListeners()
    return
  }
  try {
    __registerManagedBeforeExitListener()
  } catch {}
}

function __destroyManagedEmnapiContexts(__excludedDestroyers) {
  if (__managedDestroyPromise) {
    return __managedDestroyPromise
  }
  const __destroyers = Array.from(__managedEmnapiContextDestroyers).filter(
    (__destroy) => !__excludedDestroyers?.has(__destroy),
  )
  if (__destroyers.length === 0) {
    return Promise.resolve()
  }
  let __resolveDestroy
  let __rejectDestroy
  const __promise = new Promise((resolve, reject) => {
    __resolveDestroy = resolve
    __rejectDestroy = reject
  })
  __managedDestroyPromise = __promise
  __managedDestroyersInFlight = new Set(__destroyers)
  void Promise.all(
    __destroyers.map((__destroy) => {
      try {
        return Promise.resolve(__destroy()).then(
          () => ({ failed: false }),
          (error) => ({ failed: true, error }),
        )
      } catch (error) {
        return { failed: true, error }
      }
    }),
  ).then((__results) => {
    let __primaryError
    let __failed = false
    for (const __result of __results) {
      if (!__result.failed) {
        continue
      }
      if (!__failed) {
        __failed = true
        __primaryError = __result.error
      } else {
        __attachCleanupError(__primaryError, __result.error)
      }
    }
    if (__failed) {
      __rejectDestroy(__primaryError)
    } else {
      __resolveDestroy()
    }
  }, __rejectDestroy)
  void __promise.then(
    () => {
      __settleManagedEmnapiContextDestroy(__promise)
    },
    () => {
      __settleManagedEmnapiContextDestroy(__promise)
    },
  )
  return __promise
}

async function __drainManagedEmnapiContexts(__excludedDestroyers) {
  const __attemptedDestroyers = new Set(__excludedDestroyers)
  let __primaryError
  let __failed = false
  while (true) {
    let __promise = __managedDestroyPromise
    let __destroyers = __managedDestroyersInFlight
    if (!__promise) {
      __promise = __destroyManagedEmnapiContexts(__attemptedDestroyers)
      __destroyers = __managedDestroyersInFlight
      if (!__destroyers) {
        break
      }
    }
    for (const __destroy of __destroyers) {
      __attemptedDestroyers.add(__destroy)
    }
    try {
      await __promise
    } catch (error) {
      if (!__failed) {
        __failed = true
        __primaryError = error
      } else {
        __attachCleanupError(__primaryError, error)
      }
    }
  }
  if (__failed) {
    throw __primaryError
  }
}

function __destroyManagedEmnapiContextsBeforeExit() {
  // A once listener is consumed before Node invokes it, including when another
  // cleanup batch is still pending.
  __managedBeforeExitListener = undefined
  if (__managedDestroyPromise) {
    return
  }
  void __destroyManagedEmnapiContexts().catch((error) => {
    queueMicrotask(() => {
      throw error
    })
  })
}

function __registerManagedEmnapiContext(__process, __destroy) {
  __managedEmnapiContextDestroyers.add(__destroy)
  if (
    !__managedCleanupProcess &&
    __process &&
    typeof __process.once === 'function' &&
    typeof __process.removeListener === 'function'
  ) {
    __managedCleanupProcess = __process
  }
  let __registered = true
  return () => {
    if (!__registered) {
      return
    }
    __registered = false
    __managedEmnapiContextDestroyers.delete(__destroy)
    if (__managedEmnapiContextDestroyers.size === 0) {
      __removeManagedEmnapiCleanupListeners()
    }
  }
}

async function __createManagedEmnapiContext(
  __prepareEnvCleanup,
  __isPreparingEnvCleanup,
${managedHostDisposeParam}) {
  const __process =
    typeof process === 'object' && process !== null ? process : undefined
  const __finishAutoDestroyCapture =
    __captureEmnapiAutoDestroyListener(__process)
  let __emnapiContext
  let __contextInitializationError
  let __contextInitializationFailed = false
  try {
    __emnapiContext = __wrapEmnapiContextDestroyForSettlement(
      __emnapiCreateContext({ autoDestroy: false }),
      __prepareEnvCleanup,
      __isPreparingEnvCleanup,
    )
    // emnapi 2.x still registers an unconditional process.once('beforeExit')
    // auto-destroy listener on Node hosts, and suppressDestroy() only
    // neutralizes its callback without removing it. This loader must stay
    // side-effect free per instance, so the listener is captured and removed;
    // suppressDestroy() remains the safety net when removal is unavailable.
    __emnapiContext.suppressDestroy()
  } catch (error) {
    __contextInitializationError = error
    __contextInitializationFailed = true
  } finally {
    // Remove only the exact emnapi callback captured above.
    __finishAutoDestroyCapture?.()
  }
  if (__emnapiContext === undefined) {
    throw __contextInitializationError
  }
  let __disposed = false
  let __destroying = false
  let __destroyPromise
  let __cleanupRegistered = false
  let __unregisterCleanup
  const __destroy = (__blocksModuleLifecycle = false) => {
    if (__disposed) {
      return
    }
    if (__destroying) {
      throw __createLifecycleReentryError('dispose')
    }
    if (__destroyPromise) {
      return __destroyPromise
    }
    __destroying = true
    let __result
    const __finishDestroyInvocation = () => {
      __destroying = false
    }
    const __finishModuleLifecycleDestroy = () => {
      if (__blocksModuleLifecycle) {
        __blocksModuleLifecycle = false
        __moduleLifecycleDestroyDepth--
      }
    }
    if (__blocksModuleLifecycle) {
      __moduleLifecycleDestroyDepth++
    }
    try {
      // Context.destroy() disables JS before cleanup hooks run, so settle
      // runtime-owned promises while this environment can still call JS.
      __prepareEnvCleanup?.()
      if (__isPreparingEnvCleanup?.()) {
        // Reached from inside the barrier, so \`Context.destroy()\` below would
        // hit the wrapper's in-flight no-op. Recording that as a completed
        // destroy is what makes the frame that *did* start the barrier skip the
        // real one afterwards, leaving the context retained with its cleanup
        // hooks unrun. Refuse instead: nothing is flagged, the context stays
        // registered for managed beforeExit cleanup, and a later destroy still
        // works. dispose() coalesces reentrancy before it can get here, so this
        // is the backstop for any other caller that manages to. A handshake
        // parked between the two halves of the barrier does not reach here —
        // \`__prepareEnvCleanup\` closes one rather than skipping it.
        throw __createLifecycleReentryError('dispose')
      }
${managedHostDisposeCall}\
      __result = __emnapiContext.destroy()
    } catch (error) {
      __finishDestroyInvocation()
      __finishModuleLifecycleDestroy()
      throw error
    }
    let __then
    try {
      if (
        __result !== null &&
        (typeof __result === 'object' || typeof __result === 'function')
      ) {
        __then = __result.then
      }
    } catch (error) {
      __finishDestroyInvocation()
      __finishModuleLifecycleDestroy()
      throw error
    }
    if (typeof __then === 'function') {
      let __resolveResult
      let __rejectResult
      const __resultPromise = new Promise((resolve, reject) => {
        __resolveResult = resolve
        __rejectResult = reject
      })
      const __promise = __resultPromise.then(
        (value) => {
          __finishDestroyInvocation()
          __finishModuleLifecycleDestroy()
          __disposed = true
          __destroyPromise = undefined
          __unregisterCleanup?.()
          return value
        },
        (error) => {
          __finishDestroyInvocation()
          __finishModuleLifecycleDestroy()
          __destroyPromise = undefined
          throw error
        },
      )
      __destroyPromise = __promise
      try {
        Reflect.apply(__then, __result, [__resolveResult, __rejectResult])
      } catch (error) {
        __rejectResult(error)
      }
      return __promise
    }
    __finishDestroyInvocation()
    __finishModuleLifecycleDestroy()
    __disposed = true
    __unregisterCleanup?.()
  }
  const __destroyForModuleLifecycle = () => __destroy(true)
  const __registerCleanup = (
    __beforeExitDestroy = __destroyForModuleLifecycle,
  ) => {
    if (__cleanupRegistered || __disposed) {
      return
    }
    __unregisterCleanup = __registerManagedEmnapiContext(
      __process,
      __beforeExitDestroy,
    )
    __cleanupRegistered = true
    __registerManagedBeforeExitListener()
  }
  if (__contextInitializationFailed) {
    let __registrationError
    let __registrationFailed = false
    try {
      __registerCleanup()
    } catch (error) {
      __attachCleanupError(__contextInitializationError, error)
      __registrationError = error
      __registrationFailed = true
    }
    try {
      await __destroyForModuleLifecycle()
    } catch (error) {
      __attachCleanupError(
        __registrationFailed
          ? __registrationError
          : __contextInitializationError,
        error,
      )
      try {
        __registerManagedBeforeExitListener()
      } catch {}
    }
    throw __contextInitializationError
  }
  return {
    context: __emnapiContext,
    destroy: __destroy,
    destroyForModuleLifecycle: __destroyForModuleLifecycle,
    registerCleanup: __registerCleanup,
  }
}

async function __createInstance(
  __wasmInput,
  __options,
  __beforeExitDestroy,
  __onManagedDestroyer,
) {
  const __module = await __resolveModule(__wasmInput)
  const __emnapiModule = await __normalizeModuleForEmnapi(__module)
  const __wasi = new __WASI({
    version: 'preview1',
  })
  // The wasm module is linked with \`--import-memory\`, so a Memory must be
  // provided. It is resolved here in function scope (workerd bans global scope
  // allocation) and is never shared (no threads, no SharedArrayBuffer).
  // Resolve it before the emnapi context so a rejected option bag or a host
  // memory-limit failure cannot leak a context that never reaches
  // instantiation.
  const __wasmMemory = __resolveInstanceMemory(__options)
  let __lifecycleState = 'pending'
  let __destroyEmnapiContext
  let __destroyOwnedContext
  let __destroyManagedOwnedContext
  let __napiInstance
${instanceHostState}\
  let __wasmEnvCleanupRan = false
  let __wasmEnvCleanupPrepared = false
  let __wasmEnvCleanupPreparing = false
  // The closer for a barrier parked between \`…_begin\` and \`…_finish\`, set only
  // while that window is open. \`__wasmEnvCleanupPreparing\` cannot tell that
  // apart from a purely synchronous frame, which must not be re-entered and
  // which nothing outside it can finish; this window spans real event-loop
  // turns, so a caller that cannot yield — the managed beforeExit teardown —
  // can land inside it, and can close it. See \`__prepareEnvCleanup\`.
  let __finishParkedEnvCleanup
  // Raised while a caller that can still yield is driving the barrier, so the
  // queue it leaves behind is expected rather than lost.
  let __wasmEnvCleanupYielding = false
  let __wasmEnvSettlementLossReported = false
  let __wasmEnvCleanupDrained = false
  let __wasmEnvCleanupDrainPromise
  const __isPreparingEnvCleanup = () => __wasmEnvCleanupPreparing
  /**
   * Say so when the barrier leaves settlements queued and nothing is left that
   * could deliver them.
   *
   * Only \`dispose()\` and the initialization rollback yield the event-loop turns
   * @emnapi/core needs to dispatch its queue. Every other caller of the barrier
   * destroys in the same turn — a raw \`Context.destroy()\`, the managed
   * beforeExit teardown — and \`Context.destroy()\` runs the threadsafe
   * function's cleanup hook, which drains that queue with a null env and
   * discards it. The promises those settlements were for then hang forever,
   * silently.
   *
   * Loud, once, and never throwing: this runs from inside \`Context.destroy()\`,
   * where throwing would take the whole teardown down with it. Destroying
   * anyway is still the right trade — the queue is already unreachable by then.
   */
  const __reportUnreachedSettlements = () => {
    if (__wasmEnvCleanupYielding || __wasmEnvSettlementLossReported) {
      return
    }
    const __pending = __napiInstance?.exports.napi_wasm_env_cleanup_pending
    if (typeof __pending !== 'function') {
      return
    }
    let __queued
    try {
      __queued = __pending()
    } catch {
      return
    }
    if (!__queued) {
      return
    }
    __wasmEnvSettlementLossReported = true
    try {
      const __consoleHost = globalThis.console
      if (__consoleHost && typeof __consoleHost.error === 'function') {
        __consoleHost.error(
          'napi-rs: the wasm environment is being destroyed with ' +
            __queued +
            ' queued promise settlement(s). Context.destroy() discards them, so those promises never settle. Dispose the instance instead: only dispose() yields the event-loop turns the settlements need.',
        )
      }
    } catch {}
  }
  const __prepareEnvCleanup = () => {
    if (__wasmEnvCleanupPrepared) {
      return
    }
    // A handshake parked between its two halves is one this frame can close,
    // and must: every caller of this is about to destroy the context, and the
    // turns the poll is waiting for will not come. Closing it runs \`…_finish\`,
    // which is the call that joins, so this degrades to exactly the single
    // call below. Leaving it open destroys the context with the barrier still
    // raised and the runtime never joined.
    const __finishParked = __finishParkedEnvCleanup
    if (__finishParked !== undefined) {
      __finishParked()
      __reportUnreachedSettlements()
      return
    }
    if (__wasmEnvCleanupPreparing) {
      return
    }
    const __prepareWasmEnvCleanup =
      __napiInstance?.exports.napi_prepare_wasm_env_cleanup
    if (typeof __prepareWasmEnvCleanup === 'function') {
      // The addon settles the promises it cancels synchronously, under a
      // non-reentrant lifecycle mutex: anything a promise hook calls from in
      // here must not reach this export again.
      __wasmEnvCleanupPreparing = true
      try {
        __prepareWasmEnvCleanup()
      } finally {
        __wasmEnvCleanupPreparing = false
      }
      __wasmEnvCleanupRan = true
      __reportUnreachedSettlements()
    }
    __wasmEnvCleanupPrepared = true
  }
  /**
   * The barrier for the callers that can yield: \`__prepareEnvCleanup\` with real
   * event-loop turns in the middle.
   *
   * \`napi_prepare_wasm_env_cleanup\` waits — it returns only once the addon's
   * async runtime has quiesced, and the work it waits for can itself be waiting
   * for a JavaScript turn from this thread. The addon's two-phase form splits
   * that: \`…_begin\` stops the runtime without joining and reports whether
   * anything is still live, \`napi_wasm_runtime_work_pending\` answers that again
   * without blocking, and \`…_finish\` joins.
   *
   * The poll is unbounded — see \`__pollWasmRuntimeWork\` — but a caller that
   * cannot yield closes the handshake itself rather than waiting for it, so
   * \`…_finish\` still runs on every teardown path. Feature-detected like every
   * other export here, and returns nothing whenever the handshake finished
   * without yielding.
   */
  const __prepareEnvCleanupWithTurns = () => {
    if (__wasmEnvCleanupPrepared || __wasmEnvCleanupPreparing) {
      return
    }
    const __exports = __napiInstance?.exports
    const __begin = __exports?.napi_prepare_wasm_env_cleanup_begin
    const __finish = __exports?.napi_prepare_wasm_env_cleanup_finish
    if (typeof __begin !== 'function' || typeof __finish !== 'function') {
      // No split to use. The settlement drain still follows this, so the queue
      // the single call leaves behind is expected rather than lost.
      __wasmEnvCleanupYielding = true
      try {
        __prepareEnvCleanup()
      } finally {
        __wasmEnvCleanupYielding = false
      }
      return
    }
    const __workPending = __exports?.napi_wasm_runtime_work_pending
    // The in-flight flag stays raised across the turns below, so a \`destroy()\`
    // from one of the JavaScript handlers they run is the same no-op it is
    // inside the single call: the barrier is up and the runtime is
    // mid-teardown, and destroying between the halves would strand exactly what
    // this delivers.
    __wasmEnvCleanupPreparing = true
    let __live
    try {
      __live = __begin()
    } catch (__error) {
      __wasmEnvCleanupPreparing = false
      throw __error
    }
    __wasmEnvCleanupRan = true
    const __finishEnvCleanup = () => {
      if (__wasmEnvCleanupPrepared) {
        // Already closed by a caller that could not yield. \`…_finish\` is
        // idempotent, but the flags it lowers are not.
        return
      }
      __finishParkedEnvCleanup = undefined
      try {
        __finish()
      } finally {
        __wasmEnvCleanupPreparing = false
      }
      __wasmEnvCleanupPrepared = true
    }
    if (!__live || typeof __workPending !== 'function') {
      __finishEnvCleanup()
      return
    }
    // Publish the closer before yielding: from here until \`__finishEnvCleanup\`
    // runs, a caller that cannot yield is entitled to end this handshake.
    __finishParkedEnvCleanup = __finishEnvCleanup
    return __pollWasmRuntimeWork(__workPending).then(
      __finishEnvCleanup,
      __finishEnvCleanup,
    )
  }
  // The barrier + settlement drain, hoisted out of the context destroyer so the
  // drain can yield without widening the destroyer's reentry window. Both
  // yielding paths run it — dispose() and the initialization-failure rollback.
  // The destroyer still runs the barrier itself (idempotently) for the one path
  // that cannot yield: managed beforeExit cleanup of an instance whose rollback
  // is being retried.
  //
  // "Drained" is recorded only once a wait has actually finished. Scheduling a
  // macrotask can fail — a host-provided or patched \`setImmediate\` that throws
  // is enough — and dispose() stays retryable after it rejects, so marking the
  // drain complete up front would make the retry skip it and destroy the context
  // with the barrier's settlements still queued.
  const __drainAfterEnvCleanup = () => {
    if (!__wasmEnvCleanupRan) {
      return
    }
    const __drained = __drainWasmEnvCleanup(__napiInstance)
    if (!__drained || typeof __drained.then !== 'function') {
      __wasmEnvCleanupDrained = true
      return
    }
    return __drained.then((__value) => {
      __wasmEnvCleanupDrained = true
      return __value
    })
  }
  const __prepareForDisposal = () => {
    if (__wasmEnvCleanupDrained) {
      return
    }
    if (__wasmEnvCleanupDrainPromise) {
      return __wasmEnvCleanupDrainPromise
    }
    // The barrier itself can yield now, so the memo below has to cover it too:
    // a reentrant caller must join this handshake rather than start a second
    // one while the first is parked between the two halves.
    const __prepared = __prepareEnvCleanupWithTurns()
    const __settled =
      __prepared && typeof __prepared.then === 'function'
        ? __prepared.then(__drainAfterEnvCleanup)
        : __drainAfterEnvCleanup()
    if (!__settled || typeof __settled.then !== 'function') {
      return
    }
    const __tracked = __settled.then(
      (__value) => {
        __wasmEnvCleanupDrainPromise = undefined
        return __value
      },
      (__error) => {
        __wasmEnvCleanupDrainPromise = undefined
        throw __error
      },
    )
    __wasmEnvCleanupDrainPromise = __tracked
    return __tracked
  }
  let __disposed = false
  const __runInstanceDisposal = async () => {
    if (__lifecycleState !== 'failed') {
      __lifecycleState = 'disposal'
    }
    // Outstanding async work first, while the environment is still completely
    // live: its completion callbacks run addon code, and the barrier and
    // \`Context.destroy()\` below each take that away. Undefined unless work is
    // outstanding.
    const __asyncWorkDrained = __drainInstanceAsyncWork(__napiInstance)
    if (__asyncWorkDrained) {
      await __asyncWorkDrained
    }
    // Then settle what the barrier cancelled, before the environment stops
    // accepting JavaScript calls. Undefined unless something is queued, so
    // an idle disposal is not delayed by a single turn.
    const __drained = __prepareForDisposal()
    if (__drained) {
      await __drained
    }
    const __result = await (__beforeExitDestroy
      ? __destroyManagedOwnedContext()
      : __destroyOwnedContext())
    // Only a completed destroy retires the instance; a throw above leaves
    // the counter untouched so a retried dispose() cannot double-decrement.
    if (!__disposed) {
      __disposed = true
      __liveInstances -= 1
    }
    return __result
  }
  let __instanceDisposePromise
  /**
   * The disposal frame runs the barrier, and the barrier settles the promises it
   * cancels synchronously — so a promise hook firing inside it can call this
   * same instance's dispose() again while the first call is still in its drain.
   * That nested call finds the barrier flagged in flight, prepares nothing,
   * drains nothing, and falls straight through to the context destroyer, whose
   * \`Context.destroy()\` hits the wrapper's in-flight no-op. It would record a
   * destruction that never happened, and the outer frame would then skip the
   * real one: both disposals resolve, no cleanup hook runs, the context stays
   * retained.
   *
   * Memoize before any of that starts, exactly like the eager loaders'
   * \`__disposeWasiBinding\`, so there is only ever one disposal frame per
   * instance and a reentrant caller awaits it instead of racing it. Cleared on
   * rejection: a drain that failed has to stay retryable.
   */
  const __disposeInstance = () => {
    if (__instanceDisposePromise) {
      return __instanceDisposePromise
    }
    let __resolveDispose
    let __rejectDispose
    const __disposePromise = new Promise((__resolve, __reject) => {
      __resolveDispose = __resolve
      __rejectDispose = __reject
    })
    __instanceDisposePromise = __disposePromise
    __runInstanceDisposal().then(__resolveDispose, (__error) => {
      __instanceDisposePromise = undefined
      __rejectDispose(__error)
    })
    return __disposePromise
  }
  const __destroyBeforeExit = __beforeExitDestroy
    ? async () => {
        if (__lifecycleState === 'failed') {
          await __destroyManagedOwnedContext()
          return
        }
        __lifecycleState = 'disposal'
        try {
          await __beforeExitDestroy()
        } catch (error) {
          if (__lifecycleState !== 'failed') {
            throw error
          }
          // The singleton's initialization rejection is already observable
          // through instantiate() and dispose(). Managed beforeExit cleanup
          // owns only context destruction, including retrying a failed rollback.
          await __destroyManagedOwnedContext()
        }
      }
    : undefined
  const {
    context: __emnapiContext,
    destroy,
    destroyForModuleLifecycle,
    registerCleanup: __registerCleanup,
  } = await __createManagedEmnapiContext(
    __prepareEnvCleanup,
    __isPreparingEnvCleanup,
${managedHostDisposeArg}  )
  __destroyEmnapiContext = destroy
  __destroyOwnedContext = () => __destroyEmnapiContext()
  __destroyManagedOwnedContext = destroyForModuleLifecycle
  try {
    if (__destroyBeforeExit) {
      __onManagedDestroyer(__destroyBeforeExit)
      await __registerCleanup(__destroyBeforeExit)
    }
${emnapiInjectBuffer}\
    let __napiModule
    ;({
      instance: __napiInstance,
      napiModule: __napiModule,
    } = await __emnapiInstantiateNapiModule(__emnapiModule, {
      context: __emnapiContext,
      asyncWorkPoolSize: 0,
      plugins: [__emnapiAsyncWorkPlugin, __emnapiTSFNPlugin],
      wasi: __wasi,
      overwriteImports(importObject) {
        importObject.env = {
          ...importObject.env,
          ...importObject.napi,
          ...importObject.emnapi,
          memory: __wasmMemory,
        }
        return importObject
      },
      beforeInit({ instance }) {
        __napiInstance = instance
        for (const name of Object.keys(instance.exports)) {
          if (name.startsWith('__napi_register__')) {
            instance.exports[name]()
          }
        }
      },
    }))
${installInstanceHosts}\
    // \`instantiate()\` and \`createInstance().exports\` hand out this object; a
    // named module export does not travel with it. After the instance host
    // install, which hands the same object to addon-provided registration
    // functions that may put anything on it, and inside this \`try\`, so a
    // claimed name flips \`__lifecycleState\` to 'failed' and tears the instance
    // down rather than escaping a half-built one.
    ${NAPI_BINDING_TARGET_STAMP_FN}(__napiModule.exports, __napiBindingTarget)
    if (__lifecycleState === 'pending') {
      __lifecycleState = 'succeeded'
    }
    __createdInstances += 1
    __liveInstances += 1
    return {
      exports: __napiModule.exports,
      get memory() {
        return __wasmMemory
      },
      get memoryBytes() {
        // The Memory outlives the environment, so this stays readable after a
        // FAILED dispose() (which leaves the instance undisposed and
        // retryable). It reports 0 only once disposal has actually completed.
        return __disposed ? 0 : __wasmMemory.buffer.byteLength
      },
      get disposed() {
        return __disposed
      },
      dispose: __disposeInstance,
    }
  } catch (error) {
    __lifecycleState = 'failed'
    // Instantiation can fail *after* registration has run, and registration runs
    // with a live environment: a module-init hook can start async work and then
    // return an error, and the promise it created may already have escaped into
    // JavaScript. Settle what the barrier cancels before the context is
    // destroyed, exactly like dispose() does; destroying without yielding
    // discards the queue with a null env. Undefined unless something is queued,
    // so a failure before beforeInit costs no extra turn.
    let __settlementsUnreached = false
    try {
      // Registration can start async work too, and this path destroys the same
      // environment its completions need. A drain that cannot finish leaves the
      // work outstanding, so it counts as settlements unreached and stops the
      // rollback short of destroying, exactly like a failed barrier drain.
      const __asyncWorkDrained = __drainInstanceAsyncWork(__napiInstance)
      if (__asyncWorkDrained) {
        await __asyncWorkDrained
      }
      const __drained = __prepareForDisposal()
      if (__drained) {
        await __drained
      }
    } catch (drainError) {
      __attachCleanupError(error, drainError)
      __settlementsUnreached = true
    }
    let __registrationError
    let __registrationFailed = false
    if (!__beforeExitDestroy) {
      try {
        // Independent instances are caller-owned while pending and after
        // success. Register only failed rollback so cleanup remains retryable.
        await __registerCleanup()
      } catch (registrationError) {
        __attachCleanupError(error, registrationError)
        __registrationError = registrationError
        __registrationFailed = true
      }
    }
    if (__settlementsUnreached) {
      // The barrier or the drain did not finish, so the settlements it queued
      // are still in the threadsafe-function queue. Destroying now runs the
      // cleanup hook that drains that queue with a null env and discards it,
      // stranding a promise that already escaped into JavaScript — with nothing
      // left that could ever settle it. dispose() refuses to destroy for exactly
      // this reason (a rejected drain there never reaches the destroy), so this
      // path refuses too.
      //
      // Nothing leaks. The registration just above — and, for the singleton, the
      // one made before instantiation — leaves this context in
      // \`__managedEmnapiContextDestroyers\`, so beforeExit destroys it and
      // dispose() can retry it. Only the destruction is deferred, and the turns
      // that pass in the meantime are exactly what the queue needed.
      try {
        __registerManagedBeforeExitListener()
      } catch {}
      throw error
    }
    try {
      await __destroyManagedOwnedContext()
    } catch (disposeError) {
      // Initialization is the primary failure. Preserve it even if cleanup
      // also fails, while retaining the cleanup error when the value is
      // extensible and has no existing cause.
      __attachCleanupError(
        __registrationFailed ? __registrationError : error,
        disposeError,
      )
      try {
        __registerManagedBeforeExitListener()
      } catch {}
    }
    throw error
  }
}

/**
 * Create an independent instance. Call and await dispose() when the instance
 * is no longer needed so emnapi cleanup hooks run deterministically.
 *
 * The optional second argument selects this instance's linear memory: either
 * \`memory\` (an unshared, single-use WebAssembly.Memory you allocated) or
 * \`initialMemoryPages\` / \`maximumMemoryPages\`, never both. Omitted, the
 * loader allocates WASM_MEMORY.initialPages..WASM_MEMORY.maximumPages.
 *
 * A provided Memory must come from this loader's own realm: the WASI and
 * emnapi layers underneath identify one with a realm-local \`instanceof\`, so a
 * Memory built in a \`node:vm\` context or another frame is rejected. Every
 * Memory an instance runs on is single-use, the loader-allocated one included:
 * \`instance.memory\` cannot be recycled into a second \`createInstance()\`.
 */
export async function createInstance(__wasmInput, __options) {
  return __createInstance(__wasmInput, __options)
}

let __defaultModulePromise
let __defaultInstancePromise
let __defaultDisposePromise
let __defaultDisposalStarted = false
const __defaultManagedDestroyers = new WeakMap()
let __moduleDisposePromise

/**
 * Instantiate a module-local singleton. Concurrent and repeated calls
 * with the same module share one instance and one Memory allocation.
 */
export function instantiate(__wasmInput) {
  const __modulePromise = __resolveModule(__wasmInput)
  if (__moduleLifecycleDestroyDepth !== 0) {
    void __modulePromise.catch(() => {})
    return Promise.reject(__createLifecycleReentryError('instantiate'))
  }
  if (__moduleDisposePromise) {
    void __modulePromise.catch(() => {})
    return __moduleDisposePromise.then(() => instantiate(__modulePromise))
  }
  if (__defaultDisposalStarted) {
    // Observe rejected input immediately, but preserve lifecycle ordering and
    // error precedence by instantiating only after disposal succeeds. A failed
    // disposal retains the old instance only so its cleanup can be retried.
    void __modulePromise.catch(() => {})
    const __disposePromise = __defaultDisposePromise ?? dispose()
    return __disposePromise.then(() => instantiate(__modulePromise))
  }
  if (!__defaultInstancePromise) {
    __defaultModulePromise = __modulePromise
    const __instancePromise = __modulePromise.then((__module) =>
      __createInstance(
        __module,
        undefined,
        __disposeDefaultInstance,
        (__managedDestroyer) => {
          __defaultManagedDestroyers.set(
            __instancePromise,
            __managedDestroyer,
          )
        },
      ),
    )
    __defaultInstancePromise = __instancePromise
    void __instancePromise.catch(() => {
      if (__defaultInstancePromise === __instancePromise) {
        __defaultInstancePromise = undefined
        __defaultModulePromise = undefined
      }
    })
    return __instancePromise.then((__instance) => __instance.exports)
  }
  const __defaultModulePromiseForCall = __defaultModulePromise
  const __defaultInstancePromiseForCall = __defaultInstancePromise
  return Promise.all([__defaultModulePromiseForCall, __modulePromise]).then(
    async ([__defaultModule, __module]) => {
      if (__defaultModule !== __module) {
        throw new Error(
          'instantiate() already owns a different WebAssembly.Module; call dispose() first or use createInstance() for independent instances.',
        )
      }
      return (await __defaultInstancePromiseForCall).exports
    },
  )
}

async function __disposeDefaultInstance(__onDestroy) {
  if (__defaultDisposePromise) {
    return __defaultDisposePromise
  }
  const __instancePromise = __defaultInstancePromise
  if (!__instancePromise) {
    __defaultDisposalStarted = false
    return
  }
  __defaultDisposalStarted = true
  const __disposePromise = (async () => {
    let __instance
    try {
      __instance = await __instancePromise
    } catch (error) {
      const __managedDestroyer =
        __defaultManagedDestroyers.get(__instancePromise)
      if (__managedDestroyer) {
        __onDestroy?.(__managedDestroyer)
      }
      __defaultManagedDestroyers.delete(__instancePromise)
      throw error
    }
    const __managedDestroyer =
      __defaultManagedDestroyers.get(__instancePromise)
    if (__managedDestroyer) {
      __onDestroy?.(__managedDestroyer)
    }
    await __instance.dispose()
    if (__defaultInstancePromise === __instancePromise) {
      __defaultInstancePromise = undefined
      __defaultModulePromise = undefined
      __defaultDisposalStarted = false
    }
    __defaultManagedDestroyers.delete(__instancePromise)
  })()
  __defaultDisposePromise = __disposePromise
  try {
    await __disposePromise
  } finally {
    if (__defaultDisposePromise === __disposePromise) {
      __defaultDisposePromise = undefined
    }
  }
}

async function __dispose() {
  let __defaultDisposeError
  let __defaultDisposeFailed = false
  let __attemptedDefaultDestroyer
  try {
    await __disposeDefaultInstance((__destroyer) => {
      __attemptedDefaultDestroyer = __destroyer
    })
  } catch (error) {
    __defaultDisposeError = error
    __defaultDisposeFailed = true
  }
  const __excludedDestroyers = new Set()
  if (__defaultDisposeFailed && __attemptedDefaultDestroyer) {
    __excludedDestroyers.add(__attemptedDefaultDestroyer)
  }
  try {
    await __drainManagedEmnapiContexts(__excludedDestroyers)
  } catch (error) {
    if (!__defaultDisposeFailed) {
      throw error
    }
    if (error !== __defaultDisposeError) {
      __attachCleanupError(__defaultDisposeError, error)
    }
  }
  if (__defaultDisposeFailed) {
    throw __defaultDisposeError
  }
}

/**
 * Dispose the singleton created by instantiate(). A later call may create a
 * fresh instance, including from a different module. This also retries cleanup
 * retained after a failed initialization rollback.
 */
export function dispose() {
  if (__moduleLifecycleDestroyDepth !== 0) {
    return Promise.reject(__createLifecycleReentryError('dispose'))
  }
  if (__moduleDisposePromise) {
    return __moduleDisposePromise
  }
  let __resolveDispose
  let __rejectDispose
  const __promise = new Promise((resolve, reject) => {
    __resolveDispose = resolve
    __rejectDispose = reject
  })
  __moduleDisposePromise = __promise
  void __dispose().then(__resolveDispose, __rejectDispose)
  void __promise.then(
    () => {
      if (__moduleDisposePromise === __promise) {
        __moduleDisposePromise = undefined
      }
    },
    () => {
      if (__moduleDisposePromise === __promise) {
        __moduleDisposePromise = undefined
      }
    },
  )
  return __promise
}
`
}

export const createWasiDeferredBrowserBindingTypeDef = (
  packageName: string,
  platformArchABI = 'wasm32-wasip1',
) => `export type WasiBinding = typeof import('${packageName}')

export type WasiModuleInput =
  | WebAssembly.Module
  | PromiseLike<WebAssembly.Module>

/** Run the instance on a linear memory the caller allocated. */
export interface WasiCallerMemoryOptions {
  /**
   * A caller-allocated linear memory for this instance. It must be unshared
   * and created in this loader's own realm — the WASI and emnapi layers
   * underneath identify a Memory with a realm-local \`instanceof\`, so one from
   * a \`node:vm\` context or another frame is rejected. It is single-use: once
   * a validated initialization attempt has begun, the same Memory cannot be
   * passed again — including after that attempt failed, and after the instance
   * was disposed.
   */
  memory: WebAssembly.Memory
  /** Not available beside \`memory\`: the loader allocates neither. */
  initialMemoryPages?: never
  /** Not available beside \`memory\`: the loader allocates neither. */
  maximumMemoryPages?: never
}

/** Let the loader allocate the linear memory, optionally sized. */
export interface WasiAllocatedMemoryOptions {
  /** Not available beside the page counts: they size the loader's own Memory. */
  memory?: never
  /** @default WASM_MEMORY.initialPages */
  initialMemoryPages?: number
  /** @default WASM_MEMORY.maximumPages */
  maximumMemoryPages?: number
}

/**
 * Either memory form, never a mix of the two: the loader throws a TypeError
 * on \`memory\` beside a page count. \`{}\` and an omitted argument select the
 * loader defaults.
 */
export type WasiInstanceOptions =
  | WasiCallerMemoryOptions
  | WasiAllocatedMemoryOptions

export interface WasiRuntimeStats {
  /** Instances created by this evaluated loader module, not process-wide. */
  createdInstances: number
  /** Created instances whose dispose() has not completed. */
  liveInstances: number
  /** Declared initial address space, not committed memory. */
  declaredInitialMemoryBytes: number
}

export interface WasiInstance {
  readonly exports: WasiBinding
  /** This instance's linear memory. Claimed, so it cannot start another one. */
  readonly memory: WebAssembly.Memory
  /** Current linear-memory size; 0 once dispose() has completed. */
  readonly memoryBytes: number
  readonly disposed: boolean
  dispose(): Promise<void>
}

/** The memory descriptor compiled into this loader. */
export const WASM_MEMORY: Readonly<{
  initialPages: number
  maximumPages: number
  pageBytes: number
  initialBytes: number
  maximumBytes: number
}>

export function getDeferredRuntimeStats(): Readonly<WasiRuntimeStats>

export function instantiate(wasmInput: WasiModuleInput): Promise<WasiBinding>
export function createInstance(
  wasmInput: WasiModuleInput,
  options?: WasiInstanceOptions,
): Promise<WasiInstance>
/** Dispose the singleton and retry retained failed-initialization cleanup. */
export function dispose(): Promise<void>

/** The WASI flavor this deferred loader instantiates. */
export declare const __napiBindingTarget: '${platformArchABI}'
`

export const createWasiBinding = (
  wasmFileName: string,
  packageName: string,
  initialMemory = 4000,
  maximumMemory = 65536,
  threads = true,
  // `platformArchABI` of the flavor this loader belongs to; the fallback
  // package (`<packageName>-<platformArchABI>`) must ship the same flavor's
  // wasm artifact.
  platformArchABI = 'wasm32-wasi',
  packageWasmFileName = wasmFileName,
  asyncRuntime = false,
) => {
  const asyncRuntimeImport = asyncRuntime
    ? `const {
  installCurrentThreadHosts: __installCurrentThreadHosts,
} = require('@napi-rs/async-runtime')
`
    : ''
  const installAsyncRuntimeHosts = asyncRuntime
    ? `  __currentThreadHostsDisposer = __installCurrentThreadHosts(
    __napiModule.exports,
  )
`
    : ''
  const workerImports = threads
    ? `const { Worker } = require('node:worker_threads')
`
    : ''
  const workerExecArgv = threads
    ? `
function __getWasiWorkerExecArgv() {
  const __workerExecArgv = []
  for (let __index = 0; __index < process.execArgv.length; __index += 1) {
    const __arg = process.execArgv[__index]
    if (
      __arg === '--input-type' ||
      __arg === '--eval' ||
      __arg === '-e' ||
      __arg === '--print' ||
      __arg === '-p'
    ) {
      __index += 1
      continue
    }
    if (
      __arg.startsWith('--input-type=') ||
      __arg.startsWith('--eval=') ||
      __arg.startsWith('--print=')
    ) {
      continue
    }
    __workerExecArgv.push(__arg)
  }
  return __workerExecArgv
}

function __isInvalidWasiWorkerExecArgv(errorMessage, argument) {
  const __equalsIndex = argument.indexOf('=')
  const __argumentName =
    __equalsIndex === -1 ? argument : argument.slice(0, __equalsIndex)
  return (
    errorMessage.includes(': ' + __argumentName + ',') ||
    errorMessage.includes(': ' + __argumentName + '=') ||
    errorMessage.endsWith(': ' + __argumentName) ||
    errorMessage.includes(', ' + __argumentName + ',') ||
    errorMessage.includes(', ' + __argumentName + '=') ||
    errorMessage.endsWith(', ' + __argumentName)
  )
}

function __removeInvalidWasiWorkerExecArgv(execArgv, error) {
  if (typeof error.message !== 'string') {
    return
  }
  const __workerExecArgv = []
  let __removed = false
  for (let __index = 0; __index < execArgv.length; __index += 1) {
    const __arg = execArgv[__index]
    if (
      __arg.startsWith('-') &&
      __isInvalidWasiWorkerExecArgv(error.message, __arg)
    ) {
      __removed = true
      if (
        !__arg.includes('=') &&
        __index + 1 < execArgv.length &&
        !execArgv[__index + 1].startsWith('-')
      ) {
        __index += 1
      }
      continue
    }
    __workerExecArgv.push(__arg)
  }
  return __removed ? __workerExecArgv : undefined
}

function __createWasiWorker(filename) {
  let __workerExecArgv = __getWasiWorkerExecArgv()
  while (true) {
    try {
      return new Worker(filename, {
        env: process.env,
        execArgv: __workerExecArgv,
        workerData: { hostRoot: __hostRoot, rootDir: __rootDir },
      })
    } catch (error) {
      if (!error || error.code !== 'ERR_WORKER_INVALID_EXEC_ARGV') {
        throw error
      }
      const __nextWorkerExecArgv =
        __removeInvalidWasiWorkerExecArgv(__workerExecArgv, error)
      if (!__nextWorkerExecArgv) {
        throw error
      }
      __workerExecArgv = __nextWorkerExecArgv
    }
  }
}
`
    : ''
  const workerRuntimeImport = threads
    ? `  createOnMessage: __wasmCreateOnMessageForFsProxy,\n`
    : ''
  const memoryName = threads ? '__sharedMemory' : '__wasmMemory'
  const asyncWorkOptions = threads
    ? `    asyncWorkPoolSize: (function () {
      const threadsSizeFromEnv = Number(process.env.NAPI_RS_ASYNC_WORK_POOL_SIZE ?? process.env.UV_THREADPOOL_SIZE)
      // NaN > 0 is false
      if (threadsSizeFromEnv > 0) {
        return threadsSizeFromEnv
      } else {
        return 4
      }
    })(),
    reuseWorker: true,
    plugins: [
      __captureWasiThreadManager,
      __emnapiAsyncWorkPlugin,
      __emnapiTSFNPlugin,
    ],
`
    : `    asyncWorkPoolSize: 0,
    plugins: [
      __captureWasiThreadManager,
      __emnapiAsyncWorkPlugin,
      __emnapiTSFNPlugin,
    ],
`
  // Which archive a build links decides who implements async work and
  // threadsafe functions — see `emnapi_link_library` in
  // `crates/build/src/wasi.rs`. Without threads it is `emnapi-basic-napi-rs`,
  // the "basic" model: both stay wasm imports, and the `@emnapi/core`
  // JavaScript plugins below are what resolves them; without the plugins
  // instantiation fails with a LinkError naming the missing import. With
  // threads it is `emnapi-napi-rs-mt`, the full composition, whose C
  // `async_work.c` / `threadsafe_function.c` run on the uv threadpool inside
  // the wasm — it imports none of those symbols, so the plugins are inert
  // there. They are passed in both modes because only the archive knows which
  // applies, and a plugin nothing imports costs nothing.
  //
  // This is why the async-work drain on the disposal path cannot live here:
  // with threads there is no JavaScript seam at all, so `__drainWasiAsyncWork`
  // asks the addon instead.
  const emnapiPluginRequire = `  emnapiAsyncWorkPlugin: __emnapiAsyncWorkPlugin,\n  emnapiTSFNPlugin: __emnapiTSFNPlugin,\n`
  const workerOption = threads
    ? `    onCreateWorker() {
      const worker = __createWasiWorker(__nodePath.join(__dirname, 'wasi-worker.mjs'))
      __wasiWorkers.add(worker)
      worker.onmessage = ({ data }) => {
        __wasmCreateOnMessageForFsProxy(__nodeFs)(data)
      }

      // The main thread of Node.js waits for all the active handles before exiting.
      // But Rust threads are never waited without \`thread::join\`.
      // So here we hack the code of Node.js to prevent the workers from being referenced (active).
      // According to https://github.com/nodejs/node/blob/19e0d472728c79d418b74bddff588bea70a403d0/lib/internal/worker.js#L415,
      // a worker is consist of two handles: kPublicPort and kHandle.
      {
        const kPublicPort = Object.getOwnPropertySymbols(worker).find((s) =>
          s.toString().includes('kPublicPort'),
        )
        if (kPublicPort) {
          worker[kPublicPort].ref = () => {}
        }

        const kHandle = Object.getOwnPropertySymbols(worker).find((s) =>
          s.toString().includes('kHandle'),
        )
        if (kHandle) {
          worker[kHandle].ref = () => {}
        }

        worker.unref()
        // These stubs stay in place for the worker's whole life, disposal
        // included: \`__keepEventLoopAliveUntil\` is what holds the process open
        // while a termination is pending, precisely because a worker's own
        // references cannot be relied on for it.
      }
      return worker
    },
`
    : ''

  return `/* eslint-disable */
/* auto-generated by NAPI-RS */

const __napiBindingTarget = '${platformArchABI}'
${BINDING_TARGET_STAMP_HELPER}

const __nodeFs = require('node:fs')
const __nodePath = require('node:path')
const { WASI: __nodeWASI } = require('node:wasi')
${workerImports}\

const {
${emnapiPluginRequire}\
${workerRuntimeImport}\
  instantiateNapiModuleSync: __emnapiInstantiateNapiModuleSync,
} = require('@napi-rs/wasm-runtime')
const { createContext: __emnapiCreateContext } = require('@emnapi/runtime')
${asyncRuntimeImport}\
${workerExecArgv}\

const __cwd = process.cwd()
const __rootDir = __nodePath.parse(__cwd).root
const __hostRoot =
  process.platform === 'android' ? __cwd : __rootDir

const __wasi = new __nodeWASI({
  version: 'preview1',
  env: process.env,
  preopens: {
    [__rootDir]: __hostRoot,
    [__hostRoot]: __hostRoot,
  },
})

const ${memoryName} = new WebAssembly.Memory({
  initial: ${initialMemory},
  maximum: ${maximumMemory},
${threads ? '  shared: true,\n' : ''}\
})

let __wasmFilePath = __nodePath.join(__dirname, '${wasmFileName}.wasm')
const __wasmDebugFilePath = __nodePath.join(__dirname, '${wasmFileName}.debug.wasm')

if (__nodeFs.existsSync(__wasmDebugFilePath)) {
  __wasmFilePath = __wasmDebugFilePath
} else if (!__nodeFs.existsSync(__wasmFilePath)) {
  const __wasiPackageEntry = require.resolve('${packageName}-${platformArchABI}')
  const __packagedWasmFilePath = __nodePath.join(
    __nodePath.dirname(__wasiPackageEntry),
    '${packageWasmFileName}.wasm',
  )
  if (!__nodeFs.existsSync(__packagedWasmFilePath)) {
    throw new Error(
      '${packageName}-${platformArchABI} is installed but is missing ${packageWasmFileName}.wasm.',
    )
  }
  __wasmFilePath = __packagedWasmFilePath
}

const __wasmFile = __nodeFs.readFileSync(__wasmFilePath)
let __emnapiContext
${createEmnapiContextLifecycle(asyncRuntime)}
const __wasiRollbackRegistrySymbol = Symbol.for('${WASI_ROLLBACK_REGISTRY_SYMBOL}')
const __wasiRollbackRegistryKey =
  typeof __filename === 'string' ? __filename : __wasmFilePath

function __getWasiRollbackRegistry() {
  const existing = process[__wasiRollbackRegistrySymbol]
  if (existing !== undefined) {
    if (!(existing instanceof Map)) {
      throw new TypeError(
        'The process-wide NAPI-RS WASI rollback registry is invalid',
      )
    }
    return existing
  }
  const registry = new Map()
  Object.defineProperty(process, __wasiRollbackRegistrySymbol, {
    configurable: false,
    enumerable: false,
    value: registry,
    writable: false,
  })
  return registry
}

const __wasiRollbackRegistry = __getWasiRollbackRegistry()

function __completeWasiInitializationRollback(record, cleanupErrors) {
  try {
    if (cleanupErrors.length === 0) {
      if (
        __wasiRollbackRegistry.get(__wasiRollbackRegistryKey) === record
      ) {
        __wasiRollbackRegistry.delete(__wasiRollbackRegistryKey)
      }
      return
    }
    record.error = __attachCleanupErrors(record.error, cleanupErrors)
  } catch (cleanupError) {
    try {
      record.error = __createCleanupError(
        [record.error, cleanupError],
        'WASI binding initialization and cleanup failed',
      )
    } catch {}
  } finally {
    record.active = false
    record.promise = undefined
  }
}

function __runWasiInitializationRollback(record) {
  if (record.active) {
    return
  }
  record.active = true

  let rollbackResult
  try {
    rollbackResult = record.rollback()
  } catch (cleanupError) {
    __completeWasiInitializationRollback(record, [cleanupError])
    return
  }

  if (!__isThenable(rollbackResult)) {
    __completeWasiInitializationRollback(record, rollbackResult)
    return
  }

  record.promise = Promise.resolve(rollbackResult).then(
    (cleanupErrors) => {
      __completeWasiInitializationRollback(record, cleanupErrors)
    },
    (cleanupError) => {
      __completeWasiInitializationRollback(record, [cleanupError])
    },
  )
}

const __pendingWasiRollback = __wasiRollbackRegistry.get(
  __wasiRollbackRegistryKey,
)
if (__pendingWasiRollback !== undefined) {
  __runWasiInitializationRollback(__pendingWasiRollback)
  throw __pendingWasiRollback.error
}

let __wasiModule
let __napiModule
let __wasiExitListenerRegistered = false

function __removeWasiExitListener() {
  if (
    __wasiExitListenerRegistered &&
    typeof process.removeListener === 'function'
  ) {
    process.removeListener('exit', __disposeWasiBindingAtExit)
  }
  __wasiExitListenerRegistered = false
}

function __disposeWasiBindingAtExit() {
  __wasiExitListenerRegistered = false
  // An 'exit' handler cannot yield, so it cannot wait for queued promise
  // settlements the way __startWasiDisposal does — the process is leaving and
  // those promises have no observer left anyway. Run the synchronous teardown
  // directly. Every step is idempotent, which also makes this the synchronous
  // finish for a disposal that is still waiting for its drain — and, through
  // __prepareWasmEnvCleanup, for one still parked between the two halves of
  // the environment cleanup barrier: there are no turns left to poll with, so
  // this closes that handshake with \`…_finish\`, which joins.
  try {
    __destroyEmnapiContext()
  } catch {}
  try {
    const workerResult = __terminateWasiWorkers()
    if (__isThenable(workerResult)) {
      void Promise.resolve(workerResult).catch(() => {})
    }
  } catch {}
}

function __registerWasiExitListener() {
  if (
    !__wasiExitListenerRegistered &&
    typeof process.once === 'function'
  ) {
    process.once('exit', __disposeWasiBindingAtExit)
    __wasiExitListenerRegistered = true
  }
}

__completeWasiDisposal = __removeWasiExitListener
// A rollback that could not reach the queued settlements keeps the context so
// the registry replay above can retry it. Nothing forces that replay to happen,
// so hand the context to the same synchronous teardown a successful load uses:
// a process that exits without ever retrying still runs the cleanup hooks. The
// handler cannot yield, so it does not settle anything — but by then the process
// is leaving and those promises have no observer left anyway.
__retainWasiRollbackForRetry = __registerWasiExitListener

function __captureEmnapiAutoDestroyListener() {
  if (
    typeof process.prependListener !== 'function' ||
    typeof process.removeListener !== 'function'
  ) {
    return
  }
  let __autoDestroyListener
  const __captureListener = (__event, __listener) => {
    if (__event === 'beforeExit' && __autoDestroyListener === undefined) {
      __autoDestroyListener = __listener
    }
  }
  try {
    // Run before existing newListener hooks so a hook that registers its own
    // beforeExit listener cannot be mistaken for emnapi's registration.
    process.prependListener('newListener', __captureListener)
  } catch {
    return
  }
  return () => {
    try {
      process.removeListener('newListener', __captureListener)
    } catch {}
    if (__autoDestroyListener !== undefined) {
      try {
        process.removeListener('beforeExit', __autoDestroyListener)
      } catch {}
    }
  }
}

try {
  const __finishAutoDestroyCapture = __captureEmnapiAutoDestroyListener()
  try {
    __emnapiContext = __wrapEmnapiContextDestroyForSettlement(
      __emnapiCreateContext({ autoDestroy: false }),
      __prepareWasmEnvCleanup,
      __isPreparingWasmEnvCleanup,
    )
    // emnapi 2.x still registers an unconditional once-listener for
    // beforeExit that auto-destroys the context, and suppressDestroy() only
    // neutralizes its callback without removing it. This loader owns cleanup
    // through its 'exit' listener, so emnapi's listener is captured and
    // removed; suppressDestroy() remains the safety net when removal fails.
    __emnapiContext.suppressDestroy()
  } finally {
    // Remove only the exact emnapi callback captured above.
    __finishAutoDestroyCapture?.()
  }

  ;({
    instance: __napiInstance,
    module: __wasiModule,
    napiModule: __napiModule,
  } = __emnapiInstantiateNapiModuleSync(__wasmFile, {
    context: __emnapiContext,
${asyncWorkOptions}\
    wasi: __wasi,
${workerOption}\
    overwriteImports(importObject) {
      importObject.env = {
        ...importObject.env,
        ...importObject.napi,
        ...importObject.emnapi,
        memory: ${memoryName},
      }
      return importObject
    },
    beforeInit({ instance }) {
      __napiInstance = instance
      for (const name of Object.keys(instance.exports)) {
        if (name.startsWith('__napi_register__')) {
          instance.exports[name]()
        }
      }
    },
  }))
  __publishWasiDispose(__napiModule.exports)
${installAsyncRuntimeHosts}\
  // The CommonJS tail below aliases \`__napiModule.exports\`; a named module
  // export does not travel with it, so carry the marker on the binding itself
  // too. Three things pin the stamp to exactly this spot:
  //   - inside this \`try\`, because the guard throws on a
  //     \`#[napi(module_exports)]\` hook that claimed the name, and only the
  //     catch below tears the environment — context, workers, exit listener —
  //     back down;
  //   - after the async runtime host install, which hands this same object to
  //     addon-provided registration functions that may put anything on it;
  //   - assigning onto the loader's own \`module.exports\`, which is still the
  //     original object here, so an addon accessor with a refusing setter is
  //     never written through. \`cjs-module-lexer\` — Node's CJS -> ESM named
  //     export detection — reads the static \`module.exports.<name> =\` either
  //     way, and the later \`module.exports = __napiModule.exports\` does not
  //     undo that.
  module.exports.${NAPI_BINDING_TARGET_EXPORT} = ${NAPI_BINDING_TARGET_STAMP_FN}(__napiModule.exports, __napiBindingTarget)
  __registerWasiExitListener()
} catch (error) {
  const rollback = {
    active: false,
    error,
    promise: undefined,
    rollback: __rollbackWasiInitialization,
  }
  __wasiRollbackRegistry.set(__wasiRollbackRegistryKey, rollback)
  __runWasiInitializationRollback(rollback)
  throw rollback.error
}
`
}
