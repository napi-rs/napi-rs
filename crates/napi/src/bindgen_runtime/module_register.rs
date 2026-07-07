use std::cell::{LazyCell, RefCell};
#[cfg(not(feature = "noop"))]
use std::collections::HashSet;
#[cfg(not(feature = "noop"))]
use std::ffi::CStr;
#[cfg(all(not(feature = "noop"), feature = "node_version_detect"))]
use std::mem::MaybeUninit;
#[cfg(not(feature = "noop"))]
use std::ptr;
#[cfg(all(
  not(feature = "noop"),
  any(feature = "tokio_rt", feature = "async-runtime"),
  feature = "napi4"
))]
use std::sync::Mutex;
#[cfg(all(not(feature = "noop"), feature = "node_version_detect"))]
use std::sync::OnceLock;
#[cfg(not(feature = "noop"))]
use std::sync::{
  atomic::{AtomicBool, AtomicUsize, Ordering},
  LazyLock, RwLock,
};
use std::{any::TypeId, collections::HashMap};

use rustc_hash::FxBuildHasher;

#[cfg(all(
  not(feature = "noop"),
  any(feature = "napi4", feature = "node_version_detect")
))]
use crate::check_status_or_throw;
#[cfg(all(not(feature = "noop"), feature = "node_version_detect"))]
use crate::NodeVersion;
#[cfg(not(feature = "noop"))]
use crate::{check_status, JsError};
use crate::{sys, Property, Result};

// #[napi] fn
pub type ExportRegisterCallback = unsafe fn(sys::napi_env) -> Result<sys::napi_value>;
// #[napi(module_exports)] fn
pub type ExportRegisterHookCallback =
  unsafe fn(sys::napi_env, sys::napi_value) -> Result<sys::napi_value>;
pub type ModuleExportsCallback =
  unsafe fn(env: sys::napi_env, exports: sys::napi_value) -> Result<()>;

#[cfg(all(not(feature = "noop"), feature = "node_version_detect"))]
pub static NODE_VERSION: OnceLock<NodeVersion> = OnceLock::new();

#[cfg(feature = "node_version_detect")]
pub static mut NODE_VERSION_MAJOR: u32 = 0;
#[cfg(feature = "node_version_detect")]
pub static mut NODE_VERSION_MINOR: u32 = 0;
#[cfg(feature = "node_version_detect")]
pub static mut NODE_VERSION_PATCH: u32 = 0;

#[repr(transparent)]
pub(crate) struct PersistedPerInstanceHashMap<K, V, S>(RefCell<HashMap<K, V, S>>);

impl<K, V, S> PersistedPerInstanceHashMap<K, V, S> {
  #[allow(clippy::mut_from_ref)]
  pub(crate) fn borrow_mut<F, R>(&self, f: F) -> R
  where
    F: FnOnce(&mut HashMap<K, V, S>) -> R,
  {
    f(&mut *self.0.borrow_mut())
  }
}

impl<K, V, S: Default> Default for PersistedPerInstanceHashMap<K, V, S> {
  fn default() -> Self {
    Self(RefCell::new(HashMap::<K, V, S>::default()))
  }
}

#[cfg(not(feature = "noop"))]
type ModuleRegisterCallback =
  RwLock<Vec<(Option<&'static str>, (&'static str, ExportRegisterCallback))>>;

#[cfg(not(feature = "noop"))]
type ClassPropertyRegistry =
  HashMap<TypeId, HashMap<Option<&'static str>, ClassRegistration, FxBuildHasher>, FxBuildHasher>;

#[cfg(not(feature = "noop"))]
struct ClassRegistration {
  js_name: &'static str,
  props: Vec<Property>,
  implement_iterator: bool,
}

// Stores class metadata registered by napi macros.
// Since class properties do not contain any napi_value, ModuleClassProperty is thread-safe.
// This structure is shared between the main JS thread and worker threads.
#[cfg(not(feature = "noop"))]
#[derive(Default)]
struct ModuleClassProperty(RwLock<ClassPropertyRegistry>);

#[cfg(not(feature = "noop"))]
unsafe impl Send for ModuleClassProperty {}
#[cfg(not(feature = "noop"))]
unsafe impl Sync for ModuleClassProperty {}

#[cfg(not(feature = "noop"))]
impl ModuleClassProperty {
  pub(crate) fn borrow_mut<F, R>(&self, f: F) -> R
  where
    F: FnOnce(&mut ClassPropertyRegistry) -> R,
  {
    let mut write_lock = self.0.write().unwrap();
    f(&mut write_lock)
  }

  pub(crate) fn borrow<F, R>(&self, f: F) -> R
  where
    F: FnOnce(&ClassPropertyRegistry) -> R,
  {
    let write_lock = self.0.read().unwrap();
    f(&write_lock)
  }
}

#[cfg(not(feature = "noop"))]
static MODULE_REGISTER_CALLBACK: LazyLock<ModuleRegisterCallback> = LazyLock::new(Default::default);
#[cfg(not(feature = "noop"))]
static MODULE_REGISTER_HOOK_CALLBACK: LazyLock<RwLock<Option<ExportRegisterHookCallback>>> =
  LazyLock::new(Default::default);
#[cfg(not(feature = "noop"))]
static MODULE_CLASS_PROPERTIES: LazyLock<ModuleClassProperty> = LazyLock::new(Default::default);
#[cfg(not(feature = "noop"))]
static MODULE_COUNT: AtomicUsize = AtomicUsize::new(0);
#[cfg(not(feature = "noop"))]
static FIRST_MODULE_REGISTERED: AtomicBool = AtomicBool::new(false);
#[cfg(all(
  not(feature = "noop"),
  any(feature = "tokio_rt", feature = "async-runtime"),
  feature = "napi4"
))]
static REGISTERED_RUNTIME_ENVS: LazyLock<Mutex<HashMap<usize, RuntimeEnvRegistration>>> =
  LazyLock::new(|| Mutex::new(HashMap::new()));

#[cfg(all(not(feature = "noop"), feature = "napi4"))]
fn checked_update_atomic(
  value: &AtomicUsize,
  update: impl Fn(usize) -> Option<usize>,
) -> std::result::Result<usize, usize> {
  let mut current = value.load(Ordering::Acquire);
  loop {
    let Some(next) = update(current) else {
      return Err(current);
    };
    match value.compare_exchange_weak(current, next, Ordering::AcqRel, Ordering::Acquire) {
      Ok(previous) => return Ok(previous),
      Err(actual) => current = actual,
    }
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "tokio_rt", feature = "async-runtime"),
  feature = "napi4"
))]
struct RuntimeEnvRegistration {
  count: usize,
  closing: bool,
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "tokio_rt", feature = "async-runtime"),
  feature = "napi4"
))]
pub(crate) struct RegisteredRuntimeEnvGuard {
  _guard: std::sync::MutexGuard<'static, HashMap<usize, RuntimeEnvRegistration>>,
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "tokio_rt", feature = "async-runtime"),
  feature = "napi4"
))]
pub(crate) fn registered_runtime_env(env: usize) -> Option<RegisteredRuntimeEnvGuard> {
  let guard = REGISTERED_RUNTIME_ENVS
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner);
  guard
    .get(&env)
    .is_some_and(|registration| !registration.closing)
    .then_some(RegisteredRuntimeEnvGuard { _guard: guard })
}

#[cfg(all(
  not(feature = "noop"),
  feature = "tokio_rt",
  not(feature = "async-runtime"),
  feature = "napi4"
))]
pub(crate) fn with_registered_runtime_env<T>(env: usize, f: impl FnOnce() -> T) -> Option<T> {
  let _guard = registered_runtime_env(env)?;
  Some(f())
}

thread_local! {
  static REGISTERED_CLASSES: LazyCell<RegisteredClasses> = LazyCell::new(Default::default);
  static CALLBACK_ENV_STACK: RefCell<Vec<usize>> = const { RefCell::new(Vec::new()) };
}

pub(crate) struct CallbackEnvGuard {
  env: usize,
}

pub(crate) fn enter_callback_env(env: sys::napi_env) -> CallbackEnvGuard {
  let env = env as usize;
  CALLBACK_ENV_STACK.with(|stack| stack.borrow_mut().push(env));
  CallbackEnvGuard { env }
}

impl Drop for CallbackEnvGuard {
  fn drop(&mut self) {
    CALLBACK_ENV_STACK.with(|stack| {
      let actual = stack
        .borrow_mut()
        .pop()
        .expect("callback environment guards must be dropped in stack order");
      assert_eq!(
        actual, self.env,
        "callback environment guards must be dropped in stack order"
      );
    });
  }
}

pub(crate) fn current_callback_env() -> Option<sys::napi_env> {
  CALLBACK_ENV_STACK.with(|stack| {
    stack
      .borrow()
      .last()
      .copied()
      .map(|env| env as sys::napi_env)
  })
}

#[cfg(all(feature = "async-runtime", not(feature = "noop")))]
fn rollback_unowned_runtime_preserving_registration_error(mut error: crate::Error) -> crate::Error {
  if let Err(cleanup_error) =
    crate::tokio_runtime::rollback_unowned_async_runtime_after_registration_failure()
  {
    error
      .reason
      .push_str("; additionally, async runtime rollback failed: ");
    error.reason.push_str(&cleanup_error.reason);
  }
  error
}

