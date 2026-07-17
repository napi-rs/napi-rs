use std::os::raw::c_void;
use std::ptr;
use std::{
  marker::PhantomData,
  sync::{Arc, Mutex, RwLock, Weak},
};

#[cfg(feature = "deferred_trace")]
use crate::{bindgen_runtime::JsObjectValue, JsValue};
use crate::{
  bindgen_runtime::{Object, ToNapiValue},
  check_status, sys, Env, Error, Result,
};

#[cfg(feature = "deferred_trace")]
/// A javascript error which keeps a stack trace
/// to the original caller in an asynchronous context.
/// This is required as the stack trace is lost when
/// an error is created in a different thread.
///
/// See this issue for more details:
/// https://github.com/nodejs/node-addon-api/issues/595
#[repr(transparent)]
#[derive(Clone)]
struct DeferredTrace(sys::napi_ref);

#[cfg(feature = "deferred_trace")]
impl DeferredTrace {
  fn new(raw_env: sys::napi_env) -> Result<Self> {
    let env = Env::from_raw(raw_env);
    let reason = env.create_string("none")?;

    let mut js_error = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_create_error(raw_env, ptr::null_mut(), reason.raw(), &mut js_error) },
      "Create error in DeferredTrace failed"
    )?;

    let mut result = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_create_reference(raw_env, js_error, 1, &mut result) },
      "Create reference in DeferredTrace failed"
    )?;

    Ok(Self(result))
  }

  fn into_rejected(self, raw_env: sys::napi_env, err: Error) -> Result<sys::napi_value> {
    let env = Env::from_raw(raw_env);
    let mut raw = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_reference_value(raw_env, self.0, &mut raw) },
      "Failed to get referenced value in DeferredTrace"
    )?;

    let mut obj = Object::from_raw(raw_env, raw);
    // Reuse the original JS error object when it is safe to read on this thread;
    // the shared `napi_ref` is released when `err` drops at the end of the call.
    let err_value = if let Some(err_raw_value) = unsafe { err.referenced_value(raw_env) } {
      let err_obj = Object::from_raw(raw_env, err_raw_value);
      if err_obj.has_named_property("message")? {
        // The error was already created inside the JS engine, just return it
        Ok(err_obj.raw())
      } else {
        obj.set_named_property("message", "")?;
        obj.set_named_property("code", "")?;
        Ok(raw)
      }
    } else {
      obj.set_named_property("message", &err.reason)?;
      obj.set_named_property(
        "code",
        env.create_string_from_std(format!("{}", err.status))?,
      )?;
      Ok(raw)
    };
    check_status!(
      unsafe { sys::napi_delete_reference(raw_env, self.0) },
      "Failed to get referenced value in DeferredTrace"
    )?;
    err_value
  }
}

type FinalizeCallback = Arc<RwLock<Option<Box<dyn FnOnce(sys::napi_env)>>>>;

struct DeferredData<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>> {
  resolver: Result<Resolver>,
  #[cfg(feature = "deferred_trace")]
  trace: DeferredTrace,
  tsfn: sys::napi_threadsafe_function,
  finalize_callback: FinalizeCallback,
}

/// Shared between the deferred (and its clones) and the threadsafe function's env teardown hook
/// and finalize callback. Owns the pending threadsafe function: a settle takes it (moving the
/// release duty into the queued `DeferredData`), the env teardown hook abort-releases it,
/// whichever locks first. The lock is held across those calls so env teardown cannot finalize
/// the threadsafe function while a settle on a foreign thread is inside it.
struct DeferredHandle {
  pending_tsfn: Mutex<Option<sys::napi_threadsafe_function>>,
}

// The raw threadsafe-function pointer makes the handle neither `Send` nor `Sync`, but calling a
// threadsafe function from any thread is its documented purpose, and the mutex hands it to
// exactly one consumer.
unsafe impl Send for DeferredHandle {}
unsafe impl Sync for DeferredHandle {}

pub struct JsDeferred<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>> {
  handle: Arc<DeferredHandle>,
  #[cfg(feature = "deferred_trace")]
  trace: DeferredTrace,
  finalize_callback: FinalizeCallback,
  _data: PhantomData<Data>,
  _resolver: PhantomData<Resolver>,
}

// A trick to send the resolver into the `panic` handler
// Do not use clone in the other place besides the `fn execute_tokio_future`
impl<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>> Clone
  for JsDeferred<Data, Resolver>
{
  fn clone(&self) -> Self {
    Self {
      handle: self.handle.clone(),
      #[cfg(feature = "deferred_trace")]
      trace: self.trace.clone(),
      finalize_callback: self.finalize_callback.clone(),
      _data: PhantomData,
      _resolver: PhantomData,
    }
  }
}

unsafe impl<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>> Send
  for JsDeferred<Data, Resolver>
{
}

