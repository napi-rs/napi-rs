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

#[cfg(all(not(feature = "noop"), feature = "node_version_detect"))]
use crate::NodeVersion;
#[cfg(not(feature = "noop"))]
use crate::{check_status, check_status_or_throw, JsError};
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
static RUNTIME_MODULE_LOCK: Mutex<()> = Mutex::new(());
thread_local! {
  static REGISTERED_CLASSES: LazyCell<RegisteredClasses> = LazyCell::new(Default::default);
}
// Per-env custom-GC infrastructure (#3357). One `CustomGcHandle` is created + unref'd per isolate in
// `create_custom_gc`, and every Buffer/TypedArray drop routes through it.
// `AtomicPtr<_>` + `RwLock<bool>` are auto `Send + Sync`, so no `unsafe impl` is required.
// No `impl Drop`: freeing the `Arc` touches zero Node/V8 resources; Node owns the TSFN (created +
// unref'd at module load, destroyed at env teardown which fires `custom_gc_handle_finalize`).
#[cfg(all(feature = "napi4", not(feature = "noop")))]
pub(crate) struct CustomGcHandle {
  tsfn: std::sync::atomic::AtomicPtr<sys::napi_threadsafe_function__>,
  aborted: std::sync::RwLock<bool>,
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
impl CustomGcHandle {
  pub(crate) fn get_raw(&self) -> sys::napi_threadsafe_function {
    self.tsfn.load(std::sync::atomic::Ordering::SeqCst)
  }
  // drop path: read-lock held ACROSS the napi_call so finalize's write-lock blocks until the call returns
  pub(crate) fn with_read_aborted<RT>(&self, f: impl FnOnce(bool) -> RT) -> RT {
    let g = self
      .aborted
      .read()
      .expect("custom gc aborted lock poisoned");
    f(*g)
  }
  fn set_aborted(&self) {
    *self
      .aborted
      .write()
      .expect("custom gc aborted lock poisoned") = true;
  }
}

// INVARIANT: this per-OS-thread slot relies on ONE `napi_env` per OS thread, which holds for every
// supported runtime — Node's main thread, each `worker_threads` worker (its own V8 isolate + env +
// loop thread), and Electron. `create_custom_gc` installs the handle once per env on its registering
// thread, and `FromNapiValue` always runs on that same thread for that env, so a captured handle is
// always the value's OWNING env. An embedder hosting multiple `napi_env` on a single shared OS thread
// is out of scope: the per-env `Arc` identity (see `current_thread_owns_custom_gc`) is immune to
// env-pointer reuse, and the single public `Env::set_instance_data` slot is reserved for addon authors
// so it cannot be co-opted to key the handle by env.
thread_local! {
  #[cfg(all(feature = "napi4", not(feature = "noop")))]
  // Per-thread "this isolate's custom-GC handle".
  pub(crate) static CURRENT_CUSTOM_GC_HANDLE:
    std::cell::RefCell<Option<std::sync::Arc<CustomGcHandle>>> = const { std::cell::RefCell::new(None) };
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
pub(crate) fn current_custom_gc_handle() -> Option<std::sync::Arc<CustomGcHandle>> {
  // clone = one refcount inc, at from_napi_value capture
  CURRENT_CUSTOM_GC_HANDLE.with(|c| c.borrow().clone())
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
pub(crate) fn current_thread_owns_custom_gc(handle: &std::sync::Arc<CustomGcHandle>) -> bool {
  // same-isolate-JS-thread test by ALLOCATION identity (immune to env-pointer reuse).
  // `is_some_and` (NOT `map_or(false, ..)`): clippy::unnecessary_map_or is denied by
  // `#![deny(clippy::all)]` and would turn CI's `cargo clippy` red.
  CURRENT_CUSTOM_GC_HANDLE.with(|c| {
    c.borrow()
      .as_ref()
      .is_some_and(|cur| std::sync::Arc::ptr_eq(cur, handle))
  })
}

type RegisteredClasses = PersistedPerInstanceHashMap<
  /* export name */ String,
  /* constructor */ sys::napi_ref,
  FxBuildHasher,
>;

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
  REGISTERED_CLASSES.with(|cell| cell.borrow_mut(|map| map.get(js_name).copied()))
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

  if let Err(error) = crate::sendable_resolver::register_resolver_env(env) {
    JsError::from(error).throw_into(env);
    return exports;
  }

  if increment_module_count() != 0 {
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
    }));
    #[cfg(not(target_family = "wasm"))]
    {
      let status =
        unsafe { sys::napi_add_env_cleanup_hook(env, Some(thread_cleanup), cleanup_data.cast()) };
      if status != sys::Status::napi_ok {
        drop(unsafe { Box::from_raw(cleanup_data) });
        decrement_runtime_module_count();
        check_status_or_throw!(env, status, "Failed to add env cleanup hook");
        FIRST_MODULE_REGISTERED.store(true, Ordering::SeqCst);
        return exports;
      }
    }
    #[cfg(target_family = "wasm")]
    {
      let status = unsafe {
        sys::napi_wrap(
          env,
          exports,
          cleanup_data.cast(),
          Some(thread_cleanup),
          ptr::null_mut(),
          ptr::null_mut(),
        )
      };
      if status != sys::Status::napi_ok {
        drop(unsafe { Box::from_raw(cleanup_data) });
        decrement_runtime_module_count();
        check_status_or_throw!(env, status, "Failed to add env cleanup finalizer");
        FIRST_MODULE_REGISTERED.store(true, Ordering::SeqCst);
        return exports;
      }
    }

