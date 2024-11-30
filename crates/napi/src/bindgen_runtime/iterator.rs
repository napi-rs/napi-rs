use std::ptr;
use std::{ffi::c_void, os::raw::c_char};

use crate::Value;
use crate::{bindgen_runtime::Unknown, check_status_or_throw, sys, Env};

use super::{FromNapiValue, ToNapiValue};

const GENERATOR_STATE_KEY: &str = "[[GeneratorState]]\0";

/// Implement a Iterator for the JavaScript Class.
/// This feature is an experimental feature and is not yet stable.
pub trait Generator {
  type Yield: ToNapiValue;
  type Next: FromNapiValue;
  type Return: FromNapiValue;

  /// Handle the `Generator.next()`
  /// <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Generator/next>
  fn next(&mut self, value: Option<Self::Next>) -> Option<Self::Yield>;

  #[allow(unused_variables)]
  /// Implement complete to handle the `Generator.return()`
  /// <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Generator/return>
  fn complete(&mut self, value: Option<Self::Return>) -> Option<Self::Yield> {
    None
  }

  #[allow(unused_variables)]
  /// Implement catch to handle the `Generator.throw()`
  /// <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Generator/throw>
  fn catch(&mut self, env: Env, value: Unknown) -> Result<Option<Self::Yield>, Unknown> {
    Err(value)
  }
}

#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub fn create_iterator<T: Generator>(
  env: sys::napi_env,
  instance: sys::napi_value,
  generator_ptr: *mut T,
) {
  let mut global = ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe { sys::napi_get_global(env, &mut global) },
    "Get global object failed",
  );
  let mut symbol_object = ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe {
      sys::napi_get_named_property(env, global, c"Symbol".as_ptr().cast(), &mut symbol_object)
    },
    "Get global object failed",
  );
  let mut iterator_symbol = ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe {
      sys::napi_get_named_property(
        env,
        symbol_object,
        c"iterator".as_ptr().cast(),
        &mut iterator_symbol,
      )
    },
    "Get Symbol.iterator failed",
  );
  let mut generator_function = ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe {
      sys::napi_create_function(
        env,
        c"Iterator".as_ptr().cast(),
        8,
        Some(symbol_generator::<T>),
        generator_ptr as *mut c_void,
        &mut generator_function,
      )
    },
    "Create iterator function failed",
  );
  check_status_or_throw!(
    env,
    unsafe { sys::napi_set_property(env, instance, iterator_symbol, generator_function) },
    "Failed to set Symbol.iterator on class instance",
  );
}

#[doc(hidden)]
pub unsafe extern "C" fn symbol_generator<T: Generator>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> sys::napi_value {
  let mut this = ptr::null_mut();
  let mut argv: [sys::napi_value; 1] = [ptr::null_mut()];
  let mut argc = 0;
  let mut generator_ptr = ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe {
      sys::napi_get_cb_info(
        env,
        info,
        &mut argc,
        argv.as_mut_ptr(),
        &mut this,
        &mut generator_ptr,
      )
    },
    "Get callback info from generator function failed"
  );
  let mut generator_object = ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe { sys::napi_create_object(env, &mut generator_object) },
    "Create Generator object failed"
  );
  let mut next_function = ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe {
      sys::napi_create_function(
        env,
        c"next".as_ptr().cast(),
        4,
        Some(generator_next::<T>),
        generator_ptr,
        &mut next_function,
      )
    },
    "Create next function failed"
  );
  let mut return_function = ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe {
      sys::napi_create_function(
        env,
        c"return".as_ptr().cast(),
        6,
        Some(generator_return::<T>),
        generator_ptr,
        &mut return_function,
      )
    },
    "Create next function failed"
  );
  let mut throw_function = ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe {
      sys::napi_create_function(
        env,
        c"throw".as_ptr().cast(),
        5,
        Some(generator_throw::<T>),
        generator_ptr,
        &mut throw_function,
      )
    },
    "Create next function failed"
  );

  check_status_or_throw!(
    env,
    unsafe {
      sys::napi_set_named_property(
        env,
        generator_object,
        c"next".as_ptr().cast(),
        next_function,
      )
    },
    "Set next function on Generator object failed"
  );

  check_status_or_throw!(
    env,
    unsafe {
      sys::napi_set_named_property(
        env,
        generator_object,
        c"return".as_ptr().cast(),
        return_function,
      )
    },
    "Set return function on Generator object failed"
  );

  check_status_or_throw!(
    env,
    unsafe {
      sys::napi_set_named_property(
        env,
        generator_object,
        c"throw".as_ptr().cast(),
        throw_function,
      )
    },
    "Set throw function on Generator object failed"
  );

  let mut generator_state = ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe { sys::napi_get_boolean(env, false, &mut generator_state) },
    "Create generator state failed"
  );

  let properties = [sys::napi_property_descriptor {
    utf8name: GENERATOR_STATE_KEY.as_ptr().cast(),
    name: ptr::null_mut(),
    method: None,
    getter: None,
    setter: None,
    value: generator_state,
    attributes: sys::PropertyAttributes::writable,
    data: ptr::null_mut(),
  }];

  check_status_or_throw!(
    env,
    unsafe { sys::napi_define_properties(env, generator_object, 1, properties.as_ptr()) },
    "Define properties on Generator object failed"
  );

  generator_object
}

