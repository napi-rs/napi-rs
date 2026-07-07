use std::cell::Cell;
use std::marker::PhantomData;
use std::mem;
use std::os::raw::c_void;
use std::panic::UnwindSafe;
use std::ptr;
use std::rc::Rc;
use std::sync::{
  atomic::{AtomicU8, Ordering},
  Arc,
};

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
  lifecycle: Arc<AsyncWorkLifecycle>,
  abort_status: Option<Rc<Cell<u8>>>,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum AsyncWorkState {
  Pending,
  CancellationAccepted,
  Terminal,
}

struct AsyncWorkLifecycle(AtomicU8);

impl AsyncWorkLifecycle {
  fn new() -> Self {
    Self(AtomicU8::new(AsyncWorkState::Pending as u8))
  }

  fn state(&self) -> AsyncWorkState {
    match self.0.load(Ordering::Acquire) {
      state if state == AsyncWorkState::Pending as u8 => AsyncWorkState::Pending,
      state if state == AsyncWorkState::CancellationAccepted as u8 => {
        AsyncWorkState::CancellationAccepted
      }
      state if state == AsyncWorkState::Terminal as u8 => AsyncWorkState::Terminal,
      _ => std::process::abort(),
    }
  }

  fn mark_cancellation_accepted(&self) {
    match self.0.compare_exchange(
      AsyncWorkState::Pending as u8,
      AsyncWorkState::CancellationAccepted as u8,
      Ordering::AcqRel,
      Ordering::Acquire,
    ) {
      Ok(_) => {}
      Err(state) if state == AsyncWorkState::Terminal as u8 => {}
      Err(_) => std::process::abort(),
    }
  }

  fn mark_terminal(&self) {
    self
      .0
      .store(AsyncWorkState::Terminal as u8, Ordering::Release);
  }
}

struct AsyncWorkDeleteGuard {
  env: sys::napi_env,
  work: sys::napi_async_work,
}

impl AsyncWorkDeleteGuard {
  fn new(env: sys::napi_env, work: sys::napi_async_work) -> Self {
    Self { env, work }
  }

  fn delete(mut self) -> Result<()> {
    let work = mem::replace(&mut self.work, ptr::null_mut());
    check_status!(
      unsafe { sys::napi_delete_async_work(self.env, work) },
      "Delete async work failed"
    )
  }
}

impl Drop for AsyncWorkDeleteGuard {
  fn drop(&mut self) {
    if !self.work.is_null() {
      let _ = unsafe { sys::napi_delete_async_work(self.env, self.work) };
    }
  }
}

pub struct AsyncWorkPromise<T> {
  pub(crate) napi_async_work: sys::napi_async_work,
  raw_promise: sys::napi_value,
  env: sys::napi_env,
  lifecycle: Arc<AsyncWorkLifecycle>,
  _phantom: PhantomData<T>,
}

impl<T> UnwindSafe for AsyncWorkPromise<T> {}
impl<T> std::panic::RefUnwindSafe for AsyncWorkPromise<T> {}

impl<T> AsyncWorkPromise<T> {
  pub fn promise_object<'env>(&self) -> PromiseRaw<'env, T> {
    // SAFETY: both handles come from `napi_create_promise` in `run` and remain owned by this env.
    unsafe { PromiseRaw::new(self.env, self.raw_promise) }
  }

  pub fn cancel(&mut self) -> Result<()> {
    if self.lifecycle.state() != AsyncWorkState::Pending {
      return Ok(());
    }
    check_status!(
      unsafe { sys::napi_cancel_async_work(self.env, self.napi_async_work) },
      "Cancel async work failed"
    )?;
    self.lifecycle.mark_cancellation_accepted();
    Ok(())
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
  let lifecycle = Arc::new(AsyncWorkLifecycle::new());
  let mut work = Box::new(AsyncWork {
    inner_task: task,
    deferred,
    value: mem::MaybeUninit::uninit(),
    napi_async_work: ptr::null_mut(),
    lifecycle: Arc::clone(&lifecycle),
    abort_status,
  });
  let create_result = check_status!(
    unsafe {
      sys::napi_create_async_work(
        env,
        raw_promise,
        undefined,
        Some(execute::<T>),
        Some(complete::<T>),
        (&raw mut *work).cast(),
        &mut work.napi_async_work,
      )
    },
    "Create async work failed in async_work::run"
  );
  create_result?;

  let napi_async_work = work.napi_async_work;
  let work = Box::into_raw(work);
  let queue_result = check_status!(
    unsafe { sys::napi_queue_async_work(env, napi_async_work) },
    "Queue async work failed in async_work::run"
  );
  if let Err(mut queue_error) = queue_result {
    // Queueing failure leaves ownership with the caller. Delete the native
    // handle before reclaiming the task allocation that its data pointer
    // references.
    let delete_result = check_status!(
      unsafe { sys::napi_delete_async_work(env, napi_async_work) },
      "Delete unqueued async work failed in async_work::run"
    );
    match delete_result {
      Ok(()) => {
        // SAFETY: the work was never queued and the native handle was deleted,
        // so neither callback nor Node-API can retain `work`.
        drop(unsafe { Box::from_raw(work) });
      }
      Err(delete_error) => {
        // The failed delete leaves ownership of the data pointer ambiguous.
        // Leak it rather than free memory a native handle may still reference.
        queue_error.reason.push_str(&format!(
          "; additionally failed to clean up: {delete_error}"
        ));
      }
    }
    return Err(queue_error);
  }

  Ok(AsyncWorkPromise {
    napi_async_work,
    raw_promise,
    env,
    lifecycle,
    _phantom: PhantomData,
  })
}

unsafe impl<'task, T: ScopedTask<'task> + Send> Send for AsyncWork<'task, T> {}
unsafe impl<'task, T: ScopedTask<'task> + Sync> Sync for AsyncWork<'task, T> {}

/// env here is the same with the one in `CallContext`.
/// So it actually could do nothing here, because `execute` function is called in the other thread mostly.
unsafe extern "C" fn execute<'task, T: ScopedTask<'task>>(_env: sys::napi_env, data: *mut c_void) {
  let work = Box::leak(unsafe { Box::from_raw(data as *mut AsyncWork<T>) });
  let value = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| work.inner_task.compute()))
    .unwrap_or_else(|payload| Err(crate::bindgen_runtime::panic_to_error(payload)));
  work.value.write(value);
}

