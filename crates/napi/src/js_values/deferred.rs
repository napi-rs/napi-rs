use std::cell::RefCell;
use std::collections::{hash_map::Entry, HashMap, HashSet};
use std::os::raw::c_void;
use std::ptr;
use std::{
  marker::PhantomData,
  sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Mutex,
  },
  thread::{self, ThreadId},
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

type FinalizeCallbackId = usize;
type EnvId = usize;
type FinalizeCallback = Box<dyn FnOnce(sys::napi_env)>;

struct FinalizeCallbackEntry {
  #[cfg_attr(feature = "noop", allow(dead_code))]
  env: EnvId,
  callback: Option<FinalizeCallback>,
}

impl Drop for FinalizeCallbackEntry {
  fn drop(&mut self) {
    if let Some(callback) = self.callback.take() {
      crate::bindgen_runtime::catch_unwind_safely(|| drop(callback));
    }
  }
}

thread_local! {
  static FINALIZE_CALLBACKS: RefCell<HashMap<FinalizeCallbackId, FinalizeCallbackEntry>> =
    RefCell::new(HashMap::new());
  static FINALIZE_CLEANUP_ENVS: RefCell<HashSet<EnvId>> = RefCell::new(HashSet::new());
  static FINALIZE_CLOSING_ENVS: RefCell<HashSet<EnvId>> = RefCell::new(HashSet::new());
}

static NEXT_FINALIZE_CALLBACK_ID: AtomicUsize = AtomicUsize::new(1);

struct FinalizeCallbackHandle {
  id: FinalizeCallbackId,
}

impl FinalizeCallbackHandle {
  fn new(env: sys::napi_env, callback: FinalizeCallback) -> Self {
    if FINALIZE_CLOSING_ENVS.with(|envs| envs.borrow().contains(&(env as EnvId))) {
      crate::bindgen_runtime::catch_unwind_safely(|| drop(callback));
      return Self { id: 0 };
    }
    let mut callback = Some(callback);
    let id = FINALIZE_CALLBACKS.with(|callbacks| loop {
      let id = NEXT_FINALIZE_CALLBACK_ID.fetch_add(1, Ordering::Relaxed);
      if id == 0 {
        continue;
      }
      if let Entry::Vacant(entry) = callbacks.borrow_mut().entry(id) {
        entry.insert(FinalizeCallbackEntry {
          env: env as EnvId,
          callback: callback.take(),
        });
        break id;
      }
    });
    Self { id }
  }

  fn run(self, env: sys::napi_env) {
    let entry = FINALIZE_CALLBACKS.with(|callbacks| callbacks.borrow_mut().remove(&self.id));
    if let Some(mut entry) = entry {
      if let Some(callback) = entry.callback.take() {
        crate::bindgen_runtime::catch_unwind_safely(|| callback(env));
      }
    }
  }
}

impl Drop for FinalizeCallbackHandle {
  fn drop(&mut self) {
    if let Ok(Some(entry)) =
      FINALIZE_CALLBACKS.try_with(|callbacks| callbacks.borrow_mut().remove(&self.id))
    {
      drop(entry);
    }
  }
}

type SharedFinalizeCallback = Arc<Mutex<Option<FinalizeCallbackHandle>>>;

#[derive(Clone, Default)]
struct DeferredSettlement(Arc<AtomicBool>);

impl DeferredSettlement {
  fn try_claim(&self) -> bool {
    !self.0.swap(true, Ordering::AcqRel)
  }
}

#[cfg(not(feature = "noop"))]
fn ensure_finalize_cleanup_hook(env: sys::napi_env) -> Result<()> {
  if FINALIZE_CLEANUP_ENVS.with(|envs| envs.borrow().contains(&(env as EnvId))) {
    return Ok(());
  }
  #[cfg(not(target_family = "wasm"))]
  let status =
    unsafe { sys::napi_add_env_cleanup_hook(env, Some(finalize_callback_env_cleanup), env.cast()) };
  #[cfg(target_family = "wasm")]
  let status = unsafe {
    crate::napi_add_env_cleanup_hook(env, Some(finalize_callback_env_cleanup), env.cast())
  };
  check_status!(status, "Add JsDeferred environment cleanup hook failed")?;
  FINALIZE_CLEANUP_ENVS.with(|envs| {
    envs.borrow_mut().insert(env as EnvId);
  });
  Ok(())
}