    #[cfg(feature = "async-runtime")]
    {
      crate::tokio_runtime::register_async_runtime_env_tasks(env);
      if let Err(error) = crate::tokio_runtime::register_async_runtime_env() {
        rollback_runtime_env(env, exports, cleanup_data);
        JsError::from(error).throw_into(env);
        FIRST_MODULE_REGISTERED.store(true, Ordering::SeqCst);
        return exports;
      }
    }
    #[cfg(all(feature = "tokio_rt", not(feature = "async-runtime")))]
    if let Err(error) = crate::tokio_runtime::start_tokio_runtime() {
      rollback_runtime_env(env, exports, cleanup_data);
      JsError::from(error).throw_into(env);
      FIRST_MODULE_REGISTERED.store(true, Ordering::SeqCst);
      return exports;
    }
    cleanup_data
  };

  #[cfg(feature = "async-runtime")]
  if let Err(error) = crate::tokio_runtime::ensure_async_runtime_ready() {
    rollback_runtime_env(env, exports, _runtime_cleanup);
    JsError::from(error).throw_into(env);
    FIRST_MODULE_REGISTERED.store(true, Ordering::SeqCst);
    return exports;
  }

  // Install the per-env custom-GC handle (#3357) BEFORE running ANY module-init
  // callback below (the export-register callbacks, `module_register_hook_callback`,
  // and the compat `MODULE_EXPORTS` callbacks). Those callbacks can capture a
  // `Buffer`/`TypedArray` via `from_napi_value`, which snapshots the thread-local
  // `CURRENT_CUSTOM_GC_HANDLE`. If the handle were installed afterwards (as it was
  // originally), such a value would record `None`; because `Buffer`/`TypedArray`
  // are `Send`, dropping it later on a non-JS thread would fall through to a direct
  // `napi_reference_unref(env, ..)` on the WRONG thread — the cross-isolate
  // use-after-free this change exists to prevent. `create_custom_gc` only needs a
  // valid `env` (it creates a dummy function + the per-env TSFN and never reads
  // `exports`), so running it this early is safe.
  #[cfg(feature = "napi4")]
  create_custom_gc(env);

  let mut exports_objects: HashSet<String> = HashSet::default();

  {
    let mut register_callback = MODULE_REGISTER_CALLBACK
      .write()
      .expect("Write MODULE_REGISTER_CALLBACK in napi_register_module_v1 failed");
    register_callback
      .iter_mut()
      .fold(
        HashMap::<Option<&'static str>, Vec<(&'static str, ExportRegisterCallback)>>::new(),
        |mut acc, (js_mod, item)| {
          if let Some(k) = acc.get_mut(js_mod) {
            k.push(*item);
          } else {
            acc.insert(*js_mod, vec![*item]);
          }
          acc
        },
      )
      .iter()
      .for_each(|(js_mod, items)| {
        let mut exports_js_mod = ptr::null_mut();
        if let Some(js_mod_str) = js_mod {
          let mod_name_c_str =
            unsafe { CStr::from_bytes_with_nul_unchecked(js_mod_str.as_bytes()) };
          if exports_objects.contains(*js_mod_str) {
            check_status_or_throw!(
              env,
              unsafe {
                sys::napi_get_named_property(
                  env,
                  exports,
                  mod_name_c_str.as_ptr(),
                  &mut exports_js_mod,
                )
              },
              "Get mod {} from exports failed",
              js_mod_str,
            );
          } else {
            check_status_or_throw!(
              env,
              unsafe { sys::napi_create_object(env, &mut exports_js_mod) },
              "Create export JavaScript Object [{}] failed",
              js_mod_str
            );
            check_status_or_throw!(
              env,
              unsafe {
                sys::napi_set_named_property(env, exports, mod_name_c_str.as_ptr(), exports_js_mod)
              },
              "Set exports Object [{}] into exports object failed",
              js_mod_str
            );
            exports_objects.insert(js_mod_str.to_string());
          }
        }
        for (name, callback) in items {
          unsafe {
            let js_name = CStr::from_bytes_with_nul_unchecked(name.as_bytes());
            if let Err(e) = callback(env).and_then(|v| {
              let exported_object = if exports_js_mod.is_null() {
                exports
              } else {
                exports_js_mod
              };
              check_status!(
                sys::napi_set_named_property(env, exported_object, js_name.as_ptr(), v),
                "Failed to register export `{}`",
                name,
              )
            }) {
              JsError::from(e).throw_into(env)
            }
          }
        }
      });
  }

  let mut registered_classes = HashMap::default();

  MODULE_CLASS_PROPERTIES.borrow(|inner| {
    inner.iter().for_each(|(_, js_mods)| {
      for (js_mod, class_registration) in js_mods {
        let mut exports_js_mod = ptr::null_mut();
        unsafe {
          let js_name = class_registration.js_name;
          let props = &class_registration.props;
          if let Some(js_mod_str) = js_mod {
            let mod_name_c_str = CStr::from_bytes_with_nul_unchecked(js_mod_str.as_bytes());
            if exports_objects.contains(*js_mod_str) {
              check_status_or_throw!(
                env,
                sys::napi_get_named_property(
                  env,
                  exports,
                  mod_name_c_str.as_ptr(),
                  &mut exports_js_mod,
                ),
                "Get mod {} from exports failed",
                js_mod_str,
              );
            } else {
              check_status_or_throw!(
                env,
                sys::napi_create_object(env, &mut exports_js_mod),
                "Create export JavaScript Object [{}] failed",
                js_mod_str
              );
              check_status_or_throw!(
                env,
                sys::napi_set_named_property(env, exports, mod_name_c_str.as_ptr(), exports_js_mod),
                "Set exports Object [{}] into exports object failed",
                js_mod_str
              );
              exports_objects.insert(js_mod_str.to_string());
            }
          }
          let (ctor, props): (Vec<_>, Vec<_>) = props.iter().partition(|prop| prop.is_ctor);

          let ctor = ctor
            .first()
            .map(|c| c.raw().method.unwrap())
            .unwrap_or(noop);
          let raw_props: Vec<_> = props.iter().map(|prop| prop.raw()).collect();

          let js_class_name = CStr::from_bytes_with_nul_unchecked(js_name.as_bytes());
          let mut class_ptr = ptr::null_mut();

          check_status_or_throw!(
            env,
            sys::napi_define_class(
              env,
              js_class_name.as_ptr(),
              js_name.len() as isize - 1,
              Some(ctor),
              ptr::null_mut(),
              raw_props.len(),
              raw_props.as_ptr(),
              &mut class_ptr,
            ),
            "Failed to register class `{}`",
            &js_name,
          );

          if class_registration.implement_iterator {
            crate::bindgen_runtime::iterator::setup_iterator_class(env, class_ptr);
          }

          let mut ctor_ref = ptr::null_mut();
          sys::napi_create_reference(env, class_ptr, 1, &mut ctor_ref);

          registered_classes.insert(js_name.to_string(), ctor_ref);

          check_status_or_throw!(
            env,
            sys::napi_set_named_property(
              env,
              if exports_js_mod.is_null() {
                exports
              } else {
                exports_js_mod
              },
              js_class_name.as_ptr(),
              class_ptr
            ),
            "Failed to register class `{}`",
            &js_name,
          );
        }
      }
    });
  });

  REGISTERED_CLASSES.with(|cell| {
    cell.borrow_mut(|map| {
      *map = registered_classes;
    })
  });

  let module_register_hook_callback = MODULE_REGISTER_HOOK_CALLBACK
    .read()
    .expect("Read MODULE_REGISTER_HOOK_CALLBACK failed");
  if let Some(cb) = module_register_hook_callback.as_ref() {
    if let Err(e) = cb(env, exports) {
      JsError::from(e).throw_into(env);
    }
  }

  #[cfg(feature = "compat-mode")]
  {
    let module_exports = MODULE_EXPORTS.read().expect("Read MODULE_EXPORTS failed");
    module_exports.iter().for_each(|callback| unsafe {
      if let Err(e) = callback(env, exports) {
        JsError::from(e).throw_into(env);
      }
    })
  }

  FIRST_MODULE_REGISTERED.store(true, Ordering::SeqCst);
  exports
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
fn create_custom_gc(env: sys::napi_env) {
  // Per-env custom-GC TSFN (#3357): created for EVERY isolate. It is `napi_unref`'d so it never pins
  // the event loop (worker terminate/exit cannot hang), and Node owns it (torn down via
  // `custom_gc_handle_finalize` at env teardown).
  let mut custom_gc_fn = ptr::null_mut();
  check_status_or_throw!(
    env,
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
  );
  let mut async_resource_name = ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe { sys::napi_create_string_utf8(env, c"CustomGC".as_ptr(), 8, &mut async_resource_name) },
    "Create async resource string in napi_register_module_v1"
  );
  let handle = std::sync::Arc::new(CustomGcHandle {
    tsfn: std::sync::atomic::AtomicPtr::new(ptr::null_mut()),
    aborted: std::sync::RwLock::new(false),
  });
  let weak_ptr = std::sync::Arc::downgrade(&handle).into_raw();
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
  if status != sys::Status::napi_ok || custom_gc_tsfn.is_null() {
    // reclaim the leaked weak count before bailing
    drop(unsafe { std::sync::Weak::from_raw(weak_ptr) });
    check_status_or_throw!(
      env,
      status,
      "Create Custom GC ThreadsafeFunction in napi_register_module_v1 failed"
    );
    // `napi_create_threadsafe_function` only fails under resource exhaustion; `check_status_or_throw!`
    // above leaves a pending exception, which aborts the addon load (`require` throws). No user
    // `#[napi]` code then runs, so no Buffer/TypedArray is ever created with this env's (unset) handle.
    return;
  }
  handle
    .tsfn
    .store(custom_gc_tsfn, std::sync::atomic::Ordering::SeqCst);
  check_status_or_throw!(
    env,
    unsafe { sys::napi_unref_threadsafe_function(env, custom_gc_tsfn) },
    "Unref Custom GC ThreadsafeFunction in napi_register_module_v1 failed"
  );
  CURRENT_CUSTOM_GC_HANDLE.with(|c| *c.borrow_mut() = Some(handle));
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
}

