use std::collections::{HashMap, HashSet};
use std::ffi::CStr;
#[cfg(all(feature = "napi4", not(target_arch = "wasm32"), not(feature = "noop")))]
use std::hash::Hash;
#[cfg(all(feature = "napi4", not(target_arch = "wasm32")))]
use std::ops::Deref;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicUsize, Ordering};
use std::thread::ThreadId;

use once_cell::sync::Lazy;

use crate::{check_status, sys, Env, JsFunction, Property, Result, Value, ValueType};
#[cfg(not(feature = "noop"))]
use crate::{check_status_or_throw, JsError};

pub type ExportRegisterCallback = unsafe fn(sys::napi_env) -> Result<sys::napi_value>;
pub type ModuleExportsCallback =
  unsafe fn(env: sys::napi_env, exports: sys::napi_value) -> Result<()>;

struct PersistedPerInstanceVec<T> {
  inner: AtomicPtr<T>,
  length: AtomicUsize,
}

impl<T> Default for PersistedPerInstanceVec<T> {
  fn default() -> Self {
    let mut vec: Vec<T> = Vec::with_capacity(1);
    let ret = Self {
      inner: AtomicPtr::new(vec.as_mut_ptr()),
      length: AtomicUsize::new(0),
    };
    std::mem::forget(vec);
    ret
  }
}

impl<T> PersistedPerInstanceVec<T> {
  #[cfg(not(feature = "noop"))]
  #[allow(clippy::mut_from_ref)]
  fn borrow_mut<F>(&self, f: F)
  where
    F: FnOnce(&mut [T]),
  {
    let length = self.length.load(Ordering::Relaxed);
    if length == 0 {
      f(&mut []);
    } else {
      let inner = self.inner.load(Ordering::Relaxed);
      let mut temp = unsafe { Vec::from_raw_parts(inner, length, length) };
      f(temp.as_mut_slice());
      // Inner Vec has been reallocated, so we need to update the pointer
      if temp.as_mut_ptr() != inner {
        self.inner.store(temp.as_mut_ptr(), Ordering::Relaxed);
      }
      self.length.store(temp.len(), Ordering::Relaxed);
      std::mem::forget(temp);
    }
  }

  fn push(&self, item: T) {
    let length = self.length.load(Ordering::Relaxed);
    let inner = self.inner.load(Ordering::Relaxed);
    let mut temp = unsafe { Vec::from_raw_parts(inner, length, length) };
    temp.push(item);
    // Inner Vec has been reallocated, so we need to update the pointer
    if temp.as_mut_ptr() != inner {
      self.inner.store(temp.as_mut_ptr(), Ordering::Relaxed);
    }
    std::mem::forget(temp);

    self.length.fetch_add(1, Ordering::Relaxed);
  }
}

unsafe impl<T: Send> Send for PersistedPerInstanceVec<T> {}
unsafe impl<T: Sync> Sync for PersistedPerInstanceVec<T> {}

#[cfg(all(feature = "napi4", not(target_arch = "wasm32")))]
pub(crate) struct PersistedPerInstanceHashSet<T: 'static> {
  inner: *mut HashSet<T>,
}

#[cfg(not(feature = "noop"))]
#[cfg(all(feature = "napi4", not(target_arch = "wasm32")))]
impl<T: 'static + PartialEq + Eq + Hash> PersistedPerInstanceHashSet<T> {
  pub(crate) fn insert(&self, item: T) {
    Box::leak(unsafe { Box::from_raw(self.inner) }).insert(item);
  }

  fn remove(&self, item: &T) {
    Box::leak(unsafe { Box::from_raw(self.inner) }).remove(item);
  }
}

#[cfg(all(feature = "napi4", not(target_arch = "wasm32")))]
impl<T: 'static> Deref for PersistedPerInstanceHashSet<T> {
  type Target = HashSet<T>;

  fn deref(&self) -> &Self::Target {
    Box::leak(unsafe { Box::from_raw(self.inner) })
  }
}