// Per-env custom-GC infrastructure (#3357). Module registration first installs a provisional
// handle so values captured by module-init callbacks can route off-thread drops without creating
// a native callback that could outlive a failed load. After exports succeed, the handle becomes
// active and owns one unref'd TSFN until env teardown.
#[cfg(all(feature = "napi4", not(feature = "noop")))]
struct CustomGcOwnerCleanupContext {
  handle: std::sync::Arc<CustomGcHandle>,
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
pub(crate) struct CustomGcHandle {
  env: usize,
  owner_thread: std::thread::ThreadId,
  tsfn: std::sync::atomic::AtomicPtr<sys::napi_threadsafe_function__>,
  owner_cleanup_context: std::sync::atomic::AtomicPtr<CustomGcOwnerCleanupContext>,
  state: std::sync::Mutex<CustomGcState>,
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
enum CustomGcState {
  Pending(Vec<usize>),
  Active,
  RolledBack(Vec<usize>),
  Closed,
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
impl CustomGcHandle {
  pub(crate) fn release_reference(&self, reference: sys::napi_ref) -> sys::napi_status {
    let mut state = self
      .state
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    match &mut *state {
      CustomGcState::Closed => sys::Status::napi_closing,
      CustomGcState::Pending(pending) => {
        pending.push(reference as usize);
        sys::Status::napi_ok
      }
      CustomGcState::RolledBack(pending) => {
        if self.owner_thread == std::thread::current().id() {
          drop(state);
          return release_custom_gc_reference(self.env as sys::napi_env, reference);
        }
        pending.push(reference as usize);
        sys::Status::napi_ok
      }
      CustomGcState::Active => {
        let status = unsafe {
          sys::napi_call_threadsafe_function(
            self.tsfn.load(std::sync::atomic::Ordering::SeqCst),
            reference.cast(),
            1,
          )
        };
        if status == sys::Status::napi_closing {
          *state = CustomGcState::Closed;
        }
        status
      }
    }
  }

  pub(crate) fn can_access_from_current_thread(&self, env: sys::napi_env) -> bool {
    self.env == env as usize
      && self.owner_thread == std::thread::current().id()
      && !matches!(
        *self
          .state
          .lock()
          .unwrap_or_else(std::sync::PoisonError::into_inner),
        CustomGcState::Closed
      )
  }

  fn activate(&self, tsfn: sys::napi_threadsafe_function) -> Vec<usize> {
    self.tsfn.store(tsfn, std::sync::atomic::Ordering::SeqCst);
    let mut state = self
      .state
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    match std::mem::replace(&mut *state, CustomGcState::Active) {
      CustomGcState::Pending(pending) => pending,
      CustomGcState::Active => Vec::new(),
      CustomGcState::RolledBack(pending) => {
        *state = CustomGcState::RolledBack(pending);
        Vec::new()
      }
      CustomGcState::Closed => {
        *state = CustomGcState::Closed;
        Vec::new()
      }
    }
  }

  fn rollback(&self) -> Vec<usize> {
    let mut state = self
      .state
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    match std::mem::replace(&mut *state, CustomGcState::RolledBack(Vec::new())) {
      CustomGcState::Pending(pending) | CustomGcState::RolledBack(pending) => pending,
      CustomGcState::Active => {
        *state = CustomGcState::Active;
        Vec::new()
      }
      CustomGcState::Closed => {
        *state = CustomGcState::Closed;
        Vec::new()
      }
    }
  }

  fn close_for_env_cleanup(&self) -> (sys::napi_threadsafe_function, Vec<usize>) {
    let mut state = self
      .state
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    match std::mem::replace(&mut *state, CustomGcState::Closed) {
      CustomGcState::Pending(pending) | CustomGcState::RolledBack(pending) => {
        (ptr::null_mut(), pending)
      }
      CustomGcState::Active => (
        self.tsfn.load(std::sync::atomic::Ordering::SeqCst),
        Vec::new(),
      ),
      CustomGcState::Closed => (ptr::null_mut(), Vec::new()),
    }
  }

  fn close_from_finalize(&self) -> bool {
    let mut state = self
      .state
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    if matches!(*state, CustomGcState::Active) {
      *state = CustomGcState::Closed;
      true
    } else {
      false
    }
  }

  fn is_active_for(&self, env: sys::napi_env) -> bool {
    self.env == env as usize
      && matches!(
        *self
          .state
          .lock()
          .unwrap_or_else(std::sync::PoisonError::into_inner),
        CustomGcState::Active
      )
  }
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
struct CustomGcRegistration {
  handle: std::sync::Arc<CustomGcHandle>,
  owned: bool,
}

// `prepare_custom_gc` installs the current registration's handle under its exact `napi_env`, and
// `FromNapiValue` captures that handle for the value's owning env. Duplicate `process.dlopen` calls
// may supply multiple `napi_env` pointers on the same isolate thread; an env-keyed map prevents a
// reference created by one registration from being routed through another registration's TSFN.
thread_local! {
  #[cfg(all(feature = "napi4", not(feature = "noop")))]
  pub(crate) static CURRENT_CUSTOM_GC_HANDLES:
    std::cell::RefCell<HashMap<usize, std::sync::Arc<CustomGcHandle>>> =
      std::cell::RefCell::new(HashMap::new());
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
pub(crate) fn current_custom_gc_handle(
  env: sys::napi_env,
) -> Option<std::sync::Arc<CustomGcHandle>> {
  // clone = one refcount inc, at from_napi_value capture
  CURRENT_CUSTOM_GC_HANDLES.with(|handles| handles.borrow().get(&(env as usize)).cloned())
}

struct RegisteredClass {
  js_name: &'static str,
  constructor: sys::napi_ref,
}

type RegisteredClassKey = (TypeId, Option<&'static str>);
type RegisteredClassesForEnv = HashMap<RegisteredClassKey, RegisteredClass, FxBuildHasher>;
type RegisteredClasses =
  PersistedPerInstanceHashMap</* napi_env */ usize, RegisteredClassesForEnv, FxBuildHasher>;

#[cfg(all(feature = "compat-mode", not(feature = "noop")))]
// compatibility for #[module_exports]
static MODULE_EXPORTS: LazyLock<RwLock<Vec<ModuleExportsCallback>>> =
  LazyLock::new(Default::default);

#[cfg(not(feature = "noop"))]
#[inline]
fn wait_first_thread_registered() {
  while !FIRST_MODULE_REGISTERED.load(Ordering::SeqCst) {
    std::hint::spin_loop();
  }
}

#[doc(hidden)]
#[cfg(all(feature = "compat-mode", not(feature = "noop")))]
// compatibility for #[module_exports]
pub fn register_module_exports(callback: ModuleExportsCallback) {
  MODULE_EXPORTS
    .write()
    .expect("Register module exports failed")
    .push(callback);
}

#[cfg(feature = "noop")]
#[doc(hidden)]
pub fn register_module_exports(_: ModuleExportsCallback) {}

#[cfg(not(feature = "noop"))]
#[doc(hidden)]
pub fn register_module_export(
  js_mod: Option<&'static str>,
  name: &'static str,
  cb: ExportRegisterCallback,
) {
  MODULE_REGISTER_CALLBACK
    .write()
    .expect("Register module export failed")
    .push((js_mod, (name, cb)));
}

#[cfg(feature = "noop")]
#[doc(hidden)]
pub fn register_module_export(
  _js_mod: Option<&'static str>,
  _name: &'static str,
  _cb: ExportRegisterCallback,
) {
}

#[cfg(not(feature = "noop"))]
#[doc(hidden)]
pub fn register_module_export_hook(cb: ExportRegisterHookCallback) {
  let mut inner = MODULE_REGISTER_HOOK_CALLBACK
    .write()
    .expect("Write MODULE_REGISTER_HOOK_CALLBACK failed");
  *inner = Some(cb);
}

#[cfg(feature = "noop")]
#[doc(hidden)]
pub fn register_module_export_hook(_cb: ExportRegisterHookCallback) {}

#[doc(hidden)]
pub fn get_class_constructor(js_name: &'static str) -> Option<sys::napi_ref> {
  if let Some(env) = current_callback_env() {
    return get_class_constructor_for_env(env, js_name);
  }
  REGISTERED_CLASSES.with(|cell| {
    cell.borrow_mut(|map| {
      let mut matches = map
        .values()
        .flat_map(HashMap::values)
        .filter(|class| class.js_name == js_name)
        .map(|class| class.constructor);
      let constructor = matches.next()?;
      matches.next().is_none().then_some(constructor)
    })
  })
}

#[doc(hidden)]
pub fn get_class_constructor_for_env(
  env: sys::napi_env,
  js_name: &'static str,
) -> Option<sys::napi_ref> {
  REGISTERED_CLASSES.with(|cell| {
    cell.borrow_mut(|map| {
      let mut matches = map
        .get(&(env as usize))?
        .values()
        .filter(|class| class.js_name == js_name)
        .map(|class| class.constructor);
      let constructor = matches.next()?;
      matches.next().is_none().then_some(constructor)
    })
  })
}

#[doc(hidden)]
pub fn get_class_constructor_for_env_by_type(
  env: sys::napi_env,
  rust_type_id: TypeId,
  js_mod: Option<&'static str>,
) -> Option<sys::napi_ref> {
  REGISTERED_CLASSES.with(|cell| {
    cell.borrow_mut(|map| {
      map
        .get(&(env as usize))
        .and_then(|classes| classes.get(&(rust_type_id, js_mod)))
        .map(|class| class.constructor)
    })
  })
}

#[cfg(all(not(feature = "noop"), feature = "napi3"))]
pub(crate) fn cleanup_registered_classes_for_env(env: sys::napi_env) {
  if env.is_null() {
    return;
  }
  let classes = REGISTERED_CLASSES
    .with(|registered| registered.borrow_mut(|classes| classes.remove(&(env as usize))));
  let Some(classes) = classes else {
    return;
  };
  for class in classes.into_values() {
    let status = unsafe { sys::napi_delete_reference(env, class.constructor) };
    if status != sys::Status::napi_ok && cfg!(debug_assertions) {
      crate::bindgen_runtime::catch_unwind_safely(|| {
        eprintln!(
          "Failed to delete registered class reference during environment cleanup: {}",
          crate::Status::from(status)
        );
      });
    }
  }
}

#[cfg(not(feature = "noop"))]
#[doc(hidden)]
pub fn register_class(
  rust_type_id: TypeId,
  js_mod: Option<&'static str>,
  js_name: &'static str,
  props: Vec<Property>,
  implement_iterator: bool,
) {
  MODULE_CLASS_PROPERTIES.borrow_mut(|inner| {
    let val = inner.entry(rust_type_id).or_default();
    let val = val.entry(js_mod).or_insert_with(|| ClassRegistration {
      js_name,
      props: Vec::new(),
      implement_iterator,
    });
    val.js_name = js_name;
    val.implement_iterator |= implement_iterator;
    val.props.extend(props);
  });
}

#[cfg(feature = "noop")]
#[doc(hidden)]
#[allow(unused_variables)]
pub fn register_class(
  rust_type_id: TypeId,
  js_mod: Option<&'static str>,
  js_name: &'static str,
  props: Vec<Property>,
  implement_iterator: bool,
) {
}

#[cfg(all(target_family = "wasm", not(feature = "noop")))]
#[no_mangle]
unsafe extern "C" fn napi_register_wasm_v1(
  env: sys::napi_env,
  exports: sys::napi_value,
) -> sys::napi_value {
  unsafe { napi_register_module_v1(env, exports) }
}

#[cfg(not(feature = "noop"))]
#[no_mangle]
/// Register the n-api module exports.
///
/// # Safety
/// This method is meant to be called by Node.js while importing the n-api module.
/// Only call this method if the current module is **not** imported by a node-like runtime.
///
/// Arguments `env` and `exports` must **not** be null.
pub unsafe extern "C" fn napi_register_module_v1(
  env: sys::napi_env,
  exports: sys::napi_value,
) -> sys::napi_value {
  #[cfg(any(
    target_env = "msvc",
    all(not(target_family = "wasm"), feature = "dyn-symbols")
  ))]
  unsafe {
    sys::setup();
  }
  #[cfg(feature = "node_version_detect")]
  {
    NODE_VERSION.get_or_init(|| {
      let mut node_version = MaybeUninit::uninit();
      check_status_or_throw!(
        env,
        unsafe { sys::napi_get_node_version(env, node_version.as_mut_ptr()) },
        "Failed to get node version"
      );
      let node_version = *node_version.assume_init();
      unsafe {
        NODE_VERSION_MAJOR = node_version.major;
        NODE_VERSION_MINOR = node_version.minor;
        NODE_VERSION_PATCH = node_version.patch;
      }
      NodeVersion {
        major: node_version.major,
        minor: node_version.minor,
        patch: node_version.patch,
        release: unsafe { CStr::from_ptr(node_version.release).to_str().unwrap() },
      }
    });
  }

