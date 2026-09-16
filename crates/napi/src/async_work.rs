use std::cell::Cell;
use std::marker::PhantomData;
use std::mem;
use std::os::raw::c_void;
use std::panic::UnwindSafe;
use std::ptr;
use std::rc::Rc;

use crate::bindgen_runtime::JsObjectValue;
use crate::{
  bindgen_runtime::{PromiseRaw, ToNapiValue},
  check_status, sys, Env, Error, JsError, Result, ScopedTask, Status,
};

struct AsyncWork<'task, T: ScopedTask<'task>> {
  inner_task: T,
  deferred: sys::napi_deferred,
  value: mem::MaybeUninit<Result<T::Output>>,
  napi_async_work: sys::napi_async_work,
  status: Rc<Cell<u8>>,
}

pub struct AsyncWorkPromise<T> {
  pub(crate) napi_async_work: sys::napi_async_work,
  raw_promise: sys::napi_value,
  env: sys::napi_env,
  /// share with AsyncWork
  /// 0: not started
  /// 1: completed
  /// 2: canceled
  pub(crate) status: Rc<Cell<u8>>,
  _phantom: PhantomData<T>,
}

impl<T> UnwindSafe for AsyncWorkPromise<T> {}
impl<T> std::panic::RefUnwindSafe for AsyncWorkPromise<T> {}

/// The `napi_async_work` this addon has queued and whose completion callback has not run yet,
/// as `(napi_env, napi_async_work)` addresses.
///
/// On wasm a loader disposes the binding by destroying the emnapi context and terminating the
/// pool threads. Neither can run a completion callback, so a work still outstanding at that
/// point never settles its promise — and it also never balances the emnapi waiting-request
/// counter, which brackets every queued work. On Node a nonzero counter keeps a
/// `MessageChannel` port referenced, so the process cannot exit either.
///
/// Nothing observable from JavaScript can stand in for this registry. The threadless archive
/// (`emnapi-basic-napi-rs`) resolves `napi_*_async_work` through the `@emnapi/core` JavaScript
/// plugins, but the threaded one (`emnapi-napi-rs-mt`) links the C `async_work.c` backed by the
/// uv threadpool — see `emnapi_link_library` in `crates/build/src/wasi.rs` — so there the wasm
/// neither imports nor exports those symbols, and the only brackets a loader could see
/// (`_emnapi_ctx_*_waiting_request_counter`) are shared with threadsafe functions. This crate is
/// the one choke point both flavors go through.
///
/// Exported to the loader as [`napi_wasm_async_work_pending`] and
/// [`napi_wasm_cancel_pending_async_work`], the async-work half of the
/// `napi_wasm_env_cleanup_pending` handshake.
///
/// A `Mutex` rather than a thread local: queueing and completing both happen on the JavaScript
/// thread, but the registry is process-wide and this keeps it sound without depending on that.
#[cfg(all(target_family = "wasm", not(feature = "noop")))]
static OUTSTANDING_ASYNC_WORK: std::sync::Mutex<Vec<(usize, usize)>> =
  std::sync::Mutex::new(Vec::new());

/// A lock this addon poisoned is not worth aborting a teardown over: the registry only ever
/// makes disposal wait *longer*, so a failure to read it degrades to today's behavior.
#[cfg(all(target_family = "wasm", not(feature = "noop")))]
fn register_outstanding_async_work(env: sys::napi_env, work: sys::napi_async_work) {
  if let Ok(mut outstanding) = OUTSTANDING_ASYNC_WORK.lock() {
    outstanding.push((env as usize, work as usize));
  }
}

#[cfg(all(target_family = "wasm", not(feature = "noop")))]
fn unregister_outstanding_async_work(work: sys::napi_async_work) {
  if let Ok(mut outstanding) = OUTSTANDING_ASYNC_WORK.lock() {
    let handle = work as usize;
    if let Some(index) = outstanding.iter().position(|(_, queued)| *queued == handle) {
      outstanding.swap_remove(index);
    }
  }
}

/// How many `napi_async_work` are queued and have not completed yet.
#[cfg(all(target_family = "wasm", not(feature = "noop")))]
pub(crate) fn pending_async_work() -> u32 {
  OUTSTANDING_ASYNC_WORK
    .lock()
    .map(|outstanding| outstanding.len() as u32)
    .unwrap_or(0)
}