#[cfg(all(feature = "napi4", not(target_arch = "wasm32")))]
impl<T: 'static> Default for PersistedPerInstanceHashSet<T> {
  fn default() -> Self {
    Self {
      inner: Box::leak(Box::default()),
    }
  }
}

#[cfg(all(feature = "napi4", not(target_arch = "wasm32")))]
unsafe impl<T: Send> Send for PersistedPerInstanceHashSet<T> {}
#[cfg(all(feature = "napi4", not(target_arch = "wasm32")))]
unsafe impl<T: Sync> Sync for PersistedPerInstanceHashSet<T> {}

pub(crate) struct PersistedPerInstanceHashMap<K, V>(*mut HashMap<K, V>);

impl<K, V> PersistedPerInstanceHashMap<K, V> {
  #[cfg(not(feature = "noop"))]
  pub(crate) fn from_hashmap(hashmap: HashMap<K, V>) -> Self {
    Self(Box::into_raw(Box::new(hashmap)))
  }

  #[allow(clippy::mut_from_ref)]
  pub(crate) fn borrow_mut<F, R>(&self, f: F) -> R
  where
    F: FnOnce(&mut HashMap<K, V>) -> R,
  {
    f(unsafe { Box::leak(Box::from_raw(self.0)) })
  }
}

impl<K, V> Default for PersistedPerInstanceHashMap<K, V> {
  fn default() -> Self {
    let map = Default::default();
    Self(Box::into_raw(Box::new(map)))
  }
}

type ModuleRegisterCallback =
  PersistedPerInstanceVec<(Option<&'static str>, (&'static str, ExportRegisterCallback))>;

type ModuleClassProperty = PersistedPerInstanceHashMap<
  &'static str,
  HashMap<Option<&'static str>, (&'static str, Vec<Property>)>,
>;

unsafe impl<K, V> Send for PersistedPerInstanceHashMap<K, V> {}
unsafe impl<K, V> Sync for PersistedPerInstanceHashMap<K, V> {}