  let resolver_registration = crate::sendable_resolver::register_resolver_env(env);
  let resolver_env_owned = match resolver_registration {
    Ok(owned) => owned,
    Err(error) => {
      #[cfg(all(feature = "async-runtime", not(feature = "noop")))]
      let error = rollback_unowned_runtime_preserving_registration_error(error);
      JsError::from(error).throw_into(env);
      return exports;
    }
  };
  #[cfg(not(feature = "napi4"))]
  let _ = resolver_env_owned;

  if increment_module_count(env) != 0 {
    wait_first_thread_registered();
  }

  #[cfg(all(
    any(feature = "tokio_rt", feature = "async-runtime"),
    feature = "napi4"
  ))]
  let _runtime_cleanup = {
    let cleanup_data = Box::into_raw(Box::new(RuntimeEnvCleanup {
      env,
      active: AtomicBool::new(true),
      runtime_env_tasks_owned: AtomicBool::new(false),
      resolver_env_owned: AtomicBool::new(resolver_env_owned),
      #[cfg(feature = "async-runtime")]
      async_runtime_env_reserved: AtomicBool::new(false),
    }));
    #[cfg(not(target_family = "wasm"))]
    let status =
      unsafe { sys::napi_add_env_cleanup_hook(env, Some(thread_cleanup), cleanup_data.cast()) };
    #[cfg(target_family = "wasm")]
    let status =
      unsafe { crate::napi_add_env_cleanup_hook(env, Some(thread_cleanup), cleanup_data.cast()) };
    if status != sys::Status::napi_ok {
      drop(unsafe { Box::from_raw(cleanup_data) });
      decrement_runtime_module_count(env);
      rollback_resolver_env(env, resolver_env_owned);
      let error = crate::Error::new(
        crate::Status::from(status),
        "Failed to add env cleanup hook",
      );
      #[cfg(all(feature = "async-runtime", not(feature = "noop")))]
      let error = rollback_unowned_runtime_preserving_registration_error(error);
      JsError::from(error).throw_into(env);
      FIRST_MODULE_REGISTERED.store(true, Ordering::SeqCst);
      return exports;
    }

    #[cfg(all(
      not(feature = "noop"),
      any(feature = "tokio_rt", feature = "async-runtime")
    ))]
    unsafe {
      (*cleanup_data).runtime_env_tasks_owned.store(
        crate::tokio_runtime::register_runtime_env_tasks(env),
        Ordering::Release,
      );
    }
    #[cfg(feature = "async-runtime")]
    {
      if let Err(error) = crate::tokio_runtime::reserve_async_runtime_env() {
        rollback_runtime_env(env, cleanup_data);
        let error = rollback_unowned_runtime_preserving_registration_error(error);
        JsError::from(error).throw_into(env);
        FIRST_MODULE_REGISTERED.store(true, Ordering::SeqCst);
        return exports;
      }
      unsafe {
        (*cleanup_data)
          .async_runtime_env_reserved
          .store(true, Ordering::Release);
      }
    }
    #[cfg(all(feature = "tokio_rt", not(feature = "async-runtime")))]
    if let Err(error) = crate::tokio_runtime::start_tokio_runtime_after_retirement() {
      rollback_runtime_env(env, cleanup_data);
      JsError::from(error).throw_into(env);
      FIRST_MODULE_REGISTERED.store(true, Ordering::SeqCst);
      return exports;
    }
    cleanup_data
  };

  #[cfg(feature = "async-runtime")]
  if let Err(error) = crate::tokio_runtime::activate_async_runtime_env()
    .and_then(|_| crate::tokio_runtime::ensure_async_runtime_ready())
  {
    rollback_runtime_env(env, _runtime_cleanup);
    JsError::from(error).throw_into(env);
    FIRST_MODULE_REGISTERED.store(true, Ordering::SeqCst);
    return exports;
  }

  // Install the provisional per-env custom-GC handle (#3357) BEFORE running ANY module-init
  // callback below (the export-register callbacks, `module_register_hook_callback`,
  // and the compat `MODULE_EXPORTS` callbacks). Those callbacks can capture a
  // `Buffer`/`TypedArray` via `from_napi_value`, which snapshots the thread-local
  // `CURRENT_CUSTOM_GC_HANDLES`. If the handle were installed afterwards (as it was
  // originally), such a value would record `None`; because `Buffer`/`TypedArray`
  // are `Send`, dropping it later on a non-JS thread would fall through to a direct
  // `napi_reference_unref(env, ..)` on the WRONG thread. The TSFN itself is not
  // created until exports succeed, so a failed module load leaves no native
  // callback that the loader must keep mapped.
  #[cfg(feature = "napi4")]
  let custom_gc_registration = match prepare_custom_gc(env) {
    Ok(registration) => registration,
    Err(error) => {
      #[cfg(any(feature = "tokio_rt", feature = "async-runtime"))]
      rollback_runtime_env(env, _runtime_cleanup);
      #[cfg(not(any(feature = "tokio_rt", feature = "async-runtime")))]
      {
        rollback_resolver_env(env, resolver_env_owned);
        rollback_module_count();
      }
      JsError::from(error).throw_into(env);
      FIRST_MODULE_REGISTERED.store(true, Ordering::SeqCst);
      return exports;
    }
  };

  if let Err(error) = unsafe { initialize_module_exports(env, exports) } {
    // Export setters and module hooks can retain callbacks before throwing. Keep
    // per-environment infrastructure alive until the real environment teardown.
    // Native addons also need an explicit loader reference; WASI cleanup hooks
    // retain the owning environment and its WebAssembly callback table.
    #[cfg(not(target_family = "wasm"))]
    retain_current_module_for_unload_safety();
    #[cfg(feature = "napi4")]
    let error = {
      let mut error = error;
      if let Err(commit_error) =
        unsafe { commit_custom_gc_preserving_pending_exception(&custom_gc_registration) }
      {
        rollback_custom_gc(custom_gc_registration);
        error.reason.push_str("; failed to retain escaped values: ");
        error.reason.push_str(&commit_error.reason);
      }
      error
    };
    #[cfg(feature = "async-runtime")]
    crate::tokio_runtime::commit_async_runtime_module_retention();
    JsError::from(error).throw_into(env);
    FIRST_MODULE_REGISTERED.store(true, Ordering::SeqCst);
    return exports;
  }

  #[cfg(feature = "napi4")]
  if let Err(error) = commit_custom_gc(&custom_gc_registration) {
    rollback_custom_gc(custom_gc_registration);
    #[cfg(not(target_family = "wasm"))]
    retain_current_module_for_unload_safety();
    #[cfg(feature = "async-runtime")]
    crate::tokio_runtime::commit_async_runtime_module_retention();
    JsError::from(error).throw_into(env);
    FIRST_MODULE_REGISTERED.store(true, Ordering::SeqCst);
    return exports;
  }

  #[cfg(feature = "async-runtime")]
  crate::tokio_runtime::commit_async_runtime_module_retention();

  FIRST_MODULE_REGISTERED.store(true, Ordering::SeqCst);
  exports
}

