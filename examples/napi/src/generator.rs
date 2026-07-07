use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::sync::{Arc, Mutex};

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

#[napi(iterator)]
pub struct ComplexTypeGenerator {
  current: u32,
}

#[napi]
impl Generator for ComplexTypeGenerator {
  type Yield = [u32; 2];
  type Next = HashMap<String, u32>;
  type Return = (String, u32);

  fn next(&mut self, value: Option<Self::Next>) -> Option<Self::Yield> {
    let previous = self.current;
    self.current += value
      .map(|entries| entries.into_values().sum())
      .unwrap_or(1);
    Some([previous, self.current])
  }
}

#[napi]
#[allow(clippy::new_without_default)]
impl ComplexTypeGenerator {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self { current: 0 }
  }
}

#[napi(iterator)]
pub struct ReentrantGenerator {
  calls: u32,
}

#[napi]
impl<'a> ScopedGenerator<'a> for ReentrantGenerator {
  type Yield = u32;
  type Next = Function<'a, (), ()>;
  type Return = ();

  fn next(&mut self, _env: &'a Env, callback: Option<Self::Next>) -> Option<Self::Yield> {
    self.calls += 1;
    callback
      .map(|callback| callback.call(()))
      .transpose()
      .ok()?;
    Some(self.calls)
  }
}

#[napi]
impl ReentrantGenerator {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self { calls: 0 }
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

#[napi(async_iterator)]
pub struct AsyncComplexTypeGenerator {
  current: u32,
}

#[napi]
impl AsyncGenerator for AsyncComplexTypeGenerator {
  type Yield = [u32; 2];
  type Next = HashMap<String, u32>;
  type Return = (u32, u32);

  fn next(
    &mut self,
    value: Option<Self::Next>,
  ) -> impl Future<Output = Result<Option<Self::Yield>>> + Send + 'static {
    let previous = self.current;
    self.current += value
      .map(|entries| entries.into_values().sum())
      .unwrap_or(1);
    let current = self.current;
    async move { Ok(Some([previous, current])) }
  }

  fn complete(
    &mut self,
    value: Option<Self::Return>,
  ) -> impl Future<Output = Result<Option<Self::Yield>>> + Send + 'static {
    async move { Ok(value.map(|(first, second)| [first, second])) }
  }
}

#[napi]
#[allow(clippy::new_without_default)]
impl AsyncComplexTypeGenerator {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self { current: 0 }
  }
}

#[napi(async_iterator)]
pub struct AsyncReentrantGenerator {
  env: usize,
  calls: u32,
}

#[napi]
impl AsyncGenerator for AsyncReentrantGenerator {
  type Yield = u32;
  type Next = FunctionRef<(), ()>;
  type Return = ();

  fn next(
    &mut self,
    callback: Option<Self::Next>,
  ) -> impl Future<Output = Result<Option<Self::Yield>>> + Send + 'static {
    self.calls += 1;
    let value = self.calls;
    let callback_result = callback
      .map(|callback| {
        let env = Env::from_raw(self.env as napi::sys::napi_env);
        callback.borrow_back(&env)?.call(())
      })
      .transpose();
    async move {
      callback_result?;
      Ok(Some(value))
    }
  }
}

#[napi]
impl AsyncReentrantGenerator {
  #[napi(constructor)]
  pub fn new(env: Env) -> Self {
    Self {
      env: env.raw() as usize,
      calls: 0,
    }
  }
}

#[napi(async_iterator)]
pub struct AsyncGeneratorSetupFailure {
  panic_in: String,
}

#[napi]
impl AsyncGenerator for AsyncGeneratorSetupFailure {
  type Yield = u32;
  type Next = i32;
  type Return = i32;

  fn next(
    &mut self,
    _value: Option<Self::Next>,
  ) -> impl Future<Output = Result<Option<Self::Yield>>> + Send + 'static {
    if self.panic_in == "next" {
      panic!("intentional async generator next setup panic");
    }
    async { Ok(Some(1)) }
  }

  fn complete(
    &mut self,
    _value: Option<Self::Return>,
  ) -> impl Future<Output = Result<Option<Self::Yield>>> + Send + 'static {
    if self.panic_in == "return" {
      panic!("intentional async generator return setup panic");
    }
    async { Ok(None) }
  }

  fn catch(
    &mut self,
    _env: Env,
    value: Unknown,
  ) -> impl Future<Output = Result<Option<Self::Yield>>> + Send + 'static {
    if self.panic_in == "throw-pending-exception" {
      let _ = value.coerce_to_string();
    }
    if self.panic_in == "throw" {
      panic!("intentional async generator throw setup panic");
    }
    async { Ok(None) }
  }
}