type FnRegisterMap =
  PersistedPerInstanceHashMap<ExportRegisterCallback, (sys::napi_callback, &'static str)>;
type RegisteredClassesMap = PersistedPerInstanceHashMap<ThreadId, RegisteredClasses>;

static MODULE_REGISTER_CALLBACK: Lazy<ModuleRegisterCallback> = Lazy::new(Default::default);
static MODULE_CLASS_PROPERTIES: Lazy<ModuleClassProperty> = Lazy::new(Default::default);
#[cfg(not(feature = "noop"))]
static IS_FIRST_MODULE: AtomicBool = AtomicBool::new(true);
#[cfg(not(feature = "noop"))]
static FIRST_MODULE_REGISTERED: AtomicBool = AtomicBool::new(false);
static REGISTERED_CLASSES: Lazy<RegisteredClassesMap> = Lazy::new(Default::default);
static FN_REGISTER_MAP: Lazy<FnRegisterMap> = Lazy::new(Default::default);
#[cfg(all(feature = "napi4", not(target_arch = "wasm32")))]
pub(crate) static CUSTOM_GC_TSFN: AtomicPtr<sys::napi_threadsafe_function__> =
  AtomicPtr::new(ptr::null_mut());
#[cfg(all(feature = "napi4", not(target_arch = "wasm32")))]
thread_local! {
  // CustomGC ThreadsafeFunction may be deleted during the process exit.
  // And there may still some Buffer alive after that.
  pub(crate) static THREAD_DESTROYED: AtomicBool = AtomicBool::new(false);
}
#[cfg(all(feature = "napi4", not(target_arch = "wasm32")))]
// Store thread id of the thread that created the CustomGC ThreadsafeFunction.
pub(crate) static THREADS_CAN_ACCESS_ENV: once_cell::sync::OnceCell<
  PersistedPerInstanceHashSet<ThreadId>,
> = once_cell::sync::OnceCell::new();

type RegisteredClasses =
  PersistedPerInstanceHashMap</* export name */ String, /* constructor */ sys::napi_ref>;

#[cfg(all(feature = "compat-mode", not(feature = "noop")))]
// compatibility for #[module_exports]
static MODULE_EXPORTS: Lazy<PersistedPerInstanceVec<ModuleExportsCallback>> =
  Lazy::new(Default::default);

#[cfg(not(feature = "noop"))]
#[inline]
fn wait_first_thread_registered() {
  while !FIRST_MODULE_REGISTERED.load(Ordering::SeqCst) {
    std::hint::spin_loop();
  }
}

#[doc(hidden)]
pub fn get_class_constructor(js_name: &'static str) -> Option<sys::napi_ref> {
  let current_id = std::thread::current().id();
  REGISTERED_CLASSES.borrow_mut(|map| {
    map
      .get(&current_id)
      .map(|m| m.borrow_mut(|map| map.get(js_name).copied()))
  })?
}

#[doc(hidden)]
#[cfg(all(feature = "compat-mode", not(feature = "noop")))]
// compatibility for #[module_exports]
pub fn register_module_exports(callback: ModuleExportsCallback) {
  MODULE_EXPORTS.push(callback);
}

#[doc(hidden)]
pub fn register_module_export(
  js_mod: Option<&'static str>,
  name: &'static str,
  cb: ExportRegisterCallback,
) {
  MODULE_REGISTER_CALLBACK.push((js_mod, (name, cb)));
}

#[doc(hidden)]
pub fn register_js_function(
  name: &'static str,
  cb: ExportRegisterCallback,
  c_fn: sys::napi_callback,
) {
  FN_REGISTER_MAP.borrow_mut(|inner| {
    inner.insert(cb, (c_fn, name));
  });
}

#[doc(hidden)]
pub fn register_class(
  rust_name: &'static str,
  js_mod: Option<&'static str>,
  js_name: &'static str,
  props: Vec<Property>,
) {
  MODULE_CLASS_PROPERTIES.borrow_mut(|inner| {
    let val = inner.entry(rust_name).or_default();
    let val = val.entry(js_mod).or_default();
    val.0 = js_name;
    val.1.extend(props);
  });
}

#[inline]
/// Get `JsFunction` from defined Rust `fn`
/// ```rust
/// #[napi]
/// fn some_fn() -> u32 {
///     1
/// }
///
/// #[napi]
/// fn return_some_fn() -> Result<JsFunction> {
///     get_js_function(some_fn_js_function)
/// }
/// ```
///
/// ```js
/// returnSomeFn()(); // 1
/// ```
///
pub fn get_js_function(env: &Env, raw_fn: ExportRegisterCallback) -> Result<JsFunction> {
  FN_REGISTER_MAP.borrow_mut(|inner| {
    inner
      .get(&raw_fn)
      .and_then(|(cb, name)| {
        let mut function = ptr::null_mut();
        let name_len = name.len() - 1;
        let fn_name = unsafe { CStr::from_bytes_with_nul_unchecked(name.as_bytes()) };
        check_status!(unsafe {
          sys::napi_create_function(
            env.0,
            fn_name.as_ptr(),
            name_len,
            *cb,
            ptr::null_mut(),
            &mut function,
          )
        })
        .ok()?;
        Some(JsFunction(Value {
          env: env.0,
          value: function,
          value_type: ValueType::Function,
        }))
      })
      .ok_or_else(|| {
        crate::Error::new(
          crate::Status::InvalidArg,
          "JavaScript function does not exist".to_owned(),
        )
      })
  })
}

/// Get `C Callback` from defined Rust `fn`
/// ```rust
/// #[napi]
/// fn some_fn() -> u32 {
///     1
/// }
///
/// #[napi]
/// fn create_obj(env: Env) -> Result<JsObject> {
///     let mut obj = env.create_object()?;
///     obj.define_property(&[Property::new("getter")?.with_getter(get_c_callback(some_fn_js_function)?)])?;
///     Ok(obj)
/// }
/// ```
///
/// ```js
/// console.log(createObj().getter) // 1
/// ```
///
pub fn get_c_callback(raw_fn: ExportRegisterCallback) -> Result<crate::Callback> {
  FN_REGISTER_MAP.borrow_mut(|inner| {
    inner
      .get(&raw_fn)
      .and_then(|(cb, _name)| *cb)
      .ok_or_else(|| {
        crate::Error::new(
          crate::Status::InvalidArg,
          "JavaScript function does not exist".to_owned(),
        )
      })
  })
}

#[cfg(all(windows, not(feature = "noop")))]
#[ctor::ctor]
fn load_host() {
  unsafe {
    sys::setup();
  }
}

#[cfg(all(target_arch = "wasm32", not(feature = "noop")))]
#[no_mangle]
unsafe extern "C" fn napi_register_wasm_v1(
  env: sys::napi_env,
  exports: sys::napi_value,
) -> sys::napi_value {
  unsafe { napi_register_module_v1(env, exports) }
}

#[cfg(not(feature = "noop"))]
#[no_mangle]
unsafe extern "C" fn napi_register_module_v1(
  env: sys::napi_env,
  exports: sys::napi_value,
) -> sys::napi_value {
  if IS_FIRST_MODULE.load(Ordering::SeqCst) {
    IS_FIRST_MODULE.store(false, Ordering::SeqCst);
  } else {
    wait_first_thread_registered();
  }
  let mut exports_objects: HashSet<String> = HashSet::default();
  MODULE_REGISTER_CALLBACK.borrow_mut(|inner| {
    inner
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
      })
  });

  let mut registered_classes = HashMap::new();

  MODULE_CLASS_PROPERTIES.borrow_mut(|inner| {
    inner.iter().for_each(|(rust_name, js_mods)| {
      for (js_mod, (js_name, props)) in js_mods {
        let mut exports_js_mod = ptr::null_mut();
        unsafe {
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

          let ctor = ctor.get(0).map(|c| c.raw().method.unwrap()).unwrap_or(noop);
          let raw_props: Vec<_> = props.iter().map(|prop| prop.raw()).collect();

          let js_class_name = CStr::from_bytes_with_nul_unchecked(js_name.as_bytes());
          let mut class_ptr = ptr::null_mut();

          check_status_or_throw!(
            env,
            sys::napi_define_class(
              env,
              js_class_name.as_ptr(),
              js_name.len() - 1,
              Some(ctor),
              ptr::null_mut(),
              raw_props.len(),
              raw_props.as_ptr(),
              &mut class_ptr,
            ),
            "Failed to register class `{}` generate by struct `{}`",
            &js_name,
            &rust_name
          );

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
            "Failed to register class `{}` generate by struct `{}`",
            &js_name,
            &rust_name
          );
        }
      }
    });

    REGISTERED_CLASSES.borrow_mut(|map| {
      map.insert(
        std::thread::current().id(),
        PersistedPerInstanceHashMap::from_hashmap(registered_classes),
      )
    });
  });

  #[cfg(feature = "compat-mode")]
  MODULE_EXPORTS.borrow_mut(|inner| {
    inner.iter().for_each(|callback| unsafe {
      if let Err(e) = callback(env, exports) {
        JsError::from(e).throw_into(env);
      }
    })
  });

  #[cfg(all(windows, feature = "napi4", feature = "tokio_rt"))]
  {
    crate::tokio_runtime::ensure_runtime();

    static init_counter: AtomicUsize = AtomicUsize::new(0);
    let cleanup_hook_payload =
      init_counter.fetch_add(1, Ordering::Relaxed) as *mut std::ffi::c_void;

    unsafe {
      sys::napi_add_env_cleanup_hook(
        env,
        Some(crate::tokio_runtime::drop_runtime),
        cleanup_hook_payload,
      )
    };
  }
  #[cfg(all(feature = "napi4", not(target_arch = "wasm32")))]
  create_custom_gc(env);
  FIRST_MODULE_REGISTERED.store(true, Ordering::SeqCst);
  exports
}