#[cfg(not(feature = "noop"))]
unsafe fn initialize_module_exports(env: sys::napi_env, exports: sys::napi_value) -> Result<()> {
  let _callback_env = enter_callback_env(env);
  let mut exports_objects: HashSet<String> = HashSet::default();
  let register_callbacks = MODULE_REGISTER_CALLBACK
    .read()
    .expect("Read MODULE_REGISTER_CALLBACK in napi_register_module_v1 failed")
    .clone();
  let grouped_callbacks = register_callbacks.into_iter().fold(
    HashMap::<Option<&'static str>, Vec<(&'static str, ExportRegisterCallback)>>::new(),
    |mut grouped, (js_mod, item)| {
      grouped.entry(js_mod).or_default().push(item);
      grouped
    },
  );

  for (js_mod, items) in grouped_callbacks {
    let exports_js_mod =
      unsafe { exports_object_for_module(env, exports, js_mod, &mut exports_objects) }?;
    for (name, callback) in items {
      let js_name = unsafe { CStr::from_bytes_with_nul_unchecked(name.as_bytes()) };
      let value = unsafe { callback(env) }?;
      ensure_no_pending_exception(env, "Module export callback left a pending exception")?;
      check_status!(
        unsafe { sys::napi_set_named_property(env, exports_js_mod, js_name.as_ptr(), value) },
        "Failed to register export `{}`",
        name,
      )?;
    }
  }

  REGISTERED_CLASSES.with(|cell| {
    cell.borrow_mut(|map| {
      map.entry(env as usize).or_insert_with(HashMap::default);
    });
  });
  MODULE_CLASS_PROPERTIES.borrow(|inner| -> Result<()> {
    for (rust_type_id, js_mods) in inner {
      for (js_mod, class_registration) in js_mods {
        let exports_js_mod =
          unsafe { exports_object_for_module(env, exports, *js_mod, &mut exports_objects) }?;
        let js_name = class_registration.js_name;
        let props = &class_registration.props;
        let (ctor, props): (Vec<_>, Vec<_>) = props.iter().partition(|prop| prop.is_ctor);
        let ctor = ctor
          .first()
          .map(|property| property.raw().method.unwrap())
          .unwrap_or(noop);
        let raw_props: Vec<_> = props.iter().map(|property| property.raw()).collect();
        let js_class_name = unsafe { CStr::from_bytes_with_nul_unchecked(js_name.as_bytes()) };
        let mut class_ptr = ptr::null_mut();

        check_status!(
          unsafe {
            sys::napi_define_class(
              env,
              js_class_name.as_ptr(),
              js_name.len() as isize - 1,
              Some(ctor),
              ptr::null_mut(),
              raw_props.len(),
              raw_props.as_ptr(),
              &mut class_ptr,
            )
          },
          "Failed to register class `{}`",
          &js_name,
        )?;

        if class_registration.implement_iterator {
          unsafe { crate::bindgen_runtime::iterator::setup_iterator_class(env, class_ptr) };
          ensure_no_pending_exception(env, "Iterator class setup left a pending exception")?;
        }

        let mut ctor_ref = ptr::null_mut();
        check_status!(
          unsafe { sys::napi_create_reference(env, class_ptr, 1, &mut ctor_ref) },
          "Failed to create constructor reference for class `{}`",
          &js_name,
        )?;
        // The export setter can execute arbitrary JavaScript and throw after retaining `class_ptr`.
        // Publish its constructor first so factories on an escaped class remain usable.
        let previous = REGISTERED_CLASSES.with(|cell| {
          cell.borrow_mut(|map| {
            map
              .entry(env as usize)
              .or_insert_with(HashMap::default)
              .insert(
                (*rust_type_id, *js_mod),
                RegisteredClass {
                  js_name,
                  constructor: ctor_ref,
                },
              )
          })
        });
        if let Some(previous) = previous {
          check_status!(
            unsafe { sys::napi_delete_reference(env, previous.constructor) },
            "Failed to replace constructor reference for class `{}`",
            &js_name,
          )?;
        }

        check_status!(
          unsafe {
            sys::napi_set_named_property(env, exports_js_mod, js_class_name.as_ptr(), class_ptr)
          },
          "Failed to register class `{}`",
          &js_name,
        )?;
      }
    }
    Ok(())
  })?;

  let module_register_hook_callback = *MODULE_REGISTER_HOOK_CALLBACK
    .read()
    .expect("Read MODULE_REGISTER_HOOK_CALLBACK failed");
  if let Some(callback) = module_register_hook_callback {
    unsafe { callback(env, exports) }?;
    ensure_no_pending_exception(env, "Module register hook left a pending exception")?;
  }

  #[cfg(feature = "compat-mode")]
  {
    let module_exports = MODULE_EXPORTS
      .read()
      .expect("Read MODULE_EXPORTS failed")
      .clone();
    for callback in module_exports {
      unsafe { callback(env, exports) }?;
      ensure_no_pending_exception(env, "Module exports callback left a pending exception")?;
    }
  }

  Ok(())
}

#[cfg(not(feature = "noop"))]
unsafe fn exports_object_for_module(
  env: sys::napi_env,
  exports: sys::napi_value,
  js_mod: Option<&'static str>,
  exports_objects: &mut HashSet<String>,
) -> Result<sys::napi_value> {
  let Some(js_mod) = js_mod else {
    return Ok(exports);
  };
  let mod_name = unsafe { CStr::from_bytes_with_nul_unchecked(js_mod.as_bytes()) };
  let mut exports_js_mod = ptr::null_mut();
  if exports_objects.contains(js_mod) {
    check_status!(
      unsafe { sys::napi_get_named_property(env, exports, mod_name.as_ptr(), &mut exports_js_mod) },
      "Get mod {} from exports failed",
      js_mod,
    )?;
  } else {
    check_status!(
      unsafe { sys::napi_create_object(env, &mut exports_js_mod) },
      "Create export JavaScript Object [{}] failed",
      js_mod,
    )?;
    check_status!(
      unsafe { sys::napi_set_named_property(env, exports, mod_name.as_ptr(), exports_js_mod) },
      "Set exports Object [{}] into exports object failed",
      js_mod,
    )?;
    exports_objects.insert(js_mod.to_owned());
  }
  Ok(exports_js_mod)
}

#[cfg(not(feature = "noop"))]
fn ensure_no_pending_exception(env: sys::napi_env, reason: &'static str) -> Result<()> {
  let mut is_pending = false;
  check_status!(
    unsafe { sys::napi_is_exception_pending(env, &mut is_pending) },
    "Failed to check for a pending exception during module registration",
  )?;
  if is_pending {
    Err(crate::Error::new(crate::Status::PendingException, reason))
  } else {
    Ok(())
  }
}

