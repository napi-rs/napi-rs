//! The promise an `AsyncTask` / `Env::spawn` hands to JavaScript, and how it is settled.
//!
//! `napi_create_promise` hands back a `napi_deferred` that only `napi_resolve_deferred` /
//! `napi_reject_deferred` free. Both begin with `NAPI_PREAMBLE`, which refuses once the env can
//! no longer run JavaScript. A worker that is terminated while a task is queued or running still
//! runs the task's completion callback during teardown (Node drains the threadpool before it
//! frees the env), and a deferred settled there is never freed: 16 bytes of C++ heap per task,
//! per terminated worker, on every Node version.
//!
//! Each env settles its promises one of two ways, picked once when this addon registers into it
//! ([`SettleMode`], `settle_mode.rs`):
//!
//! * **Deferred**, where the env can only die with its process: the main env of Node and Bun
//!   (the env's loop is `uv_default_loop()`), and every wasm env (emnapi refuses JavaScript only
//!   after `Context.destroy()`; the refused deferred dies with the realm, or stays until process
//!   exit if the process continues after `beforeExit`, the same as before). The deferred is
//!   settled when the task completes, as before. A task still in flight when such an env is torn
//!   down leaks its deferred, which only happens on process exit there.
//! * **Thenable**, everywhere else: workers, Electron and NW.js (whose renderer envs are freed
//!   on navigation), Bun before 1.4.4 and Bun on Windows, Deno, and any host the check cannot
//!   place. Described below. It costs about 2 µs more main-thread CPU per task.
//!
//! On macOS, Linux and the other Unix hosts, a host that is neither Node-based (it exports
//! `node::Buffer::Data`) nor Bun 1.4.4+ never has `uv_default_loop()` called. So a Bun below
//! 1.4.4 whose `process.versions.bun` was removed takes the thenable path instead of reaching
//! Bun's crash stub. Windows is unchanged: Node, Electron and Bun all have a real libuv there,
//! and Deno does not export `uv_default_loop`.
//!
//! In deferred mode a settling call behaves as before #3689: one that fails after Node freed the
//! deferred gives `Err(generic_failure)` or `Ok(false)` from [`conclude`] and the promise stays
//! pending; `napi_invalid_arg` from a null `napi_value` leaves the deferred unsettled; on WASI, a
//! replaced `globalThis.Promise` whose resolving functions throw leaves one emnapi deferred
//! reference and its promise pending.
//!
//! In thenable mode the deferred is settled right away, in [`create`], on the JavaScript thread
//! that just created it. It is resolved with a fresh plain object (the *thenable*) whose own
//! `then` data property is a native function of this module. Resolving a promise with a thenable
//! reads `then` once, at once, and queues a job that later calls
//! `then.call(thenable, resolve, reject)` with the engine's own resolving functions for the
//! promise. The native `then` keeps them behind two `napi_ref`s, and the completion callback
//! settles the promise by calling one of them. `napi_delete_reference` has no `NAPI_PREAMBLE`
//! (Node and emnapi alike), so the references are deleted on every path, including a settlement
//! the env refused.
//!
//! One deferred can still leak: `worker.terminate()` runs on the parent thread, so the env can
//! start refusing JavaScript between `napi_create_promise` and `napi_resolve_deferred`. Every
//! later `napi_create_promise` on that env is refused, so it is at most one per terminated
//! worker (settling at completion leaked one per task).
//!
//! In thenable mode, nothing here reads a property user code can reach, and nothing calls user
//! code to build or settle the promise on Node: the promise comes from `napi_create_promise` (not from
//! `globalThis.Promise`), `then` is an own data property of an object no script holds (defined,
//! not assigned, so an `Object.prototype.then` accessor is never consulted), and `resolve` /
//! `reject` are the built-in resolving functions of this very promise. Only the inspector
//! (`Runtime.queryObjects`) can reach the thenable; calling its `then` first steals the
//! promise's settlement, which then never happens. In deferred mode the task's value goes
//! straight to `napi_resolve_deferred`, as before #3689, so V8 reads `then` on an object value
//! and an `Object.prototype.then` accessor runs there.
//!
//! On WASI, emnapi builds these calls in JavaScript: `napi_create_promise` uses the
//! `globalThis.Promise` of the moment, and `napi_call_function` uses the current
//! `Array.prototype.push` and `Function.prototype.apply`. Replacing those can run user code
//! while a task settles; a throwing replacement leaves the promise pending and its exception
//! reported as uncaught.
//!
//! The `then` function is shared by every task of an env (kept in the env's registration
//! record, released at its teardown); the thenable carries a number naming the task's [`Slot`].
//!
//! Observable differences of thenable mode from deferred mode (workers, Electron and the other
//! thenable hosts only):
//!
//! * One extra microtask job per task, the one that calls `then`, at the first microtask
//!   checkpoint after the task is created. The task cannot settle the promise before it.
//! * That job runs with the task's promise as its resource, so `async_hooks` and
//!   `v8.promiseHooks` see one extra `before`/`after` pair for the promise, while it is still
//!   pending (standard behaviour for a promise resolved with a thenable).
//! * If the task completes before that job (only possible when its completion runs inside a
//!   nested event loop, before the outer callback drained its microtasks), the outcome is kept
//!   and `then` settles the promise with it. Kept outcomes settle at the next microtask
//!   checkpoint in task-creation order, not completion order, and the task's `finally` runs
//!   before its promise is settled. A kept outcome whose `then` never comes is released at env
//!   teardown.