#[cfg(feature = "noop")]
fn ensure_finalize_cleanup_hook(_env: sys::napi_env) -> Result<()> {
  Ok(())
}

#[cfg(not(feature = "noop"))]
unsafe extern "C" fn finalize_callback_env_cleanup(data: *mut c_void) {
  let env = data.cast();
  crate::bindgen_runtime::with_runtime_teardown_guard(|| {
    crate::bindgen_runtime::catch_unwind_safely(|| clear_finalize_callbacks_for_env(env));
  });
  let _ = FINALIZE_CLEANUP_ENVS.try_with(|envs| {
    envs.borrow_mut().remove(&(env as EnvId));
  });
}

struct DeferredData<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>> {
  resolver: Result<Resolver>,
  rejection_cleanup: Option<Box<dyn FnOnce() + Send>>,
  #[cfg(feature = "deferred_trace")]
  trace: DeferredTrace,
  tsfn: sys::napi_threadsafe_function,
  finalize_callback: SharedFinalizeCallback,
}

pub struct JsDeferred<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>> {
  env: sys::napi_env,
  owner_thread: ThreadId,
  pub(crate) tsfn: sys::napi_threadsafe_function,
  #[cfg(feature = "deferred_trace")]
  trace: DeferredTrace,
  finalize_callback: SharedFinalizeCallback,
  settlement: DeferredSettlement,
  _data: PhantomData<fn() -> Data>,
  _resolver: PhantomData<fn() -> Resolver>,
}

/// Clones race to settle the same promise; only the first resolution or rejection is submitted.
impl<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>> Clone
  for JsDeferred<Data, Resolver>
{
  fn clone(&self) -> Self {
    Self {
      env: self.env,
      owner_thread: self.owner_thread,
      tsfn: self.tsfn,
      #[cfg(feature = "deferred_trace")]
      trace: self.trace.clone(),
      finalize_callback: self.finalize_callback.clone(),
      settlement: self.settlement.clone(),
      _data: PhantomData,
      _resolver: PhantomData,
    }
  }
}

// SAFETY: a JsDeferred owns only a Node threadsafe-function handle and Send callback state.
// Data and Resolver are represented by non-owning function-pointer markers. Resolution data is
// transferred through napi_call_threadsafe_function only after the Resolver satisfies Send.
unsafe impl<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data> + Send> Send
  for JsDeferred<Data, Resolver>
{
}

impl<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>> JsDeferred<Data, Resolver> {
  pub(crate) fn new(env: &Env) -> Result<(Self, Object<'_>)> {
    ensure_finalize_cleanup_hook(env.0)?;
    let (tsfn, promise) = js_deferred_new_raw(env, Some(napi_resolve_deferred::<Data, Resolver>))?;

    let deferred = Self {
      env: env.0,
      owner_thread: thread::current().id(),
      tsfn,
      #[cfg(feature = "deferred_trace")]
      trace: DeferredTrace::new(env.0)?,
      finalize_callback: Default::default(),
      settlement: Default::default(),
      _data: PhantomData,
      _resolver: PhantomData,
    };

    Ok((deferred, promise))
  }

  /// Consumes the deferred, and resolves the promise. The provided function will be called
  /// from the JavaScript thread, and should return the resolved value.
  pub fn resolve(self, resolver: Resolver) {
    self.call_tsfn(Ok(resolver), None)
  }

  /// Consumes the deferred, and rejects the promise with the provided error.
  pub fn reject(self, error: Error) {
    self.call_tsfn(Err(error), None)
  }