#[cfg(not(feature = "noop"))]
pub(crate) unsafe extern "C" fn noop(
  env: sys::napi_env,
  _info: sys::napi_callback_info,
) -> sys::napi_value {
  if !crate::bindgen_runtime::___CALL_FROM_FACTORY.with(|s| s.get()) {
    unsafe {
      sys::napi_throw_error(
        env,
        ptr::null_mut(),
        c"Class contains no `constructor`, can not new it!".as_ptr(),
      );
    }
  }
  ptr::null_mut()
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
unsafe fn add_custom_gc_owner_cleanup_hook(
  env: sys::napi_env,
  context: *mut CustomGcOwnerCleanupContext,
) -> sys::napi_status {
  #[cfg(not(target_family = "wasm"))]
  {
    unsafe { sys::napi_add_env_cleanup_hook(env, Some(custom_gc_owner_cleanup), context.cast()) }
  }
  #[cfg(target_family = "wasm")]
  {
    unsafe { crate::napi_add_env_cleanup_hook(env, Some(custom_gc_owner_cleanup), context.cast()) }
  }
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
unsafe fn remove_custom_gc_owner_cleanup_hook(
  env: sys::napi_env,
  context: *mut CustomGcOwnerCleanupContext,
) -> sys::napi_status {
  #[cfg(not(target_family = "wasm"))]
  {
    unsafe { sys::napi_remove_env_cleanup_hook(env, Some(custom_gc_owner_cleanup), context.cast()) }
  }
  #[cfg(target_family = "wasm")]
  {
    unsafe {
      crate::napi_remove_env_cleanup_hook(env, Some(custom_gc_owner_cleanup), context.cast())
    }
  }
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
fn register_custom_gc_owner_cleanup(handle: &std::sync::Arc<CustomGcHandle>) -> Result<()> {
  if !handle
    .owner_cleanup_context
    .load(std::sync::atomic::Ordering::Acquire)
    .is_null()
  {
    return Ok(());
  }
  let context = Box::into_raw(Box::new(CustomGcOwnerCleanupContext {
    handle: handle.clone(),
  }));
  let status = unsafe { add_custom_gc_owner_cleanup_hook(handle.env as sys::napi_env, context) };
  if status != sys::Status::napi_ok {
    drop(unsafe { Box::from_raw(context) });
    return Err(crate::Error::new(
      crate::Status::from(status),
      "Failed to add Custom GC environment cleanup hook",
    ));
  }
  handle
    .owner_cleanup_context
    .store(context, std::sync::atomic::Ordering::Release);
  Ok(())
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
fn rearm_custom_gc_owner_cleanup(handle: &std::sync::Arc<CustomGcHandle>) -> Result<()> {
  let context = handle
    .owner_cleanup_context
    .swap(ptr::null_mut(), std::sync::atomic::Ordering::AcqRel);
  if context.is_null() {
    return register_custom_gc_owner_cleanup(handle);
  }
  let env = handle.env as sys::napi_env;
  let remove_status = unsafe { remove_custom_gc_owner_cleanup_hook(env, context) };
  if remove_status != sys::Status::napi_ok {
    handle
      .owner_cleanup_context
      .store(context, std::sync::atomic::Ordering::Release);
    return Err(crate::Error::new(
      crate::Status::from(remove_status),
      "Failed to reorder Custom GC environment cleanup hook",
    ));
  }
  let add_status = unsafe { add_custom_gc_owner_cleanup_hook(env, context) };
  if add_status != sys::Status::napi_ok {
    drop(unsafe { Box::from_raw(context) });
    return Err(crate::Error::new(
      crate::Status::from(add_status),
      "Failed to re-add Custom GC environment cleanup hook",
    ));
  }
  handle
    .owner_cleanup_context
    .store(context, std::sync::atomic::Ordering::Release);
  Ok(())
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
fn prepare_custom_gc(env: sys::napi_env) -> Result<CustomGcRegistration> {
  if let Some(handle) = CURRENT_CUSTOM_GC_HANDLES.with(|handles| {
    handles
      .borrow()
      .get(&(env as usize))
      .filter(|handle| handle.is_active_for(env))
      .cloned()
  }) {
    return Ok(CustomGcRegistration {
      handle,
      owned: false,
    });
  }

  let handle = std::sync::Arc::new(CustomGcHandle {
    env: env as usize,
    owner_thread: std::thread::current().id(),
    tsfn: std::sync::atomic::AtomicPtr::new(ptr::null_mut()),
    owner_cleanup_context: std::sync::atomic::AtomicPtr::new(ptr::null_mut()),
    state: std::sync::Mutex::new(CustomGcState::Pending(Vec::new())),
  });
  register_custom_gc_owner_cleanup(&handle)?;
  CURRENT_CUSTOM_GC_HANDLES.with(|handles| {
    handles.borrow_mut().insert(env as usize, handle.clone());
  });
  Ok(CustomGcRegistration {
    handle,
    owned: true,
  })
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
fn commit_custom_gc(registration: &CustomGcRegistration) -> Result<()> {
  if !registration.owned {
    return Ok(());
  }

  let env = registration.handle.env as sys::napi_env;
  let mut custom_gc_fn = ptr::null_mut();
  check_status!(
    unsafe {
      sys::napi_create_function(
        env,
        c"custom_gc".as_ptr(),
        9,
        Some(empty),
        ptr::null_mut(),
        &mut custom_gc_fn,
      )
    },
    "Create Custom GC Function in napi_register_module_v1 failed"
  )?;
  let mut async_resource_name = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_create_string_utf8(env, c"CustomGC".as_ptr(), 8, &mut async_resource_name) },
    "Create async resource string in napi_register_module_v1"
  )?;
  let weak_ptr = std::sync::Arc::downgrade(&registration.handle).into_raw();
  let mut custom_gc_tsfn = ptr::null_mut();
  let status = unsafe {
    sys::napi_create_threadsafe_function(
      env,
      custom_gc_fn,
      ptr::null_mut(),
      async_resource_name,
      0,
      1,
      weak_ptr.cast_mut().cast(),
      Some(custom_gc_handle_finalize),
      ptr::null_mut(),
      Some(custom_gc),
      &mut custom_gc_tsfn,
    )
  };
  if status != sys::Status::napi_ok {
    drop(unsafe { std::sync::Weak::from_raw(weak_ptr) });
    return Err(crate::Error::new(
      crate::Status::from(status),
      "Create Custom GC ThreadsafeFunction in napi_register_module_v1 failed",
    ));
  }
  if custom_gc_tsfn.is_null() {
    #[cfg(not(target_family = "wasm"))]
    {
      retain_current_module_for_unload_safety();
      return Err(crate::Error::new(
        crate::Status::GenericFailure,
        "Create Custom GC ThreadsafeFunction in napi_register_module_v1 returned a null handle",
      ));
    }
    #[cfg(target_family = "wasm")]
    {
      // Successful native creation transferred `weak_ptr` to the host. With
      // no handle there is no operation that can reclaim it synchronously, and
      // WASI cannot keep its eventual finalizer code mapped.
      std::process::abort();
    }
  }

  registration
    .handle
    .tsfn
    .store(custom_gc_tsfn, std::sync::atomic::Ordering::SeqCst);
  let unref_status = unsafe { sys::napi_unref_threadsafe_function(env, custom_gc_tsfn) };
  if unref_status != sys::Status::napi_ok {
    let abort_status = unsafe {
      sys::napi_release_threadsafe_function(
        custom_gc_tsfn,
        sys::ThreadsafeFunctionReleaseMode::abort,
      )
    };
    #[cfg(not(target_family = "wasm"))]
    {
      retain_current_module_for_unload_safety();
      let reason = if abort_status == sys::Status::napi_ok {
        "Unref Custom GC ThreadsafeFunction in napi_register_module_v1 failed; the partially created ThreadsafeFunction was aborted".to_owned()
      } else {
        format!(
          "Unref Custom GC ThreadsafeFunction in napi_register_module_v1 failed and aborting the partially created ThreadsafeFunction returned {}",
          crate::Status::from(abort_status)
        )
      };
      return Err(crate::Error::new(crate::Status::from(unref_status), reason));
    }
    #[cfg(target_family = "wasm")]
    {
      let _ = abort_status;
      // Aborting the TSFN only schedules its native finalizer. WASI has no
      // loader handle that can keep this callback code alive after module load
      // fails, so returning would leave an unload race.
      std::process::abort();
    }
  }

  if let Err(error) = rearm_custom_gc_owner_cleanup(&registration.handle) {
    #[cfg(not(target_family = "wasm"))]
    let mut error = error;
    let abort_status = unsafe {
      sys::napi_release_threadsafe_function(
        custom_gc_tsfn,
        sys::ThreadsafeFunctionReleaseMode::abort,
      )
    };
    #[cfg(not(target_family = "wasm"))]
    {
      retain_current_module_for_unload_safety();
      if abort_status != sys::Status::napi_ok {
        error
          .reason
          .push_str("; aborting the Custom GC ThreadsafeFunction returned ");
        error
          .reason
          .push_str(crate::Status::from(abort_status).as_ref());
      }
      return Err(error);
    }
    #[cfg(target_family = "wasm")]
    {
      let _ = (abort_status, error);
      // The host may still invoke the TSFN finalizer after abort. A failed
      // cleanup-hook reorder leaves no callback that can prove the instance
      // remains alive until then.
      std::process::abort();
    }
  }

  release_custom_gc_references(
    env,
    registration.handle.activate(custom_gc_tsfn),
    "Failed to release reference queued during Custom GC initialization",
  )
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
unsafe fn commit_custom_gc_preserving_pending_exception(
  registration: &CustomGcRegistration,
) -> Result<()> {
  let env = registration.handle.env as sys::napi_env;
  let mut is_pending = false;
  check_status!(
    unsafe { sys::napi_is_exception_pending(env, &mut is_pending) },
    "Failed to check for a pending exception before Custom GC initialization",
  )?;
  let pending_exception = if is_pending {
    let mut exception = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_and_clear_last_exception(env, &mut exception) },
      "Failed to suspend the pending exception during Custom GC initialization",
    )?;
    Some(exception)
  } else {
    None
  };

  let commit_result = commit_custom_gc(registration);
  let restore_result = pending_exception.map_or(Ok(()), |exception| {
    check_status!(
      unsafe { sys::napi_throw(env, exception) },
      "Failed to restore the pending exception after Custom GC initialization",
    )
  });

  match (commit_result, restore_result) {
    (Ok(()), Ok(())) => Ok(()),
    (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error),
    (Err(mut commit_error), Err(restore_error)) => {
      commit_error
        .reason
        .push_str("; restoring the original pending exception failed: ");
      commit_error.reason.push_str(&restore_error.reason);
      Err(commit_error)
    }
  }
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
fn release_custom_gc_references(
  env: sys::napi_env,
  references: Vec<usize>,
  reason: &'static str,
) -> Result<()> {
  let mut first_error = None;
  for reference in references {
    let status = release_custom_gc_reference(env, reference as sys::napi_ref);
    if status != sys::Status::napi_ok && first_error.is_none() {
      first_error = Some(crate::Error::new(crate::Status::from(status), reason));
    }
  }
  first_error.map_or(Ok(()), Err)
}

#[cfg(all(
  not(feature = "noop"),
  all(
    any(feature = "tokio_rt", feature = "async-runtime"),
    feature = "napi4"
  )
))]
struct RuntimeEnvCleanup {
  env: sys::napi_env,
  active: AtomicBool,
  runtime_env_tasks_owned: AtomicBool,
  resolver_env_owned: AtomicBool,
  #[cfg(feature = "async-runtime")]
  async_runtime_env_reserved: AtomicBool,
}

#[cfg(all(
  not(feature = "noop"),
  all(
    any(feature = "tokio_rt", feature = "async-runtime"),
    feature = "napi4"
  )
))]
unsafe extern "C" fn thread_cleanup(data: *mut std::ffi::c_void) {
  let cleanup = unsafe { Box::from_raw(data.cast::<RuntimeEnvCleanup>()) };
  let mut cleanup_completed = false;
  crate::bindgen_runtime::catch_unwind_safely(|| {
    cleanup_runtime_env(&cleanup, true);
    cleanup_completed = true;
  });
  #[cfg(not(target_family = "wasm"))]
  if !cleanup_completed {
    // An unwind caught at the cleanup-hook boundary may have skipped runtime
    // retirement. Keep the image mapped before Node can unload it.
    retain_current_module_for_unload_safety();
  }
  #[cfg(target_family = "wasm")]
  if !cleanup_completed {
    // WASI has no loader handle that can pin code reached by cleanup that may
    // still be live after an unwind.
    std::process::abort();
  }
}

#[cfg(all(
  not(feature = "noop"),
  all(
    any(feature = "tokio_rt", feature = "async-runtime"),
    feature = "napi4"
  )
))]
fn cleanup_runtime_env(cleanup: &RuntimeEnvCleanup, env_closing: bool) {
  if !cleanup.active.swap(false, Ordering::AcqRel) {
    return;
  }
  let env = cleanup.env;
  if env_closing {
    mark_runtime_env_closing(env);
  }
  let runtime_env_tasks_owned = cleanup
    .runtime_env_tasks_owned
    .swap(false, Ordering::AcqRel);
  let resolver_env_owned = cleanup.resolver_env_owned.swap(false, Ordering::AcqRel);
  crate::bindgen_runtime::with_runtime_teardown_guard(|| {
    if runtime_env_tasks_owned {
      crate::tokio_runtime::cancel_and_wait_runtime_env_tasks(env);
      crate::js_values::clear_finalize_callbacks_for_env(env);
    }
    if env_closing {
      crate::sendable_resolver::cleanup_resolver_env(env, resolver_env_owned);
    } else {
      rollback_resolver_env(env, resolver_env_owned);
    }
  });
  #[cfg(feature = "async-runtime")]
  if cleanup
    .async_runtime_env_reserved
    .swap(false, Ordering::AcqRel)
  {
    if let Err(error) = crate::tokio_runtime::unregister_async_runtime_env() {
      crate::bindgen_runtime::catch_unwind_safely(|| {
        eprintln!("Failed to shut down async runtime: {error}");
      });
    }
  }
  decrement_runtime_module_count(env);
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "tokio_rt", feature = "async-runtime"),
  feature = "napi4"
))]
fn increment_module_count(env: sys::napi_env) -> usize {
  let mut registered = REGISTERED_RUNTIME_ENVS
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner);
  let registration = registered
    .entry(env as usize)
    .or_insert(RuntimeEnvRegistration {
      count: 0,
      closing: false,
    });
  if registration.closing {
    std::process::abort();
  }
  registration.count = registration
    .count
    .checked_add(1)
    .unwrap_or_else(|| std::process::abort());
  MODULE_COUNT.fetch_add(1, Ordering::AcqRel)
}