impl<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>> JsDeferred<Data, Resolver> {
  pub(crate) fn new(env: &Env) -> Result<(Self, Object<'_>)> {
    let handle = Arc::new(DeferredHandle {
      pending_tsfn: Mutex::new(None),
    });
    // Shared by the finalize callback and the env teardown hook; freed exactly once, by the
    // finalize callback (which during an env teardown runs after the LIFO-ordered cleanup hooks).
    let handle_weak_ptr = Box::into_raw(Box::new(Arc::downgrade(&handle)));

    let (tsfn, promise) = match js_deferred_new_raw(
      env,
      Some(napi_resolve_deferred::<Data, Resolver>),
      handle_weak_ptr.cast(),
    ) {
      Ok(created) => created,
      Err(err) => {
        drop(unsafe { Box::from_raw(handle_weak_ptr) });
        return Err(err);
      }
    };
    *handle
      .pending_tsfn
      .lock()
      .expect("JsDeferred pending lock failed") = Some(tsfn);

    // Pre-abort the threadsafe function when the environment tears down, before Node finalizes
    // it: a deferred settled from a foreign thread after (or while) its env tears down (e.g. a
    // future resolving after a worker thread terminated, see napi-rs#2460) would otherwise call
    // into a freed threadsafe function. Node registers the threadsafe function's own teardown as
    // a cleanup hook at creation, and hooks run in reverse registration order, so this hook runs
    // before Node finalizes the threadsafe function.
    #[cfg(not(target_family = "wasm"))]
    check_status!(
      unsafe {
        sys::napi_add_env_cleanup_hook(
          env.0,
          Some(deferred_env_teardown_cb),
          handle_weak_ptr.cast(),
        )
      },
      "Register env cleanup hook in JsDeferred failed"
    )?;

    let deferred = Self {
      handle,
      #[cfg(feature = "deferred_trace")]
      trace: DeferredTrace::new(env.0)?,
      finalize_callback: Default::default(),
      _data: PhantomData,
      _resolver: PhantomData,
    };

    Ok((deferred, promise))
  }

  /// Consumes the deferred, and resolves the promise. The provided function will be called
  /// from the JavaScript thread, and should return the resolved value.
  pub fn resolve(self, resolver: Resolver) {
    self.call_tsfn(Ok(resolver))
  }

  /// Consumes the deferred, and rejects the promise with the provided error.
  pub fn reject(self, error: Error) {
    self.call_tsfn(Err(error))
  }

  #[allow(clippy::arc_with_non_send_sync)]
  pub fn set_finalize_callback(
    &mut self,
    finalize_callback: Option<Box<dyn FnOnce(sys::napi_env)>>,
  ) {
    self.finalize_callback = Arc::new(RwLock::new(finalize_callback));
  }

  fn call_tsfn(self, result: Result<Resolver>) {
    let mut pending = self
      .handle
      .pending_tsfn
      .lock()
      .expect("JsDeferred pending lock failed");
    let Some(tsfn) = pending.take() else {
      // The environment tore down (or another clone already settled the promise): the promise no
      // longer exists and the threadsafe function is gone. Drop the resolver instead of calling
      // into freed memory.
      return;
    };

    let data = DeferredData {
      resolver: result,
      #[cfg(feature = "deferred_trace")]
      trace: self.trace,
      tsfn,
      finalize_callback: self.finalize_callback.clone(),
    };

    // Call back into the JS thread via a threadsafe function. This results in napi_resolve_deferred being called.
    let status = unsafe {
      sys::napi_call_threadsafe_function(
        tsfn,
        Box::into_raw(Box::from(data)).cast(),
        sys::ThreadsafeFunctionCallMode::blocking,
      )
    };
    debug_assert!(
      status == sys::Status::napi_ok,
      "Call threadsafe function in JsDeferred failed"
    );
  }
}

/// Aborts the deferred's threadsafe function when its environment starts tearing down, before
/// Node finalizes it. Runs on the environment's thread; the `aborted` write lock serializes it
/// against settles on foreign threads.
#[cfg(not(target_family = "wasm"))]
unsafe extern "C" fn deferred_env_teardown_cb(data: *mut c_void) {
  let handle_weak = unsafe { &*data.cast::<Weak<DeferredHandle>>() };
  let Some(handle) = handle_weak.upgrade() else {
    return;
  };

  let mut pending = handle
    .pending_tsfn
    .lock()
    .expect("JsDeferred pending lock failed");
  if let Some(tsfn) = pending.take() {
    let status = unsafe {
      sys::napi_release_threadsafe_function(tsfn, sys::ThreadsafeFunctionReleaseMode::abort)
    };
    debug_assert!(
      status == sys::Status::napi_ok,
      "Abort deferred threadsafe function on env teardown failed"
    );
  }
}

