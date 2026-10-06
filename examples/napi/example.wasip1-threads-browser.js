import {
  emnapiAsyncWorkPlugin as __emnapiAsyncWorkPlugin,
  emnapiTSFNPlugin as __emnapiTSFNPlugin,
  createOnMessage as __wasmCreateOnMessageForFsProxy,
  instantiateNapiModule as __emnapiInstantiateNapiModule,
  WASI as __WASI,
} from '@napi-rs/wasm-runtime'
import { createContext as __emnapiCreateContext } from '@emnapi/runtime'
import { memfs, Buffer } from '@napi-rs/wasm-runtime/fs'

export const __napiBindingTarget = 'wasm32-wasip1-threads'
function __napiStampBindingTarget(exportsObject, target) {
  if (
    Object.prototype.hasOwnProperty.call(exportsObject, '__napiBindingTarget')
  ) {
    if (exportsObject.__napiBindingTarget === target) {
      // Already ours: the root entry aliases the object it loaded, so a WASI
      // fallback candidate — or a `NAPI_RS_NATIVE_LIBRARY_PATH` override that
      // is a generated loader — arrives already stamped with this same value.
      return target
    }
    const error = new Error(
      '`__napiBindingTarget` is reserved by the generated binding loader, but the loaded binding already exports it. Rename the export, e.g. #[napi(js_name = "...")].',
    )
    error.code = 'ERR_NAPI_BINDING_TARGET_CONFLICT'
    throw error
  }
  if (!Object.isExtensible(exportsObject)) {
    // A `#[napi(module_exports)]` hook may seal or freeze this object
    // (`Object::seal` / `Object::freeze`). Reporting the artifact is metadata,
    // never a reason to fail an otherwise successful load, so the stamp is
    // skipped. What a consumer still sees then follows the entry point: the
    // browser and deferred loaders declare `__napiBindingTarget` at module
    // level and go on reporting it, while the CommonJS entries hand back this
    // very object as `module.exports`, so there the value is absent.
    return target
  }
  try {
    // [[Define]], not [[Set]]: an ordinary assignment walks the prototype
    // chain, so an inherited accessor could swallow the value or throw and
    // fail an otherwise successful load. The descriptor is what a successful
    // assignment would have produced.
    Object.defineProperty(exportsObject, '__napiBindingTarget', {
      configurable: true,
      enumerable: true,
      value: target,
      writable: true,
    })
  } catch {
    // Same rule as the non-extensible skip above: reporting the artifact is
    // metadata, never a reason to fail an otherwise successful load. An exotic
    // object (a Proxy whose defineProperty trap refuses) is skipped, not
    // thrown over.
  }
  // The CommonJS loaders assign this return value so `cjs-module-lexer` — and
  // therefore Node's CJS -> ESM named export detection — can see
  // `__napiBindingTarget` statically.
  return target
}

export const { fs: __fs, vol: __volume } = memfs()

const __wasi = new __WASI({
  version: 'preview1',
  fs: __fs,
  preopens: {
    '/': '/',
  },
})

const __wasmUrl = new URL('./example.wasm32-wasip1-threads.wasm', import.meta.url).href
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

if (typeof SharedArrayBuffer !== 'function') {
  throw new Error(
    'example.wasm32-wasip1-threads is the wasm32-wasip1-threads flavor of this binding and needs SharedArrayBuffer, which this page does not expose: threads require cross-origin isolation (Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp). Either serve those headers, or use the wasm32-wasip1 flavor when the package ships it: resolve the package with the "wasi-threadless" exports condition in your bundler, or import its "./wasm32-wasip1" subpath.',
  )
}

const __sharedMemory = new WebAssembly.Memory({
  initial: 16384,
  maximum: 65536,
  shared: true,
})
const __asyncWorkPoolSize = 4
const __workerPoolSize = Math.max(
  2,
  globalThis.navigator?.hardwareConcurrency ?? 4,
)

let __emnapiContext

const __wasiDisposeSymbol = Symbol.for('napi.rs.wasi.dispose')
const __wasiWorkers = new Set()
// The thread manager has to be reachable *before* anything that can throw
// during load or registration. Initialization can fail after the pool has
// already spawned workers, and the rollback still has to mark their
// terminations as expected — but `__napiModule` is assigned only when
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
// The closer for a barrier that is parked between `…_begin` and `…_finish`,
// set only while that window is open. `__emnapiWasmEnvCleanupPreparing` cannot
// tell those two apart on its own: it is raised both for a purely synchronous
// frame — which must not be re-entered, and which nothing outside it can
// finish — and across this window, which spans real event-loop turns, so a
// caller that cannot yield can land in the middle of one. That caller can close
// this window, because `…_finish` is idempotent and joins, which is exactly
// what the single call does. See `__prepareWasmEnvCleanup`.
let __finishParkedWasmEnvCleanup
// Raised while a caller that can still yield is driving the barrier, so the
// queue it leaves behind is expected rather than lost. See
// `__reportUnreachedWasmEnvSettlements`.
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
// `__rollbackWasiInitialization`.
let __retainWasiRollbackForRetry = function () {}

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
  // the last thing the process runs, and `Context.destroy()` takes the
  // environment away. Closing it here runs `…_finish`, which is the call that joins, so
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
 * turn — a raw `Context.destroy()`, the 'exit' teardown — and
 * `Context.destroy()` runs the threadsafe function's cleanup hook, which drains
 * that queue with a null env and discards it. The promises those settlements
 * were for then hang forever, silently.
 *
 * Loud, once, and never throwing: this runs from inside `Context.destroy()`,
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
          " queued promise settlement(s). Context.destroy() discards them, so those promises never settle. Dispose with binding[Symbol.for('napi.rs.wasi.dispose')]() instead: only it yields the event-loop turns the settlements need.",
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
// Arrivals it takes before the poll paces on the host's timers alone. One
// proves nothing: a timer armed before the host's timers stopped still fires.
const __WASM_RUNTIME_WORK_POLL_TRUSTED_ARRIVALS = 2
// How long a parked turn's own timer must already have been due before a
// backup that runs calls it dropped. Slack, not a deadline: a timer is due
// against the event loop's clock, which is read once per iteration, while
// these are `Date.now()` readings taken part-way through one, so the two
// drift apart by however long the loop has been inside the current iteration.
const __WASM_RUNTIME_WORK_POLL_STALL_MS = 50
// How long a backup itself waits. What is left of it after the slack and one
// interval — 149 ms — has to cover the *two* poll turns that can separate a
// parked turn from the last backup armed while the host's timers still
// worked, so the ceiling on a single turn is half of it. See the invariant on
// `__armWasmRuntimePollStallBackup`.
const __WASM_RUNTIME_WORK_POLL_BACKUP_MS = 200

/**
 * Pacing state for one runtime-work poll.
 *
 * Per poll, never per module: whether the host's timers arrive is not a
 * property of the module. A host can lose its timers between two disposals,
 * and in the deferred shape every instance shares this module — one healthy
 * instance must not disarm the fallback for the next one.
 */
function __createWasmRuntimePollPace() {
  return {
    // Timers armed by *this* poll that have actually arrived.
    arrivals: 0,
    // The turn waiting on a timer alone *right now* — undefined whenever no
    // turn is parked — and when that turn's own timer came due.
    settleTurn: undefined,
    turnTimerDueAt: 0,
  }
}