#[cfg(all(
  not(feature = "noop"),
  not(all(
    any(feature = "tokio_rt", feature = "async-runtime"),
    feature = "napi4"
  ))
))]
fn increment_module_count(_env: sys::napi_env) -> usize {
  MODULE_COUNT.fetch_add(1, Ordering::AcqRel)
}

#[cfg(all(
  not(feature = "noop"),
  feature = "napi4",
  not(all(
    any(feature = "tokio_rt", feature = "async-runtime"),
    feature = "napi4"
  ))
))]
fn rollback_module_count() {
  checked_update_atomic(&MODULE_COUNT, |count| count.checked_sub(1))
    .unwrap_or_else(|_| std::process::abort());
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "tokio_rt", feature = "async-runtime"),
  feature = "napi4"
))]
fn decrement_runtime_module_count(env: sys::napi_env) {
  #[cfg(feature = "tokio_rt")]
  let mut tokio_shutdown_failed = false;
  #[cfg(feature = "tokio_rt")]
  let mut tokio_retirement = None;
  #[cfg(not(feature = "tokio_rt"))]
  let tokio_shutdown_failed = false;
  let _was_last = decrement_runtime_module_count_with_last(env, || {
    #[cfg(feature = "tokio_rt")]
    match crate::tokio_runtime::shutdown_tokio_runtime() {
      Ok(()) => {
        // Snapshot this generation while registration is still excluded. A
        // later environment may retire a different generation before we wait.
        tokio_retirement = Some(crate::tokio_runtime::tokio_runtime_retirement_waiter());
      }
      Err(error) => {
        tokio_shutdown_failed = true;
        crate::bindgen_runtime::catch_unwind_safely(|| {
          eprintln!("Failed to shut down Tokio runtime: {error}");
        });
      }
    }
  });
  #[cfg(feature = "async-runtime")]
  let custom_shutdown_quiescence_unproven =
    _was_last && crate::tokio_runtime::custom_runtime_shutdown_quiescence_unproven();
  #[cfg(not(feature = "async-runtime"))]
  let custom_shutdown_quiescence_unproven = false;
  // Do not hold environment registration exclusion while waiting for
  // potentially long-running blocking work. A racing registration observes
  // the retiring generation and waits through start_tokio_runtime_after_retirement.
  #[cfg(not(target_family = "wasm"))]
  {
    #[cfg(feature = "tokio_rt")]
    let retirement_failed = !tokio_shutdown_failed
      && _was_last
      && tokio_retirement
        .expect("last environment must snapshot Tokio retirement after shutdown")
        .wait_for(std::time::Duration::from_secs(5))
        .inspect_err(|error| {
          crate::bindgen_runtime::catch_unwind_safely(|| {
            eprintln!("Failed to retire Tokio runtime during environment cleanup: {error}");
          });
        })
        .is_err();
    #[cfg(not(feature = "tokio_rt"))]
    let retirement_failed = false;
    #[cfg(feature = "tokio_rt")]
    let tokio_requires_module_retention =
      _was_last && crate::tokio_runtime::tokio_runtime_requires_module_retention();
    #[cfg(not(feature = "tokio_rt"))]
    let tokio_requires_module_retention = false;
    if _was_last
      && (tokio_shutdown_failed
        || retirement_failed
        || custom_shutdown_quiescence_unproven
        || tokio_requires_module_retention)
    {
      // Even successful Tokio retirement cannot prove that externally retained
      // task wakers no longer reference vtables in this image.
      retain_current_module_for_unload_safety();
    }
  }
  #[cfg(all(target_family = "wasm", tokio_unstable))]
  {
    let retirement_failed = if tokio_shutdown_failed {
      false
    } else {
      #[cfg(feature = "tokio_rt")]
      {
        _was_last
          && tokio_retirement
            .expect("last environment must snapshot Tokio retirement after shutdown")
            .wait_for(std::time::Duration::from_secs(5))
            .inspect_err(|error| {
              crate::bindgen_runtime::catch_unwind_safely(|| {
                eprintln!("Failed to retire Tokio runtime during environment cleanup: {error}");
              });
            })
            .is_err()
      }
      #[cfg(not(feature = "tokio_rt"))]
      {
        false
      }
    };
    if _was_last
      && (tokio_shutdown_failed || retirement_failed || custom_shutdown_quiescence_unproven)
    {
      // emnapi pthreads retain their own WebAssembly instances, but returning
      // without proven runtime quiescence could let live work access a closed
      // Node-API environment.
      std::process::abort();
    }
  }
  #[cfg(all(target_family = "wasm", not(tokio_unstable)))]
  {
    #[cfg(feature = "tokio_rt")]
    let _ = (tokio_shutdown_failed, tokio_retirement);
    #[cfg(not(feature = "tokio_rt"))]
    let _ = tokio_shutdown_failed;
    if _was_last && custom_shutdown_quiescence_unproven {
      // Non-threaded WASI cannot pin the image either, but has no built-in
      // Tokio retirement thread to wait for.
      std::process::abort();
    }
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "tokio_rt", feature = "async-runtime"),
  feature = "napi4"
))]
fn mark_runtime_env_closing(env: sys::napi_env) {
  let mut registered = REGISTERED_RUNTIME_ENVS
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner);
  let Some(registration) = registered.get_mut(&(env as usize)) else {
    std::process::abort();
  };
  registration.closing = true;
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "tokio_rt", feature = "async-runtime"),
  feature = "napi4"
))]
fn decrement_runtime_module_count_with_last(env: sys::napi_env, on_last: impl FnOnce()) -> bool {
  // Keep registration excluded until the last environment has committed its runtime shutdown.
  // Otherwise a new environment can increment zero to one, observe the old runtime as running,
  // and then have the retiring environment stop it.
  let mut registered = REGISTERED_RUNTIME_ENVS
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner);
  let env = env as usize;
  let remove_env = {
    let Some(registration) = registered.get_mut(&env) else {
      std::process::abort();
    };
    registration.count = registration
      .count
      .checked_sub(1)
      .unwrap_or_else(|| std::process::abort());
    registration.count == 0
  };
  if remove_env {
    registered.remove(&env);
  }
  let previous =
    checked_update_atomic(&MODULE_COUNT, |count| count.checked_sub(1)).unwrap_or_else(|_| {
      // Wrapping to usize::MAX would permanently suppress last-environment
      // retirement and could let the addon unload under native workers.
      std::process::abort();
    });
  let was_last = previous == 1;
  if was_last {
    on_last();
  }
  was_last
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[inline(never)]
fn module_retention_anchor() {}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm"), windows))]
pub(crate) fn retain_current_module_for_unload_safety() {
  const GET_MODULE_HANDLE_EX_FLAG_PIN: u32 = 0x0000_0001;
  const GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS: u32 = 0x0000_0004;

  #[link(name = "kernel32")]
  unsafe extern "system" {
    fn GetModuleHandleExW(
      flags: u32,
      module_name: *const u16,
      module: *mut *mut std::ffi::c_void,
    ) -> i32;
  }

  static RETAIN_MODULE: std::sync::Once = std::sync::Once::new();
  RETAIN_MODULE.call_once(|| {
    let mut module = ptr::null_mut();
    let pinned = unsafe {
      GetModuleHandleExW(
        GET_MODULE_HANDLE_EX_FLAG_PIN | GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
        module_retention_anchor as *const () as *const u16,
        &mut module,
      )
    };
    if pinned == 0 {
      // Returning would let Windows unload code that may still be executing on
      // worker threads or callbacks. There is no recoverable state after pinning fails.
      std::process::abort();
    }
  });
}

#[cfg(all(
  not(feature = "noop"),
  not(target_family = "wasm"),
  any(
    target_vendor = "apple",
    target_os = "linux",
    target_os = "android",
    target_os = "freebsd",
    target_os = "dragonfly",
    target_os = "netbsd",
    target_os = "solaris",
    target_os = "illumos"
  )
))]
pub(crate) fn retain_current_module_for_unload_safety() {
  #[cfg(any(target_os = "linux", target_os = "android"))]
  #[link(name = "dl")]
  unsafe extern "C" {}

  static RETAIN_MODULE: std::sync::Once = std::sync::Once::new();
  RETAIN_MODULE.call_once(|| unsafe {
    let local_symbol = module_retention_anchor as *const () as *const std::ffi::c_void;
    if current_image_is_main_executable(local_symbol) {
      // The process image cannot be unloaded and needs no additional loader
      // reference when napi is statically linked into an embedder.
      return;
    }

    let mut info = std::mem::MaybeUninit::<libc::Dl_info>::zeroed();
    if libc::dladdr(local_symbol, info.as_mut_ptr()) == 0 {
      std::process::abort();
    }
    let info = info.assume_init();
    if info.dli_fname.is_null() {
      std::process::abort();
    }

    // Leak one loader reference. This keeps worker, callback, and task-waker
    // code mapped after Node drops its own handle.
    let flags = libc::RTLD_LAZY | libc::RTLD_LOCAL | libc::RTLD_NOLOAD;
    let module = libc::dlopen(info.dli_fname, flags);
    if module.is_null() {
      std::process::abort();
    }
  });
}

#[cfg(all(
  not(feature = "noop"),
  not(target_family = "wasm"),
  target_os = "openbsd"
))]
pub(crate) fn retain_current_module_for_unload_safety() {
  const DL_REFERENCE: std::ffi::c_int = 4;

  unsafe extern "C" {
    fn dlctl(
      handle: *mut std::ffi::c_void,
      command: std::ffi::c_int,
      data: *mut std::ffi::c_void,
    ) -> std::ffi::c_int;
  }

  static RETAIN_MODULE: std::sync::Once = std::sync::Once::new();
  RETAIN_MODULE.call_once(|| {
    let local_symbol = module_retention_anchor as *const () as *mut std::ffi::c_void;
    // DL_REFERENCE resolves the object by address, increments its open count,
    // and marks it NODELETE. This avoids reopening a path that may no longer exist.
    if unsafe { dlctl(ptr::null_mut(), DL_REFERENCE, local_symbol) } != 0 {
      std::process::abort();
    }
  });
}

