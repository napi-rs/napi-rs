//! The promise an `AsyncTask` / `Env::spawn` hands to JavaScript, and how it is settled.
//!
//! `napi_create_promise` hands back a `napi_deferred` that only `napi_resolve_deferred` /
//! `napi_reject_deferred` free. Both begin with `NAPI_PREAMBLE`, which refuses once the env can
//! no longer run JavaScript. A worker that is terminated while a task is queued or running still
//! runs the task's completion callback during teardown (Node drains the threadpool before it
//! frees the env), and the deferred it settles there is never freed: 16 bytes of C++ heap per
//! task, per terminated worker, on every Node version.
//!
//! So when it can, this module builds the promise with the intrinsic `Promise` constructor and a
//! native executor instead, and keeps the executor's `resolve` / `reject` functions behind two
//! `napi_ref`s. `napi_delete_reference` has no `NAPI_PREAMBLE` (Node and emnapi alike), so the
//! references are deleted on every path, including a settlement the env refused.
//!
//! The constructor is read off the global object **once per env, at module registration**
//! ([`cache_promise_intrinsics_for_env`]), never per task: `globalThis.Promise` is writable, and
//! a later reassignment must not change what an `AsyncTask` returns. Registration is the same
//! trust boundary as the `Reflect` capture in `error.rs`. The candidate is also probed there and
//! only kept when it builds a real promise whose prototype is the one `napi_create_promise`
//! uses, so a replaced global (a polyfill, `zone.js`, a subclass) keeps today's behavior.
//!
//! Whenever the cache is missing — `napi1`/`napi2` builds (no env cleanup hook to release the
//! cache with), a failed probe or hook, an env that never registered this addon, or a teardown
//! that already released the cache — [`create`] falls back to `napi_create_promise`.
//!
//! Settling never reads a property user code can reach: `resolve` / `reject` are the built-in
//! resolving functions of this very promise, called directly.

use std::cell::{Cell, RefCell};
#[cfg(all(feature = "napi3", not(feature = "noop")))]
use std::ffi::c_void;
use std::ptr;

use crate::{check_status, sys, Error, Result, Status};

/// The value a promise is settled with.
pub(super) enum Settlement {
  Fulfill(sys::napi_value),
  Reject(sys::napi_value),
}

enum Handle {
  /// The built-in resolving functions of a promise built by the cached intrinsic.
  Resolvers {
    resolve: sys::napi_ref,
    reject: sys::napi_ref,
  },
  /// `napi_create_promise` fallback. A deferred the env refuses to settle cannot be freed.
  Deferred(sys::napi_deferred),
  /// Settled, or the references were released.
  Released,
}

/// Owns the settle side of one promise. Dropping it releases the resolving functions, settled or
/// not, so every path that ends an `AsyncWork` — normal settlement, a settlement refused during
/// teardown, a failed create/queue, a cancellation — frees them.
pub(super) struct PromiseSettler {
  env: sys::napi_env,
  handle: Handle,
}

impl PromiseSettler {
  /// Settles the promise once. Returns the raw status of the settling call, so the caller can
  /// tell a refusal (teardown, pending exception) from success.
  fn settle(&mut self, settlement: &Settlement) -> sys::napi_status {
    let (value, fulfill) = match *settlement {
      Settlement::Fulfill(value) => (value, true),
      Settlement::Reject(value) => (value, false),
    };
    match self.handle {
      Handle::Resolvers { resolve, reject } => {
        let mut function = ptr::null_mut();
        let status = unsafe {
          sys::napi_get_reference_value(
            self.env,
            if fulfill { resolve } else { reject },
            &mut function,
          )
        };
        if status != sys::Status::napi_ok {
          return status;
        }
        if function.is_null() {
          // Strong references (refcount 1) cannot be collected; nothing else can empty them.
          return sys::Status::napi_generic_failure;
        }
        let mut undefined = ptr::null_mut();
        let status = unsafe { sys::napi_get_undefined(self.env, &mut undefined) };
        if status != sys::Status::napi_ok {
          return status;
        }
        let status = unsafe {
          sys::napi_call_function(self.env, undefined, function, 1, &value, ptr::null_mut())
        };
        if status == sys::Status::napi_ok {
          self.release();
        }
        status
      }
      Handle::Deferred(deferred) => {
        let status = unsafe {
          if fulfill {
            sys::napi_resolve_deferred(self.env, deferred, value)
          } else {
            sys::napi_reject_deferred(self.env, deferred, value)
          }
        };
        // Success frees the deferred. A refusal leaves it alive, so a retry stays possible.
        if status == sys::Status::napi_ok {
          self.handle = Handle::Released;
        }
        status
      }
      Handle::Released => sys::Status::napi_generic_failure,
    }
  }