use std::cell::RefCell;
use std::ptr;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::settle_mode::SettleMode;
use crate::{check_status, sys, Error, Result, Status};

/// Counts the per-task promise states freed, read through [`async_task_promise_states_freed`].
static STATES_FREED: AtomicUsize = AtomicUsize::new(0);
/// Counts the resolving-function pairs released, read through
/// [`async_task_promise_resolvers_released`].
static RESOLVERS_RELEASED: AtomicUsize = AtomicUsize::new(0);

/// How many `AsyncTask` / `Env::spawn` promise states have been freed in this process — settled
/// or refused, on every env and every load of this addon. Each state holds what is needed to
/// settle one promise (its resolving functions, or an outcome kept for them), so a test can tell
/// that teardown left none behind. Deferred-mode envs never move it.
///
/// Introspection hook for napi-rs' own tests. No stability guarantee.
#[doc(hidden)]
pub fn async_task_promise_states_freed() -> usize {
  STATES_FREED.load(Ordering::Relaxed)
}

/// How many pairs of promise resolving functions (the references `then` keeps) have been
/// released in this process, settled or not. A subset of
/// [`async_task_promise_states_freed`]: the states whose `then` had already run. Deferred-mode
/// envs never move it.
///
/// Introspection hook for napi-rs' own tests. No stability guarantee.
#[doc(hidden)]
pub fn async_task_promise_resolvers_released() -> usize {
  RESOLVERS_RELEASED.load(Ordering::Relaxed)
}

/// `"deferred"` or `"thenable"`: how `AsyncTask` / `Env::spawn` promises created in `env`
/// right now are settled. `"thenable"` for an env this addon has no record of.
///
/// Introspection hook for napi-rs' own tests. No stability guarantee.
#[doc(hidden)]
pub fn async_task_promise_settle_mode(env: sys::napi_env) -> &'static str {
  settle_mode_of(env).0.as_str()
}

/// The settle mode of `env`, and its cached `then` when it has one: one record lookup on
/// native, none on wasm.
fn settle_mode_of(env: sys::napi_env) -> (SettleMode, Option<sys::napi_ref>) {
  if cfg!(target_family = "wasm") {
    return (SettleMode::Deferred, None);
  }
  crate::bindgen_runtime::env_registration::promise_settle(env)
    .unwrap_or((SettleMode::Thenable, None))
}

/// The value a promise is settled with.
pub(super) enum Settlement {
  Fulfill(sys::napi_value),
  Reject(sys::napi_value),
}

/// Own property of the thenable that carries its [`Handle`].
const HANDLE_KEY: &std::ffi::CStr = c"handle";
/// Own property of a kept outcome's holder object.
const VALUE_KEY: &std::ffi::CStr = c"value";
/// Generations wrap below 2^20, so `generation << 32 | index` is exact in an `f64`.
const GENERATION_MASK: u32 = (1 << 20) - 1;

/// Names one [`Slot`]. Travels through JavaScript as a number on the thenable, so a stale or
/// forged one must be harmless: a slot is only used when its generation and env match.
#[derive(Clone, Copy, PartialEq, Eq)]
struct Handle {
  index: u32,
  generation: u32,
}

impl Handle {
  fn to_f64(self) -> f64 {
    (((self.generation as u64) << 32) | self.index as u64) as f64
  }

  fn from_f64(value: f64) -> Option<Handle> {
    if !(0.0..(1u64 << 52) as f64).contains(&value) || value.trunc() != value {
      return None;
    }
    let bits = value as u64;
    Some(Handle {
      index: bits as u32,
      generation: (bits >> 32) as u32,
    })
  }
}