#[cfg(not(feature = "noop"))]
pub(crate) unsafe extern "C" fn noop(
  env: sys::napi_env,
  _info: sys::napi_callback_info,
) -> sys::napi_value {
  if !crate::bindgen_runtime::___CALL_FROM_FACTORY.with(|s| s.load(Ordering::Relaxed)) {
    unsafe {
      sys::napi_throw_error(
        env,
        ptr::null_mut(),
        CStr::from_bytes_with_nul_unchecked(b"Class contains no `constructor`, can not new it!\0")
          .as_ptr(),
      );
    }
  }
  ptr::null_mut()
}

#[cfg(all(feature = "napi4", not(target_arch = "wasm32"), not(feature = "noop")))]
fn create_custom_gc(env: sys::napi_env) {
  use std::os::raw::c_char;

  let mut custom_gc_fn = ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe {
      sys::napi_create_function(
        env,
        "custom_gc".as_ptr() as *const c_char,
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
    unsafe {
      sys::napi_create_string_utf8(
        env,
        "CustomGC".as_ptr() as *const c_char,
        8,
        &mut async_resource_name,
      )
    },
    "Create async resource string in napi_register_module_v1"
  );
  let mut custom_gc_tsfn = ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe {
      sys::napi_create_threadsafe_function(
        env,
        custom_gc_fn,
        ptr::null_mut(),
        async_resource_name,
        0,
        1,
        ptr::null_mut(),
        Some(custom_gc_finalize),
        ptr::null_mut(),
        Some(custom_gc),
        &mut custom_gc_tsfn,
      )
    },
    "Create Custom GC ThreadsafeFunction in napi_register_module_v1 failed"
  );
  check_status_or_throw!(
    env,
    unsafe { sys::napi_unref_threadsafe_function(env, custom_gc_tsfn) },
    "Unref Custom GC ThreadsafeFunction in napi_register_module_v1 failed"
  );
  CUSTOM_GC_TSFN.store(custom_gc_tsfn, Ordering::Relaxed);
  let threads = THREADS_CAN_ACCESS_ENV.get_or_init(Default::default);
  let current_thread_id = std::thread::current().id();
  threads.insert(current_thread_id);
  check_status_or_throw!(
    env,
    unsafe {
      sys::napi_add_env_cleanup_hook(
        env,
        Some(remove_thread_id),
        Box::into_raw(Box::new(current_thread_id)).cast(),
      )
    },
    "Failed to add remove thread id cleanup hook"
  );
}