/// Finalize callback of the deferred's threadsafe function: unregisters the teardown hook and
/// frees the shared handle weak exactly once.
unsafe extern "C" fn deferred_finalize_cb(
  env: sys::napi_env,
  finalize_data: *mut c_void,
  _finalize_hint: *mut c_void,
) {
  #[cfg(not(target_family = "wasm"))]
  if !env.is_null() {
    unsafe {
      sys::napi_remove_env_cleanup_hook(env, Some(deferred_env_teardown_cb), finalize_data)
    };
  }
  #[cfg(target_family = "wasm")]
  {
    let _ = env;
  }

  let handle_weak = unsafe { Box::from_raw(finalize_data.cast::<Weak<DeferredHandle>>()) };
  if let Some(handle) = handle_weak.upgrade() {
    handle
      .pending_tsfn
      .lock()
      .expect("JsDeferred pending lock failed")
      .take();
  }
}

fn js_deferred_new_raw(
  env: &Env,
  resolve_deferred: sys::napi_threadsafe_function_call_js,
  finalize_data: *mut c_void,
) -> Result<(sys::napi_threadsafe_function, Object<'_>)> {
  let mut raw_promise = ptr::null_mut();
  let mut raw_deferred = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_create_promise(env.0, &mut raw_deferred, &mut raw_promise) },
    "Create promise in JsDeferred failed"
  )?;

  // Create a threadsafe function so we can call back into the JS thread when we are done.
  let mut async_resource_name = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_create_string_utf8(
        env.0,
        c"napi_resolve_deferred".as_ptr().cast(),
        22,
        &mut async_resource_name,
      )
    },
    "Create async resource name in JsDeferred failed"
  )?;

  let mut tsfn = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_create_threadsafe_function(
        env.0,
        ptr::null_mut(),
        ptr::null_mut(),
        async_resource_name,
        0,
        1,
        finalize_data,
        Some(deferred_finalize_cb),
        raw_deferred.cast(),
        resolve_deferred,
        &mut tsfn,
      )
    },
    "Create threadsafe function in JsDeferred failed"
  )?;

  let promise = Object::from_raw(env.0, raw_promise);

  Ok((tsfn, promise))
}

extern "C" fn napi_resolve_deferred<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>>(
  env: sys::napi_env,
  _js_callback: sys::napi_value,
  context: *mut c_void,
  data: *mut c_void,
) {
  let deferred_data: Box<DeferredData<Data, Resolver>> = unsafe { Box::from_raw(data.cast()) };

  // Node invokes leftover queue items with a null env while the threadsafe function closes
  // during env teardown; there is no promise left to settle, and the threadsafe function is
  // already being torn down, so only the queued data must be freed.
  if env.is_null() {
    return;
  }

  let deferred = context.cast();
  let tsfn: *mut napi_sys::napi_threadsafe_function__ = deferred_data.tsfn;
  let finalize_callback = RwLock::write(&deferred_data.finalize_callback)
    .expect("RwLock Poison")
    .take();
  let result = deferred_data
    .resolver
    .and_then(|resolver| resolver(Env::from_raw(env)))
    .and_then(|res| unsafe { ToNapiValue::to_napi_value(env, res) });

  let release_tsfn_result = check_status!(
    unsafe {
      sys::napi_release_threadsafe_function(tsfn, sys::ThreadsafeFunctionReleaseMode::release)
    },
    "Release threadsafe function in JsDeferred failed"
  );

  if let Err(e) = release_tsfn_result.and(result).and_then(|res| {
    check_status!(
      unsafe { sys::napi_resolve_deferred(env, deferred, res) },
      "Resolve deferred value failed"
    )
    .map(|_| {
      #[cfg(feature = "deferred_trace")]
      {
        let _status = unsafe { sys::napi_delete_reference(env, deferred_data.trace.0) };
        if _status != sys::Status::napi_ok && cfg!(debug_assertions) {
          eprintln!(
            "Failed to delete reference in deferred {}",
            crate::Status::from(_status)
          );
        }
      }
    })
  }) {
    #[cfg(feature = "deferred_trace")]
    let error = deferred_data.trace.into_rejected(env, e);
    #[cfg(not(feature = "deferred_trace"))]
    let error = Ok::<sys::napi_value, Error>(unsafe { crate::JsError::from(e).into_value(env) });

    match error {
      Ok(error) => {
        unsafe { sys::napi_reject_deferred(env, deferred, error) };
        if let Some(finalize_callback) = finalize_callback {
          finalize_callback(env);
        }
      }
      Err(err) => {
        if let Some(finalize_callback) = finalize_callback {
          finalize_callback(env);
        }
        if cfg!(debug_assertions) {
          eprintln!("Failed to reject deferred: {err:?}");
          let mut err = ptr::null_mut();
          let mut err_msg = ptr::null_mut();
          unsafe {
            sys::napi_create_string_utf8(env, c"Rejection failed".as_ptr().cast(), 0, &mut err_msg);
            sys::napi_create_error(env, ptr::null_mut(), err_msg, &mut err);
            sys::napi_reject_deferred(env, deferred, err);
          }
        }
      }
    }
  } else if let Some(finalize_callback) = finalize_callback {
    finalize_callback(env);
  }
}