enum SlotState {
  /// `then` has not been called yet.
  Waiting,
  /// `then` was called: the promise's resolving functions.
  Resolvers {
    resolve: sys::napi_ref,
    reject: sys::napi_ref,
  },
  /// The task finished before `then` was called: a holder object whose own `value` property is
  /// the outcome.
  Kept {
    fulfill: bool,
    holder: sys::napi_ref,
  },
}

/// What one task's promise needs to be settled.
struct Slot {
  env: sys::napi_env,
  /// Whether the task's [`ThenableSettler`] still exists.
  owned: bool,
  state: SlotState,
}

struct Entry {
  generation: u32,
  slot: Option<Slot>,
}

/// A table of [`Slot`]s. Generations come from one counter, not per entry, so the table can be
/// dropped whole once it is empty without a later slot reusing a stale handle's generation.
#[derive(Default)]
struct Slots {
  entries: Vec<Entry>,
  free: Vec<u32>,
  next_generation: u32,
}

/// An empty table bigger than this gives its memory back.
const RETAINED_SLOTS: usize = 1024;

impl Slots {
  fn insert(&mut self, slot: Slot) -> Handle {
    let generation = self.next_generation;
    self.next_generation = (generation + 1) & GENERATION_MASK;
    let entry = Entry {
      generation,
      slot: Some(slot),
    };
    let index = match self.free.pop() {
      Some(index) => {
        self.entries[index as usize] = entry;
        index
      }
      None => {
        self.entries.push(entry);
        (self.entries.len() - 1) as u32
      }
    };
    Handle { index, generation }
  }

  fn get_mut(&mut self, handle: Handle, env: sys::napi_env) -> Option<&mut Slot> {
    let entry = self.entries.get_mut(handle.index as usize)?;
    if entry.generation != handle.generation {
      return None;
    }
    entry.slot.as_mut().filter(|slot| slot.env == env)
  }

  /// Frees the slot `handle` names (which must exist), so the handle never matches again.
  fn remove(&mut self, handle: Handle) -> Slot {
    let slot = self.entries[handle.index as usize]
      .slot
      .take()
      .expect("a slot is removed once");
    self.free.push(handle.index);
    STATES_FREED.fetch_add(1, Ordering::Relaxed);
    slot
  }

  /// Gives the memory of a large table back once no slot is in use. Kept apart from
  /// [`Self::remove`], so a sweep can remove while it walks the table.
  fn shrink_if_idle(&mut self) {
    if self.free.len() == self.entries.len() && self.entries.capacity() > RETAINED_SLOTS {
      self.entries = Vec::new();
      self.free = Vec::new();
    }
  }
}

thread_local! {
  // A slot is only touched on its env's JavaScript thread: the task is created, completed and
  // dropped there, and `then` is called there. One thread can host several envs (a reload, a
  // hardlinked copy), so every lookup also matches the env. The borrow is never held across a
  // call that can run JavaScript, which could create or settle another task.
  static SLOTS: RefCell<Slots> = RefCell::new(Slots::default());
}

fn with_slots<R>(f: impl FnOnce(&mut Slots) -> R) -> Option<R> {
  SLOTS
    .try_with(|slots| {
      slots.try_borrow_mut().ok().map(|mut slots| {
        let result = f(&mut slots);
        slots.shrink_if_idle();
        result
      })
    })
    .ok()
    .flatten()
}

/// What [`ThenableSettler::settle`] found in its slot.
enum Observed {
  Waiting,
  Resolvers(sys::napi_ref, sys::napi_ref),
  /// Already settled or kept (or the slot is unreachable).
  Settled,
}

/// Owns the settle side of one promise.
pub(super) enum PromiseSettler {
  Deferred(DeferredSettler),
  Thenable(ThenableSettler),
}

impl PromiseSettler {
  /// Settles the promise once. Returns the raw status of the settling call, so the caller can
  /// tell a refusal (teardown, pending exception) from success.
  fn settle(&mut self, settlement: &Settlement) -> sys::napi_status {
    match self {
      PromiseSettler::Deferred(settler) => settler.settle(settlement),
      PromiseSettler::Thenable(settler) => settler.settle(settlement),
    }
  }

  /// Whether `settle` may run again after it reported an exception. A deferred whose settling
  /// call ran is gone (Node frees it before it reports what the call caught), so it may not.
  fn can_retry(&self) -> bool {
    match self {
      PromiseSettler::Deferred(settler) => settler.deferred.is_some(),
      PromiseSettler::Thenable(_) => true,
    }
  }

