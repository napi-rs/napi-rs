use std::{
  future::Future,
  sync::{
    atomic::{AtomicU32, Ordering},
    Arc,
  },
};

use napi::{bindgen_prelude::*, iterator::ScopedGenerator};

#[napi(iterator)]
pub struct Fib {
  current: u32,
  next: u32,
}

#[napi]
impl Generator for Fib {
  type Yield = u32;
  type Next = i32;
  type Return = ();

  fn next(&mut self, value: Option<Self::Next>) -> Option<Self::Yield> {
    match value {
      Some(n) => {
        self.current = n as u32;
        self.next = n as u32 + 1;
      }
      None => {
        let next = self.next;
        let current = self.current;
        self.current = next;
        self.next = current + next;
      }
    };
    Some(self.current)
  }
}

#[napi]
#[allow(clippy::new_without_default)]
impl Fib {
  #[napi(constructor)]
  pub fn new() -> Self {
    Fib {
      current: 0,
      next: 1,
    }
  }
}

#[napi(iterator)]
pub struct Fib2 {
  current: u32,
  next: u32,
}

#[napi]
impl Generator for Fib2 {
  type Yield = u32;
  type Next = i32;
  type Return = ();

  fn next(&mut self, value: Option<Self::Next>) -> Option<Self::Yield> {
    match value {
      Some(n) => {
        self.current = n as u32;
        self.next = n as u32 + 1;
      }
      None => {
        let next = self.next;
        let current = self.current;
        self.current = next;
        self.next = current + next;
      }
    };
    Some(self.current)
  }
}

#[napi]
impl Fib2 {
  #[napi(factory)]
  pub fn create(seed: u32) -> Self {
    Self {
      current: seed,
      next: seed + 1,
    }
  }
}

#[napi(iterator, constructor)]
pub struct Fib3 {
  pub current: u32,
  pub next_num: u32,
}

#[napi]
impl Generator for Fib3 {
  type Yield = u32;
  type Next = i32;
  type Return = ();

  fn next(&mut self, value: Option<Self::Next>) -> Option<Self::Yield> {
    match value {
      Some(n) => {
        self.current = n as u32;
        self.next_num = n as u32 + 1;
      }
      None => {
        let next = self.next_num;
        let current = self.current;
        self.current = next;
        self.next_num = current + next;
      }
    };
    Some(self.current)
  }
}

#[napi(iterator, constructor)]
pub struct Fib4 {
  pub current: u32,
  pub next_item: u32,
}

#[napi]
impl<'a> ScopedGenerator<'a> for Fib4 {
  type Yield = Unknown<'a>;
  type Next = i32;
  type Return = ();

  fn next(&mut self, env: &'a Env, value: Option<Self::Next>) -> Option<Self::Yield> {
    match value {
      Some(n) => {
        self.current = n as u32;
        self.next_item = n as u32 + 1;
      }
      None => {
        let next = self.next_item;
        let current = self.current;
        self.current = next;
        self.next_item = current + next;
      }
    };
    let mut obj = Object::new(env).ok();
    if let Some(ref mut val) = obj {
      val.set("number", self.current).ok()?;
    }
    obj.into_unknown(env).ok()
  }
}

#[napi]
impl Fib4 {
  #[napi(js_name = "toJSON")]
  pub fn to_json(&self) -> Vec<u32> {
    vec![self.current, self.next_item]
  }
}

// Async iterator example - demonstrates the async generator pattern.
// This example computes Fibonacci synchronously but returns via an async block,
// showing the basic structure needed for AsyncGenerator implementations.
#[napi(async_iterator)]
pub struct AsyncFib {
  current: u32,
  next: u32,
}

#[napi]
impl AsyncGenerator for AsyncFib {
  type Yield = u32;
  type Next = i32;
  type Return = ();

  fn next(
    &mut self,
    value: Option<Self::Next>,
  ) -> impl Future<Output = Result<Option<Self::Yield>>> + Send + 'static {
    // The returned Future must be 'static, so we cannot borrow `self` in the async block.
    // Instead, we compute the result synchronously here, update `self`, and capture
    // only the computed value in the async block. This is safe because:
    // 1. All mutations to `self` complete before creating the Future
    // 2. The async block only captures `result` (an owned value), not `self`
    let result = match value {
      Some(n) => {
        self.current = n as u32;
        self.next = n as u32 + 1;
        self.current
      }
      None => {
        let next = self.next;
        let current = self.current;
        self.current = next;
        self.next = current + next;
        self.current
      }
    };
    async move { Ok(Some(result)) }
  }
}

#[napi]
#[allow(clippy::new_without_default)]
impl AsyncFib {
  #[napi(constructor)]
  pub fn new() -> Self {
    AsyncFib {
      current: 0,
      next: 1,
    }
  }
}

