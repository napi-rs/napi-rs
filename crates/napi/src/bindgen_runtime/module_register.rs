use std::cell::RefCell;
use std::collections::HashMap;
#[cfg(all(feature = "tokio_rt", feature = "napi4"))]
use std::ffi::c_void;
use std::ffi::{CStr, CString};
use std::mem;
use std::ptr;
use std::sync::atomic::AtomicBool;
use std::sync::{atomic::Ordering, Mutex};

use lazy_static::lazy_static;

use crate::{
  check_status, check_status_or_throw, sys, Env, JsError, JsFunction, Property, Result, Value,
  ValueType,
};

pub type ExportRegisterCallback = unsafe fn(sys::napi_env) -> Result<sys::napi_value>;
pub type ModuleExportsCallback =
  unsafe fn(env: sys::napi_env, exports: sys::napi_value) -> Result<()>;

struct PersistedSingleThreadVec<T> {
  inner: Mutex<Vec<T>>,
}

impl<T> Default for PersistedSingleThreadVec<T> {
  fn default() -> Self {
    PersistedSingleThreadVec {
      inner: Mutex::new(Vec::new()),
    }
  }
}

impl<T> PersistedSingleThreadVec<T> {
  #[allow(clippy::mut_from_ref)]
  fn borrow_mut<F>(&self, f: F)
  where
    F: FnOnce(&mut [T]),
  {
    let mut locked = self
      .inner
      .lock()
      .expect("Acquire persisted thread vec lock failed");
    f(&mut *locked);
  }

  fn push(&self, item: T) {
    let mut locked = self
      .inner
      .lock()
      .expect("Acquire persisted thread vec lock failed");
    locked.push(item);
  }
}

unsafe impl<T> Send for PersistedSingleThreadVec<T> {}
unsafe impl<T> Sync for PersistedSingleThreadVec<T> {}

struct PersistedSingleThreadHashMap<K, V>(Mutex<HashMap<K, V>>);

impl<K, V> PersistedSingleThreadHashMap<K, V> {
  #[allow(clippy::mut_from_ref)]
  fn borrow_mut<F, R>(&self, f: F) -> R
  where
    F: FnOnce(&mut HashMap<K, V>) -> R,
  {
    let mut lock = self
      .0
      .lock()
      .expect("Acquire persisted thread hash map lock failed");
    f(&mut *lock)
  }
}

impl<K, V> Default for PersistedSingleThreadHashMap<K, V> {
  fn default() -> Self {
    PersistedSingleThreadHashMap(Mutex::new(Default::default()))
  }
}

type ModuleRegisterCallback =
  PersistedSingleThreadVec<(Option<&'static str>, (&'static str, ExportRegisterCallback))>;

type ModuleClassProperty = PersistedSingleThreadHashMap<
  &'static str,
  HashMap<Option<&'static str>, (&'static str, Vec<Property>)>,
>;

