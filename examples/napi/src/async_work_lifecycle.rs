use std::{
  cell::RefCell,
  collections::{hash_map::Entry, HashMap},
  sync::{
    atomic::{AtomicU32, Ordering},
    Arc, Condvar, Mutex,
  },
  time::Duration,
};

use napi::{bindgen_prelude::PromiseRaw, AsyncWorkPromise, Env, Error, Result, Status, Task};

const WORK_GATE_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Default)]
struct WorkGateState {
  started: bool,
  released: bool,
}

#[derive(Default)]
struct WorkGate {
  state: Mutex<WorkGateState>,
  changed: Condvar,
}

impl WorkGate {
  fn run(&self) -> Result<()> {
    let mut state = self
      .state
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    state.started = true;
    self.changed.notify_all();
    let (state, timeout) = self
      .changed
      .wait_timeout_while(state, WORK_GATE_TIMEOUT, |state| !state.released)
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    if timeout.timed_out() && !state.released {
      return Err(Error::new(
        Status::GenericFailure,
        "Async work lifecycle gate timed out".to_owned(),
      ));
    }
    Ok(())
  }

  fn wait_until_started(&self) -> Result<()> {
    let state = self
      .state
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    let (state, timeout) = self
      .changed
      .wait_timeout_while(state, WORK_GATE_TIMEOUT, |state| !state.started)
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    if timeout.timed_out() && !state.started {
      return Err(Error::new(
        Status::GenericFailure,
        "Async work lifecycle task did not start".to_owned(),
      ));
    }
    Ok(())
  }

  fn release(&self) {
    let mut state = self
      .state
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner);
    state.released = true;
    self.changed.notify_all();
  }
}

struct GatedTask {
  gate: Arc<WorkGate>,
  value: u32,
}

impl Task for GatedTask {
  type Output = u32;
  type JsValue = u32;

  fn compute(&mut self) -> Result<Self::Output> {
    self.gate.run()?;
    Ok(self.value)
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

struct ImmediateTask(u32);

impl Task for ImmediateTask {
  type Output = u32;
  type JsValue = u32;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(self.0)
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

struct RetainedAsyncWork {
  work: AsyncWorkPromise<u32>,
  release_gate: Arc<WorkGate>,
  _blocker: Option<AsyncWorkPromise<u32>>,
}

thread_local! {
  static RETAINED_ASYNC_WORK: RefCell<HashMap<u32, RetainedAsyncWork>> =
    RefCell::new(HashMap::new());
}

static NEXT_ASYNC_WORK_ID: AtomicU32 = AtomicU32::new(1);
static PANICKING_ASYNC_WORK_FINALLY_COUNT: AtomicU32 = AtomicU32::new(0);
static PANICKING_ASYNC_WORK_RESOLVE_FINALLY_COUNT: AtomicU32 = AtomicU32::new(0);

struct PanickingTask;

impl Task for PanickingTask {
  type Output = u32;
  type JsValue = u32;

  fn compute(&mut self) -> Result<Self::Output> {
    panic!("intentional async work compute panic");
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }

  fn finally(self, _env: Env) -> Result<()> {
    PANICKING_ASYNC_WORK_FINALLY_COUNT.fetch_add(1, Ordering::SeqCst);
    Ok(())
  }
}

struct ResolvePanickingTask;

impl Task for ResolvePanickingTask {
  type Output = u32;
  type JsValue = u32;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(42)
  }

  fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
    panic!("intentional async work resolve panic");
  }

  fn finally(self, _env: Env) -> Result<()> {
    PANICKING_ASYNC_WORK_RESOLVE_FINALLY_COUNT.fetch_add(1, Ordering::SeqCst);
    Ok(())
  }
}

#[napi(object)]
pub struct AsyncWorkLifecycleHandle<'env> {
  pub id: u32,
  pub promise: PromiseRaw<'env, u32>,
}

