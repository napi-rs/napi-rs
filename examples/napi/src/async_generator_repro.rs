// Minimal reproduction of issue #3119: AsyncGenerator use-after-free during GC
// This matches the exact code from the bug report

use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::future::Future;

#[napi(async_iterator)]
pub struct CounterRepro {
  current: u32,
  max: u32,
}

#[napi]
impl CounterRepro {
  #[napi(constructor)]
  pub fn new(max: u32) -> Self {
    Self { current: 0, max }
  }
}

#[napi]
impl AsyncGenerator for CounterRepro {
  type Yield = u32;
  type Next = ();
  type Return = ();

  fn next(
    &mut self,
    _value: Option<Self::Next>,
  ) -> impl Future<Output = Result<Option<Self::Yield>>> + Send + 'static {
    let current = self.current;
    let max = self.max;
    self.current += 1;
    async move {
      // This sleep is critical - it triggers the async execution that exposes the bug
      // Removing this sleep prevents a crash, but the use-after-free is still there
      tokio::time::sleep(std::time::Duration::from_nanos(1)).await;
      if current >= max {
        Ok(None)
      } else {
        Ok(Some(current))
      }
    }
  }
}