#[napi]
impl AsyncGeneratorSetupFailure {
  #[napi(constructor)]
  pub fn new(panic_in: String) -> Self {
    Self { panic_in }
  }
}

struct AsyncIteratorAdmissionProbeState {
  events: Mutex<Vec<String>>,
  permits: Arc<tokio::sync::Semaphore>,
}

#[napi(async_iterator)]
pub struct AsyncIteratorAdmissionProbe {
  state: Arc<AsyncIteratorAdmissionProbeState>,
  outcomes: VecDeque<String>,
  next_value: u32,
}

#[napi]
impl AsyncGenerator for AsyncIteratorAdmissionProbe {
  type Yield = u32;
  type Next = i32;
  type Return = String;

  fn next(
    &mut self,
    _value: Option<Self::Next>,
  ) -> impl Future<Output = Result<Option<Self::Yield>>> + Send + 'static {
    let value = self.next_value;
    self.next_value += 1;
    let outcome = self
      .outcomes
      .pop_front()
      .unwrap_or_else(|| "value".to_owned());
    self
      .state
      .events
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .push(format!("next:{value}:{outcome}"));
    if outcome == "setup-panic" {
      panic!("intentional queued async iterator setup panic");
    }
    let permits = Arc::clone(&self.state.permits);

    async move {
      let permit = permits.acquire_owned().await.map_err(|_| {
        Error::new(
          Status::Cancelled,
          "async iterator admission probe was closed",
        )
      })?;
      permit.forget();
      match outcome.as_str() {
        "error" => Err(Error::new(
          Status::GenericFailure,
          "intentional queued async iterator error",
        )),
        "panic" => panic!("intentional queued async iterator poll panic"),
        "none" => Ok(None),
        _ => Ok(Some(value)),
      }
    }
  }

  fn complete(
    &mut self,
    value: Option<Self::Return>,
  ) -> impl Future<Output = Result<Option<Self::Yield>>> + Send + 'static {
    self
      .state
      .events
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .push(format!(
        "return:{}",
        value.unwrap_or_else(|| "undefined".to_owned())
      ));
    async { Ok(None) }
  }

  fn catch(
    &mut self,
    _env: Env,
    value: Unknown,
  ) -> impl Future<Output = Result<Option<Self::Yield>>> + Send + 'static {
    self
      .state
      .events
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .push("throw".to_owned());
    let error = value.into();
    async move { Err(error) }
  }
}

#[napi]
impl AsyncIteratorAdmissionProbe {
  #[napi(constructor)]
  pub fn new(outcomes: Vec<String>) -> Self {
    Self {
      state: Arc::new(AsyncIteratorAdmissionProbeState {
        events: Mutex::new(Vec::new()),
        permits: Arc::new(tokio::sync::Semaphore::new(0)),
      }),
      outcomes: outcomes.into(),
      next_value: 0,
    }
  }

  #[napi(getter)]
  pub fn events(&self) -> Vec<String> {
    self
      .state
      .events
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .clone()
  }

  #[napi]
  pub fn release(&self, count: u32) {
    self.state.permits.add_permits(count as usize);
  }
}

// Truly async iterator - uses tokio::time::sleep for real async delays
#[napi(async_iterator)]
pub struct DelayedCounter {
  current: u32,
  max: u32,
  delay_ms: u64,
  barrier: Option<std::sync::Arc<tokio::sync::Barrier>>,
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
    let barrier = self.barrier.clone();
    self.current += 1;

    async move {
      if let Some(barrier) = barrier {
        barrier.wait().await;
      }
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
      barrier: None,
    }
  }
}

/// Creates two counters whose matching `next()` calls wait for each other.
/// This gives the JavaScript tests a deterministic concurrency probe.
#[napi]
pub fn create_delayed_counter_pair(max: u32, delay_ms: u32) -> Vec<DelayedCounter> {
  let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(2));
  (0..2)
    .map(|_| DelayedCounter {
      current: 0,
      max,
      delay_ms: delay_ms as u64,
      barrier: Some(barrier.clone()),
    })
    .collect()
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
