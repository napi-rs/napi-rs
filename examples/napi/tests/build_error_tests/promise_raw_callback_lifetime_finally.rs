use napi::bindgen_prelude::PromiseRaw;

fn retain_borrowed_callback<'a>(promise: &mut PromiseRaw<'_, ()>, borrowed: &'a str) {
  let _ = promise.finally(move |_| Ok(borrowed.len() as u32));
}

fn main() {}