#[cfg(all(
  not(feature = "noop"),
  all(
    any(feature = "tokio_rt", feature = "async-runtime"),
    feature = "napi4"
  ),
  not(target_family = "wasm")
))]
unsafe extern "C" fn thread_cleanup(data: *mut std::ffi::c_void) {
  let cleanup = unsafe { Box::from_raw(data.cast::<RuntimeEnvCleanup>()) };
  crate::bindgen_runtime::catch_unwind_safely(|| {
    cleanup_runtime_env(&cleanup);
  });
}

#[cfg(all(
  not(feature = "noop"),
  all(
    any(feature = "tokio_rt", feature = "async-runtime"),
    feature = "napi4"
  )
))]
fn cleanup_runtime_env(cleanup: &RuntimeEnvCleanup) {
  if !cleanup.active.swap(false, Ordering::AcqRel) {
    return;
  }
  let env = cleanup.env;
  #[cfg(feature = "async-runtime")]
  {
    crate::tokio_runtime::cancel_async_runtime_env_tasks(env);
    if let Err(error) = crate::tokio_runtime::unregister_async_runtime_env() {
      crate::bindgen_runtime::catch_unwind_safely(|| {
        eprintln!("Failed to shut down custom async runtime: {error}");
      });
    }
  }
  crate::sendable_resolver::clear_resolvers_for_env(env);
  crate::js_values::clear_finalize_callbacks_for_env(env);
  decrement_runtime_module_count();
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "tokio_rt", feature = "async-runtime"),
  feature = "napi4"
))]
fn increment_module_count() -> usize {
  let _guard = RUNTIME_MODULE_LOCK
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner);
  MODULE_COUNT.fetch_add(1, Ordering::AcqRel)
}

