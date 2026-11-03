use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::thread::sleep;
use std::time::{Duration, Instant};

use napi::{bindgen_prelude::*, AsyncWorkPromise};

// Coverage for how an `AsyncTask` / `Env::spawn` promise settles:
// * a JavaScript exception left pending by the task's own `resolve` used to look like env
//   teardown, so the promise never settled and `finally` never ran;
// * `AsyncWorkPromise::cancel` on a task that already started used to leave the promise pending
//   forever;
// * a worker terminated with tasks still queued or running must drop every task without
//   crashing, and free every promise's settle state (`promise_states_freed`; a
//   `napi_create_promise` deferred settled there is refused and never freed).

static RESOLVE_CALLS: AtomicU32 = AtomicU32::new(0);
static FINALLY_CALLS: AtomicU32 = AtomicU32::new(0);
static TASKS_CREATED: AtomicU32 = AtomicU32::new(0);
static TASKS_DROPPED: AtomicU32 = AtomicU32::new(0);
static SPAWNED_EXECUTING: AtomicBool = AtomicBool::new(false);
static SPAWNED_RELEASED: AtomicBool = AtomicBool::new(false);

#[napi(object)]
pub struct AsyncTaskSettleCounters {
  pub resolve_calls: u32,
  pub finally_calls: u32,
  pub created: u32,
  pub dropped: u32,
  /// `AsyncTask` / `Env::spawn` promise settle states freed (resolving functions, or an
  /// outcome kept for them), settled or not.
  pub promise_states_freed: u32,
}

#[napi]
pub fn async_task_settle_counters() -> AsyncTaskSettleCounters {
  AsyncTaskSettleCounters {
    resolve_calls: RESOLVE_CALLS.load(Ordering::SeqCst),
    finally_calls: FINALLY_CALLS.load(Ordering::SeqCst),
    created: TASKS_CREATED.load(Ordering::SeqCst),
    dropped: TASKS_DROPPED.load(Ordering::SeqCst),
    promise_states_freed: napi::bindgen_prelude::async_task_promise_states_freed() as u32,
  }
}

pub struct ThrowInResolve;

#[napi]
impl Task for ThrowInResolve {
  type Output = u32;
  type JsValue = u32;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(1)
  }

  fn resolve(&mut self, env: Env, output: Self::Output) -> Result<Self::JsValue> {
    RESOLVE_CALLS.fetch_add(1, Ordering::SeqCst);
    // Leaves a JavaScript exception pending, yet reports success.
    let _ = env.throw_error("thrown inside resolve", None);
    Ok(output)
  }

  fn finally(self, _env: Env) -> Result<()> {
    FINALLY_CALLS.fetch_add(1, Ordering::SeqCst);
    Ok(())
  }
}

/// A task whose `resolve` leaves an exception pending: the promise must reject with it.
#[napi]
pub fn async_task_throw_in_resolve() -> AsyncTask<ThrowInResolve> {
  AsyncTask::new(ThrowInResolve)
}

pub struct SpawnedSignalWhenExecuting(u32);

#[napi]
impl Task for SpawnedSignalWhenExecuting {
  type Output = u32;
  type JsValue = u32;

  fn compute(&mut self) -> Result<Self::Output> {
    SPAWNED_EXECUTING.store(true, Ordering::SeqCst);
    // Runs until JavaScript calls `release()`, so the completion cannot reach the JavaScript
    // thread before the test has tried to cancel. The deadline only keeps a failed test from
    // holding a pool thread forever.
    let deadline = Instant::now() + Duration::from_secs(30);
    while !SPAWNED_RELEASED.load(Ordering::SeqCst) && Instant::now() < deadline {
      sleep(Duration::from_millis(1));
    }
    Ok(self.0)
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

/// Holds an `Env::spawn` result so JavaScript can wait for `compute` to start before it
/// cancels, and let `compute` finish afterwards.
#[napi]
pub struct SpawnedAsyncTask {
  inner: AsyncWorkPromise<u32>,
}

#[napi]
impl SpawnedAsyncTask {
  /// Whether `compute` has started, so a cancel can no longer take the work.
  #[napi]
  pub fn is_executing(&self) -> bool {
    SPAWNED_EXECUTING.load(Ordering::SeqCst)
  }

  /// Returns whether `AsyncWorkPromise::cancel` succeeded.
  #[napi]
  pub fn cancel(&mut self) -> bool {
    self.inner.cancel().is_ok()
  }

  /// Lets `compute` return.
  #[napi]
  pub fn release(&self) {
    SPAWNED_RELEASED.store(true, Ordering::SeqCst);
  }
}

/// Spawns a task whose `compute` runs until `task.release()` and then resolves with `value`.
/// The promise is handed out here, in the scope that created it: the `napi_value` inside
/// `AsyncWorkPromise` does not outlive it.
#[napi(ts_return_type = "{ promise: Promise<number>, task: SpawnedAsyncTask }")]
pub fn spawn_async_task(env: &Env, value: u32) -> Result<Object<'_>> {
  SPAWNED_EXECUTING.store(false, Ordering::SeqCst);
  SPAWNED_RELEASED.store(false, Ordering::SeqCst);
  let inner = env.spawn(SpawnedSignalWhenExecuting(value))?;
  let mut result = Object::new(env)?;
  result.set("promise", inner.promise_object())?;
  result.set("task", SpawnedAsyncTask { inner })?;
  Ok(result)
}

pub struct CountedTask;

impl Drop for CountedTask {
  fn drop(&mut self) {
    TASKS_DROPPED.fetch_add(1, Ordering::SeqCst);
  }
}

#[napi]
impl Task for CountedTask {
  type Output = u32;
  type JsValue = u32;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(0)
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

/// A task that counts its creation and its drop, for the worker-terminate test.
#[napi]
pub fn async_task_counted() -> AsyncTask<CountedTask> {
  TASKS_CREATED.fetch_add(1, Ordering::SeqCst);
  AsyncTask::new(CountedTask)
}