#[cfg(all(
  not(feature = "noop"),
  unix,
  not(target_os = "aix"),
  target_vendor = "apple"
))]
fn current_image_is_main_executable(local_symbol: *const std::ffi::c_void) -> bool {
  unsafe extern "C" {
    fn _dyld_get_image_header(image_index: u32) -> *const std::ffi::c_void;
  }

  let mut info = std::mem::MaybeUninit::<libc::Dl_info>::zeroed();
  unsafe {
    libc::dladdr(local_symbol, info.as_mut_ptr()) != 0
      && info.assume_init().dli_fbase.cast_const() == _dyld_get_image_header(0)
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(
    target_os = "linux",
    target_os = "android",
    target_os = "freebsd",
    target_os = "dragonfly",
    target_os = "netbsd",
    all(
      any(target_os = "solaris", target_os = "illumos"),
      any(target_arch = "x86", target_arch = "x86_64")
    )
  )
))]
fn current_image_is_main_executable(local_symbol: *const std::ffi::c_void) -> bool {
  const PT_LOAD: libc::c_uint = 1;
  const PT_PHDR: libc::c_uint = 6;

  struct MainImageLookup {
    address: usize,
    contains_address: bool,
  }

  unsafe extern "C" fn inspect_main_image(
    info: *mut libc::dl_phdr_info,
    _size: usize,
    data: *mut std::ffi::c_void,
  ) -> std::ffi::c_int {
    let lookup = unsafe { &mut *data.cast::<MainImageLookup>() };
    let info = unsafe { &*info };
    // These loaders report the main program first. Its name is not portable:
    // Linux uses an empty string, while BSD loaders may report the executable path.
    let reported_load_bias = info.dlpi_addr as usize;
    // FreeBSD's static libc stub initializes `dlpi_addr` from AT_BASE, which is
    // not the executable load bias for a static PIE. PT_PHDR lets us recover
    // the bias from the in-memory program-header address.
    let phdr_load_bias = (0..info.dlpi_phnum as usize).find_map(|index| {
      let header = unsafe { &*info.dlpi_phdr.add(index) };
      (header.p_type == PT_PHDR)
        .then(|| (info.dlpi_phdr as usize).checked_sub(header.p_vaddr as usize))
        .flatten()
    });
    for index in 0..info.dlpi_phnum as usize {
      let header = unsafe { &*info.dlpi_phdr.add(index) };
      if header.p_type != PT_LOAD {
        continue;
      }
      for load_bias in [Some(reported_load_bias), phdr_load_bias]
        .into_iter()
        .flatten()
      {
        let Some(start) = load_bias.checked_add(header.p_vaddr as usize) else {
          continue;
        };
        let Some(end) = start.checked_add(header.p_memsz as usize) else {
          continue;
        };
        if (start..end).contains(&lookup.address) {
          lookup.contains_address = true;
          break;
        }
      }
      if lookup.contains_address {
        break;
      }
    }
    // Only the first object is the main image.
    1
  }

  let mut lookup = MainImageLookup {
    address: local_symbol as usize,
    contains_address: false,
  };
  unsafe {
    libc::dl_iterate_phdr(
      Some(inspect_main_image),
      (&mut lookup as *mut MainImageLookup).cast(),
    );
  }
  lookup.contains_address
}

#[cfg(all(
  not(feature = "noop"),
  any(target_os = "solaris", target_os = "illumos"),
  not(any(target_arch = "x86", target_arch = "x86_64"))
))]
fn current_image_is_main_executable(_local_symbol: *const std::ffi::c_void) -> bool {
  false
}

#[cfg(all(not(feature = "noop"), any(target_os = "aix", test)))]
fn aix_text_range_contains(start: usize, size: usize, address: usize) -> Option<bool> {
  let end = start.checked_add(size)?;
  Some((start..end).contains(&address))
}

#[cfg(all(not(feature = "noop"), any(target_os = "aix", test)))]
fn aix_loader_names(record_tail: &[u8]) -> Option<(&[u8], &[u8])> {
  let filename_end = record_tail.iter().position(|byte| *byte == 0)?;
  let member_start = filename_end.checked_add(1)?;
  let member_tail = record_tail.get(member_start..)?;
  let member_end = member_tail.iter().position(|byte| *byte == 0)?;
  Some((&record_tail[..filename_end], &member_tail[..member_end]))
}

#[cfg(all(not(feature = "noop"), any(target_os = "aix", test)))]
fn aix_dlopen_path(filename: &[u8], member: &[u8]) -> Option<Vec<u8>> {
  if filename.is_empty() || filename.contains(&0) || member.contains(&0) {
    return None;
  }
  let member_delimiters = usize::from(!member.is_empty()) * 2;
  let capacity = filename
    .len()
    .checked_add(member.len())?
    .checked_add(member_delimiters)?
    .checked_add(1)?;
  let mut path = Vec::with_capacity(capacity);
  path.extend_from_slice(filename);
  if !member.is_empty() {
    path.push(b'(');
    path.extend_from_slice(member);
    path.push(b')');
  }
  path.push(0);
  Some(path)
}

#[cfg(all(
  not(feature = "noop"),
  any(target_os = "aix", all(test, target_pointer_width = "64"))
))]
fn aix_loader_record_is_main_executable(text_start: usize, member: &[u8]) -> bool {
  const AIX_EXECUTABLE_TEXT_BASE: usize = 0x1_0000_0000;
  member.is_empty() && text_start == AIX_EXECUTABLE_TEXT_BASE
}

#[cfg(all(not(feature = "noop"), target_os = "aix"))]
fn aix_loader_file_is_main_executable(
  text_start: usize,
  filename: &[u8],
  member: &[u8],
) -> Option<bool> {
  use std::os::{aix::fs::MetadataExt, unix::ffi::OsStrExt};

  if !member.is_empty() {
    return Some(false);
  }
  // AIX 64-bit executables use this reserved text base. Check it before the
  // filesystem fallback because the running executable may have been replaced.
  if aix_loader_record_is_main_executable(text_start, member) {
    return Some(true);
  }
  let loaded_file =
    std::fs::metadata(std::path::Path::new(std::ffi::OsStr::from_bytes(filename))).ok()?;
  let executable = std::fs::metadata(std::env::current_exe().ok()?).ok()?;
  Some(loaded_file.st_dev() == executable.st_dev() && loaded_file.st_ino() == executable.st_ino())
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm"), target_os = "aix"))]
pub(crate) fn retain_current_module_for_unload_safety() {
  const INITIAL_LOADQUERY_RECORDS: usize = 64;

  static RETAIN_MODULE: std::sync::Once = std::sync::Once::new();
  RETAIN_MODULE.call_once(|| unsafe {
    // An AIX function pointer addresses a three-word descriptor. Its first word
    // is the actual entry in the image's text segment.
    let descriptor = module_retention_anchor as *const () as *const *const std::ffi::c_void;
    let text_address = descriptor.read();
    if text_address.is_null() {
      std::process::abort();
    }
    let text_address = text_address as usize;

    let mut modules = vec![std::mem::zeroed::<libc::ld_info>(); INITIAL_LOADQUERY_RECORDS];
    loop {
      let byte_len = std::mem::size_of::<libc::ld_info>()
        .checked_mul(modules.len())
        .and_then(|len| libc::c_uint::try_from(len).ok())
        .unwrap_or_else(|| std::process::abort());
      if libc::loadquery(
        libc::L_GETINFO,
        modules.as_mut_ptr().cast::<std::ffi::c_void>(),
        byte_len,
      ) != -1
      {
        break;
      }
      if *libc::_Errno() != libc::ENOMEM {
        std::process::abort();
      }
      let next_len = modules
        .len()
        .checked_mul(2)
        .unwrap_or_else(|| std::process::abort());
      modules.resize(next_len, std::mem::zeroed::<libc::ld_info>());
    }

    let buffer = std::slice::from_raw_parts(
      modules.as_ptr().cast::<u8>(),
      std::mem::size_of::<libc::ld_info>()
        .checked_mul(modules.len())
        .unwrap_or_else(|| std::process::abort()),
    );
    let filename_offset = std::mem::offset_of!(libc::ld_info, ldinfo_filename);
    let minimum_record_len = filename_offset
      .checked_add(2)
      .unwrap_or_else(|| std::process::abort());
    let mut record_offset = 0usize;

    loop {
      let header_end = record_offset
        .checked_add(std::mem::size_of::<libc::ld_info>())
        .filter(|end| *end <= buffer.len())
        .unwrap_or_else(|| std::process::abort());
      let record =
        std::ptr::read_unaligned(buffer.as_ptr().add(record_offset).cast::<libc::ld_info>());
      let next = record.ldinfo_next as usize;
      let record_end = if next == 0 {
        buffer.len()
      } else {
        if next < minimum_record_len {
          std::process::abort();
        }
        record_offset
          .checked_add(next)
          .filter(|end| *end <= buffer.len())
          .unwrap_or_else(|| std::process::abort())
      };
      if header_end > record_end {
        std::process::abort();
      }

      let text_start = record.ldinfo_textorg as usize;
      let text_size =
        usize::try_from(record.ldinfo_textsize).unwrap_or_else(|_| std::process::abort());
      let contains_text = aix_text_range_contains(text_start, text_size, text_address)
        .unwrap_or_else(|| std::process::abort());
      if contains_text {
        let names_start = record_offset
          .checked_add(filename_offset)
          .filter(|start| *start < record_end)
          .unwrap_or_else(|| std::process::abort());
        let (filename, member) = aix_loader_names(&buffer[names_start..record_end])
          .unwrap_or_else(|| std::process::abort());
        if aix_loader_file_is_main_executable(text_start, filename, member)
          .unwrap_or_else(|| std::process::abort())
        {
          // The process image cannot be unloaded and needs no additional
          // loader reference when napi is statically linked into an embedder.
          return;
        }
        let path = aix_dlopen_path(filename, member).unwrap_or_else(|| std::process::abort());
        let mut flags = libc::RTLD_LAZY | libc::RTLD_LOCAL;
        if !member.is_empty() {
          flags |= libc::RTLD_MEMBER;
        }

        // Leak one loader reference. This keeps worker, callback, and task-waker
        // code mapped after Node drops its own handle.
        if libc::dlopen(path.as_ptr().cast::<libc::c_char>(), flags).is_null() {
          std::process::abort();
        }
        return;
      }

      if next == 0 {
        std::process::abort();
      }
      record_offset = record_end;
    }
  });
}

#[cfg(all(
  not(feature = "noop"),
  not(target_family = "wasm"),
  not(any(
    windows,
    target_vendor = "apple",
    target_os = "linux",
    target_os = "android",
    target_os = "freebsd",
    target_os = "dragonfly",
    target_os = "netbsd",
    target_os = "openbsd",
    target_os = "solaris",
    target_os = "illumos",
    target_os = "aix"
  ))
))]
pub(crate) fn retain_current_module_for_unload_safety() {
  // No portable loader-pinning API is available. Returning could let the host
  // unmap code still referenced by worker threads or callbacks.
  std::process::abort();
}