/// Cancels every outstanding `napi_async_work`, returning how many cancellations were accepted.
///
/// `napi_cancel_async_work` succeeds only for a work no thread has started. The completion
/// callback then runs with `napi_cancelled`, which [`complete_impl`] turns into an `AbortError`
/// rejection — so a cancelled work leaves this registry and balances the waiting-request counter
/// through exactly the same path an ordinary completion does. A refused cancellation means the
/// work is already executing; it is left alone to finish normally, which it can, because the
/// loader calls this *before* terminating anything.
#[cfg(all(target_family = "wasm", not(feature = "noop")))]
pub(crate) fn cancel_pending_async_work() -> u32 {
  // Snapshot and release: cancelling is the host's call, and holding the registry lock across
  // it would deadlock the moment a host delivered the cancelled completion synchronously.
  let Ok(outstanding) = OUTSTANDING_ASYNC_WORK.lock().map(|guard| guard.clone()) else {
    return 0;
  };
  let mut cancelled = 0;
  for (env, work) in outstanding {
    // SAFETY: both addresses were handed to us by `napi_create_async_work` / the `napi_env` it
    // was created with, and an entry is removed from the registry by `complete_impl` before
    // `napi_delete_async_work` frees the work — so a registered handle is always still live.
    if unsafe { sys::napi_cancel_async_work(env as sys::napi_env, work as sys::napi_async_work) }
      == sys::Status::napi_ok
    {
      cancelled += 1;
    }
  }
  cancelled
}

impl<T> AsyncWorkPromise<T> {
  pub fn promise_object<'env>(&self) -> PromiseRaw<'env, T> {
    PromiseRaw::new(self.env, self.raw_promise)
  }

  pub fn cancel(&mut self) -> Result<()> {
    // must be happened in the main thread, relaxed is enough
    self.status.set(2);
    check_status!(
      unsafe { sys::napi_cancel_async_work(self.env, self.napi_async_work) },
      "Cancel async work failed"
    )
  }
}

pub fn run<'task, T: ScopedTask<'task>>(
  env: sys::napi_env,
  task: T,
  abort_status: Option<Rc<Cell<u8>>>,
) -> Result<AsyncWorkPromise<T::JsValue>> {
  let mut undefined = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_get_undefined(env, &mut undefined) },
    "Get undefined failed in async_work::run"
  )?;
  let mut raw_promise = ptr::null_mut();
  let mut deferred = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_create_promise(env, &mut deferred, &mut raw_promise) },
    "Create promise failed in async_work::run"
  )?;
  let task_status = abort_status.unwrap_or_else(|| Rc::new(Cell::new(0)));
  let result = Box::leak(Box::new(AsyncWork {
    inner_task: task,
    deferred,
    value: mem::MaybeUninit::uninit(),
    napi_async_work: ptr::null_mut(),
    status: task_status.clone(),
  }));
  check_status!(
    unsafe {
      sys::napi_create_async_work(
        env,
        raw_promise,
        undefined,
        Some(execute::<T>),
        Some(complete::<T>),
        (result as *mut AsyncWork<T>).cast(),
        &mut result.napi_async_work,
      )
    },
    "Create async work failed in async_work::run"
  )?;
  check_status!(
    unsafe { sys::napi_queue_async_work(env, result.napi_async_work) },
    "Queue async work failed in async_work::run"
  )?;
  // Only a queue that succeeded holds a waiting-request reference for a teardown to balance.
  #[cfg(all(target_family = "wasm", not(feature = "noop")))]
  register_outstanding_async_work(env, result.napi_async_work);
  Ok(AsyncWorkPromise {
    napi_async_work: result.napi_async_work,
    raw_promise,
    env,
    status: task_status,
    _phantom: PhantomData,
  })
}

unsafe impl<'task, T: ScopedTask<'task> + Send> Send for AsyncWork<'task, T> {}
unsafe impl<'task, T: ScopedTask<'task> + Sync> Sync for AsyncWork<'task, T> {}

