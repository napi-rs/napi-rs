use napi::{
  threadsafe_function::{ThreadSafeCallContext, ThreadsafeFunction},
  Env, JsFunction, JsObject,
};

pub(crate) struct SafeCallContext(napi::CallContext);

unsafe impl Send for SafeCallContext {}
unsafe impl Sync for SafeCallContext {}

#[napi]
pub fn callback_args_with_call_emit(env: Env, callback: JsFunction) -> napi::Result<JsObject> {
  let ts_fn: ThreadsafeFunction<_, napi::threadsafe_function::ErrorStrategy::CalleeHandled> =
    callback.create_threadsafe_function(0, move |ts_ctx: ThreadSafeCallContext<i32>| {
      let env = ts_ctx.env;
      let mut obj = ts_ctx.env.create_object()?;

      let call_emit = env.create_function_from_closure("_", move |ctx| {
        let rt: tokio::runtime::Runtime = tokio::runtime::Builder::new_multi_thread()
          .enable_all()
          .build()
          .unwrap();
        let s_ctx = SafeCallContext(ctx);

        rt.block_on(async move {
          let s = s_ctx;
          let mut counter = 0;

          loop {
            counter += 1;
            let c = s.0.clone();
            let emitter = c.get::<JsFunction>(0)?;
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            if counter < 5 {
              emitter.call(
                None,
                &[
                  c.env.create_string("data".as_ref())?,
                  c.env.create_string("Hello,World".as_ref())?,
                ],
              )?;
            } else {
              emitter.call(None, &[c.env.create_string("end".as_ref())?])?;
              break;
            }
          }

          Ok::<(), napi::Error>(())
        })
      })?;

      obj.set("_callEmit", call_emit)?;

      Ok(vec![obj])
    })?;

  env.execute_tokio_future(
    async move {
      let _ = ts_fn.call_async::<i32>(Ok(1)).await;
      Ok::<(), napi::Error>(())
    },
    |env, _| env.get_undefined(),
  )
}

#[napi]
pub fn emitter_sync(env: Env, callback: JsFunction) -> napi::Result<()> {
  let mut counter = 0;

  loop {
    counter += 1;

    if counter < 5 {
      callback.call(
        None,
        &[
          env.create_string("data".as_ref())?,
          env.create_string("Hello,World".as_ref())?,
        ],
      )?;
    } else {
      callback.call(None, &[env.create_string("end".as_ref())?])?;
      break;
    }
  }

  Ok(())
}
