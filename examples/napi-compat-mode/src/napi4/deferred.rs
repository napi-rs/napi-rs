use std::thread;

use napi::{bindgen_prelude::Object, CallContext, Error, Result};

#[js_function(1)]
pub fn test_deferred(ctx: CallContext) -> Result<Object> {
  let reject: bool = ctx.get(0)?;
  let (deferred, promise) = ctx.env.create_deferred()?;

  thread::spawn(move || {
    thread::sleep(std::time::Duration::from_millis(10));
    if reject {
      deferred.reject(Error::from_reason("Fail"));
    } else {
      deferred.resolve(|_| Ok(15));
    }
  });

  Ok(promise)
}
