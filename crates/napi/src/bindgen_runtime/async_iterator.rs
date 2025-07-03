use std::future::Future;
use std::ptr;

use crate::{
  bindgen_runtime::{FromNapiValue, Object, ToNapiValue, Unknown},
  check_status, check_status_or_throw, sys, Env, JsError, Value,
};

/// Implement a Iterator for the JavaScript Class.
/// This feature is an experimental feature and is not yet stable.
pub trait AsyncGenerator {
  type Yield: ToNapiValue + Send + 'static;
  type Next: FromNapiValue;
  type Return: FromNapiValue;

  /// Handle the `AsyncGenerator.next()`
  /// <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncGenerator/next>
  fn next(
    &mut self,
    value: Option<Self::Next>,
  ) -> impl Future<Output = crate::Result<Option<Self::Yield>>> + Send + 'static;

  #[allow(unused_variables)]
  /// Implement complete to handle the `AsyncGenerator.return()`
  /// <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncGenerator/return>
  fn complete(
    &mut self,
    value: Option<Self::Return>,
  ) -> impl Future<Output = crate::Result<Option<Self::Yield>>> + Send + 'static {
    async move { Ok(None) }
  }

  #[allow(unused_variables)]
  /// Implement catch to handle the `AsyncGenerator.throw()`
  /// <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncGenerator/throw>
  fn catch(
    &mut self,
    env: Env,
    value: Unknown,
  ) -> impl Future<Output = crate::Result<Option<Self::Yield>>> + Send + 'static {
    let err = value.into();
    async move { Err(err) }
  }
}

#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub fn create_async_iterator<T: AsyncGenerator>(
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
        c"asyncIterator".as_ptr().cast(),
        &mut iterator_symbol,
      )
    },
    "Get Symbol.asyncIterator failed",
  );
  let mut generator_function = ptr::null_mut();
  check_status_or_throw!(
    env,
    unsafe {
      sys::napi_create_function(
        env,
        c"AsyncIterator".as_ptr().cast(),
        8,
        Some(symbol_async_generator::<T>),
        generator_ptr.cast(),
        &mut generator_function,
      )
    },
    "Create asyncIterator function failed",
  );
  check_status_or_throw!(
    env,
    unsafe { sys::napi_set_property(env, instance, iterator_symbol, generator_function) },
    "Failed to set Symbol.asyncIterator on class instance",
  );
}

#[doc(hidden)]
pub unsafe extern "C" fn symbol_async_generator<T: AsyncGenerator>(
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

  generator_object
}

extern "C" fn generator_next<T: AsyncGenerator>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> sys::napi_value {
  match generator_next_fn::<T>(env, info) {
    Ok(value) => value,
    Err(e) => unsafe {
      let js_error: JsError = e.into();
      js_error.throw_into(env);
      ptr::null_mut()
    },
  }
}

fn generator_next_fn<T: AsyncGenerator>(
  env: sys::napi_env,
  info: sys::napi_callback_info,
) -> crate::Result<sys::napi_value> {
  let mut this = ptr::null_mut();
  let mut argv: [sys::napi_value; 1] = [ptr::null_mut()];
  let mut argc = 1;
  let mut generator_ptr = ptr::null_mut();
  check_status!(
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
  )?;

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
            format!("{}", e.status).as_ptr().cast(),
            e.reason.as_ptr().cast(),
          )
        };
        None
      }
    })
  };

  let env = Env::from_raw(env);
  let promise = env.spawn_future_with_callback(item, |env, value| {
    if let Some(v) = value {
      let mut obj = Object::new(env)?;
      obj.set("value", v)?;
      obj.set("done", false)?;
      Ok(obj)
    } else {
      let mut obj = Object::new(env)?;
      obj.set("value", ())?;
      obj.set("done", true)?;
      Ok(obj)
    }
  })?;
  Ok(promise.inner)
}

extern "C" fn generator_return<T: AsyncGenerator>(
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
  match Env::from_raw(env).spawn_future_with_callback(
    g.complete(if argc == 0 {
      None
    } else {
      Some(match unsafe { T::Return::from_napi_value(env, argv[0]) } {
        Ok(input) => input,
        Err(e) => {
          unsafe {
            sys::napi_throw_error(
              env,
              format!("{}", e.status).as_ptr().cast(),
              e.reason.as_ptr().cast(),
            )
          };
          return ptr::null_mut();
        }
      })
    }),
    |env, value| {
      let mut obj = Object::new(env)?;
      if let Some(v) = value {
        obj.set("value", v)?;
        obj.set("done", false)?;
        Ok(obj)
      } else {
        obj.set("value", ())?;
        obj.set("done", true)?;
        Ok(obj)
      }
    },
  ) {
    Ok(promise) => promise.inner,
    Err(e) => {
      unsafe {
        sys::napi_throw_error(
          env,
          e.status.as_ref().as_ptr().cast(),
          e.reason.as_ptr().cast(),
        );
      }
      ptr::null_mut()
    }
  }
}

extern "C" fn generator_throw<T: AsyncGenerator>(
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
  let caught = if argc == 0 {
    let mut undefined = ptr::null_mut();
    check_status_or_throw!(
      env,
      unsafe { sys::napi_get_undefined(env, &mut undefined) },
      "Get undefined failed"
    );
    g.catch(
      Env(env),
      Unknown(
        Value {
          env,
          value: undefined,
          value_type: crate::ValueType::Undefined,
        },
        std::marker::PhantomData,
      ),
    )
  } else {
    g.catch(
      Env(env),
      Unknown(
        Value {
          env,
          value: argv[0],
          value_type: crate::ValueType::Unknown,
        },
        std::marker::PhantomData,
      ),
    )
  };
  match Env::from_raw(env).spawn_future_with_callback(caught, |env, value| {
    let mut obj = Object::new(env)?;
    obj.set("value", value)?;
    obj.set("done", false)?;
    Ok(obj)
  }) {
    Ok(promise) => promise.inner,
    Err(e) => {
      unsafe {
        sys::napi_throw_error(
          env,
          e.status.as_ref().as_ptr().cast(),
          e.reason.as_ptr().cast(),
        );
      }
      ptr::null_mut()
    }
  }
}