  fn release(&mut self) {
    if let Handle::Resolvers { resolve, reject } =
      std::mem::replace(&mut self.handle, Handle::Released)
    {
      // No `NAPI_PREAMBLE` on Node or emnapi: legal while the env refuses to run JavaScript
      // and while an exception is pending. The completion callback that drops this runs before
      // the env is freed.
      unsafe {
        sys::napi_delete_reference(self.env, resolve);
        sys::napi_delete_reference(self.env, reject);
      }
    }
  }
}

impl Drop for PromiseSettler {
  fn drop(&mut self) {
    self.release();
  }
}

/// Takes the exception pending on `env`, if any. Neither call has a `NAPI_PREAMBLE`.
fn take_pending_exception(env: sys::napi_env) -> Option<sys::napi_value> {
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
/// Node and emnapi refuse every settling call (`napi_call_function`, `napi_*_deferred`) in two
/// unrelated states, with the same status for module API < 10 (`napi_pending_exception`; API
/// >= 10 says `napi_cannot_run_js` for the first one):
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
/// where the completion callback's caller reports it as uncaught.
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
        if !retried {
          if let Some(exception) = take_pending_exception(env) {
            settlement = Settlement::Reject(exception);
            retried = true;
            continue;
          }
        }
        // No exception pending: the env refused because it cannot run JavaScript.
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

/// Creates the promise for one task: through the env's cached intrinsic when there is one,
/// `napi_create_promise` otherwise.
pub(super) fn create(env: sys::napi_env) -> Result<(sys::napi_value, PromiseSettler)> {
  if let Some((promise, resolve, reject)) = create_with_cached_intrinsic(env) {
    return Ok((
      promise,
      PromiseSettler {
        env,
        handle: Handle::Resolvers { resolve, reject },
      },
    ));
  }
  let mut promise = ptr::null_mut();
  let mut deferred = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_create_promise(env, &mut deferred, &mut promise) },
    "Create promise failed in async_work::run"
  )?;
  Ok((
    promise,
    PromiseSettler {
      env,
      handle: Handle::Deferred(deferred),
    },
  ))
}

/// The load-time `Promise` constructor and executor of one env, each behind a strong reference.
struct PromiseIntrinsics {
  env: sys::napi_env,
  constructor: sys::napi_ref,
  executor: sys::napi_ref,
}

type CapturedResolvers = Option<(sys::napi_ref, sys::napi_ref)>;

thread_local! {
  // Keyed by env: one OS thread can host several envs of this addon (a `delete require.cache`
  // reload, a hardlinked copy). An entry exists only while its env cleanup hook is installed,
  // and that hook removes it, so a later env that reuses the address never matches a stale one.
  static PROMISE_INTRINSICS: RefCell<Vec<PromiseIntrinsics>> = const { RefCell::new(Vec::new()) };
  // Where `capture_resolvers` writes. Set only around the synchronous `napi_new_instance` call
  // in `construct`; null otherwise, so a stray call of the executor records nothing.
  static CAPTURE_SLOT: Cell<*mut CapturedResolvers> = const { Cell::new(ptr::null_mut()) };
}