type FnRegisterMap =
  PersistedSingleThreadHashMap<ExportRegisterCallback, (sys::napi_callback, &'static str)>;

unsafe impl<K, V> Send for PersistedSingleThreadHashMap<K, V> {}
unsafe impl<K, V> Sync for PersistedSingleThreadHashMap<K, V> {}

lazy_static! {
  static ref MODULE_REGISTER_CALLBACK: ModuleRegisterCallback = Default::default();
  static ref MODULE_CLASS_PROPERTIES: ModuleClassProperty = Default::default();
  static ref FN_REGISTER_MAP: FnRegisterMap = Default::default();
  static ref MODULE_REGISTER_LOCK: Mutex<()> = Mutex::new(());
  static ref REGISTERED: AtomicBool = AtomicBool::new(false);
}

#[inline]
fn wait_first_thread_registered() {
  while !REGISTERED.load(Ordering::SeqCst) {
    std::hint::spin_loop();
  }
}

#[cfg(feature = "compat-mode")]
// compatibility for #[module_exports]
lazy_static! {
  static ref MODULE_EXPORTS: PersistedSingleThreadVec<ModuleExportsCallback> = Default::default();
}

thread_local! {
  static REGISTERED_CLASSES: RefCell<HashMap<
    /* export name */ String,
    /* constructor */ sys::napi_ref,
  >> = Default::default();
}

#[doc(hidden)]
pub fn get_class_constructor(js_name: &'static str) -> Option<sys::napi_ref> {
  wait_first_thread_registered();
  REGISTERED_CLASSES.with(|registered_classes| {
    let classes = registered_classes.borrow();
    classes.get(js_name).copied()
  })
}

#[doc(hidden)]
#[cfg(feature = "compat-mode")]
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
    val.1.extend(props.into_iter());
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
  wait_first_thread_registered();
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
  wait_first_thread_registered();
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

#[no_mangle]
unsafe extern "C" fn napi_register_module_v1(
  env: sys::napi_env,
  exports: sys::napi_value,
) -> sys::napi_value {
  let lock = MODULE_REGISTER_LOCK
    .lock()
    .expect("Failed to acquire module register lock");
  let mut exports_objects: HashMap<Option<&'static str>, sys::napi_value> = HashMap::default();
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
          if let Some(exports_object) = exports_objects.get(js_mod) {
            exports_js_mod = *exports_object;
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
                sys::napi_set_named_property(
                  env,
                  exports,
                  js_mod_str.as_ptr() as *const _,
                  exports_js_mod,
                )
              },
              "Set exports Object [{}] into exports object failed",
              js_mod_str
            );
            exports_objects.insert(*js_mod, exports_js_mod);
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

  MODULE_CLASS_PROPERTIES.borrow_mut(|inner| {
    inner.iter().for_each(|(rust_name, js_mods)| {
      for (js_mod, (js_name, props)) in js_mods {
        let mut exports_js_mod = ptr::null_mut();
        unsafe {
          if let Some(js_mod_str) = js_mod {
            if let Some(exports_object) = exports_objects.get(js_mod) {
              exports_js_mod = *exports_object;
            } else {
              check_status_or_throw!(
                env,
                sys::napi_create_object(env, &mut exports_js_mod),
                "Create export JavaScript Object [{}] failed",
                js_mod_str
              );
              check_status_or_throw!(
                env,
                sys::napi_set_named_property(
                  env,
                  exports,
                  CStr::from_bytes_with_nul_unchecked(js_mod_str.as_bytes()).as_ptr(),
                  exports_js_mod
                ),
                "Set exports Object [{}] into exports object failed",
                js_mod_str
              );
              exports_objects.insert(*js_mod, exports_js_mod);
            }
          }
          let (ctor, props): (Vec<_>, Vec<_>) = props.iter().partition(|prop| prop.is_ctor);
          // one or more or zero?
          // zero is for `#[napi(task)]`
          if ctor.is_empty() && props.is_empty() {
            continue;
          }
          let ctor = ctor.get(0).map(|c| c.raw().method.unwrap()).unwrap_or(noop);
          let raw_props: Vec<_> = props.iter().map(|prop| prop.raw()).collect();

          let js_class_name = CString::from_vec_with_nul_unchecked(js_name.as_bytes().to_vec());
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

          REGISTERED_CLASSES.with(|registered_classes| {
            let mut registered_class = registered_classes.borrow_mut();
            registered_class.insert(js_name.to_string(), ctor_ref);
          });

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
    })
  });

  #[cfg(feature = "compat-mode")]
  MODULE_EXPORTS.borrow_mut(|inner| {
    inner.iter().for_each(|callback| unsafe {
      if let Err(e) = callback(env, exports) {
        JsError::from(e).throw_into(env);
      }
    })
  });

  #[cfg(all(feature = "tokio_rt", feature = "napi4"))]
  {
    let _ = crate::tokio_runtime::RT.clone();
    crate::tokio_runtime::TOKIO_RT_REF_COUNT.fetch_add(1, Ordering::SeqCst);
    assert_eq!(
      unsafe {
        sys::napi_add_env_cleanup_hook(env, Some(crate::shutdown_tokio_rt), env as *mut c_void)
      },
      sys::Status::napi_ok
    );
  }
  mem::drop(lock);
  REGISTERED.store(true, Ordering::SeqCst);
  exports
}

pub(crate) unsafe extern "C" fn noop(
  env: sys::napi_env,
  _info: sys::napi_callback_info,
) -> sys::napi_value {
  if !crate::bindgen_runtime::___CALL_FROM_FACTORY.with(|inner| inner.load(Ordering::Relaxed)) {
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