/**
 * The backup that ends a turn whose timer is never going to arrive.
 *
 * Once the poll paces on the timer alone it has nothing left to fall back on
 * if the host's timers stop mid-poll: the turn that armed the dead timer is
 * the turn that parks, and a parked poll schedules nothing that could notice.
 * So every turn arms one of these before it yields, and each one compares due
 * times instead of measuring how long the parked turn has been waiting.
 *
 * Invariant: a parked turn is ended by the newest backup that was armed while
 * the host's timers still worked, and a backup ends a turn only when that
 * turn's own timer was already due a whole window before the backup itself.
 * Neither half turns on how far apart the arms happen to fall — what bounds
 * the rescue is how far back that newest live backup is:
 *
 * - *Ends it.* Hosts run timers in due order, so a backup that runs while a
 *   turn due a whole window earlier is still parked proves that turn's timer
 *   was dropped rather than merely late. That same comparison is what leaves a
 *   healthy host alone: there the turn's timer has already run and cleared
 *   `settleTurn` before any backup due after it can look.
 * - *Two turns back, not one.* A turn that ended does not prove its own timer
 *   arrived: until `…_TRUSTED_ARRIVALS` is reached every turn arms both
 *   primitives and the macrotask wins, so such a turn can end with its own
 *   timer — and the backup armed one line before it — already dead. The
 *   arrival that then flips the poll onto the timer alone can itself be a
 *   timer armed before the host's timers died. So the turn that parks can sit
 *   two turns past the last live arm, and the newest live backup is due
 *   `…_BACKUP_MS` less *two* turn lengths after that turn's own timer.
 *   Arming on every turn is what holds it to two, rather than however far back
 *   a throttle last let one through.
 * - *Ceiling.* Coverage therefore holds while two consecutive poll turns fit
 *   inside `…_BACKUP_MS` less the slack and one interval: 149 ms, so 74 ms
 *   per turn (measured: a 74 ms turn is still rescued, a 75 ms one parks).
 *   Past that the turn stays parked and the disposal promise never settles.
 *   The bound is deliberate: reaching it takes a host that drops timers
 *   mid-poll *and* keeps every poll turn busy for more than 74 ms, and neither
 *   Node nor WebContainer — the hosts that run the threaded artifact — does
 *   the second.
 *
 * The poll then goes back to arming both primitives until two fresh arrivals
 * prove the timers again. A host that stops running the timers it has
 * *already* accepted leaves nothing to fire, and the disposal promise stays
 * pending rather than wedging the thread — the same outcome as a blocking
 * closure that never returns. Unreferenced wherever the host allows it: the
 * poll's own turn timers are what keep the loop alive, never these.
 */
function __armWasmRuntimePollStallBackup(pace) {
  const setTimer = globalThis.setTimeout
  if (typeof setTimer !== 'function') {
    // Nothing to back up: `__scheduleTimer` is on the macrotask channel
    // already, and that one cannot park.
    return
  }
  // Read before arming, so this never claims to be due earlier than the timer
  // actually is: a backup ends a turn only when it is provably due after it.
  const dueAt = Date.now() + __WASM_RUNTIME_WORK_POLL_BACKUP_MS
  let handle
  try {
    handle = setTimer(() => {
      const settleTurn = pace.settleTurn
      if (
        !settleTurn ||
        pace.turnTimerDueAt > dueAt - __WASM_RUNTIME_WORK_POLL_STALL_MS
      ) {
        // No turn is parked, or the parked one's timer came due too close to
        // this backup to call it dropped — it may still arrive, and the turn
        // that armed it armed a backup due a whole window after *that*.
        return
      }
      pace.arrivals = 0
      pace.settleTurn = undefined
      settleTurn()
    }, __WASM_RUNTIME_WORK_POLL_BACKUP_MS)
  } catch {
    return
  }
  if (handle && typeof handle.unref === 'function') {
    try {
      handle.unref()
    } catch {}
  }
}

/**
 * One turn of the runtime-work poll.
 *
 * `__scheduleTimer` falls back to the macrotask scheduler when `setTimeout` is
 * missing or throws, but not when it is present, returns a handle and never
 * fires — fake timers in a test suite that disposes from an `afterEach`, or a
 * host whose timers belong to an IO context that is already gone. That host
 * would park this poll forever, and the poll is unbounded, so nothing would
 * ever call `…_finish`.
 *
 * Arm both primitives until timers armed by this poll have arrived twice, and
 * let whichever lands first end the turn; the loser resolves nothing. A host
 * with working timers therefore pays the double arming for the first turn or
 * two — the macrotask wins the race, but the timers behind it still arrive and
 * are counted — and paces on the timer alone from then on, instead of spinning
 * the loop on a zero-delay queue. A host whose timers never arrive keeps both,
 * and the macrotask is what keeps the poll moving. A host whose timers stop
 * after proving themselves is caught by `__armWasmRuntimePollStallBackup`,
 * which ends the parked turn and puts this poll back on both.
 */
function __yieldWasmRuntimePollTurn(pace) {
  // Armed before the turn yields, and by every turn: what rescues a parked
  // turn has to have been armed while the host's timers still worked, and the
  // turn that parks is the one whose own timer is already dead.
  __armWasmRuntimePollStallBackup(pace)
  return new Promise((resolve) => {
    let settled = false
    const settle = () => {
      if (settled) {
        return
      }
      settled = true
      if (pace.settleTurn === settle) {
        // Nothing is parked any more: a backup running later must not read a
        // due time this turn has already answered.
        pace.settleTurn = undefined
      }
      resolve()
    }
    __scheduleTimer(() => {
      pace.arrivals++
      settle()
    }, __WASM_RUNTIME_WORK_POLL_INTERVAL_MS)
    // Read next to the arming it describes; see
    // `__armWasmRuntimePollStallBackup` for what the two due times mean.
    const turnTimerDueAt = Date.now() + __WASM_RUNTIME_WORK_POLL_INTERVAL_MS
    if (pace.arrivals < __WASM_RUNTIME_WORK_POLL_TRUSTED_ARRIVALS) {
      __scheduleMacrotask(settle)
      return
    }
    // Paced by the timer alone from here; the backup is what ends this turn if
    // the timer never arrives.
    pace.settleTurn = settle
    pace.turnTimerDueAt = turnTimerDueAt
  })
}