  #[cfg(all(
    any(feature = "tokio_rt", feature = "async-runtime"),
    not(feature = "noop")
  ))]
  pub(crate) fn reject_with_cleanup(self, error: Error, cleanup: impl FnOnce() + Send + 'static) {
    self.call_tsfn(Err(error), Some(Box::new(cleanup)))
  }

  /// Set a callback to run on the JavaScript owner thread after settlement.
  ///
  /// This must be called on the thread that created the deferred.
  pub fn set_finalize_callback(
    &mut self,
    finalize_callback: Option<Box<dyn FnOnce(sys::napi_env)>>,
  ) {
    assert_eq!(
      self.owner_thread,
      thread::current().id(),
      "JsDeferred finalize callbacks must be registered on their JavaScript owner thread"
    );
    *self
      .finalize_callback
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner) =
      finalize_callback.map(|callback| FinalizeCallbackHandle::new(self.env, callback));
  }

  fn call_tsfn(
    self,
    result: Result<Resolver>,
    rejection_cleanup: Option<Box<dyn FnOnce() + Send>>,
  ) {
    if !self.settlement.try_claim() {
      crate::bindgen_runtime::catch_unwind_safely(|| drop(result));
      crate::bindgen_runtime::catch_unwind_safely(|| drop(rejection_cleanup));
      return;
    }
    let data = DeferredData {
      resolver: result,
      rejection_cleanup,
      #[cfg(feature = "deferred_trace")]
      trace: self.trace,
      tsfn: self.tsfn,
      finalize_callback: self.finalize_callback.clone(),
    };

    // Call back into the JS thread via a threadsafe function. This results in napi_resolve_deferred being called.
    let data = Box::into_raw(Box::new(data));
    let status = unsafe {
      sys::napi_call_threadsafe_function(
        self.tsfn,
        data.cast(),
        sys::ThreadsafeFunctionCallMode::blocking,
      )
    };
    if status != sys::Status::napi_ok {
      // Node did not take ownership, most commonly because the environment is closing.
      // Reclaim scheduler-owned data here. JS-thread-owned resolver closures are represented
      // by SendableResolver handles and are cleared by the per-environment cleanup hook.
      let data = unsafe { Box::from_raw(data) };
      crate::bindgen_runtime::catch_unwind_safely(|| drop(data));
    }
  }
}

fn js_deferred_new_raw(
  env: &Env,
  resolve_deferred: sys::napi_threadsafe_function_call_js,
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
        ptr::null_mut(),
        None,
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
  crate::bindgen_runtime::catch_unwind_safely(|| {
    napi_resolve_deferred_inner::<Data, Resolver>(env, context, data);
  });
}

fn napi_resolve_deferred_inner<Data: ToNapiValue, Resolver: FnOnce(Env) -> Result<Data>>(
  env: sys::napi_env,
  context: *mut c_void,
  data: *mut c_void,
) {
  let deferred = context.cast();
  let deferred_data: Box<DeferredData<Data, Resolver>> = unsafe { Box::from_raw(data.cast()) };
  if env.is_null() {
    // Node invokes TSFN callbacks with a null environment while aborting a closing
    // environment. The payload is Send and may be reclaimed here; JS-thread-owned resolver
    // entries are removed by the environment cleanup hook.
    crate::bindgen_runtime::catch_unwind_safely(|| drop(deferred_data));
    return;
  }
  let DeferredData {
    resolver,
    rejection_cleanup,
    #[cfg(feature = "deferred_trace")]
    trace,
    tsfn,
    finalize_callback,
  } = *deferred_data;
  let finalize_callback = finalize_callback
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .take();
  if resolver.is_err() {
    if let Some(rejection_cleanup) = rejection_cleanup {
      crate::bindgen_runtime::catch_unwind_safely(rejection_cleanup);
    }
  }
  let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
    resolver
      .and_then(|resolver| resolver(Env::from_raw(env)))
      .and_then(|res| unsafe { ToNapiValue::to_napi_value(env, res) })
  }))
  .map_err(crate::bindgen_runtime::panic_to_error)
  .and_then(|result| result);

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
        let _status = unsafe { sys::napi_delete_reference(env, trace.0) };
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
    let error = trace.into_rejected(env, e);
    #[cfg(not(feature = "deferred_trace"))]
    let error = Ok::<sys::napi_value, Error>(unsafe { crate::JsError::from(e).into_value(env) });

    match error {
      Ok(error) => {
        unsafe { sys::napi_reject_deferred(env, deferred, error) };
        run_finalize_callback(finalize_callback, env);
      }
      Err(err) => {
        run_finalize_callback(finalize_callback, env);
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
  } else {
    run_finalize_callback(finalize_callback, env);
  }
}

