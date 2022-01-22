use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::CStr;
use std::ptr;
use std::sync::atomic::{AtomicPtr, AtomicUsize, Ordering};

use lazy_static::lazy_static;

use crate::{check_status, check_status_or_throw, sys, JsError, Property, Result};

pub type ExportRegisterCallback = unsafe fn(sys::napi_env) -> Result<sys::napi_value>;
pub type ModuleExportsCallback =
  unsafe fn(env: sys::napi_env, exports: sys::napi_value) -> Result<()>;

struct PersistedSingleThreadVec<T> {
  inner: AtomicPtr<T>,
  length: AtomicUsize,
}

impl<T> Default for PersistedSingleThreadVec<T> {
  fn default() -> Self {
    let mut vec: Vec<T> = Vec::with_capacity(1);
    let ret = PersistedSingleThreadVec {
      inner: AtomicPtr::new(vec.as_mut_ptr()),
      length: AtomicUsize::new(0),
    };
    std::mem::forget(vec);
    ret
  }
}

impl<T> PersistedSingleThreadVec<T> {
  #[allow(clippy::mut_from_ref)]
  fn borrow_mut(&self) -> &mut [T] {
    let length = self.length.load(Ordering::Relaxed);
    if length == 0 {
      return &mut [];
    }
    let inner = self.inner.load(Ordering::Relaxed);
    unsafe { std::slice::from_raw_parts_mut(inner, length) }
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

unsafe impl<T> Send for PersistedSingleThreadVec<T> {}
unsafe impl<T> Sync for PersistedSingleThreadVec<T> {}

struct PersistedSingleThreadHashMap<K, V>(*mut HashMap<K, V>);

impl<K, V> PersistedSingleThreadHashMap<K, V> {
  #[allow(clippy::mut_from_ref)]
  fn borrow_mut(&self) -> &mut HashMap<K, V> {
    unsafe { Box::leak(Box::from_raw(self.0)) }
  }
}

impl<K, V> Default for PersistedSingleThreadHashMap<K, V> {
  fn default() -> Self {
    let map = Default::default();
    PersistedSingleThreadHashMap(Box::into_raw(Box::new(map)))
  }
}

type ModuleRegisterCallback =
  PersistedSingleThreadVec<(Option<&'static str>, (&'static str, ExportRegisterCallback))>;

type ModuleClassProperty = PersistedSingleThreadHashMap<
  &'static str,
  HashMap<Option<&'static str>, (&'static str, Vec<Property>)>,
>;

unsafe impl<K, V> Send for PersistedSingleThreadHashMap<K, V> {}
unsafe impl<K, V> Sync for PersistedSingleThreadHashMap<K, V> {}

lazy_static! {
  static ref MODULE_REGISTER_CALLBACK: ModuleRegisterCallback = Default::default();
  static ref MODULE_CLASS_PROPERTIES: ModuleClassProperty = Default::default();
}

#[cfg(feature = "compat-mode")]
// compatibility for #[module_exports]
lazy_static! {
  static ref MODULE_EXPORTS: PersistedSingleThreadVec<ModuleExportsCallback> = Default::default();
}

thread_local! {
  static REGISTERED_CLASSES: RefCell<HashMap<
    /* export name */ &'static str,
    /* constructor */ sys::napi_ref,
  >> = Default::default();
}

pub fn get_class_constructor(js_name: &'static str) -> Option<sys::napi_ref> {
  REGISTERED_CLASSES.with(|registered_classes| {
    let classes = registered_classes.borrow();
    classes.get(js_name).copied()
  })
}

#[cfg(feature = "compat-mode")]
// compatibility for #[module_exports]
pub fn register_module_exports(callback: ModuleExportsCallback) {
  MODULE_EXPORTS.push(callback);
}

pub fn register_module_export(
  js_mod: Option<&'static str>,
  name: &'static str,
  cb: ExportRegisterCallback,
) {
  MODULE_REGISTER_CALLBACK.push((js_mod, (name, cb)));
}

pub fn register_class(
  rust_name: &'static str,
  js_mod: Option<&'static str>,
  js_name: &'static str,
  props: Vec<Property>,
) {
  let map = MODULE_CLASS_PROPERTIES.borrow_mut();
  let val = map.entry(rust_name).or_default();
  let val = val.entry(js_mod).or_default();

  val.0 = js_name;
  val.1.extend(props.into_iter());
}

#[no_mangle]
unsafe extern "C" fn napi_register_module_v1(
  env: sys::napi_env,
  exports: sys::napi_value,
) -> sys::napi_value {
  let mut exports_objects: HashMap<Option<&'static str>, sys::napi_value> = HashMap::default();
  MODULE_REGISTER_CALLBACK
    .borrow_mut()
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
        let js_name = unsafe { CStr::from_bytes_with_nul_unchecked(name.as_bytes()) };
        unsafe {
          if let Err(e) = callback(env).and_then(|v| {
            check_status!(
              sys::napi_set_named_property(
                env,
                if exports_js_mod.is_null() {
                  exports
                } else {
                  exports_js_mod
                },
                js_name.as_ptr(),
                v
              ),
              "Failed to register export `{}`",
              name,
            )
          }) {
            JsError::from(e).throw_into(env)
          }
        }
      }
    });

  MODULE_CLASS_PROPERTIES
    .borrow_mut()
    .iter()
    .for_each(|(rust_name, js_mods)| {
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
                  js_mod_str.as_ptr() as *const _,
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

          let js_class_name = CStr::from_bytes_with_nul_unchecked(js_name.as_bytes());
          let mut class_ptr = ptr::null_mut();

          check_status_or_throw!(
            env,
            sys::napi_define_class(
              env,
              js_class_name.as_ptr(),
              js_name.len(),
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
            registered_class.insert(js_name, ctor_ref);
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
    });

  #[cfg(feature = "compat-mode")]
  MODULE_EXPORTS
    .borrow_mut()
    .iter()
    .for_each(|callback| unsafe {
      if let Err(e) = callback(env, exports) {
        JsError::from(e).throw_into(env);
      }
    });

  #[cfg(all(feature = "tokio_rt", feature = "napi4"))]
  {
    let _ = crate::tokio_runtime::RT.clone();
    crate::tokio_runtime::TOKIO_RT_REF_COUNT.fetch_add(1, Ordering::Relaxed);
    assert_eq!(
      unsafe {
        sys::napi_add_env_cleanup_hook(env, Some(crate::shutdown_tokio_rt), ptr::null_mut())
      },
      sys::Status::napi_ok
    );
  }

  exports
}

pub(crate) unsafe extern "C" fn noop(
  env: sys::napi_env,
  _info: sys::napi_callback_info,
) -> sys::napi_value {
  if !crate::bindgen_runtime::___CALL_FROM_FACTORY.load(std::sync::atomic::Ordering::Relaxed) {
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
