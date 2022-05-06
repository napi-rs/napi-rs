use std::thread;

use napi::{
  bindgen_prelude::*,
  threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode},
  JsBoolean, JsNumber, JsString, JsUndefined,
};

pub fn call_threadsafe_function(callback: JsFunction) -> Result<()> {
  let tsfn: ThreadsafeFunction<u32, ErrorStrategy::CalleeHandled> = callback
    .create_threadsafe_function(
      0,
      |ctx| ctx.env.create_uint32(ctx.value + 1).map(|v| vec![v]),
      |res: Promise<u32>| {},
    )?;
  for n in 0..1 {
    let tsfn = tsfn.clone();
    thread::spawn(move || {
      tsfn.call(Ok(n), ThreadsafeFunctionCallMode::Blocking);
    });
  }
  Ok(())
}
#[doc(hidden)]
#[allow(non_snake_case)]
#[allow(clippy::all)]
extern "C" fn __napi__call_threadsafe_function(
  env: napi::bindgen_prelude::sys::napi_env,
  cb: napi::bindgen_prelude::sys::napi_callback_info,
) -> napi::bindgen_prelude::sys::napi_value {
  unsafe {
    napi::bindgen_prelude::CallbackInfo::<1usize>::new(env, cb, None)
      .and_then(|mut cb| {
        let arg0 = {
          <JsFunction as napi::bindgen_prelude::FromNapiValue>::from_napi_value(
            env,
            cb.get_arg(0usize),
          )?
        };
        let _ret = { call_threadsafe_function(arg0) };
        match _ret {
          Ok(value) => napi::bindgen_prelude::ToNapiValue::to_napi_value(env, value),
          Err(err) => {
            napi::bindgen_prelude::JsError::from(err).throw_into(env);
            Ok(std::ptr::null_mut())
          }
        }
      })
      .unwrap_or_else(|e| {
        napi::bindgen_prelude::JsError::from(e).throw_into(env);
        std::ptr::null_mut::<napi::bindgen_prelude::sys::napi_value__>()
      })
  }
}
#[allow(non_snake_case)]
#[allow(clippy::all)]
unsafe fn call_threadsafe_function_js_function(
  env: napi::bindgen_prelude::sys::napi_env,
) -> napi::bindgen_prelude::Result<napi::bindgen_prelude::sys::napi_value> {
  let mut fn_ptr = std::ptr::null_mut();
  napi::bindgen_prelude::check_status!(
    napi::bindgen_prelude::sys::napi_create_function(
      env,
      "callThreadsafeFunction\u{0}".as_ptr() as *const _,
      23usize,
      Some(__napi__call_threadsafe_function),
      std::ptr::null_mut(),
      &mut fn_ptr,
    ),
    "Failed to register function `{}`",
    "call_threadsafe_function",
  )?;
  napi::bindgen_prelude::register_js_function(
    "callThreadsafeFunction\u{0}",
    call_threadsafe_function_js_function,
    Some(__napi__call_threadsafe_function),
  );
  Ok(fn_ptr)
}
#[allow(clippy::all)]
#[allow(non_snake_case)]
#[cfg(all(not(test), not(feature = "noop")))]
#[napi::bindgen_prelude::ctor]
fn __napi_register__call_threadsafe_function() {
  napi::bindgen_prelude::register_module_export(
    None,
    "callThreadsafeFunction\u{0}",
    call_threadsafe_function_js_function,
  );
}

// #[napi]
// pub fn call_threadsafe_function(callback: JsFunction) -> Result<()> {
//   let tsfn: ThreadsafeFunction<u32, ErrorStrategy::CalleeHandled> = callback
//     .create_threadsafe_function(
//       0,
//       |ctx| ctx.env.create_uint32(ctx.value + 1).map(|v| vec![v]),
//       |res: Promise<u32>| {
//         // println!("value from node {}", res.get_int32().unwrap());
//       },
//     )?;
//   for n in 0..1 {
//     let tsfn = tsfn.clone();
//     thread::spawn(move || {
//       tsfn.call(Ok(n), ThreadsafeFunctionCallMode::Blocking);
//     });
//   }
//   Ok(())
// }

// #[napi]
// pub fn threadsafe_function_throw_error(cb: JsFunction) -> Result<()> {
//   let tsfn: ThreadsafeFunction<bool, ErrorStrategy::CalleeHandled> = cb
//     .create_threadsafe_function(
//       0,
//       |ctx| ctx.env.get_boolean(ctx.value).map(|v| vec![v]),
//       |_: JsUndefined| (),
//     )?;
//   thread::spawn(move || {
//     tsfn.call(
//       Err(Error::new(
//         Status::GenericFailure,
//         "ThrowFromNative".to_owned(),
//       )),
//       ThreadsafeFunctionCallMode::Blocking,
//     );
//   });
//   Ok(())
// }
//
// #[napi]
// pub fn threadsafe_function_fatal_mode(cb: JsFunction) -> Result<()> {
//   let tsfn: ThreadsafeFunction<bool, ErrorStrategy::Fatal> = cb.create_threadsafe_function(
//     0,
//     |ctx| ctx.env.get_boolean(ctx.value).map(|v| vec![v]),
//     |_: JsUndefined| (),
//   )?;
//   thread::spawn(move || {
//     tsfn.call(true, ThreadsafeFunctionCallMode::Blocking);
//   });
//   Ok(())
// }
//
// #[napi]
// pub fn threadsafe_function_fatal_mode_error(cb: JsFunction) -> Result<()> {
//   let tsfn: ThreadsafeFunction<bool, ErrorStrategy::Fatal> = cb.create_threadsafe_function(
//     0,
//     |_ctx| {
//       Err::<Vec<JsBoolean>, Error>(Error::new(
//         Status::GenericFailure,
//         "Generic tsfn error".to_owned(),
//       ))
//     },
//     |_: JsUndefined| (),
//   )?;
//   thread::spawn(move || {
//     tsfn.call(true, ThreadsafeFunctionCallMode::Blocking);
//   });
//   Ok(())
// }