// Truly async iterator - uses tokio::time::sleep for real async delays
#[napi(async_iterator)]
pub struct DelayedCounter {
  current: u32,
  max: u32,
  delay_ms: u64,
  probe: Option<Arc<SleepOverlapCounts>>,
}

#[napi]
impl AsyncGenerator for DelayedCounter {
  type Yield = u32;
  type Next = ();
  type Return = String;

  fn next(
    &mut self,
    _value: Option<Self::Next>,
  ) -> impl Future<Output = Result<Option<Self::Yield>>> + Send + 'static {
    let current = self.current;
    let max = self.max;
    let delay_ms = self.delay_ms;
    let probe = self.probe.clone();
    self.current += 1;

    async move {
      // Dropped when the sleep ends or the future is cancelled
      let _sleep_guard = probe.map(SleepOverlapGuard::new);
      // Actually sleep - this is truly async!
      tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;

      if current >= max {
        Ok(None) // Signal completion
      } else {
        Ok(Some(current))
      }
    }
  }
}

#[napi]
impl DelayedCounter {
  /// Creates a counter that yields values from 0 to max-1 with a delay between each
  #[napi(constructor)]
  pub fn new(max: u32, delay_ms: u32) -> Self {
    DelayedCounter {
      current: 0,
      max,
      delay_ms: delay_ms as u64,
      probe: None,
    }
  }

  /// Like the constructor, but every sleep is counted by `probe`
  #[napi(factory)]
  pub fn with_probe(max: u32, delay_ms: u32, probe: &SleepOverlapProbe) -> Self {
    DelayedCounter {
      current: 0,
      max,
      delay_ms: delay_ms as u64,
      probe: Some(probe.counts.clone()),
    }
  }
}

#[derive(Default)]
struct SleepOverlapCounts {
  in_flight: AtomicU32,
  max_in_flight: AtomicU32,
}

struct SleepOverlapGuard(Arc<SleepOverlapCounts>);

impl SleepOverlapGuard {
  fn new(counts: Arc<SleepOverlapCounts>) -> Self {
    let in_flight = counts.in_flight.fetch_add(1, Ordering::SeqCst) + 1;
    counts.max_in_flight.fetch_max(in_flight, Ordering::SeqCst);
    SleepOverlapGuard(counts)
  }
}

impl Drop for SleepOverlapGuard {
  fn drop(&mut self) {
    self.0.in_flight.fetch_sub(1, Ordering::SeqCst);
  }
}

/// Counts how many `DelayedCounter` sleeps are pending at the same time
#[napi]
pub struct SleepOverlapProbe {
  counts: Arc<SleepOverlapCounts>,
}

#[napi]
impl SleepOverlapProbe {
  #[allow(clippy::new_without_default)]
  #[napi(constructor)]
  pub fn new() -> Self {
    SleepOverlapProbe {
      counts: Arc::default(),
    }
  }

  /// The most sleeps that were pending at once
  #[napi(getter)]
  pub fn max_in_flight(&self) -> u32 {
    self.counts.max_in_flight.load(Ordering::SeqCst)
  }
}

// Async iterator that simulates fetching paginated data
#[napi(async_iterator)]
pub struct AsyncDataSource {
  data: Vec<String>,
  index: usize,
  delay_ms: u64,
}

#[napi]
impl AsyncGenerator for AsyncDataSource {
  type Yield = String;
  type Next = ();
  type Return = ();

  fn next(
    &mut self,
    _value: Option<Self::Next>,
  ) -> impl Future<Output = Result<Option<Self::Yield>>> + Send + 'static {
    let item = if self.index < self.data.len() {
      Some(self.data[self.index].clone())
    } else {
      None
    };
    self.index += 1;
    let delay_ms = self.delay_ms;

    async move {
      // Simulate async I/O delay
      tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
      Ok(item)
    }
  }
}

#[napi]
impl AsyncDataSource {
  /// Creates an async data source that yields each item with a simulated I/O delay
  #[napi(factory)]
  pub fn from_data(data: Vec<String>, delay_ms: u32) -> Self {
    AsyncDataSource {
      data,
      index: 0,
      delay_ms: delay_ms as u64,
    }
  }
}

#[napi]
pub type FallibleGeneratorArg = String;

#[napi]
pub type FallibleGeneratorYield = u32;

mod fallible_generator_types {
  use napi::bindgen_prelude::*;

  /// Helper conversion type for testing generator error paths with empty reason
  /// (`Error::from_status`, whose `String::new().as_ptr()` is dangling `0x1`)
  /// and interior NUL bytes.
  pub enum FallibleGeneratorArg {
    Ok(String),
  }