#[cfg(all(
  not(feature = "noop"),
  not(all(
    any(feature = "tokio_rt", feature = "async-runtime"),
    feature = "napi4"
  ))
))]
fn increment_module_count() -> usize {
  MODULE_COUNT.fetch_add(1, Ordering::AcqRel)
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "tokio_rt", feature = "async-runtime"),
  feature = "napi4"
))]
fn decrement_runtime_module_count() {
  decrement_runtime_module_count_with_last(|| {
    #[cfg(all(feature = "tokio_rt", not(feature = "async-runtime")))]
    if let Err(error) = crate::tokio_runtime::shutdown_tokio_runtime() {
      crate::bindgen_runtime::catch_unwind_safely(|| {
        eprintln!("Failed to shut down Tokio runtime: {error}");
      });
    }
  });
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "tokio_rt", feature = "async-runtime"),
  feature = "napi4"
))]
fn decrement_runtime_module_count_with_last(on_last: impl FnOnce()) {
  // Keep registration excluded until the last environment has committed its runtime shutdown.
  // Otherwise a new environment can increment zero to one, observe the old runtime as running,
  // and then have the retiring environment stop it.
  let _guard = RUNTIME_MODULE_LOCK
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner);
  if MODULE_COUNT.fetch_sub(1, Ordering::AcqRel) == 1 {
    on_last();
  }
}

