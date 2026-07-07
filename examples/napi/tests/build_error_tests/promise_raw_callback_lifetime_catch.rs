use napi::bindgen_prelude::{CallbackContext, PromiseRaw};

fn retain_borrowed_callback<'a>(promise: &PromiseRaw<'_, ()>, borrowed: &'a str) {
  let _ = promise.catch(move |_: CallbackContext<()>| Ok(borrowed.len() as u32));
}

fn main() {}