unsafe extern "C" fn complete<'task, T: ScopedTask<'task>>(
  env: sys::napi_env,
  status: sys::napi_status,
  data: *mut c_void,
) {
  let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
    complete_impl::<T>(env, status, data)
  }))
  .map_err(crate::bindgen_runtime::panic_to_error)
  .and_then(|result| result);
  if let Err(e) = result {
    let js_err = JsError::from(e);
    unsafe { js_err.throw_into(env) };
  }
}

fn complete_impl<'task, T: ScopedTask<'task>>(
  env: sys::napi_env,
  status: sys::napi_status,
  data: *mut c_void,
) -> Result<()> {
  // SAFETY: successful queueing transferred the allocation to the native
  // async-work callbacks, and completion runs exactly once.
  let AsyncWork {
    mut inner_task,
    deferred,
    value,
    napi_async_work,
    lifecycle,
    abort_status,
  } = *unsafe { Box::from_raw(data as *mut AsyncWork<T>) };
  let delete_guard = AsyncWorkDeleteGuard::new(env, napi_async_work);
  lifecycle.mark_terminal();
  if let Some(abort_status) = abort_status {
    abort_status.set(1);
  }

  let completion_result = if status == sys::Status::napi_cancelled {
    (|| {
      const ABORT_ERROR_NAME: &str = "AbortError";
      let wrapped_env = Env::from_raw(env);
      let mut error =
        wrapped_env.create_error(Error::new(Status::Cancelled, ABORT_ERROR_NAME.to_owned()))?;
      error.set_named_property("name", ABORT_ERROR_NAME)?;
      check_status!(
        unsafe { sys::napi_reject_deferred(env, deferred, error.0.value) },
        "Reject AbortError failed"
      )
    })()
  } else {
    // SAFETY: every non-cancelled completion follows an execute callback that
    // initializes `value`.
    let value_ptr = unsafe { value.assume_init() };
    let value = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match value_ptr {
      Ok(output) => inner_task.resolve(
        // SAFETY: `Env` is long lived
        unsafe { std::mem::transmute::<&Env, &'task Env>(&Env::from_raw(env)) },
        output,
      ),
      Err(e) => inner_task.reject(
        // SAFETY: `Env` is long lived
        unsafe { std::mem::transmute::<&Env, &'task Env>(&Env::from_raw(env)) },
        e,
      ),
    }))
    .map_err(crate::bindgen_runtime::panic_to_error)
    .and_then(|result| result);
    match check_status!(status)
      .and_then(move |_| value)
      .and_then(|v| {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| unsafe {
          ToNapiValue::to_napi_value(env, v)
        }))
        .map_err(crate::bindgen_runtime::panic_to_error)
        .and_then(|result| result)
      }) {
      Ok(v) => {
        check_status!(
          unsafe { sys::napi_resolve_deferred(env, deferred, v) },
          "Resolve promise failed"
        )
      }
      Err(e) => {
        check_status!(
          unsafe { sys::napi_reject_deferred(env, deferred, JsError::from(e).into_value(env)) },
          "Reject promise failed"
        )
      }
    }
  };

  // `finally` and native-handle deletion are unconditional. A failure in
  // promise conversion/settlement must not leak the task or async work.
  let finally_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
    inner_task.finally(Env::from_raw(env))
  }))
  .map_err(crate::bindgen_runtime::panic_to_error)
  .and_then(|result| result);
  let delete_result = delete_guard.delete();

  completion_result.and(finally_result).and(delete_result)
}