/**
 * The barrier for callers that can yield: `__prepareWasmEnvCleanup` with real
 * event-loop turns in the middle.
 *
 * `napi_prepare_wasm_env_cleanup` waits — it returns only once the addon's
 * async runtime has quiesced, and on `wasm32-wasip1-threads` the thread it
 * waits on is this one, the only thread that can give a running blocking
 * closure the JavaScript turn *it* is waiting for. A single call there can wait
 * for work that can never finish. The addon's two-phase form splits that:
 * `…_begin` stops the runtime without joining and reports whether anything is
 * still live, `napi_wasm_runtime_work_pending` answers that question again
 * without blocking, and `…_finish` joins. The turns yielded in between are the
 * entire point.
 *
 * The poll has no deadline, for the same reason the async-work drain below has
 * none: giving up means calling `…_finish`, which joins on this thread, and the
 * work it would join is the work that is waiting for a turn from this thread —
 * so a bound does not end the wait, it only moves it somewhere the JavaScript
 * thread can no longer be reached. A blocking closure that never returns keeps
 * the disposal promise pending instead, exactly as a task whose `execute` never
 * returns already keeps an *undisposed* process alive. The host contract is in
 * `crates/async-runtime/README.md`: a blocking closure must never wait on a
 * JavaScript turn. The process-exit path still blocks in `…_finish`, because it
 * has no turns left to give (see `__prepareWasmEnvCleanup`).
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
  // The in-flight flag stays raised across the turns below, so a `destroy()`
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
      // reached `__prepareWasmEnvCleanup` while this poll was parked. `…_finish`
      // is idempotent, but the flags it lowers are not: running it again here
      // would clear a `preparing` some later barrier had raised.
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
  // Publish the closer before yielding: from here until `finishCleanup` runs,
  // a caller that cannot yield is entitled to end this handshake itself.
  __finishParkedWasmEnvCleanup = finishCleanup
  return (async () => {
    // Unbounded, exactly like the async-work drain below. The wait ends when
    // the addon reports its runtime work finished; the turns spent here are
    // what let that happen at all.
    const pace = __createWasmRuntimePollPace()
    for (;;) {
      await __yieldWasmRuntimePollTurn(pace)
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
// disposal as retryable (`ERR_NAPI_WASI_CLEANUP_PENDING`) rather than
// destroying the context over a still-queued settlement — the wait stays
// bounded either way.
const __WASM_ENV_CLEANUP_DRAIN_TURNS = 128
// Without `napi_wasm_env_cleanup_pending` the queue is not observable. Fall
// back to the number of turns @emnapi/core needs to coalesce and dispatch a
// call made on this thread (two), plus a margin.
const __WASM_ENV_CLEANUP_BLIND_DRAIN_TURNS = 4

/**
 * `napi_prepare_wasm_env_cleanup` only *queues* the promise settlements of the
 * tasks it cancelled: `napi_call_threadsafe_function` appends to the
 * threadsafe-function queue, and @emnapi/core dispatches that queue from a
 * macrotask — two coalescing turns later, even for a call made on this very
 * thread. `Context.destroy()` then runs the threadsafe function's cleanup hook,
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
 * Scheduling a macrotask can fail — a host-provided or patched `setImmediate`
 * that throws is enough — and a disposal that rejects stays retryable, so
 * marking the drain complete up front would make the retry skip it and destroy
 * the context with the barrier's settlements still queued.
 *
 * A wait that runs out of turns with the counter still nonzero rejects with
 * `ERR_NAPI_WASI_CLEANUP_PENDING` for the same reason: at that point
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
      // Blind wait: without `napi_wasm_env_cleanup_pending` the bound IS the
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

  __prepareWasmEnvCleanup()
  if (__isPreparingWasmEnvCleanup()) {
    // Reached from inside the synchronous barrier — a promise hook one of the
    // settlements above ran, which is the reentrancy the destroy wrapper
    // exists for. `Context.destroy()` below would hit that wrapper's in-flight
    // no-op and answer `undefined`, and recording that as a completed destroy
    // is what makes the frame that *did* start the barrier skip the real one
    // afterwards, leaving the context retained with its cleanup hooks unrun.
    // Refuse instead: nothing is flagged, and that frame destroys for real the
    // moment it returns. The deferred loader carries the same backstop. A
    // parked handshake cannot get here — `__prepareWasmEnvCleanup` closes one
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
 * Holds the event loop open until `work` settles.
 *
 * Nothing else can: the pool workers are deliberately unreferenced so an idle
 * binding cannot keep a process alive, and referencing them again for the
 * termination does not hold either — emnapi unreferences a worker the moment it
 * reports `async-thread-ready`, which for a worker that was still starting
 * lands *after* the termination began. Without a handle of its own, an
 * `await dispose()` with nothing else pending exits the process with its
 * promise unsettled, and everything after the `await` is skipped.
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

// How often to re-read `napi_wasm_async_work_pending` while waiting. The wait
// ends when the addon reports zero, so this only decides how promptly disposal
// notices — not how long it waits.
const __WASI_ASYNC_WORK_POLL_INTERVAL_MS = 1

/**
 * Settles this addon's outstanding `napi_async_work` before the teardown that
 * would strand it.
 *
 * `napi_prepare_wasm_env_cleanup` does not cover async work, and nothing about
 * it is observable from JavaScript: the threadless archive resolves
 * `napi_*_async_work` through the `@emnapi/core` plugins, but the threaded one
 * links the C `async_work.c` on the uv threadpool, so there the wasm neither
 * imports nor exports those symbols and the only brackets a loader could watch
 * (`_emnapi_ctx_*_waiting_request_counter`) are shared with threadsafe
 * functions. The addon is the one place both flavors go through, so it answers
 * for both, through the same kind of handshake the settlement drain uses:
 *
 *   - `napi_wasm_cancel_pending_async_work()` cancels what no thread has
 *     started. Those completion callbacks run with `napi_cancelled`, which
 *     napi-rs turns into a promise rejected with an `AbortError`.
 *   - `napi_wasm_async_work_pending()` counts what is still owed a completion
 *     callback. Work already executing refuses cancellation and stays counted
 *     until it finishes normally — which it can, because this runs before the
 *     barrier, before `Context.destroy()` and before anything is terminated.
 *
 * Both exports are optional: an addon built against a napi crate that predates
 * them drains nothing and keeps the previous behavior, exactly as the
 * `napi_wasm_env_cleanup_pending` handshake degrades.
 *
 * Returns nothing when there is nothing outstanding, which keeps disposal
 * synchronous in the common case. The promise it returns otherwise never
 * rejects.
 *
 * The wait has no deadline, and that is the point: giving up would destroy the
 * environment with a completion callback still owed, which is the stranding
 * this exists to prevent. A task whose `execute` never returns already keeps an
 * *undisposed* process alive in exactly the same way, so disposal inherits that
 * rather than inventing a bound it cannot honor.
 *
 * Safe to call from inside a completion callback, which is reachable: settling
 * a task runs addon code that can re-enter JavaScript — a setter on the value
 * being handed back, a threadsafe-function callback — and that JavaScript can
 * call `dispose()`. Two things make it terminate rather than wait on itself:
 *
 *   - The addon keeps a work registered until its completion callback
 *     *finishes*, so the count read here is at least one and this takes the
 *     polling path instead of declaring the environment drained and tearing it
 *     down from inside the frame that is still settling a promise.
 *   - The poll is a timer, so it cannot run until the callback has returned to
 *     the host — by which time that work has left the registry. The count the
 *     next poll reads is the one taken after the callback finished.
 *
 * `__disposeWasiBinding` hands every caller the same in-flight promise, so the
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
 * `@emnapi/wasi-threads` counts a worker exit as expected only when its own
 * thread manager performed the termination. A bare `worker.terminate()` reaches
 * the manager's `exit` listener instead, which reports
 * `worker (tid = N) sent an error! ... stopped with exit code 1` and rethrows
 * inside the emit — aborting the `once('exit')` that backs the terminate
 * promise, so disposal never settles and the process dies with an uncaught
 * exception. Mark the termination through the manager first.
 *
 * The manager comes from `__getWasiThreadManager`, not from `__napiModule`:
 * the initialization rollback runs on the one path where instantiation never
 * returned, so `__napiModule` is still undefined there while the workers it
 * spawned are already registered and loaded.
 *
 * Not `terminateAllThreads()`: that one recreates the pool it just shut down.
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
        // `terminateWorker` leaves behind a reporter that logs every message
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
  // Outstanding `napi_async_work` goes first, while the environment is still
  // completely live: the completion callbacks run addon code, and everything
  // after this point takes that away from them — the barrier shuts the async
  // runtime down, `Context.destroy()` stops JavaScript calls, and terminating
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
 * binding[Symbol.for('napi.rs.wasi.dispose')]()
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
 * `beforeInit`: there is no instance to run the barrier on, so nothing to drain.
 *
 * A barrier or drain that did *not* finish stops the rollback short of
 * destroying, which is what `dispose()` already does — a rejected drain there
 * never reaches `__continueWasiDisposal`. Destroying anyway is the worse of the
 * two trades, and not because of what it saves:
 *
 *   - It cannot deliver the settlements. `Context.destroy()` runs the
 *     threadsafe function's cleanup hook, which drains the queue with a null env
 *     and discards it, so a promise that already escaped into JavaScript hangs
 *     forever with nothing left that could ever settle it.
 *   - It saves less than it looks. `Context.destroy()` stops JavaScript calls
 *     and runs cleanup hooks; it does not free the wasm instance or its Memory,
 *     which this module's scope holds either way. What stopping short retains is
 *     the emnapi context's bookkeeping and its un-run cleanup hooks.
 *   - Retry is not theoretical. A rollback that records a cleanup error is
 *     already kept in the process-wide registry above, so re-`require()`ing this
 *     file replays it instead of re-instantiating — and the `6e15de6f` flag fix
 *     means the replay drains again rather than skipping it. Destroying first is
 *     what makes that retained record useless.
 *
 * The residual cost is honest: the CJS flavor hands the context to its
 * `process.on('exit')` teardown, so a process that never retries still reclaims
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

  // Same reason as `__startWasiDisposal`: a module-init hook can start async
  // work before the load goes on to fail, and this rollback tears down exactly
  // what those completions need. Settle them while everything is still live,
  // before the barrier and the teardown above take that away.
  //
  // A drain that could not finish leaves async work possibly outstanding, and
  // destroying the context over it would strand exactly what this rollback is
  // there to settle. Stop short and retain instead — the same trade
  // `__rollbackWasmEnvForWasiInitialization` makes for the settlement drain, so
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

// A view of the addon's crash flag, one word of the shared wasm memory, for the
// pool workers: they raise it when their wasm thread dies, and the shutdown
// waits inside the cleanup calls on this thread then trap instead of waiting on
// the dead thread for good. Undefined for an addon built with an older napi.
let __wasiAddonCrashFlag

function __captureWasiAddonCrashFlag(instance) {
  try {
    const getAddress = instance.exports.napi_wasm_thread_crash_flag_address
    if (typeof getAddress !== 'function') {
      return
    }
    const address = getAddress() >>> 0
    const buffer = __sharedMemory.buffer
    if (address === 0 || address % 4 !== 0 || address + 4 > buffer.byteLength) {
      return
    }
    __wasiAddonCrashFlag = new Int32Array(buffer, address, 1)
  } catch {}
}

function __shareWasiAddonCrashFlag(worker) {
  if (__wasiAddonCrashFlag === undefined) {
    return
  }
  try {
    worker.postMessage({ __napiRsAddonCrashFlag: __wasiAddonCrashFlag })
  } catch {}
}

let __wasiModule
let __napiModule

try {
  __emnapiContext = __wrapEmnapiContextDestroyForSettlement(
    __emnapiCreateContext({ autoDestroy: false }),
    __prepareWasmEnvCleanup,
    __isPreparingWasmEnvCleanup,
  )
  __emnapiContext.suppressDestroy()
    __emnapiContext.features.Buffer = Buffer

  ;({
    instance: __napiInstance,
    module: __wasiModule,
    napiModule: __napiModule,
  } = await __emnapiInstantiateNapiModule(__wasmFile, {
    context: __emnapiContext,
    asyncWorkPoolSize: __asyncWorkPoolSize,
    reuseWorker: { size: __asyncWorkPoolSize + __workerPoolSize },
    plugins: [
      __captureWasiThreadManager,
      __emnapiAsyncWorkPlugin,
      __emnapiTSFNPlugin,
    ],
    wasi: __wasi,
    onCreateWorker() {
      const worker = new Worker(new URL('./wasi-worker-browser.mjs', import.meta.url), {
        type: 'module',
      })
      __wasiWorkers.add(worker)
      __shareWasiAddonCrashFlag(worker)
      worker.addEventListener('message', __wasmCreateOnMessageForFsProxy(__fs))


      return worker
    },
    overwriteImports(importObject) {
      importObject.env = {
        ...importObject.env,
        ...importObject.napi,
        ...importObject.emnapi,
        memory: __sharedMemory,
      }
      return importObject
    },
    beforeInit({ instance }) {
      __napiInstance = instance
      __captureWasiAddonCrashFlag(instance)
      for (const worker of __wasiWorkers) {
        __shareWasiAddonCrashFlag(worker)
      }
      for (const name of Object.keys(instance.exports)) {
        if (name.startsWith('__napi_register__')) {
          instance.exports[name]()
        }
      }
    },
  }))
  __publishWasiDispose(__napiModule.exports)
  // The default export hands out this object; a named module export does not
  // travel with it, so carry the marker on the binding itself too. After the
  // host install, which hands the same object to addon-provided registration
  // functions that may put anything on it, and inside this `try`, so a claimed
  // name fails the load through the rollback below rather than past it.
  __napiStampBindingTarget(__napiModule.exports, __napiBindingTarget)
} catch (error) {
  const cleanupErrors = await __rollbackWasiInitialization()
  throw __attachCleanupErrors(error, cleanupErrors)
}
export default __napiModule.exports
export const Animal = __napiModule.exports.Animal
export const AnimalWithDefaultConstructor = __napiModule.exports.AnimalWithDefaultConstructor
export const AnotherClassForEither = __napiModule.exports.AnotherClassForEither
export const AnotherCssStyleSheet = __napiModule.exports.AnotherCssStyleSheet
export const AnotherCSSStyleSheet = __napiModule.exports.AnotherCSSStyleSheet
export const Asset = __napiModule.exports.Asset
export const JsAsset = __napiModule.exports.JsAsset
export const Assets = __napiModule.exports.Assets
export const JsAssets = __napiModule.exports.JsAssets
export const AsyncDataSource = __napiModule.exports.AsyncDataSource
export const AsyncFib = __napiModule.exports.AsyncFib
export const AsyncThrowClass = __napiModule.exports.AsyncThrowClass
export const Bird = __napiModule.exports.Bird
export const Blake2BHasher = __napiModule.exports.Blake2BHasher
export const Blake2bHasher = __napiModule.exports.Blake2bHasher
export const Blake2BKey = __napiModule.exports.Blake2BKey
export const Blake2bKey = __napiModule.exports.Blake2bKey
export const CatchOnConstructor = __napiModule.exports.CatchOnConstructor
export const CatchOnConstructor2 = __napiModule.exports.CatchOnConstructor2
export const ClassInArray = __napiModule.exports.ClassInArray
export const ClassReturnInPromise = __napiModule.exports.ClassReturnInPromise
export const ClassWithFactory = __napiModule.exports.ClassWithFactory
export const ClassWithLifetime = __napiModule.exports.ClassWithLifetime
export const Context = __napiModule.exports.Context
export const CounterRepro = __napiModule.exports.CounterRepro
export const CreateStringClass = __napiModule.exports.CreateStringClass
export const CssRuleList = __napiModule.exports.CssRuleList
export const CSSRuleList = __napiModule.exports.CSSRuleList
export const CssStyleSheet = __napiModule.exports.CssStyleSheet
export const CSSStyleSheet = __napiModule.exports.CSSStyleSheet
export const CustomFinalize = __napiModule.exports.CustomFinalize
export const CustomStruct = __napiModule.exports.CustomStruct
export const DefaultUseNullableClass = __napiModule.exports.DefaultUseNullableClass
export const DelayedCounter = __napiModule.exports.DelayedCounter
export const Dog = __napiModule.exports.Dog
export const EagerReleaseHolder = __napiModule.exports.EagerReleaseHolder
export const Fib = __napiModule.exports.Fib
export const Fib2 = __napiModule.exports.Fib2
export const Fib3 = __napiModule.exports.Fib3
export const Fib4 = __napiModule.exports.Fib4
export const GetterSetterWithClosures = __napiModule.exports.GetterSetterWithClosures
export const JsClassForEither = __napiModule.exports.JsClassForEither
export const JSOnlyMethodsClass = __napiModule.exports.JSOnlyMethodsClass
export const RustOnlyMethodsClass = __napiModule.exports.RustOnlyMethodsClass
export const JsRemote = __napiModule.exports.JsRemote
export const JsRepo = __napiModule.exports.JsRepo
export const MyJsNamedClass = __napiModule.exports.MyJsNamedClass
export const OriginalRustNameForJsNamedStruct = __napiModule.exports.OriginalRustNameForJsNamedStruct
export const NinjaTurtle = __napiModule.exports.NinjaTurtle
export const NotUseNullableClass = __napiModule.exports.NotUseNullableClass
export const NotWritableClass = __napiModule.exports.NotWritableClass
export const Optional = __napiModule.exports.Optional
export const PackageJsonReader = __napiModule.exports.PackageJsonReader
export const Reader = __napiModule.exports.Reader
export const ReentrantBorrowOrderTest = __napiModule.exports.ReentrantBorrowOrderTest
export const RenamedForIssue3427 = __napiModule.exports.RenamedForIssue3427
export const RenamedForIssue3427Rust = __napiModule.exports.RenamedForIssue3427Rust
export const Selector = __napiModule.exports.Selector
export const Thing = __napiModule.exports.Thing
export const ThingList = __napiModule.exports.ThingList
export const TypeTagA = __napiModule.exports.TypeTagA
export const TypeTagB = __napiModule.exports.TypeTagB
export const UnwrapForgerySurface = __napiModule.exports.UnwrapForgerySurface
export const UseNullableClass = __napiModule.exports.UseNullableClass
export const Width = __napiModule.exports.Width
export const acceptArraybuffer = __napiModule.exports.acceptArraybuffer
export const acceptSlice = __napiModule.exports.acceptSlice
export const acceptStream = __napiModule.exports.acceptStream
export const acceptThreadsafeFunction = __napiModule.exports.acceptThreadsafeFunction
export const acceptThreadsafeFunctionFatal = __napiModule.exports.acceptThreadsafeFunctionFatal
export const acceptThreadsafeFunctionTupleArgs = __napiModule.exports.acceptThreadsafeFunctionTupleArgs
export const acceptThreadsafeFunctionTupleNoFnArgs = __napiModule.exports.acceptThreadsafeFunctionTupleNoFnArgs
export const acceptUint8ClampedSlice = __napiModule.exports.acceptUint8ClampedSlice
export const acceptUint8ClampedSliceAndBufferSlice = __napiModule.exports.acceptUint8ClampedSliceAndBufferSlice
export const acceptUntypedTypedArray = __napiModule.exports.acceptUntypedTypedArray
export const add = __napiModule.exports.add
export const ALIAS = __napiModule.exports.ALIAS
export const AliasedEnum = __napiModule.exports.AliasedEnum
export const appendBuffer = __napiModule.exports.appendBuffer
export const appendToOsString = __napiModule.exports.appendToOsString
export const apply0 = __napiModule.exports.apply0
export const apply1 = __napiModule.exports.apply1
export const arrayBufferFromData = __napiModule.exports.arrayBufferFromData
export const arrayBufferFromExternal = __napiModule.exports.arrayBufferFromExternal
export const arrayBufferFromExternalReadBack = __napiModule.exports.arrayBufferFromExternalReadBack
export const arrayBufferLenAsync = __napiModule.exports.arrayBufferLenAsync
export const arrayBufferPassThrough = __napiModule.exports.arrayBufferPassThrough
export const arrayParams = __napiModule.exports.arrayParams
export const asyncBufferToArray = __napiModule.exports.asyncBufferToArray
export const asyncMultiTwo = __napiModule.exports.asyncMultiTwo
export const asyncPlus100 = __napiModule.exports.asyncPlus100
export const asyncReduceBuffer = __napiModule.exports.asyncReduceBuffer
export const asyncResolveArray = __napiModule.exports.asyncResolveArray
export const asyncTaskArraybuffer = __napiModule.exports.asyncTaskArraybuffer
export const asyncTaskFinally = __napiModule.exports.asyncTaskFinally
export const asyncTaskIsExecuting = __napiModule.exports.asyncTaskIsExecuting
export const asyncTaskOptionalReturn = __napiModule.exports.asyncTaskOptionalReturn
export const asyncTaskReadFile = __napiModule.exports.asyncTaskReadFile
export const asyncTaskRejectIsExecuting = __napiModule.exports.asyncTaskRejectIsExecuting
export const asyncTaskRejectWithCapturedValue = __napiModule.exports.asyncTaskRejectWithCapturedValue
export const asyncTaskSignalWhenExecuting = __napiModule.exports.asyncTaskSignalWhenExecuting
export const asyncTaskSignalWhenExecutingReject = __napiModule.exports.asyncTaskSignalWhenExecutingReject
export const asyncTaskVoidReturn = __napiModule.exports.asyncTaskVoidReturn
export const awaitRejectionOffThread = __napiModule.exports.awaitRejectionOffThread
export const bigintAdd = __napiModule.exports.bigintAdd
export const bigintFromI128 = __napiModule.exports.bigintFromI128
export const bigintFromI64 = __napiModule.exports.bigintFromI64
export const bigintGetU64AsString = __napiModule.exports.bigintGetU64AsString
export const btreeSetToJs = __napiModule.exports.btreeSetToJs
export const btreeSetToRust = __napiModule.exports.btreeSetToRust
export const bufferAssertionTarget = __napiModule.exports.bufferAssertionTarget
export const bufferComplexOverride = __napiModule.exports.bufferComplexOverride
export const bufferDestructureBinding = __napiModule.exports.bufferDestructureBinding
export const bufferGenericConstraint = __napiModule.exports.bufferGenericConstraint
export const bufferGenericShadow = __napiModule.exports.bufferGenericShadow
export const bufferLenAsync = __napiModule.exports.bufferLenAsync
export const bufferPassThrough = __napiModule.exports.bufferPassThrough
export const bufferSliceCopyFromMutated = __napiModule.exports.bufferSliceCopyFromMutated
export const bufferSliceCopyFromReadBack = __napiModule.exports.bufferSliceCopyFromReadBack
export const bufferSliceFromDataMutated = __napiModule.exports.bufferSliceFromDataMutated
export const bufferSliceFromDataReadBack = __napiModule.exports.bufferSliceFromDataReadBack
export const bufferSliceFromExternalMutated = __napiModule.exports.bufferSliceFromExternalMutated
export const bufferSliceFromExternalReadBack = __napiModule.exports.bufferSliceFromExternalReadBack
export const bufferValueBinding = __napiModule.exports.bufferValueBinding
export const bufferWithAsyncBlock = __napiModule.exports.bufferWithAsyncBlock
export const buildThreadsafeFunctionFromFunction = __napiModule.exports.buildThreadsafeFunctionFromFunction
export const buildThreadsafeFunctionFromFunctionCalleeHandle = __napiModule.exports.buildThreadsafeFunctionFromFunctionCalleeHandle
export const call0 = __napiModule.exports.call0
export const call1 = __napiModule.exports.call1
export const call2 = __napiModule.exports.call2
export const callAsyncWithUnknownReturnValue = __napiModule.exports.callAsyncWithUnknownReturnValue
export const callbackInSpawn = __napiModule.exports.callbackInSpawn
export const callbackReturnPromise = __napiModule.exports.callbackReturnPromise
export const callbackReturnPromiseAndSpawn = __napiModule.exports.callbackReturnPromiseAndSpawn
export const callCatchOnPromise = __napiModule.exports.callCatchOnPromise
export const callCatchOnPromiseCapturing = __napiModule.exports.callCatchOnPromiseCapturing
export const callFinallyOnPromise = __napiModule.exports.callFinallyOnPromise
export const callFunction = __napiModule.exports.callFunction
export const callFunctionWithArg = __napiModule.exports.callFunctionWithArg
export const callFunctionWithArgAndCtx = __napiModule.exports.callFunctionWithArgAndCtx
export const callLongThreadsafeFunction = __napiModule.exports.callLongThreadsafeFunction
export const callRuleHandler = __napiModule.exports.callRuleHandler
export const callThenOnPromise = __napiModule.exports.callThenOnPromise
export const callThenOnPromiseCapturing = __napiModule.exports.callThenOnPromiseCapturing
export const callThreadsafeFunction = __napiModule.exports.callThreadsafeFunction
export const callWithNestedFunctionArg = __napiModule.exports.callWithNestedFunctionArg
export const callWithTupleArg = __napiModule.exports.callWithTupleArg
export const captureErrorInCallback = __napiModule.exports.captureErrorInCallback
export const chronoDateAdd1Minute = __napiModule.exports.chronoDateAdd1Minute
export const chronoDateFixtureReturn1 = __napiModule.exports.chronoDateFixtureReturn1
export const chronoDateFixtureReturn2 = __napiModule.exports.chronoDateFixtureReturn2
export const chronoDateWithTimezoneReturn = __napiModule.exports.chronoDateWithTimezoneReturn
export const chronoDateWithTimezoneToMillis = __napiModule.exports.chronoDateWithTimezoneToMillis
export const chronoLocalDateReturn = __napiModule.exports.chronoLocalDateReturn
export const chronoLocalDateToMillis = __napiModule.exports.chronoLocalDateToMillis
export const chronoNativeDateTime = __napiModule.exports.chronoNativeDateTime
export const chronoNativeDateTimeReturn = __napiModule.exports.chronoNativeDateTimeReturn
export const chronoUtcDateReturn = __napiModule.exports.chronoUtcDateReturn
export const chronoUtcDateToMillis = __napiModule.exports.chronoUtcDateToMillis
export const churnGlobalHandles = __napiModule.exports.churnGlobalHandles
export const cleanupReentrantBorrowOrderTestTargets = __napiModule.exports.cleanupReentrantBorrowOrderTestTargets
export const compressSync = __napiModule.exports.compressSync
export const concatLatin1 = __napiModule.exports.concatLatin1
export const concatStr = __napiModule.exports.concatStr
export const concatUtf16 = __napiModule.exports.concatUtf16
export const contains = __napiModule.exports.contains
export const convertU32Array = __napiModule.exports.convertU32Array
export const createArraybuffer = __napiModule.exports.createArraybuffer
export const createBigInt = __napiModule.exports.createBigInt
export const createBigIntI64 = __napiModule.exports.createBigIntI64
export const createBufferSliceFromCopiedData = __napiModule.exports.createBufferSliceFromCopiedData
export const createErrorFromRetainedValue = __napiModule.exports.createErrorFromRetainedValue
export const createErroringReadableStream = __napiModule.exports.createErroringReadableStream
export const createExternal = __napiModule.exports.createExternal
export const createExternalBufferSlice = __napiModule.exports.createExternalBufferSlice
export const createExternalLatin1CustomFinalize = __napiModule.exports.createExternalLatin1CustomFinalize
export const createExternalLatin1Empty = __napiModule.exports.createExternalLatin1Empty
export const createExternalLatin1Long = __napiModule.exports.createExternalLatin1Long
export const createExternalLatin1Short = __napiModule.exports.createExternalLatin1Short
export const createExternalLatin1String = __napiModule.exports.createExternalLatin1String
export const createExternalLatin1WithLatin1Chars = __napiModule.exports.createExternalLatin1WithLatin1Chars
export const createExternalRef = __napiModule.exports.createExternalRef
export const createExternalString = __napiModule.exports.createExternalString
export const createExternalTypedArray = __napiModule.exports.createExternalTypedArray
export const createExternalUtf16String = __napiModule.exports.createExternalUtf16String
export const createForeignExternal = __napiModule.exports.createForeignExternal
export const createFunction = __napiModule.exports.createFunction
export const createI32ArrayFromExternal = __napiModule.exports.createI32ArrayFromExternal
export const createNotUseNullableStruct = __napiModule.exports.createNotUseNullableStruct
export const createObj = __napiModule.exports.createObj
export const createObjectRef = __napiModule.exports.createObjectRef
export const createObjectWithClassField = __napiModule.exports.createObjectWithClassField
export const createObjWithProperty = __napiModule.exports.createObjWithProperty
export const createOptionalExternal = __napiModule.exports.createOptionalExternal
export const createPanickingClosureFunction = __napiModule.exports.createPanickingClosureFunction
export const createReadableStream = __napiModule.exports.createReadableStream
export const createReadableStreamFromClass = __napiModule.exports.createReadableStreamFromClass
export const createReadableStreamWithObject = __napiModule.exports.createReadableStreamWithObject
export const createReentrantBorrowOrderTestTarget = __napiModule.exports.createReentrantBorrowOrderTestTarget
export const createReferenceOnFunction = __napiModule.exports.createReferenceOnFunction
export const createRejectedPromise = __napiModule.exports.createRejectedPromise
export const createResolvedPromise = __napiModule.exports.createResolvedPromise
export const createStaticLatin1String = __napiModule.exports.createStaticLatin1String
export const createStaticUtf16String = __napiModule.exports.createStaticUtf16String
export const createSymbol = __napiModule.exports.createSymbol
export const createSymbolFor = __napiModule.exports.createSymbolFor
export const createSymbolRef = __napiModule.exports.createSymbolRef
export const createUint8ClampedArrayFromData = __napiModule.exports.createUint8ClampedArrayFromData
export const createUint8ClampedArrayFromExternal = __napiModule.exports.createUint8ClampedArrayFromExternal
export const createUseNullableStruct = __napiModule.exports.createUseNullableStruct
export const createZeroCopyLatin1String = __napiModule.exports.createZeroCopyLatin1String
export const createZeroCopyUtf16String = __napiModule.exports.createZeroCopyUtf16String
export const CustomNumEnum = __napiModule.exports.CustomNumEnum
export const customStatusCode = __napiModule.exports.customStatusCode
export const CustomStringEnum = __napiModule.exports.CustomStringEnum
export const dateToNumber = __napiModule.exports.dateToNumber
export const DEFAULT_COST = __napiModule.exports.DEFAULT_COST
export const defineClass = __napiModule.exports.defineClass
export const derefUint8Array = __napiModule.exports.derefUint8Array
export const describeCapturedValue = __napiModule.exports.describeCapturedValue
export const describePromiseRejection = __napiModule.exports.describePromiseRejection
export const detachReentrantBorrowOrderTestTarget = __napiModule.exports.detachReentrantBorrowOrderTestTarget
export const drainStreamCount = __napiModule.exports.drainStreamCount
export const dropClonedErrorsOnTwoThreads = __napiModule.exports.dropClonedErrorsOnTwoThreads
export const dropErrorFromValueOffThread = __napiModule.exports.dropErrorFromValueOffThread
export const either3 = __napiModule.exports.either3
export const either4 = __napiModule.exports.either4
export const eitherBoolOrFunction = __napiModule.exports.eitherBoolOrFunction
export const eitherBoolOrTuple = __napiModule.exports.eitherBoolOrTuple
export const eitherF64OrU32 = __napiModule.exports.eitherF64OrU32
export const eitherFromObjects = __napiModule.exports.eitherFromObjects
export const eitherFromOption = __napiModule.exports.eitherFromOption
export const eitherPromiseInEitherA = __napiModule.exports.eitherPromiseInEitherA
export const eitherStringOrNumber = __napiModule.exports.eitherStringOrNumber
export const Empty = __napiModule.exports.Empty
export const enumToI32 = __napiModule.exports.enumToI32
export const errorMessageContainsNullByte = __napiModule.exports.errorMessageContainsNullByte
export const esmResolve = __napiModule.exports.esmResolve
export const extendsJavascriptError = __napiModule.exports.extendsJavascriptError
export const f32ArrayToArray = __napiModule.exports.f32ArrayToArray
export const f64ArrayToArray = __napiModule.exports.f64ArrayToArray
export const fibonacci = __napiModule.exports.fibonacci
export const fnReceivedAliased = __napiModule.exports.fnReceivedAliased
export const generateFunctionAndCallIt = __napiModule.exports.generateFunctionAndCallIt
export const getBigintJsonValue = __napiModule.exports.getBigintJsonValue
export const getBtreeMapping = __napiModule.exports.getBtreeMapping
export const getBuffer = __napiModule.exports.getBuffer
export const getBufferSlice = __napiModule.exports.getBufferSlice
export const getClassFromArray = __napiModule.exports.getClassFromArray
export const getCwd = __napiModule.exports.getCwd
export const getEmptyBuffer = __napiModule.exports.getEmptyBuffer
export const getEmptyTypedArray = __napiModule.exports.getEmptyTypedArray
export const getExternal = __napiModule.exports.getExternal
export const getExternalRef = __napiModule.exports.getExternalRef
export const getGlobal = __napiModule.exports.getGlobal
export const getIndexMapping = __napiModule.exports.getIndexMapping
export const getIndexMappingWithHasher = __napiModule.exports.getIndexMappingWithHasher
export const getMapping = __napiModule.exports.getMapping
export const getMappingWithHasher = __napiModule.exports.getMappingWithHasher
export const getModuleFileName = __napiModule.exports.getModuleFileName
export const getMyVec = __napiModule.exports.getMyVec
export const getNestedNumArr = __napiModule.exports.getNestedNumArr
export const getNull = __napiModule.exports.getNull
export const getNullByteProperty = __napiModule.exports.getNullByteProperty
export const getNumArr = __napiModule.exports.getNumArr
export const getNums = __napiModule.exports.getNums
export const getOptionalExternal = __napiModule.exports.getOptionalExternal
export const getPackageJsonName = __napiModule.exports.getPackageJsonName
export const getStrFromObject = __napiModule.exports.getStrFromObject
export const getterFromObj = __napiModule.exports.getterFromObj
export const getTuple = __napiModule.exports.getTuple
export const getUndefined = __napiModule.exports.getUndefined
export const getWords = __napiModule.exports.getWords
export const i16ArrayToArray = __napiModule.exports.i16ArrayToArray
export const i32ArrayToArray = __napiModule.exports.i32ArrayToArray
export const i64ArrayToArray = __napiModule.exports.i64ArrayToArray
export const i8ArrayToArray = __napiModule.exports.i8ArrayToArray
export const indexmapPassthrough = __napiModule.exports.indexmapPassthrough
export const indexSetToJs = __napiModule.exports.indexSetToJs
export const indexSetToRust = __napiModule.exports.indexSetToRust
export const intoUtf8 = __napiModule.exports.intoUtf8
export const issue3427Either = __napiModule.exports.issue3427Either
export const issue3427Option = __napiModule.exports.issue3427Option
export const issue3427Strict = __napiModule.exports.issue3427Strict
export const joinPath = __napiModule.exports.joinPath
export const jsErrorCallback = __napiModule.exports.jsErrorCallback
export const jsErrorFromRetainedValue = __napiModule.exports.jsErrorFromRetainedValue
export const jsErrorWithoutRetainedValue = __napiModule.exports.jsErrorWithoutRetainedValue
export const jsRangeErrorFromRetainedValue = __napiModule.exports.jsRangeErrorFromRetainedValue
export const jsRangeErrorWithoutRetainedValue = __napiModule.exports.jsRangeErrorWithoutRetainedValue
export const jsTypeErrorFromRetainedValue = __napiModule.exports.jsTypeErrorFromRetainedValue
export const jsTypeErrorWithoutRetainedValue = __napiModule.exports.jsTypeErrorWithoutRetainedValue
export const Kind = __napiModule.exports.Kind
export const KindInValidate = __napiModule.exports.KindInValidate
export const listObjKeys = __napiModule.exports.listObjKeys
export const makeDeepSerdeValue = __napiModule.exports.makeDeepSerdeValue
export const makeTypeTagA = __napiModule.exports.makeTypeTagA
export const mapOption = __napiModule.exports.mapOption
export const mergeTupleArray = __napiModule.exports.mergeTupleArray
export const moduleRetentionRequests = __napiModule.exports.moduleRetentionRequests
export const mutateArraybuffer = __napiModule.exports.mutateArraybuffer
export const mutateExternal = __napiModule.exports.mutateExternal
export const mutateOptionalExternal = __napiModule.exports.mutateOptionalExternal
export const mutateTypedArray = __napiModule.exports.mutateTypedArray
export const objectGetNamedPropertyShouldPerformTypecheck = __napiModule.exports.objectGetNamedPropertyShouldPerformTypecheck
export const objectRemoveWrappedA = __napiModule.exports.objectRemoveWrappedA
export const objectRewrapAfterRemove = __napiModule.exports.objectRewrapAfterRemove
export const objectRewrapWithDifferentType = __napiModule.exports.objectRewrapWithDifferentType
export const objectWithCApis = __napiModule.exports.objectWithCApis
export const objectWrapMismatchKeepsWrap = __napiModule.exports.objectWrapMismatchKeepsWrap
export const objectWrapRoundtrip = __napiModule.exports.objectWrapRoundtrip
export const objectWrapWithA = __napiModule.exports.objectWrapWithA
export const optionalCallbackTypes = __napiModule.exports.optionalCallbackTypes
export const optionEnd = __napiModule.exports.optionEnd
export const optionOnly = __napiModule.exports.optionOnly
export const optionStart = __napiModule.exports.optionStart
export const optionStartEnd = __napiModule.exports.optionStartEnd
export const overrideIndividualArgOnFunction = __napiModule.exports.overrideIndividualArgOnFunction
export const overrideIndividualArgOnFunctionWithCbArg = __napiModule.exports.overrideIndividualArgOnFunctionWithCbArg
export const overrideWholeFunctionType = __napiModule.exports.overrideWholeFunctionType
export const panic = __napiModule.exports.panic
export const panicInAsync = __napiModule.exports.panicInAsync
export const passSetToJs = __napiModule.exports.passSetToJs
export const passSetToRust = __napiModule.exports.passSetToRust
export const passSetWithHasherToJs = __napiModule.exports.passSetWithHasherToJs
export const pathParent = __napiModule.exports.pathParent
export const plusOne = __napiModule.exports.plusOne
export const promiseInEither = __napiModule.exports.promiseInEither
export const promiseRawReturnClassInstance = __napiModule.exports.promiseRawReturnClassInstance
export const readFile = __napiModule.exports.readFile
export const readFileAsync = __napiModule.exports.readFileAsync
export const readPackageJson = __napiModule.exports.readPackageJson
export const receiveAllOptionalObject = __napiModule.exports.receiveAllOptionalObject
export const receiveBindingVitePluginMeta = __napiModule.exports.receiveBindingVitePluginMeta
export const receiveBufferSliceWithLifetime = __napiModule.exports.receiveBufferSliceWithLifetime
export const receiveClassOrNumber = __napiModule.exports.receiveClassOrNumber
export const receiveDifferentClass = __napiModule.exports.receiveDifferentClass
export const receiveMutClassOrNumber = __napiModule.exports.receiveMutClassOrNumber
export const receiveObjectOnlyFromJs = __napiModule.exports.receiveObjectOnlyFromJs
export const receiveObjectWithClassField = __napiModule.exports.receiveObjectWithClassField
export const receiveStrictObject = __napiModule.exports.receiveStrictObject
export const receiveString = __napiModule.exports.receiveString
export const referenceAsCallback = __napiModule.exports.referenceAsCallback
export const referenceWithTupleArg = __napiModule.exports.referenceWithTupleArg
export const removeWrappedObjectAsU8Rejected = __napiModule.exports.removeWrappedObjectAsU8Rejected
export const returnCString = __napiModule.exports.returnCString
export const returnEither = __napiModule.exports.returnEither
export const returnEitherClass = __napiModule.exports.returnEitherClass
export const returnFromSharedCrate = __napiModule.exports.returnFromSharedCrate
export const returnNull = __napiModule.exports.returnNull
export const returnObjectOnlyToJs = __napiModule.exports.returnObjectOnlyToJs
export const returnUndefined = __napiModule.exports.returnUndefined
export const returnUndefinedIfInvalid = __napiModule.exports.returnUndefinedIfInvalid
export const returnUndefinedIfInvalidPromise = __napiModule.exports.returnUndefinedIfInvalidPromise
export const roundtripStr = __napiModule.exports.roundtripStr
export const runScript = __napiModule.exports.runScript
export const setNullByteProperty = __napiModule.exports.setNullByteProperty
export const setSymbolInObj = __napiModule.exports.setSymbolInObj
export const shorterEscapableScope = __napiModule.exports.shorterEscapableScope
export const shorterScope = __napiModule.exports.shorterScope
export const shutdownRuntime = __napiModule.exports.shutdownRuntime
export const spawnFutureLifetime = __napiModule.exports.spawnFutureLifetime
export const spawnThreadInThread = __napiModule.exports.spawnThreadInThread
export const stashBufferInThreadLocal = __napiModule.exports.stashBufferInThreadLocal
export const stashErrorInThreadLocal = __napiModule.exports.stashErrorInThreadLocal
export const stashTypedArrayInThreadLocal = __napiModule.exports.stashTypedArrayInThreadLocal
export const Status = __napiModule.exports.Status
export const StatusInValidate = __napiModule.exports.StatusInValidate
export const StringEnum = __napiModule.exports.StringEnum
export const sumBtreeMapping = __napiModule.exports.sumBtreeMapping
export const sumIndexMapping = __napiModule.exports.sumIndexMapping
export const sumMapping = __napiModule.exports.sumMapping
export const sumNums = __napiModule.exports.sumNums
export const testEscapedQuotesInComments = __napiModule.exports.testEscapedQuotesInComments
export const testLatin1Methods = __napiModule.exports.testLatin1Methods
export const testSerdeBigNumberPrecision = __napiModule.exports.testSerdeBigNumberPrecision
export const testSerdeBufferBytes = __napiModule.exports.testSerdeBufferBytes
export const testSerdeRoundtrip = __napiModule.exports.testSerdeRoundtrip
export const testWorkers = __napiModule.exports.testWorkers
export const threadsafeFunctionBuildThrowErrorWithStatus = __napiModule.exports.threadsafeFunctionBuildThrowErrorWithStatus
export const threadsafeFunctionClosureCapture = __napiModule.exports.threadsafeFunctionClosureCapture
export const threadsafeFunctionFatalMode = __napiModule.exports.threadsafeFunctionFatalMode
export const threadsafeFunctionFatalModeError = __napiModule.exports.threadsafeFunctionFatalModeError
export const threadsafeFunctionThrowError = __napiModule.exports.threadsafeFunctionThrowError
export const threadsafeFunctionThrowErrorWithStatus = __napiModule.exports.threadsafeFunctionThrowErrorWithStatus
export const throwAsyncError = __napiModule.exports.throwAsyncError
export const throwDetachedPendingException = __napiModule.exports.throwDetachedPendingException
export const throwError = __napiModule.exports.throwError
export const throwErrorWithCause = __napiModule.exports.throwErrorWithCause
export const throwSyntaxError = __napiModule.exports.throwSyntaxError
export const toJsObj = __napiModule.exports.toJsObj
export const tryCloneErrorCauseOffThread = __napiModule.exports.tryCloneErrorCauseOffThread
export const tryCloneErrorCauseTransitiveOffThread = __napiModule.exports.tryCloneErrorCauseTransitiveOffThread
export const tryCloneErrorOffThread = __napiModule.exports.tryCloneErrorOffThread
export const tryCloneErrorOffThreadKeepReference = __napiModule.exports.tryCloneErrorOffThreadKeepReference
export const tsfnAsyncCall = __napiModule.exports.tsfnAsyncCall
export const tsfnCallWithCallback = __napiModule.exports.tsfnCallWithCallback
export const tsfnInEither = __napiModule.exports.tsfnInEither
export const tsfnReturnPromise = __napiModule.exports.tsfnReturnPromise
export const tsfnReturnPromiseTimeout = __napiModule.exports.tsfnReturnPromiseTimeout
export const tsfnThrowFromJs = __napiModule.exports.tsfnThrowFromJs
export const tsfnThrowFromJsCallbackContainsTsfn = __napiModule.exports.tsfnThrowFromJsCallbackContainsTsfn
export const tsfnThrowFromJsCatch = __napiModule.exports.tsfnThrowFromJsCatch
export const tsfnThrowFromJsCatchDropInThread = __napiModule.exports.tsfnThrowFromJsCatchDropInThread
export const tsfnThrowFromJsCatchHandled = __napiModule.exports.tsfnThrowFromJsCatchHandled
export const tsfnThrowFromJsCatchRecover = __napiModule.exports.tsfnThrowFromJsCatchRecover
export const tsfnWeak = __napiModule.exports.tsfnWeak
export const tsRename = __napiModule.exports.tsRename
export const u16ArrayToArray = __napiModule.exports.u16ArrayToArray
export const u32ArrayToArray = __napiModule.exports.u32ArrayToArray
export const u64ArrayToArray = __napiModule.exports.u64ArrayToArray
export const u8ArrayToArray = __napiModule.exports.u8ArrayToArray
export const uInit8ArrayFromString = __napiModule.exports.uInit8ArrayFromString
export const uint8ArrayFromData = __napiModule.exports.uint8ArrayFromData
export const uint8ArrayFromExternal = __napiModule.exports.uint8ArrayFromExternal
export const uint8ArraySliceFromExternalReadBack = __napiModule.exports.uint8ArraySliceFromExternalReadBack
export const uint8ClampedSliceFromExternalReadBack = __napiModule.exports.uint8ClampedSliceFromExternalReadBack
export const unwrapObjectAsARejected = __napiModule.exports.unwrapObjectAsARejected
export const unwrapObjectAsTypeTagARejected = __napiModule.exports.unwrapObjectAsTypeTagARejected
export const unwrapObjectAsU8Rejected = __napiModule.exports.unwrapObjectAsU8Rejected
export const validateArray = __napiModule.exports.validateArray
export const validateBigint = __napiModule.exports.validateBigint
export const validateBoolean = __napiModule.exports.validateBoolean
export const validateBuffer = __napiModule.exports.validateBuffer
export const validateBufferSlice = __napiModule.exports.validateBufferSlice
export const validateDate = __napiModule.exports.validateDate
export const validateDateTime = __napiModule.exports.validateDateTime
export const validateEnum = __napiModule.exports.validateEnum
export const validateExternal = __napiModule.exports.validateExternal
export const validateFunction = __napiModule.exports.validateFunction
export const validateHashMap = __napiModule.exports.validateHashMap
export const validateNull = __napiModule.exports.validateNull
export const validateNumber = __napiModule.exports.validateNumber
export const validateOptional = __napiModule.exports.validateOptional
export const validatePromise = __napiModule.exports.validatePromise
export const validateString = __napiModule.exports.validateString
export const validateStringEnum = __napiModule.exports.validateStringEnum
export const validateStructuredEnum = __napiModule.exports.validateStructuredEnum
export const validateStructuredEnumLowercase = __napiModule.exports.validateStructuredEnumLowercase
export const validateSymbol = __napiModule.exports.validateSymbol
export const validateTypedArray = __napiModule.exports.validateTypedArray
export const validateTypedArraySlice = __napiModule.exports.validateTypedArraySlice
export const validateUint8ClampedSlice = __napiModule.exports.validateUint8ClampedSlice
export const validateUndefined = __napiModule.exports.validateUndefined
export const wasmMemorySizeBytes = __napiModule.exports.wasmMemorySizeBytes
export const withAbortController = __napiModule.exports.withAbortController
export const withAbortSignalHandle = __napiModule.exports.withAbortSignalHandle
export const withinAsyncRuntimeIfAvailable = __napiModule.exports.withinAsyncRuntimeIfAvailable
export const withoutAbortController = __napiModule.exports.withoutAbortController
export const xxh64Alias = __napiModule.exports.xxh64Alias
export const xxh2 = __napiModule.exports.xxh2
export const xxh3 = __napiModule.exports.xxh3
export const ComplexClass = __napiModule.exports.ComplexClass