/// The native executor shared by every promise of one env. The intrinsic `Promise` constructor
/// calls it synchronously with the promise's resolving functions, before `napi_new_instance`
/// returns. The handles to them die with this callback's scope, so they are referenced here.
#[cfg(all(feature = "napi3", not(feature = "noop")))]
unsafe extern "C" fn capture_resolvers(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> sys::napi_value {
  let slot = CAPTURE_SLOT.with(Cell::get);
  if slot.is_null() {
    return ptr::null_mut();
  }
  // SAFETY: `construct` points the slot at its own stack local for exactly the duration of
  // `napi_new_instance`, which is the only call that runs this executor on this thread.
  let slot = unsafe { &mut *slot };
  if slot.is_some() {
    return ptr::null_mut();
  }
  let mut argc = 2;
  let mut argv = [ptr::null_mut(); 2];
  if unsafe {
    sys::napi_get_cb_info(
      env,
      info,
      &mut argc,
      argv.as_mut_ptr(),
      ptr::null_mut(),
      ptr::null_mut(),
    )
  } != sys::Status::napi_ok
    || argc < 2
  {
    return ptr::null_mut();
  }
  let mut resolve = ptr::null_mut();
  if unsafe { sys::napi_create_reference(env, argv[0], 1, &mut resolve) } != sys::Status::napi_ok {
    return ptr::null_mut();
  }
  let mut reject = ptr::null_mut();
  if unsafe { sys::napi_create_reference(env, argv[1], 1, &mut reject) } != sys::Status::napi_ok {
    unsafe { sys::napi_delete_reference(env, resolve) };
    return ptr::null_mut();
  }
  *slot = Some((resolve, reject));
  ptr::null_mut()
}

/// `new constructor(executor)`, returning the promise and references to its resolving functions.
/// `None` when the constructor failed or did not call the executor; any exception it left is
/// kept pending, so the caller's fallback reports it.
fn construct(
  env: sys::napi_env,
  constructor: sys::napi_value,
  executor: sys::napi_value,
) -> Option<(sys::napi_value, sys::napi_ref, sys::napi_ref)> {
  let mut captured: CapturedResolvers = None;
  let previous = CAPTURE_SLOT.with(|slot| slot.replace(&mut captured));
  let mut promise = ptr::null_mut();
  let status = unsafe { sys::napi_new_instance(env, constructor, 1, &executor, &mut promise) };
  CAPTURE_SLOT.with(|slot| slot.set(previous));
  match captured {
    Some((resolve, reject)) if status == sys::Status::napi_ok && !promise.is_null() => {
      Some((promise, resolve, reject))
    }
    Some((resolve, reject)) => {
      unsafe {
        sys::napi_delete_reference(env, resolve);
        sys::napi_delete_reference(env, reject);
      }
      None
    }
    None => None,
  }
}

fn create_with_cached_intrinsic(
  env: sys::napi_env,
) -> Option<(sys::napi_value, sys::napi_ref, sys::napi_ref)> {
  let (constructor, executor) = PROMISE_INTRINSICS.with(|cache| {
    cache
      .borrow()
      .iter()
      .find(|entry| entry.env == env)
      .map(|entry| (entry.constructor, entry.executor))
  })?;
  let constructor = reference_value(env, constructor)?;
  let executor = reference_value(env, executor)?;
  construct(env, constructor, executor)
}

fn reference_value(env: sys::napi_env, reference: sys::napi_ref) -> Option<sys::napi_value> {
  let mut value = ptr::null_mut();
  if unsafe { sys::napi_get_reference_value(env, reference, &mut value) } != sys::Status::napi_ok
    || value.is_null()
  {
    return None;
  }
  Some(value)
}

/// Clears an exception this module caused while probing, so registration goes on.
#[cfg(all(feature = "napi3", not(feature = "noop")))]
fn clear_pending_exception(env: sys::napi_env) {
  let _ = take_pending_exception(env);
}

/// Reads `globalThis.Promise` for `env`, probes it, and caches it with a native executor, so
/// [`create`] never reads the global again. Called once per registration of this addon on an
/// env, before any export callback runs.
///
/// Cached only when the env cleanup hook that releases the cache is installed (`napi3`; on wasm
/// through emnapi's `napi` import). Without it a recycled env address could match a dead entry,
/// and the cache would leak the references the change is meant to free.
///
/// Best effort: a failure clears the exception it caused and leaves the env on
/// `napi_create_promise`.
#[cfg(all(feature = "napi3", not(feature = "noop")))]
pub(crate) fn cache_promise_intrinsics_for_env(env: sys::napi_env) {
  // The same live env registering this addon again (`delete require.cache`): the entry and its
  // hook are already in place, and Node aborts on a duplicate `(fn, arg)` cleanup hook.
  if PROMISE_INTRINSICS.with(|cache| cache.borrow().iter().any(|entry| entry.env == env)) {
    return;
  }
  let mut global = ptr::null_mut();
  if unsafe { sys::napi_get_global(env, &mut global) } != sys::Status::napi_ok {
    clear_pending_exception(env);
    return;
  }
  let mut constructor = ptr::null_mut();
  if unsafe { sys::napi_get_named_property(env, global, c"Promise".as_ptr(), &mut constructor) }
    != sys::Status::napi_ok
  {
    clear_pending_exception(env);
    return;
  }
  let mut value_type = sys::ValueType::napi_undefined;
  if unsafe { sys::napi_typeof(env, constructor, &mut value_type) } != sys::Status::napi_ok
    || value_type != sys::ValueType::napi_function
  {
    clear_pending_exception(env);
    return;
  }
  let mut executor = ptr::null_mut();
  if unsafe {
    sys::napi_create_function(
      env,
      c"executor".as_ptr().cast(),
      8,
      Some(capture_resolvers),
      ptr::null_mut(),
      &mut executor,
    )
  } != sys::Status::napi_ok
  {
    clear_pending_exception(env);
    return;
  }
  if !probe_promise_constructor(env, constructor, executor) {
    clear_pending_exception(env);
    return;
  }
  let mut constructor_ref = ptr::null_mut();
  if unsafe { sys::napi_create_reference(env, constructor, 1, &mut constructor_ref) }
    != sys::Status::napi_ok
  {
    clear_pending_exception(env);
    return;
  }
  let mut executor_ref = ptr::null_mut();
  if unsafe { sys::napi_create_reference(env, executor, 1, &mut executor_ref) }
    != sys::Status::napi_ok
  {
    unsafe { sys::napi_delete_reference(env, constructor_ref) };
    clear_pending_exception(env);
    return;
  }
  #[cfg(not(target_family = "wasm"))]
  let hook_status = unsafe {
    sys::napi_add_env_cleanup_hook(env, Some(promise_intrinsics_env_cleanup), env.cast())
  };
  // `sys::` would import the symbol from the `env` wasm module; emnapi provides it under
  // `napi` (see `crate::napi_add_env_cleanup_hook`).
  #[cfg(target_family = "wasm")]
  let hook_status = unsafe {
    crate::napi_add_env_cleanup_hook(env, Some(promise_intrinsics_env_cleanup), env.cast())
  };
  if hook_status != sys::Status::napi_ok {
    unsafe {
      sys::napi_delete_reference(env, constructor_ref);
      sys::napi_delete_reference(env, executor_ref);
    }
    clear_pending_exception(env);
    return;
  }
  PROMISE_INTRINSICS.with(|cache| {
    cache.borrow_mut().push(PromiseIntrinsics {
      env,
      constructor: constructor_ref,
      executor: executor_ref,
    })
  });
}

/// Accepts `constructor` only when `new constructor(executor)` calls the executor with two
/// resolving functions and returns a native promise whose prototype is the one
/// `napi_create_promise` uses — so an `AsyncTask` keeps returning exactly what it returned
/// before this cache existed.
#[cfg(all(feature = "napi3", not(feature = "noop")))]
fn probe_promise_constructor(
  env: sys::napi_env,
  constructor: sys::napi_value,
  executor: sys::napi_value,
) -> bool {
  let Some((probe, resolve, reject)) = construct(env, constructor, executor) else {
    return false;
  };
  unsafe {
    sys::napi_delete_reference(env, resolve);
    sys::napi_delete_reference(env, reject);
  }
  let mut is_promise = false;
  if unsafe { sys::napi_is_promise(env, probe, &mut is_promise) } != sys::Status::napi_ok
    || !is_promise
  {
    return false;
  }
  let mut intrinsic = ptr::null_mut();
  let mut deferred = ptr::null_mut();
  if unsafe { sys::napi_create_promise(env, &mut deferred, &mut intrinsic) } != sys::Status::napi_ok
  {
    return false;
  }
  let mut undefined = ptr::null_mut();
  // Settling frees the deferred; registration runs JavaScript, so this cannot be refused.
  let settled = unsafe {
    sys::napi_get_undefined(env, &mut undefined) == sys::Status::napi_ok
      && sys::napi_resolve_deferred(env, deferred, undefined) == sys::Status::napi_ok
  };
  if !settled {
    return false;
  }
  // `napi_get_prototype` is the internal [[GetPrototypeOf]] of an ordinary promise: no user code.
  let mut probe_prototype = ptr::null_mut();
  let mut intrinsic_prototype = ptr::null_mut();
  let mut same = false;
  unsafe {
    sys::napi_get_prototype(env, probe, &mut probe_prototype) == sys::Status::napi_ok
      && sys::napi_get_prototype(env, intrinsic, &mut intrinsic_prototype) == sys::Status::napi_ok
      && sys::napi_strict_equals(env, probe_prototype, intrinsic_prototype, &mut same)
        == sys::Status::napi_ok
      && same
  }
}

/// Env-teardown counterpart of [`cache_promise_intrinsics_for_env`]: deletes the env's cached
/// references and removes its entry. Runs on the env's own thread, before the env is freed.
/// Tasks still settling afterwards hold their own references; a task created afterwards falls
/// back to `napi_create_promise`.
#[cfg(all(feature = "napi3", not(feature = "noop")))]
unsafe extern "C" fn promise_intrinsics_env_cleanup(arg: *mut c_void) {
  let env: sys::napi_env = arg.cast();
  let removed = PROMISE_INTRINSICS.with(|cache| {
    let mut cache = cache.borrow_mut();
    cache
      .iter()
      .position(|entry| entry.env == env)
      .map(|index| cache.swap_remove(index))
  });
  if let Some(entry) = removed {
    unsafe {
      sys::napi_delete_reference(env, entry.constructor);
      sys::napi_delete_reference(env, entry.executor);
    }
  }
}