extern "C" fn generator_next<T: Generator>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> sys::napi_value {
  let mut this = ptr::null_mut();
  let mut argv: [sys::napi_value; 1] = [ptr::null_mut()];
  let mut argc = 1;
  let mut generator_ptr = ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe {
      sys::napi_get_cb_info(
        env,
        info,
        &mut argc,
        argv.as_mut_ptr(),
        &mut this,
        &mut generator_ptr,
      )
    },
    "Get callback info from generator function failed"
  );
  let mut generator_state = ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe {
      sys::napi_get_named_property(
        env,
        this,
        GENERATOR_STATE_KEY.as_ptr().cast(),
        &mut generator_state,
      )
    },
    "Get generator state failed"
  );
  let mut completed = false;
  check_status_or_throw!(
    env,
    unsafe { sys::napi_get_value_bool(env, generator_state, &mut completed) },
    "Get generator state failed"
  );
  let mut result = std::ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe { sys::napi_create_object(env, &mut result) },
    "Failed to create iterator result object",
  );
  if !completed {
    let g = unsafe { Box::leak(Box::from_raw(generator_ptr as *mut T)) };
    let item = if argc == 0 {
      g.next(None)
    } else {
      g.next(match unsafe { T::Next::from_napi_value(env, argv[0]) } {
        Ok(input) => Some(input),
        Err(e) => {
          unsafe {
            sys::napi_throw_error(
              env,
              format!("{}", e.status).as_ptr() as *mut c_char,
              e.reason.as_ptr() as *mut c_char,
            )
          };
          None
        }
      })
    };

    if let Some(value) = item {
      set_generator_value(env, result, value);
    } else {
      completed = true;
    }
  }
  let mut completed_value = ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe { sys::napi_get_boolean(env, completed, &mut completed_value) },
    "Failed to create completed value"
  );
  check_status_or_throw!(
    env,
    unsafe {
      sys::napi_set_named_property(
        env,
        result,
        c"done".as_ptr() as *const std::os::raw::c_char,
        completed_value,
      )
    },
    "Failed to set iterator result done",
  );

  result
}

extern "C" fn generator_return<T: Generator>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> sys::napi_value {
  let mut this = ptr::null_mut();
  let mut argv: [sys::napi_value; 1] = [ptr::null_mut()];
  let mut argc = 1;
  let mut generator_ptr = ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe {
      sys::napi_get_cb_info(
        env,
        info,
        &mut argc,
        argv.as_mut_ptr(),
        &mut this,
        &mut generator_ptr,
      )
    },
    "Get callback info from generator function failed"
  );

  let g = unsafe { Box::leak(Box::from_raw(generator_ptr as *mut T)) };
  if argc == 0 {
    g.complete(None);
  } else {
    g.complete(Some(
      match unsafe { T::Return::from_napi_value(env, argv[0]) } {
        Ok(input) => input,
        Err(e) => {
          unsafe {
            sys::napi_throw_error(
              env,
              format!("{}", e.status).as_ptr() as *mut c_char,
              e.reason.as_ptr() as *mut c_char,
            )
          };
          return ptr::null_mut();
        }
      },
    ));
  }
  let mut generator_state = ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe { sys::napi_get_boolean(env, true, &mut generator_state) },
    "Create generator state failed"
  );
  check_status_or_throw!(
    env,
    unsafe {
      sys::napi_set_named_property(
        env,
        this,
        GENERATOR_STATE_KEY.as_ptr().cast(),
        generator_state,
      )
    },
    "Get generator state failed"
  );
  let mut result = std::ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe { sys::napi_create_object(env, &mut result) },
    "Failed to create iterator result object",
  );
  if argc > 0 {
    check_status_or_throw!(
      env,
      unsafe {
        sys::napi_set_named_property(
          env,
          result,
          c"value".as_ptr() as *const std::os::raw::c_char,
          argv[0],
        )
      },
      "Failed to set iterator result value",
    );
  }
  check_status_or_throw!(
    env,
    unsafe {
      sys::napi_set_named_property(
        env,
        result,
        c"done".as_ptr() as *const std::os::raw::c_char,
        generator_state,
      )
    },
    "Failed to set iterator result done",
  );

  result
}