  /// Ends a promise that was never handed to JavaScript (`async_work::run` failed to create or
  /// queue the work): a deferred is resolved with `undefined`, so it is freed and no rejection
  /// goes unhandled; a thenable state is released.
  pub(super) fn discard(&mut self) {
    match self {
      PromiseSettler::Deferred(settler) => settler.discard(),
      PromiseSettler::Thenable(settler) => settler.release(),
    }
  }
}

/// The deferred of a promise settled at completion ([`SettleMode::Deferred`]). Dropping it
/// settles nothing: a deferred nobody settled stays with the env, as before #3689. Deferred mode
/// is only picked where that env dies with its process or realm.
pub(super) struct DeferredSettler {
  env: sys::napi_env,
  /// `None` once a settling call ran: Node frees the deferred inside that call.
  deferred: Option<sys::napi_deferred>,
  /// The env refused a settling call because it cannot run JavaScript any more.
  refused: bool,
}

impl DeferredSettler {
  fn settle(&mut self, settlement: &Settlement) -> sys::napi_status {
    let Some(deferred) = self.deferred.take() else {
      return sys::Status::napi_generic_failure;
    };
    let status = unsafe {
      match *settlement {
        Settlement::Fulfill(value) => sys::napi_resolve_deferred(self.env, deferred, value),
        Settlement::Reject(value) => sys::napi_reject_deferred(self.env, deferred, value),
      }
    };
    // `NAPI_PREAMBLE` refused before the deferred was touched (Node and emnapi). Node also
    // returns `napi_pending_exception` AFTER it freed the deferred when the call caught an
    // exception (`delete deferred_ref`, then `GET_RETURN_STATUS`). `conclude` clears
    // exceptions before calling, so an exception pending now came from inside the call: then
    // the deferred is gone.
    if matches!(
      status,
      sys::Status::napi_pending_exception | sys::Status::napi_cannot_run_js
    ) && !exception_pending(self.env)
    {
      self.deferred = Some(deferred);
      self.refused = true;
    }
    status
  }

  /// Resolves a deferred nobody settled with `undefined`, so it is freed. Skipped after a
  /// refusal: the env is going away and would refuse again. A pending exception is set aside
  /// and thrown again afterwards.
  fn discard(&mut self) {
    if self.deferred.is_none() || self.refused {
      return;
    }
    let env = self.env;
    let pending = take_pending_exception(env);
    let mut undefined = ptr::null_mut();
    if unsafe { sys::napi_get_undefined(env, &mut undefined) } == sys::Status::napi_ok {
      let _ = self.settle(&Settlement::Fulfill(undefined));
    }
    if let Some(exception) = pending {
      unsafe { sys::napi_throw(env, exception) };
    }
  }
}

/// Whether an exception is pending on `env`. `napi_is_exception_pending` has no
/// `NAPI_PREAMBLE`. `false` when it cannot tell.
fn exception_pending(env: sys::napi_env) -> bool {
  let mut pending = false;
  (unsafe { sys::napi_is_exception_pending(env, &mut pending) } == sys::Status::napi_ok) && pending
}

/// The thenable state of one promise ([`SettleMode::Thenable`]). Dropping it releases what it
/// holds, settled or not, so every path that ends an `AsyncWork` — normal settlement, a
/// settlement refused during teardown, a failed create/queue, a cancellation — frees it.
pub(super) struct ThenableSettler {
  env: sys::napi_env,
  handle: Option<Handle>,
}

impl ThenableSettler {
  /// Settles the promise once, in thenable mode. Returns the raw status of the settling call,
  /// so the caller can tell a refusal (teardown, pending exception) from success.
  fn settle(&mut self, settlement: &Settlement) -> sys::napi_status {
    let Some(handle) = self.handle else {
      return sys::Status::napi_generic_failure;
    };
    let (value, fulfill) = match *settlement {
      Settlement::Fulfill(value) => (value, true),
      Settlement::Reject(value) => (value, false),
    };
    let env = self.env;
    let state = with_slots(
      |slots| match slots.get_mut(handle, env).map(|slot| &slot.state) {
        Some(SlotState::Waiting) => Observed::Waiting,
        Some(&SlotState::Resolvers { resolve, reject }) => Observed::Resolvers(resolve, reject),
        Some(SlotState::Kept { .. }) | None => Observed::Settled,
      },
    )
    .unwrap_or(Observed::Settled);
    match state {
      // `then` was called: settle through the promise's own resolving function.
      Observed::Resolvers(resolve, reject) => {
        let status = call_resolving_function(env, if fulfill { resolve } else { reject }, value);
        if status == sys::Status::napi_ok {
          self.release();
        }
        status
      }
      // `then` has not been called yet: keep the outcome for it, if JavaScript can still run.
      Observed::Waiting => keep_outcome(env, handle, fulfill, value),
      Observed::Settled => sys::Status::napi_generic_failure,
    }
  }