#[cfg(all(
  not(feature = "noop"),
  any(feature = "tokio_rt", feature = "async-runtime"),
  feature = "napi4"
))]
fn rollback_runtime_env(
  env: sys::napi_env,
  _exports: sys::napi_value,
  cleanup_data: *mut RuntimeEnvCleanup,
) {
  cleanup_runtime_env(unsafe { &*cleanup_data });

  #[cfg(not(target_family = "wasm"))]
  {
    let status =
      unsafe { sys::napi_remove_env_cleanup_hook(env, Some(thread_cleanup), cleanup_data.cast()) };
    if status == sys::Status::napi_ok {
      drop(unsafe { Box::from_raw(cleanup_data) });
    }
  }

  #[cfg(target_family = "wasm")]
  {
    let mut removed = ptr::null_mut();
    let status = unsafe { sys::napi_remove_wrap(env, _exports, &mut removed) };
    if status == sys::Status::napi_ok && removed == cleanup_data.cast() {
      drop(unsafe { Box::from_raw(removed.cast::<RuntimeEnvCleanup>()) });
    }
  }
}

#[cfg(all(
  not(feature = "noop"),
  all(
    any(feature = "tokio_rt", feature = "async-runtime"),
    feature = "napi4"
  ),
  target_family = "wasm"
))]
unsafe extern "C" fn thread_cleanup(
  env: sys::napi_env,
  data: *mut std::ffi::c_void,
  _finalize_hint: *mut std::ffi::c_void,
) {
  let cleanup = unsafe { Box::from_raw(data.cast::<RuntimeEnvCleanup>()) };
  debug_assert_eq!(cleanup.env, env);
  crate::bindgen_runtime::catch_unwind_safely(|| {
    cleanup_runtime_env(&cleanup);
  });
}