  impl FromNapiValue for FallibleGeneratorArg {
    unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
      let mode = unsafe { String::from_napi_value(env, napi_val)? };
      match mode.as_str() {
        "empty" => Err(Error::from_status(Status::InvalidArg)),
        "nul" => Err(Error::new(Status::InvalidArg, "before\0after".to_owned())),
        "reason" => Err(Error::new(
          Status::InvalidArg,
          "exact-error-reason".to_owned(),
        )),
        _ => Ok(Self::Ok(mode)),
      }
    }
  }

  pub enum FallibleGeneratorYield {
    Ok(u32),
    EmptyErr,
    NulErr,
  }

  impl ToNapiValue for FallibleGeneratorYield {
    unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
      match val {
        Self::Ok(n) => unsafe { u32::to_napi_value(env, n) },
        Self::EmptyErr => Err(Error::from_status(Status::GenericFailure)),
        Self::NulErr => Err(Error::new(
          Status::GenericFailure,
          "yield\0error".to_owned(),
        )),
      }
    }
  }
}

#[napi(iterator)]
pub struct FailingGenerator {
  next_calls: u32,
  return_calls: u32,
}

#[napi]
#[allow(clippy::new_without_default)]
impl FailingGenerator {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self {
      next_calls: 0,
      return_calls: 0,
    }
  }

  #[napi(getter)]
  pub fn next_calls(&self) -> u32 {
    self.next_calls
  }

  #[napi(getter)]
  pub fn return_calls(&self) -> u32 {
    self.return_calls
  }
}

#[napi]
impl Generator for FailingGenerator {
  type Yield = fallible_generator_types::FallibleGeneratorYield;
  type Next = fallible_generator_types::FallibleGeneratorArg;
  type Return = fallible_generator_types::FallibleGeneratorArg;

  fn next(&mut self, value: Option<Self::Next>) -> Option<Self::Yield> {
    self.next_calls += 1;
    match value {
      Some(fallible_generator_types::FallibleGeneratorArg::Ok(mode)) if mode == "yield-empty" => {
        Some(fallible_generator_types::FallibleGeneratorYield::EmptyErr)
      }
      Some(fallible_generator_types::FallibleGeneratorArg::Ok(mode)) if mode == "yield-nul" => {
        Some(fallible_generator_types::FallibleGeneratorYield::NulErr)
      }
      _ => Some(fallible_generator_types::FallibleGeneratorYield::Ok(
        self.next_calls,
      )),
    }
  }

  fn complete(&mut self, _value: Option<Self::Return>) -> Option<Self::Yield> {
    self.return_calls += 1;
    None
  }

  fn catch<'env>(
    &'env mut self,
    env: Env,
    value: Unknown<'env>,
  ) -> std::result::Result<Option<Self::Yield>, Unknown<'env>> {
    if let Ok(mode) = value.coerce_to_string().and_then(|s| s.into_utf8()) {
      if mode.as_str().ok() == Some("yield-nul") {
        return Ok(Some(
          fallible_generator_types::FallibleGeneratorYield::NulErr,
        ));
      }
      if mode.as_str().ok() == Some("yield-empty") {
        return Ok(Some(
          fallible_generator_types::FallibleGeneratorYield::EmptyErr,
        ));
      }
      if mode.as_str().ok() == Some("pending") {
        let _ = env.throw_error("pending-catch-error", Some("PendingCatchCode"));
        return Err(value);
      }
    }
    Err(value)
  }
}

#[napi(async_iterator)]
pub struct FailingAsyncGenerator {
  next_calls: u32,
  return_calls: u32,
}

#[napi]
#[allow(clippy::new_without_default)]
impl FailingAsyncGenerator {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self {
      next_calls: 0,
      return_calls: 0,
    }
  }

  #[napi(getter)]
  pub fn next_calls(&self) -> u32 {
    self.next_calls
  }

  #[napi(getter)]
  pub fn return_calls(&self) -> u32 {
    self.return_calls
  }
}

#[napi]
impl AsyncGenerator for FailingAsyncGenerator {
  type Yield = u32;
  type Next = fallible_generator_types::FallibleGeneratorArg;
  type Return = fallible_generator_types::FallibleGeneratorArg;

  fn next(
    &mut self,
    _value: Option<Self::Next>,
  ) -> impl Future<Output = Result<Option<Self::Yield>>> + Send + 'static {
    self.next_calls += 1;
    let count = self.next_calls;
    async move { Ok(Some(count)) }
  }

  fn complete(
    &mut self,
    _value: Option<Self::Return>,
  ) -> impl Future<Output = Result<Option<Self::Yield>>> + Send + 'static {
    self.return_calls += 1;
    async move { Ok(None) }
  }
}