  fn release(&mut self) {
    let Some(handle) = self.handle.take() else {
      return;
    };
    let env = self.env;
    let resolvers = with_slots(|slots| {
      let slot = slots.get_mut(handle, env)?;
      match slot.state {
        // Settled or not, `then` has run and will not run again.
        SlotState::Resolvers { resolve, reject } => {
          slots.remove(handle);
          Some((resolve, reject))
        }
        // Nothing to settle any more; a `then` that still comes finds no slot and does nothing.
        SlotState::Waiting => {
          slots.remove(handle);
          None
        }
        // The kept outcome now waits for `then` alone (or for env teardown).
        SlotState::Kept { .. } => {
          slot.owned = false;
          None
        }
      }
    })
    .flatten();
    if let Some((resolve, reject)) = resolvers {
      // No `NAPI_PREAMBLE` on Node or emnapi: legal while the env refuses to run JavaScript
      // and while an exception is pending. The completion callback that drops this runs before
      // the env is freed.
      unsafe {
        sys::napi_delete_reference(env, resolve);
        sys::napi_delete_reference(env, reject);
      }
      RESOLVERS_RELEASED.fetch_add(1, Ordering::Relaxed);
    }
  }
}

impl Drop for ThenableSettler {
  fn drop(&mut self) {
    self.release();
  }
}

/// `function(value)` with `undefined` as `this`, where `function` is behind `reference`.
fn call_resolving_function(
  env: sys::napi_env,
  reference: sys::napi_ref,
  value: sys::napi_value,
) -> sys::napi_status {
  let mut function = ptr::null_mut();
  let status = unsafe { sys::napi_get_reference_value(env, reference, &mut function) };
  if status != sys::Status::napi_ok {
    return status;
  }
  if function.is_null() {
    // Strong references (refcount 1) cannot be collected; nothing else can empty them.
    return sys::Status::napi_generic_failure;
  }
  call_with_undefined_this(env, function, value)
}

fn call_with_undefined_this(
  env: sys::napi_env,
  function: sys::napi_value,
  value: sys::napi_value,
) -> sys::napi_status {
  let mut undefined = ptr::null_mut();
  let status = unsafe { sys::napi_get_undefined(env, &mut undefined) };
  if status != sys::Status::napi_ok {
    return status;
  }
  unsafe { sys::napi_call_function(env, undefined, function, 1, &value, ptr::null_mut()) }
}

/// Keeps the outcome of a task that finished before its promise's `then` was called.
///
/// Refused — with the status `napi_call_function` would have given — when the env cannot run
/// JavaScript: `then` can then never be called, and [`conclude`] treats it as teardown.
/// `napi_strict_equals` is the probe because it has a `NAPI_PREAMBLE` (Node and emnapi) and
/// runs no JavaScript.
fn keep_outcome(
  env: sys::napi_env,
  handle: Handle,
  fulfill: bool,
  value: sys::napi_value,
) -> sys::napi_status {
  let mut equal = false;
  let status = unsafe { sys::napi_strict_equals(env, value, value, &mut equal) };
  if status != sys::Status::napi_ok {
    return status;
  }
  // A plain object holds the value: references to primitives need Node-API 10.
  let mut holder = ptr::null_mut();
  let status = unsafe { sys::napi_create_object(env, &mut holder) };
  if status != sys::Status::napi_ok {
    return status;
  }
  let status = define_own_data_property(env, holder, VALUE_KEY, value);
  if status != sys::Status::napi_ok {
    return status;
  }
  let mut holder_ref = ptr::null_mut();
  let status = unsafe { sys::napi_create_reference(env, holder, 1, &mut holder_ref) };
  if status != sys::Status::napi_ok {
    return status;
  }
  let kept = with_slots(|slots| match slots.get_mut(handle, env) {
    Some(slot) if matches!(slot.state, SlotState::Waiting) => {
      slot.state = SlotState::Kept {
        fulfill,
        holder: holder_ref,
      };
      true
    }
    _ => false,
  })
  .unwrap_or(false);
  if !kept {
    unsafe { sys::napi_delete_reference(env, holder_ref) };
    return sys::Status::napi_generic_failure;
  }
  sys::Status::napi_ok
}