#[cfg(all(
  test,
  not(feature = "noop"),
  any(feature = "tokio_rt", feature = "async-runtime"),
  feature = "napi4"
))]
mod runtime_module_count_tests {
  use std::sync::mpsc;
  use std::time::Duration;

  use super::*;

  #[test]
  fn last_environment_shutdown_excludes_new_registration() {
    let original_count = MODULE_COUNT.swap(1, Ordering::AcqRel);
    assert_eq!(
      original_count, 0,
      "module count must be unused by Rust unit tests"
    );

    let (shutdown_started_tx, shutdown_started_rx) = mpsc::channel();
    let (release_shutdown_tx, release_shutdown_rx) = mpsc::channel();
    let shutdown = std::thread::spawn(move || {
      decrement_runtime_module_count_with_last(|| {
        shutdown_started_tx.send(()).unwrap();
        release_shutdown_rx.recv().unwrap();
      });
    });
    shutdown_started_rx.recv().unwrap();

    let (registration_done_tx, registration_done_rx) = mpsc::channel();
    let registration = std::thread::spawn(move || {
      let previous = increment_module_count();
      registration_done_tx.send(previous).unwrap();
    });
    assert!(
      registration_done_rx
        .recv_timeout(Duration::from_millis(50))
        .is_err(),
      "registration must wait until the previous runtime shutdown is committed"
    );

    release_shutdown_tx.send(()).unwrap();
    shutdown.join().unwrap();
    assert_eq!(
      registration_done_rx
        .recv_timeout(Duration::from_secs(1))
        .unwrap(),
      0
    );
    registration.join().unwrap();
    assert_eq!(MODULE_COUNT.swap(0, Ordering::AcqRel), 1);
  }
}

#[cfg(all(feature = "napi4", not(feature = "noop")))]
#[allow(unused)]
unsafe extern "C" fn empty(env: sys::napi_env, info: sys::napi_callback_info) -> sys::napi_value {
  ptr::null_mut()
}

// Per-env custom-GC finalize (#3357): sets the per-handle `aborted` flag when Node tears down the
// owner env's TSFN. `finalize_data` is the `Weak<CustomGcHandle>` smuggled in via
// `thread_finalize_data`; we reclaim that weak count here.
#[cfg(all(feature = "napi4", not(feature = "noop")))]
unsafe extern "C" fn custom_gc_handle_finalize(
  _env: sys::napi_env,
  finalize_data: *mut std::ffi::c_void,
  _finalize_hint: *mut std::ffi::c_void,
) {
  if finalize_data.is_null() {
    return;
  }
  if let Some(handle) =
    unsafe { std::sync::Weak::<CustomGcHandle>::from_raw(finalize_data.cast()) }.upgrade()
  {
    // owner env gone, ref already invalidated by V8 -> mark aborted (write-lock)
    handle.set_aborted();
  }
  // temp Weak dropped here -> reclaims the weak count
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
  let mut ref_count = 0;
  check_status_or_throw!(
    env,
    unsafe { sys::napi_reference_unref(env, data.cast(), &mut ref_count) },
    "Failed to unref reference in Custom GC"
  );
  // Both ArrayBuffer/Buffer and `Error` references reach 0 here: each is created
  // at refcount 1 and routed through this TSFN exactly once, by its owner's drop
  // (for `Error`, the last `Arc<ErrorRef>`), so the unref above always hits 0.
  if ref_count == 0 {
    check_status_or_throw!(
      env,
      unsafe { sys::napi_delete_reference(env, data.cast()) },
      "Failed to delete reference in Custom GC"
    );
  }
}