#[cfg(all(feature = "napi4", not(target_arch = "wasm32"), not(feature = "noop")))]
unsafe extern "C" fn remove_thread_id(id: *mut std::ffi::c_void) {
  let thread_id = unsafe { Box::from_raw(id.cast::<ThreadId>()) };
  THREADS_CAN_ACCESS_ENV
    .get_or_init(Default::default)
    .remove(&*thread_id);
}

#[cfg(all(feature = "napi4", not(target_arch = "wasm32"), not(feature = "noop")))]
#[allow(unused)]
unsafe extern "C" fn empty(env: sys::napi_env, info: sys::napi_callback_info) -> sys::napi_value {
  ptr::null_mut()
}

#[cfg(all(feature = "napi4", not(target_arch = "wasm32"), not(feature = "noop")))]
#[allow(unused)]
unsafe extern "C" fn custom_gc_finalize(
  env: sys::napi_env,
  finalize_data: *mut std::ffi::c_void,
  finalize_hint: *mut std::ffi::c_void,
) {
  THREAD_DESTROYED.with(|closed| {
    closed.store(true, Ordering::Relaxed);
  });
}

#[cfg(all(feature = "napi4", not(target_arch = "wasm32"), not(feature = "noop")))]
// recycle the ArrayBuffer/Buffer Reference if the ArrayBuffer/Buffer is not dropped on the main thread
extern "C" fn custom_gc(
  env: sys::napi_env,
  _js_callback: sys::napi_value,
  _context: *mut std::ffi::c_void,
  data: *mut std::ffi::c_void,
) {
  check_status_or_throw!(
    env,
    unsafe { sys::napi_delete_reference(env, data as sys::napi_ref) },
    "Failed to delete Buffer reference in Custom GC"
  );
}