/// Defines `object[key] = value` as an own data property: an accessor or a setter on the
/// prototype chain is never consulted (`napi_set_named_property` would call it).
fn define_own_data_property(
  env: sys::napi_env,
  object: sys::napi_value,
  key: &std::ffi::CStr,
  value: sys::napi_value,
) -> sys::napi_status {
  let descriptor = data_property(key, value);
  unsafe { sys::napi_define_properties(env, object, 1, &descriptor) }
}

fn data_property(key: &std::ffi::CStr, value: sys::napi_value) -> sys::napi_property_descriptor {
  sys::napi_property_descriptor {
    utf8name: key.as_ptr(),
    name: ptr::null_mut(),
    method: None,
    getter: None,
    setter: None,
    value,
    // All three attributes send Node to its `CreateDataProperty` fast path, which still defines
    // an own property and never consults the prototype chain. Nothing else holds the object.
    attributes: sys::PropertyAttributes::writable
      | sys::PropertyAttributes::enumerable
      | sys::PropertyAttributes::configurable,
    data: ptr::null_mut(),
  }
}

/// Reads `object[key]` where `key` is an own data property this module defined: no prototype
/// lookup, no user code.
fn own_data_property(
  env: sys::napi_env,
  object: sys::napi_value,
  key: &std::ffi::CStr,
) -> Option<sys::napi_value> {
  let mut value = ptr::null_mut();
  (unsafe { sys::napi_get_named_property(env, object, key.as_ptr(), &mut value) }
    == sys::Status::napi_ok
    && !value.is_null())
  .then_some(value)
}

/// The thenable's `then`, shared by every task of an env. The promise's resolve job calls it
/// with the thenable as `this` and the promise's resolving functions, which are kept in the
/// task's slot. A slot that already holds the task's outcome is settled right here instead.
unsafe extern "C" fn thenable_then(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> sys::napi_value {
  let mut argc = 2;
  let mut argv = [ptr::null_mut(); 2];
  let mut this = ptr::null_mut();
  if unsafe {
    sys::napi_get_cb_info(
      env,
      info,
      &mut argc,
      argv.as_mut_ptr(),
      &mut this,
      ptr::null_mut(),
    )
  } != sys::Status::napi_ok
    || argc < 2
  {
    return ptr::null_mut();
  }
  let Some(handle) = thenable_handle(env, this) else {
    return ptr::null_mut();
  };
  let kept = with_slots(|slots| {
    let slot = slots.get_mut(handle, env)?;
    match slot.state {
      SlotState::Waiting => {
        let mut resolve = ptr::null_mut();
        let mut reject = ptr::null_mut();
        // `napi_create_reference` runs no JavaScript, so the borrow may stay held.
        unsafe {
          if sys::napi_create_reference(env, argv[0], 1, &mut resolve) != sys::Status::napi_ok {
            return None;
          }
          if sys::napi_create_reference(env, argv[1], 1, &mut reject) != sys::Status::napi_ok {
            sys::napi_delete_reference(env, resolve);
            return None;
          }
        }
        slot.state = SlotState::Resolvers { resolve, reject };
        None
      }
      // Called again: the first call already took the resolving functions.
      SlotState::Resolvers { .. } => None,
      SlotState::Kept { fulfill, holder } => {
        // Settle below, outside the borrow. A task that still owns the slot stops caring once
        // its outcome is kept, so the slot goes now either way.
        slots.remove(handle);
        Some((fulfill, holder))
      }
    }
  })
  .flatten();
  if let Some((fulfill, holder)) = kept {
    let mut holder_value = ptr::null_mut();
    if unsafe { sys::napi_get_reference_value(env, holder, &mut holder_value) }
      == sys::Status::napi_ok
      && !holder_value.is_null()
    {
      if let Some(value) = own_data_property(env, holder_value, VALUE_KEY) {
        // A resolving function never throws; anything pending afterwards came from elsewhere
        // and propagates to the job, which ignores it once the promise is settled.
        call_with_undefined_this(env, argv[if fulfill { 0 } else { 1 }], value);
      }
    }
    unsafe { sys::napi_delete_reference(env, holder) };
  }
  ptr::null_mut()
}

fn thenable_handle(env: sys::napi_env, thenable: sys::napi_value) -> Option<Handle> {
  let mut value_type = sys::ValueType::napi_undefined;
  if unsafe { sys::napi_typeof(env, thenable, &mut value_type) } != sys::Status::napi_ok
    || value_type != sys::ValueType::napi_object
  {
    return None;
  }
  let handle = own_data_property(env, thenable, HANDLE_KEY)?;
  let mut number = 0.0;
  if unsafe { sys::napi_get_value_double(env, handle, &mut number) } != sys::Status::napi_ok {
    return None;
  }
  Handle::from_f64(number)
}

/// The `then` function of `env`: `cached`, the one in the env's registration record, or one
/// created and cached on first use. A fresh one when there is no record to keep it in (wasm
/// below Node-API 3, an env that never registered this addon).
fn then_function(env: sys::napi_env, cached: Option<sys::napi_ref>) -> Result<sys::napi_value> {
  if let Some(reference) = cached {
    let mut function = ptr::null_mut();
    if unsafe { sys::napi_get_reference_value(env, reference, &mut function) }
      == sys::Status::napi_ok
      && !function.is_null()
    {
      return Ok(function);
    }
  }
  let mut function = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_create_function(
        env,
        c"then".as_ptr().cast(),
        4,
        Some(thenable_then),
        ptr::null_mut(),
        &mut function,
      )
    },
    "Create promise thenable failed in async_work::run"
  )?;
  let mut reference = ptr::null_mut();
  if unsafe { sys::napi_create_reference(env, function, 1, &mut reference) } == sys::Status::napi_ok
    && !crate::bindgen_runtime::env_registration::set_promise_then(env, reference)
  {
    unsafe { sys::napi_delete_reference(env, reference) };
  }
  Ok(function)
}

