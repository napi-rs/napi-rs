use std::{cell::RefCell, collections::HashMap, ffi::CString, ptr};

use crate::{check_status, check_status_or_throw, sys, JsError, Property, Result};

pub type ExportRegisterCallback = unsafe fn(sys::napi_env) -> Result<sys::napi_value>;
pub type ModuleExportsCallback =
  unsafe fn(env: sys::napi_env, exports: sys::napi_value) -> Result<()>;

thread_local! {
  static MODULE_REGISTER_CALLBACK: RefCell<Vec<(&'static str, ExportRegisterCallback)>> = Default::default();
  static MODULE_CLASS_PROPERTIES: RefCell<HashMap<&'static str, (&'static str, Vec<Property>)>> = Default::default();
  static REGISTERED_CLASSES: RefCell<HashMap<
    /* export name */ &'static str,
    /* constructor */ sys::napi_ref,
  >> = Default::default();
  // compatibility for #[module_exports]
  #[cfg(feature = "compat-mode")]
  static MODULE_EXPORTS: std::cell::Cell<Vec<ModuleExportsCallback>> = Default::default();
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
  MODULE_EXPORTS.with(|cell| cell.set(vec![callback]));
}

pub fn register_module_export(name: &'static str, cb: ExportRegisterCallback) {
  MODULE_REGISTER_CALLBACK.with(|exports| {
    let mut list = exports.borrow_mut();
    list.push((name, cb));
  });
}

pub fn register_class(rust_name: &'static str, js_name: &'static str, props: Vec<Property>) {
  MODULE_CLASS_PROPERTIES.with(|map| {
    let mut map = map.borrow_mut();
    let val = map.entry(rust_name).or_default();

    val.0 = js_name;
    val.1.extend(props.into_iter());
  });
}

#[no_mangle]
unsafe extern "C" fn napi_register_module_v1(
  env: sys::napi_env,
  exports: sys::napi_value,
) -> sys::napi_value {
  MODULE_REGISTER_CALLBACK.with(|to_register_exports| {
    to_register_exports
      .take()
      .into_iter()
      .for_each(|(name, callback)| {
        let js_name = CString::new(name).unwrap();
        unsafe {
          if let Err(e) = callback(env).and_then(|v| {
            check_status!(
              sys::napi_set_named_property(env, exports, js_name.as_ptr(), v),
              "Failed to register export `{}`",
              name,
            )
          }) {
            JsError::from(e).throw_into(env)
          }
        }
      })
  });

  MODULE_CLASS_PROPERTIES.with(|to_register_classes| {
    for (rust_name, (js_name, props)) in to_register_classes.take().into_iter() {
      unsafe {
        let (ctor, props): (Vec<_>, Vec<_>) = props.into_iter().partition(|prop| prop.is_ctor);
        // one or more?
        let ctor = ctor[0].raw().method.unwrap();
        let raw_props: Vec<_> = props.iter().map(|prop| prop.raw()).collect();

        let js_class_name = CString::new(js_name).unwrap();
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
          sys::napi_set_named_property(env, exports, js_class_name.as_ptr(), class_ptr),
          "Failed to register class `{}` generate by struct `{}`",
          &js_name,
          &rust_name
        );
      }
    }
  });

  #[cfg(feature = "compat-mode")]
  MODULE_EXPORTS.with(|callbacks| {
    for callback in callbacks.take().into_iter() {
      if let Err(e) = callback(env, exports) {
        JsError::from(e).throw_into(env);
      }
    }
  });

  #[cfg(all(feature = "tokio_rt", feature = "napi4"))]
  if let Err(e) = check_status!(
    sys::napi_add_env_cleanup_hook(env, Some(crate::shutdown_tokio_rt), ptr::null_mut()),
    "Failed to initialize module",
  ) {
    JsError::from(e).throw_into(env);
  }

  exports
}