fn retain_async_work<'env>(
  work: AsyncWorkPromise<u32>,
  release_gate: Arc<WorkGate>,
  blocker: Option<AsyncWorkPromise<u32>>,
) -> AsyncWorkLifecycleHandle<'env> {
  let promise = work.promise_object();
  let id = RETAINED_ASYNC_WORK.with(|retained| {
    let mut retained = retained.borrow_mut();
    loop {
      let id = NEXT_ASYNC_WORK_ID.fetch_add(1, Ordering::Relaxed);
      if id == 0 {
        continue;
      }
      if let Entry::Vacant(entry) = retained.entry(id) {
        entry.insert(RetainedAsyncWork {
          work,
          release_gate,
          _blocker: blocker,
        });
        return id;
      }
    }
  });
  AsyncWorkLifecycleHandle { id, promise }
}

#[napi]
pub fn create_running_async_work_lifecycle<'env>(
  env: &'env Env,
) -> Result<AsyncWorkLifecycleHandle<'env>> {
  let gate = Arc::new(WorkGate::default());
  let work = env.spawn(GatedTask {
    gate: Arc::clone(&gate),
    value: 42,
  })?;
  if let Err(error) = gate.wait_until_started() {
    gate.release();
    return Err(error);
  }
  Ok(retain_async_work(work, gate, None))
}

#[napi]
pub fn create_queued_async_work_lifecycle<'env>(
  env: &'env Env,
) -> Result<AsyncWorkLifecycleHandle<'env>> {
  let gate = Arc::new(WorkGate::default());
  let blocker = env.spawn(GatedTask {
    gate: Arc::clone(&gate),
    value: 0,
  })?;
  if let Err(error) = gate.wait_until_started() {
    gate.release();
    return Err(error);
  }
  let work = match env.spawn(ImmediateTask(42)) {
    Ok(work) => work,
    Err(error) => {
      gate.release();
      return Err(error);
    }
  };
  Ok(retain_async_work(work, gate, Some(blocker)))
}

#[napi]
pub fn cancel_async_work_lifecycle(id: u32) -> Result<()> {
  RETAINED_ASYNC_WORK.with(|retained| {
    retained
      .borrow_mut()
      .get_mut(&id)
      .ok_or_else(|| Error::from_reason("Async work lifecycle handle was not found"))?
      .work
      .cancel()
  })
}

#[napi]
pub fn release_async_work_lifecycle(id: u32) -> Result<()> {
  let gate = RETAINED_ASYNC_WORK.with(|retained| {
    retained
      .borrow()
      .get(&id)
      .map(|entry| Arc::clone(&entry.release_gate))
      .ok_or_else(|| Error::from_reason("Async work lifecycle handle was not found"))
  })?;
  gate.release();
  Ok(())
}

#[napi]
pub fn dispose_async_work_lifecycle(id: u32) -> Result<()> {
  let entry = RETAINED_ASYNC_WORK.with(|retained| retained.borrow_mut().remove(&id));
  let Some(entry) = entry else {
    return Err(Error::from_reason(
      "Async work lifecycle handle was not found",
    ));
  };
  entry.release_gate.release();
  drop(entry);
  Ok(())
}

#[napi]
pub fn create_panicking_async_work<'env>(env: &'env Env) -> Result<PromiseRaw<'env, u32>> {
  Ok(env.spawn(PanickingTask)?.promise_object())
}

#[napi]
pub fn panicking_async_work_finally_count() -> u32 {
  PANICKING_ASYNC_WORK_FINALLY_COUNT.load(Ordering::SeqCst)
}

#[napi]
pub fn create_resolve_panicking_async_work<'env>(env: &'env Env) -> Result<PromiseRaw<'env, u32>> {
  Ok(env.spawn(ResolvePanickingTask)?.promise_object())
}

#[napi]
pub fn resolve_panicking_async_work_finally_count() -> u32 {
  PANICKING_ASYNC_WORK_RESOLVE_FINALLY_COUNT.load(Ordering::SeqCst)
}