/// `{ then, handle }` as own data properties.
fn create_thenable(
  env: sys::napi_env,
  handle: Handle,
  cached_then: Option<sys::napi_ref>,
) -> Result<sys::napi_value> {
  let then = then_function(env, cached_then)?;
  let mut number = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_create_double(env, handle.to_f64(), &mut number) },
    "Create promise thenable failed in async_work::run"
  )?;
  let mut thenable = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_create_object(env, &mut thenable) },
    "Create promise thenable failed in async_work::run"
  )?;
  let properties = [
    data_property(c"then", then),
    data_property(HANDLE_KEY, number),
  ];
  check_status!(
    unsafe { sys::napi_define_properties(env, thenable, properties.len(), properties.as_ptr()) },
    "Create promise thenable failed in async_work::run"
  )?;
  Ok(thenable)
}

/// Creates the promise for one task, settled the way `env`'s [`SettleMode`] says: in deferred
/// mode the returned settler keeps the deferred for the task's completion; in thenable mode the
/// deferred is settled right away with a thenable whose `then` hands the promise's resolving
/// functions to the returned settler.
pub(super) fn create(env: sys::napi_env) -> Result<(sys::napi_value, PromiseSettler)> {
  let (mode, cached_then) = settle_mode_of(env);
  let mut promise = ptr::null_mut();
  let mut deferred = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_create_promise(env, &mut deferred, &mut promise) },
    "Create promise failed in async_work::run"
  )?;
  match mode {
    SettleMode::Deferred => Ok((
      promise,
      PromiseSettler::Deferred(DeferredSettler {
        env,
        deferred: Some(deferred),
        refused: false,
      }),
    )),
    SettleMode::Thenable => create_thenable_settler(env, deferred, cached_then)
      .map(|settler| (promise, PromiseSettler::Thenable(settler))),
  }
}

/// Settles `deferred` right away with a thenable whose `then` hands the promise's resolving
/// functions to the returned settler.
fn create_thenable_settler(
  env: sys::napi_env,
  deferred: sys::napi_deferred,
  cached_then: Option<sys::napi_ref>,
) -> Result<ThenableSettler> {
  let handle = with_slots(|slots| {
    slots.insert(Slot {
      env,
      owned: true,
      state: SlotState::Waiting,
    })
  });
  // Dropping the settler on an error below frees the slot.
  let settler = ThenableSettler { env, handle };
  let thenable = match handle {
    Some(handle) => create_thenable(env, handle, cached_then),
    None => Err(Error::new(
      Status::GenericFailure,
      "Promise state unavailable in async_work::run".to_owned(),
    )),
  };
  let status = match thenable {
    Ok(thenable) => unsafe { sys::napi_resolve_deferred(env, deferred, thenable) },
    Err(err) => {
      // The promise is never handed out; settling frees its deferred while the env allows.
      let mut undefined = ptr::null_mut();
      unsafe {
        if sys::napi_get_undefined(env, &mut undefined) == sys::Status::napi_ok {
          sys::napi_resolve_deferred(env, deferred, undefined);
        }
      }
      return Err(err);
    }
  };
  check_status!(
    status,
    "Resolve promise with thenable failed in async_work::run"
  )?;
  Ok(settler)
}