fn run_finalize_callback(finalize_callback: Option<FinalizeCallbackHandle>, env: sys::napi_env) {
  if let Some(finalize_callback) = finalize_callback {
    finalize_callback.run(env);
  }
}

#[cfg_attr(feature = "noop", allow(dead_code))]
pub(crate) fn clear_finalize_callbacks_for_env(env: sys::napi_env) {
  FINALIZE_CLOSING_ENVS.with(|envs| {
    envs.borrow_mut().insert(env as EnvId);
  });
  let entries = FINALIZE_CALLBACKS.with(|callbacks| {
    let mut callbacks = callbacks.borrow_mut();
    let ids = callbacks
      .iter()
      .filter_map(|(id, entry)| (entry.env == env as EnvId).then_some(*id))
      .collect::<Vec<_>>();
    ids
      .into_iter()
      .filter_map(|id| callbacks.remove(&id))
      .collect::<Vec<_>>()
  });
  drop(entries);
  FINALIZE_CLOSING_ENVS.with(|envs| {
    envs.borrow_mut().remove(&(env as EnvId));
  });
}

#[cfg(test)]
mod tests {
  use std::{
    cell::Cell,
    rc::Rc,
    thread::{self, ThreadId},
  };

  use super::*;

  struct DropThread {
    dropped_on: Rc<Cell<Option<ThreadId>>>,
  }

  impl Drop for DropThread {
    fn drop(&mut self) {
      self.dropped_on.set(Some(thread::current().id()));
    }
  }

  struct ReentrantFinalizeDrop {
    env: sys::napi_env,
    nested_dropped_on: Rc<Cell<Option<ThreadId>>>,
  }

  impl Drop for ReentrantFinalizeDrop {
    fn drop(&mut self) {
      let captured = DropThread {
        dropped_on: Rc::clone(&self.nested_dropped_on),
      };
      let nested = FinalizeCallbackHandle::new(
        self.env,
        Box::new(move |_| {
          drop(captured);
        }),
      );
      std::mem::forget(nested);
    }
  }

  #[test]
  fn non_send_finalize_callback_runs_on_owner_thread() {
    let owner_thread = thread::current().id();
    let called_on = Rc::new(Cell::new(None));
    let called_on_callback = Rc::clone(&called_on);
    let callback = FinalizeCallbackHandle::new(
      std::ptr::null_mut(),
      Box::new(move |_| called_on_callback.set(Some(thread::current().id()))),
    );

    callback.run(std::ptr::null_mut());

    assert_eq!(called_on.get(), Some(owner_thread));
  }

  #[test]
  fn environment_cleanup_drops_finalize_callbacks_on_owner_thread() {
    let owner_thread = thread::current().id();
    let dropped_on = Rc::new(Cell::new(None));
    let captured = DropThread {
      dropped_on: Rc::clone(&dropped_on),
    };
    let env = 1usize as sys::napi_env;
    let _callback = FinalizeCallbackHandle::new(
      env,
      Box::new(move |_| {
        drop(captured);
      }),
    );

    clear_finalize_callbacks_for_env(env);

    assert_eq!(dropped_on.get(), Some(owner_thread));
  }

  #[test]
  fn environment_cleanup_rejects_reentrant_finalize_callbacks() {
    let env = 2usize as sys::napi_env;
    let nested_dropped_on = Rc::new(Cell::new(None));
    let captured = ReentrantFinalizeDrop {
      env,
      nested_dropped_on: Rc::clone(&nested_dropped_on),
    };
    let _callback = FinalizeCallbackHandle::new(
      env,
      Box::new(move |_| {
        drop(captured);
      }),
    );

    clear_finalize_callbacks_for_env(env);

    assert_eq!(nested_dropped_on.get(), Some(thread::current().id()));
  }

  #[test]
  fn deferred_clones_share_one_shot_settlement_ownership() {
    let settlement = DeferredSettlement::default();
    let clone = settlement.clone();

    assert!(settlement.try_claim());
    assert!(!clone.try_claim());
  }
}