/// env here is the same with the one in `CallContext`.
/// So it actually could do nothing here, because `execute` function is called in the other thread mostly.
unsafe extern "C" fn execute<'task, T: ScopedTask<'task>>(_env: sys::napi_env, data: *mut c_void) {
  let work = Box::leak(unsafe { Box::from_raw(data as *mut AsyncWork<T>) });
  let value = work.inner_task.compute();
  work.value.write(value);
}

unsafe extern "C" fn complete<'task, T: ScopedTask<'task>>(
  env: sys::napi_env,
  status: sys::napi_status,
  data: *mut c_void,
) {
  if let Err(e) = complete_impl::<T>(env, status, data) {
    let js_err = JsError::from(e);
    unsafe { js_err.throw_into(env) };
  }
}

fn complete_impl<'task, T: ScopedTask<'task>>(
  env: sys::napi_env,
  status: sys::napi_status,
  data: *mut c_void,
) -> Result<()> {
  let mut work = unsafe { Box::from_raw(data as *mut AsyncWork<T>) };
  let napi_async_work = mem::replace(&mut work.napi_async_work, ptr::null_mut());
  // Here, not beside the `napi_delete_async_work` below: every `?` between the two would skip
  // it, and an entry left behind makes a loader's drain wait for a work that already completed
  // — forever, since the drain has no deadline. This runs inside the completion callback, so
  // the promise is settled before the loader's next poll can observe the count either way.
  #[cfg(all(target_family = "wasm", not(feature = "noop")))]
  unregister_outstanding_async_work(napi_async_work);
  let deferred = mem::replace(&mut work.deferred, ptr::null_mut());
  if status == sys::Status::napi_cancelled {
    const ABORT_ERROR_NAME: &str = "AbortError";
    let wrapped_env = Env::from_raw(env);
    let mut error =
      wrapped_env.create_error(Error::new(Status::Cancelled, ABORT_ERROR_NAME.to_owned()))?;
    error.set_named_property("name", ABORT_ERROR_NAME)?;
    check_status!(
      unsafe { sys::napi_reject_deferred(env, deferred, error.0.value) },
      "Reject AbortError failed"
    )?;
  } else {
    let value_ptr = unsafe { work.value.assume_init() };
    let value = match value_ptr {
      Ok(output) => work.inner_task.resolve(
        // SAFETY: `Env` is long lived
        unsafe { std::mem::transmute::<&Env, &'task Env>(&Env::from_raw(env)) },
        output,
      ),
      Err(e) => work.inner_task.reject(
        // SAFETY: `Env` is long lived
        unsafe { std::mem::transmute::<&Env, &'task Env>(&Env::from_raw(env)) },
        e,
      ),
    };
    if work.status.get() != 2 {
      match check_status!(status)
        .and_then(move |_| value)
        .and_then(|v| unsafe { ToNapiValue::to_napi_value(env, v) })
      {
        Ok(v) => {
          check_status!(
            unsafe { sys::napi_resolve_deferred(env, deferred, v) },
            "Resolve promise failed"
          )?;
        }
        Err(e) => {
          // `ToNapiValue for Error` hands the retained value back verbatim —
          // the completion callback runs on the owning env/thread, exactly
          // where the retained reference is restorable — and synthesizes a
          // fresh `Error` from `status`/`reason`/`cause` when there is nothing
          // to hand back (an error built on the libuv thread holds no
          // reference; one captured on a foreign env or thread fails the owner
          // gates in `referenced_value` and falls back to synthesis instead of
          // dereferencing a foreign reference). `JsError::into_value` cannot
          // be used here: it gates reuse on `napi_is_error`, so a task
          // rejecting with a retained primitive or plain object — same
          // contract as the deferred settlement path — would settle with a
          // synthesized `Error` instead of the captured value.
          let rejection = unsafe { ToNapiValue::to_napi_value(env, e) }?;
          check_status!(
            unsafe { sys::napi_reject_deferred(env, deferred, rejection) },
            "Reject promise failed"
          )?;
        }
      };
    }
    work.status.set(1);
  }
  work.inner_task.finally(Env::from_raw(env))?;
  check_status!(
    unsafe { sys::napi_delete_async_work(env, napi_async_work) },
    "Delete async work failed"
  )?;
  Ok(())
}