/// Env-teardown sweep, called from the env's registration cleanup: frees the kept outcomes of
/// tasks whose `then` never came. Nothing can call `then` for this env any more. Slots still
/// owned by a task are left to it: its completion callback runs before the env is freed.
#[cfg(all(
  not(feature = "noop"),
  any(feature = "napi3", not(target_family = "wasm"))
))]
pub(crate) fn release_env_promise_states(env: sys::napi_env) {
  let holders = with_slots(|slots| {
    let mut holders = Vec::new();
    for index in 0..slots.entries.len() {
      let entry = &slots.entries[index];
      let Some(slot) = entry.slot.as_ref() else {
        continue;
      };
      if slot.env != env || slot.owned {
        continue;
      }
      let handle = Handle {
        index: index as u32,
        generation: entry.generation,
      };
      if let SlotState::Kept { holder, .. } = slots.remove(handle).state {
        holders.push(holder);
      }
    }
    holders
  })
  .unwrap_or_default();
  for holder in holders {
    unsafe { sys::napi_delete_reference(env, holder) };
  }
}

/// Takes the exception pending on `env`, if any. Neither call has a `NAPI_PREAMBLE`.
pub(super) fn take_pending_exception(env: sys::napi_env) -> Option<sys::napi_value> {
  let mut pending = false;
  if unsafe { sys::napi_is_exception_pending(env, &mut pending) } != sys::Status::napi_ok
    || !pending
  {
    return None;
  }
  let mut exception = ptr::null_mut();
  if unsafe { sys::napi_get_and_clear_last_exception(env, &mut exception) } != sys::Status::napi_ok
  {
    return None;
  }
  Some(exception)
}

/// Settles `settler` with `settlement`, reporting whether the promise was settled.
///
/// Node and emnapi refuse every settling call (`napi_resolve_deferred` /
/// `napi_reject_deferred` in deferred mode; `napi_call_function`, and the `napi_strict_equals`
/// probe before keeping an outcome, in thenable mode) in two unrelated states, with the same
/// status for module API < 10 (`napi_pending_exception`; API >= 10 says `napi_cannot_run_js`
/// for the first one):
///
/// * the env is tearing down and cannot run JavaScript. Nothing can settle the promise any
///   more, and nothing should run against the env, so `Ok(false)` is returned and the caller
///   skips `finally`. The settler still releases its references when it is dropped.
/// * the env is live but an exception is pending — the task's `resolve`/`reject`, a value
///   conversion, or a getter threw during this completion. Refusing here used to look like
///   teardown and left the promise pending forever. Since that exception is what the task
///   produced, it is taken and the promise is rejected with it, and `finally` runs as usual.
///
/// A pending exception is checked before settling, and again after a refusal, because the
/// settling call itself can throw (a `then` getter cannot: the resolving functions catch it).
/// It is retried once, so a callee that keeps throwing ends with the exception still pending,
/// where the completion callback's caller reports it as uncaught. A deferred settler retries
/// nothing: Node frees the deferred before it reports an exception the call caught, so the
/// exception stays pending and `finally` is skipped.
pub(super) fn conclude(
  env: sys::napi_env,
  settler: &mut PromiseSettler,
  settlement: Result<Settlement>,
) -> Result<bool> {
  let mut settlement = match take_pending_exception(env) {
    Some(exception) => Settlement::Reject(exception),
    // No JavaScript exception to reject with: a settlement that could not even be built goes to
    // the caller, which throws it.
    None => settlement?,
  };
  let mut retried = false;
  loop {
    match settler.settle(&settlement) {
      sys::Status::napi_ok => return Ok(true),
      sys::Status::napi_pending_exception | sys::Status::napi_cannot_run_js => {
        if !retried && settler.can_retry() {
          if let Some(exception) = take_pending_exception(env) {
            settlement = Settlement::Reject(exception);
            retried = true;
            continue;
          }
        }
        // Either the env refused because it cannot run JavaScript (no exception pending), or the
        // retried settlement threw again (only a tampered emnapi `napi_call_function` on WASI):
        // that exception stays pending for the completion callback's caller to report.
        return Ok(false);
      }
      status => {
        return Err(Error::new(
          Status::from(status),
          "Settle async task promise failed".to_owned(),
        ))
      }
    }
  }
}