#[cfg(all(test, not(feature = "noop"), target_pointer_width = "64"))]
mod aix_loader_tests {
  use super::{
    aix_dlopen_path, aix_loader_names, aix_loader_record_is_main_executable,
    aix_text_range_contains,
  };

  #[test]
  fn aix_text_range_matching_checks_overflow_and_end_exclusion() {
    assert_eq!(aix_text_range_contains(0x1000, 0x20, 0x1000), Some(true));
    assert_eq!(aix_text_range_contains(0x1000, 0x20, 0x101f), Some(true));
    assert_eq!(aix_text_range_contains(0x1000, 0x20, 0x1020), Some(false));
    assert_eq!(aix_text_range_contains(usize::MAX, 1, usize::MAX), None);
  }

  #[test]
  fn aix_loader_names_require_two_bounded_terminators() {
    assert_eq!(
      aix_loader_names(b"/tmp/addon.node\0\0padding"),
      Some((&b"/tmp/addon.node"[..], &b""[..]))
    );
    assert_eq!(
      aix_loader_names(b"/usr/lib/libfoo.a\0shr_64.o\0padding"),
      Some((&b"/usr/lib/libfoo.a"[..], &b"shr_64.o"[..]))
    );
    assert_eq!(aix_loader_names(b"/tmp/addon.node"), None);
    assert_eq!(aix_loader_names(b"/tmp/addon.node\0member"), None);
  }

  #[test]
  fn aix_dlopen_path_reconstructs_archive_members() {
    assert_eq!(
      aix_dlopen_path(b"/tmp/addon.node", b""),
      Some(b"/tmp/addon.node\0".to_vec())
    );
    assert_eq!(
      aix_dlopen_path(b"/usr/lib/libfoo.a", b"shr_64.o"),
      Some(b"/usr/lib/libfoo.a(shr_64.o)\0".to_vec())
    );
    assert_eq!(aix_dlopen_path(b"", b""), None);
    assert_eq!(aix_dlopen_path(b"/tmp/addon\0node", b""), None);
    assert_eq!(aix_dlopen_path(b"/usr/lib/libfoo.a", b"shr\0.o"), None);
  }

  #[test]
  fn aix_main_executable_detection_requires_the_reserved_text_base() {
    assert!(aix_loader_record_is_main_executable(0x1_0000_0000, b""));
    assert!(!aix_loader_record_is_main_executable(
      0x1_0000_0000,
      b"shr_64.o"
    ));
    assert!(!aix_loader_record_is_main_executable(0x2_0000_0000, b""));
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "tokio_rt", feature = "async-runtime"),
  feature = "napi4"
))]
fn rollback_runtime_env(env: sys::napi_env, cleanup_data: *mut RuntimeEnvCleanup) {
  cleanup_runtime_env(unsafe { &*cleanup_data }, false);

  #[cfg(not(target_family = "wasm"))]
  let status =
    unsafe { sys::napi_remove_env_cleanup_hook(env, Some(thread_cleanup), cleanup_data.cast()) };
  #[cfg(target_family = "wasm")]
  let status =
    unsafe { crate::napi_remove_env_cleanup_hook(env, Some(thread_cleanup), cleanup_data.cast()) };
  if status == sys::Status::napi_ok {
    drop(unsafe { Box::from_raw(cleanup_data) });
  } else {
    #[cfg(not(target_family = "wasm"))]
    retain_current_module_for_unload_safety();
    #[cfg(target_family = "wasm")]
    {
      // The hook may still run with `cleanup_data`, and WASI has no loader
      // handle that can keep that callback code mapped after failed loading.
      std::process::abort();
    }
  }
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
fn rollback_custom_gc(registration: CustomGcRegistration) {
  if !registration.owned {
    return;
  }

  #[cfg(not(target_family = "wasm"))]
  retain_current_module_for_unload_safety();
  if let Err(error) = register_custom_gc_owner_cleanup(&registration.handle) {
    #[cfg(not(target_family = "wasm"))]
    crate::bindgen_runtime::catch_unwind_safely(|| {
      eprintln!("Failed to retain Custom GC cleanup after module rollback: {error}");
    });
    #[cfg(target_family = "wasm")]
    {
      let _ = error;
      // Off-thread drops can continue queueing references after rollback. The
      // cleanup hook is the only callback that can drain them before the WASI
      // instance and its callback table are destroyed.
      std::process::abort();
    }
  }

  // Keep the rolled-back handle as a safe sentinel for values still owned by
  // failed module-init code. Owner-thread drops release immediately; native
  // thread drops queue until the environment cleanup hook runs.
  let env = registration.handle.env as sys::napi_env;
  if let Err(error) = release_custom_gc_references(
    env,
    registration.handle.rollback(),
    "Failed to release reference during Custom GC rollback",
  ) {
    crate::bindgen_runtime::catch_unwind_safely(|| {
      eprintln!("{error}");
    });
  }
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
fn rollback_resolver_env(env: sys::napi_env, owns_cleanup_hook: bool) {
  if crate::sendable_resolver::unregister_resolver_env(env, owns_cleanup_hook).is_err() {
    #[cfg(not(target_family = "wasm"))]
    retain_current_module_for_unload_safety();
    #[cfg(target_family = "wasm")]
    {
      // A failed removal leaves the resolver cleanup callback registered.
      std::process::abort();
    }
  }
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
#[allow(unused)]
unsafe extern "C" fn empty(env: sys::napi_env, info: sys::napi_callback_info) -> sys::napi_value {
  ptr::null_mut()
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
fn remove_current_custom_gc_handle(handle: &std::sync::Arc<CustomGcHandle>) {
  let _ = CURRENT_CUSTOM_GC_HANDLES.try_with(|handles| {
    let mut handles = handles.borrow_mut();
    if handles
      .get(&handle.env)
      .is_some_and(|current| std::sync::Arc::ptr_eq(current, handle))
    {
      handles.remove(&handle.env);
    }
  });
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
unsafe extern "C" fn custom_gc_owner_cleanup(data: *mut std::ffi::c_void) {
  if data.is_null() {
    return;
  }
  let context = unsafe { Box::<CustomGcOwnerCleanupContext>::from_raw(data.cast()) };
  let handle = &context.handle;
  handle
    .owner_cleanup_context
    .store(ptr::null_mut(), std::sync::atomic::Ordering::Release);
  let env = handle.env as sys::napi_env;
  let (tsfn, references) = handle.close_for_env_cleanup();
  for reference in references {
    let status = release_custom_gc_reference(env, reference as sys::napi_ref);
    if status != sys::Status::napi_ok && cfg!(debug_assertions) {
      crate::bindgen_runtime::catch_unwind_safely(|| {
        eprintln!(
          "Failed to release rolled-back Custom GC reference during environment cleanup: {}",
          crate::Status::from(status)
        );
      });
    }
  }
  cleanup_registered_classes_for_env(env);
  remove_current_custom_gc_handle(handle);
  if !tsfn.is_null() {
    let status = unsafe {
      sys::napi_release_threadsafe_function(tsfn, sys::ThreadsafeFunctionReleaseMode::abort)
    };
    if status != sys::Status::napi_ok {
      #[cfg(not(target_family = "wasm"))]
      retain_current_module_for_unload_safety();
      #[cfg(target_family = "wasm")]
      std::process::abort();
    }
  }
}

// Per-env custom-GC finalize (#3357): closes the handle when Node tears down the owner env's TSFN.
// `finalize_data` is the `Weak<CustomGcHandle>` smuggled in via `thread_finalize_data`; we reclaim
// that weak count here.
#[cfg(all(feature = "napi4", not(feature = "noop")))]
unsafe extern "C" fn custom_gc_handle_finalize(
  env: sys::napi_env,
  finalize_data: *mut std::ffi::c_void,
  _finalize_hint: *mut std::ffi::c_void,
) {
  if finalize_data.is_null() {
    return;
  }
  if let Some(handle) =
    unsafe { std::sync::Weak::<CustomGcHandle>::from_raw(finalize_data.cast()) }.upgrade()
  {
    // The owner cleanup hook retires the TSFN before Node reaches this native
    // finalizer. This fallback also handles a host that finalizes first.
    if handle.close_from_finalize() {
      cleanup_registered_classes_for_env(env);
      remove_current_custom_gc_handle(&handle);
    }
  }
  // temp Weak dropped here -> reclaims the weak count
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
fn release_custom_gc_reference(env: sys::napi_env, reference: sys::napi_ref) -> sys::napi_status {
  let mut ref_count = 0;
  let status = unsafe { sys::napi_reference_unref(env, reference, &mut ref_count) };
  if status != sys::Status::napi_ok || ref_count != 0 {
    return status;
  }
  unsafe { sys::napi_delete_reference(env, reference) }
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
// recycle a napi_ref (ArrayBuffer/Buffer/Error) that is not dropped on the main thread
extern "C" fn custom_gc(
  env: sys::napi_env,
  _js_callback: sys::napi_value,
  _context: *mut std::ffi::c_void,
  data: *mut std::ffi::c_void,
) {
  // env can be null while the owning env/TSFN is shutting down and Node drains the
  // queue (mirrors the generic call_js_cb guard in threadsafe_function.rs). The owner
  // env is gone and V8 has already invalidated the ref, so this is a safe no-op.
  if env.is_null() || data.is_null() {
    return;
  }
  let status = release_custom_gc_reference(env, data.cast());
  check_status_or_throw!(env, status, "Failed to release reference in Custom GC");
}