extern "C" fn generator_throw<T: Generator>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> sys::napi_value {
  let mut this = ptr::null_mut();
  let mut argv: [sys::napi_value; 1] = [ptr::null_mut()];
  let mut argc = 1;
  let mut generator_ptr = ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe {
      sys::napi_get_cb_info(
        env,
        info,
        &mut argc,
        argv.as_mut_ptr(),
        &mut this,
        &mut generator_ptr,
      )
    },
    "Get callback info from generator function failed"
  );

  let g = unsafe { Box::leak(Box::from_raw(generator_ptr as *mut T)) };
  let catch_result = if argc == 0 {
    let mut undefined = ptr::null_mut();
    check_status_or_throw!(
      env,
      unsafe { sys::napi_get_undefined(env, &mut undefined) },
      "Get undefined failed"
    );
    g.catch(
      Env(env),
      Unknown(Value {
        env,
        value: undefined,
        value_type: crate::ValueType::Undefined,
      }),
    )
  } else {
    g.catch(
      Env(env),
      Unknown(Value {
        env,
        value: argv[0],
        value_type: crate::ValueType::Unknown,
      }),
    )
  };
  let mut result = ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe { sys::napi_create_object(env, &mut result) },
    "Failed to create iterator result object",
  );
  let mut generator_state = ptr::null_mut();
  let mut generator_state_value = false;
  match catch_result {
    Err(e) => {
      generator_state_value = true;
      check_status_or_throw!(
        env,
        unsafe { sys::napi_get_boolean(env, generator_state_value, &mut generator_state) },
        "Create generator state failed"
      );
      check_status_or_throw!(
        env,
        unsafe {
          sys::napi_set_named_property(
            env,
            this,
            GENERATOR_STATE_KEY.as_ptr().cast(),
            generator_state,
          )
        },
        "Get generator state failed"
      );
      let throw_status = unsafe { sys::napi_throw(env, e.0.value) };
      debug_assert!(
        throw_status == sys::Status::napi_ok,
        "Failed to throw error {}",
        crate::Status::from(throw_status)
      );
      return ptr::null_mut();
    }
    Ok(Some(v)) => {
      set_generator_value(env, result, v);
    }
    Ok(None) => {
      generator_state_value = true;
    }
  }
  check_status_or_throw!(
    env,
    unsafe { sys::napi_get_boolean(env, generator_state_value, &mut generator_state) },
    "Create generator state failed"
  );
  check_status_or_throw!(
    env,
    unsafe {
      sys::napi_set_named_property(
        env,
        this,
        GENERATOR_STATE_KEY.as_ptr().cast(),
        generator_state,
      )
    },
    "Get generator state failed"
  );
  check_status_or_throw!(
    env,
    unsafe { sys::napi_set_named_property(env, result, c"done".as_ptr().cast(), generator_state) },
    "Get generator state failed"
  );

  result
}

fn set_generator_value<V: ToNapiValue>(env: sys::napi_env, result: sys::napi_value, value: V) {
  match unsafe { ToNapiValue::to_napi_value(env, value) } {
    Ok(val) => {
      check_status_or_throw!(
        env,
        unsafe {
          sys::napi_set_named_property(
            env,
            result,
            c"value".as_ptr() as *const std::os::raw::c_char,
            val,
          )
        },
        "Failed to set iterator result value",
      );
    }
    Err(e) => {
      unsafe {
        sys::napi_throw_error(
          env,
          format!("{}", e.status).as_ptr() as *mut c_char,
          e.reason.as_ptr() as *mut c_char,
        )
      };
    }
  }
}
