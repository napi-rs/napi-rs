use std::{
  sync::{
    atomic::{AtomicI32, Ordering},
    Arc, Mutex,
  },
  thread,
  time::{Duration, Instant},
};

use napi::{
  bindgen_prelude::*,
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};

const SCENARIO: usize = 0;
const WORKER_READY: usize = 1;
const WORKER_RELEASED: usize = 2;
const FIRST_ENQUEUED: usize = 3;
const HOST_CALL_ARMED: usize = 4;
const NATIVE_QUEUE_CONFIRMED: usize = 5;
const NATIVE_WAIT_ENTERED: usize = 6;
const NATIVE_WAIT_RETURNED: usize = 7;
const AFTER_NATIVE_ENTERED: usize = 8;
const AFTER_NATIVE_RELEASED: usize = 9;
const BLOCKING_RETURNED: usize = 10;
const BLOCKING_STATUS: usize = 11;
const LIFECYCLE_GATE_ARMED: usize = 12;
const LIFECYCLE_GATE_ENTERED: usize = 13;
const LIFECYCLE_GATE_RELEASED: usize = 14;
const LIFECYCLE_CALL_RETURNED: usize = 15;
const LIFECYCLE_CALL_STATUS: usize = 16;
const NATIVE_ABORT_CALLED: usize = 17;
const OWNER_ABORT_RETURNED: usize = 18;
const CLEANUP_TRACKING_ARMED: usize = 22;
const CLEANUP_HOOK_ADDED: usize = 23;
const CLEANUP_HOOK_REMOVED: usize = 24;
const SLOT_RELEASE_CONFIRMED: usize = 27;
const NATIVE_WAIT_ADDRESS_CONFIRMED: usize = 28;
const UNEXPECTED: usize = 29;
const COUNTER_COUNT: usize = 35;

const SCENARIO_DEFERRED_ABORT: i32 = 1;
const SCENARIO_POST_NATIVE_ABORT: i32 = 2;
const BLOCKING_STATUS_CLOSING: i32 = 1;
const BLOCKING_STATUS_OK: i32 = 2;
const LIFECYCLE_STATUS_QUEUE_FULL: i32 = 1;

type BrowserBoundedTsfn = ThreadsafeFunction<u32, (), u32, Status, false, false, 1>;

struct BrowserTsfnState {
  counters: [AtomicI32; COUNTER_COUNT],
}

impl BrowserTsfnState {
  fn reset(&self, scenario: i32) {
    for counter in &self.counters {
      counter.store(0, Ordering::SeqCst);
    }
    self.store(SCENARIO, scenario);
    self.store(CLEANUP_TRACKING_ARMED, 1);
  }

  fn store(&self, index: usize, value: i32) {
    self.counters[index].store(value, Ordering::SeqCst);
  }

  fn load(&self, index: usize) -> i32 {
    self.counters[index].load(Ordering::SeqCst)
  }

  fn snapshot(&self) -> Vec<i32> {
    self
      .counters
      .iter()
      .map(|counter| counter.load(Ordering::SeqCst))
      .collect()
  }

  fn fail(&self, code: i32) {
    let _ = self.counters[UNEXPECTED].compare_exchange(0, code, Ordering::SeqCst, Ordering::SeqCst);
  }
}

static BROWSER_TSFN_STATE: BrowserTsfnState = BrowserTsfnState {
  counters: [const { AtomicI32::new(0) }; COUNTER_COUNT],
};

struct BrowserBoundedTsfnTest {
  tsfn: Arc<BrowserBoundedTsfn>,
}

static BOUNDED_TSFN: Mutex<Option<BrowserBoundedTsfnTest>> = Mutex::new(None);

#[no_mangle]
pub extern "C" fn __napi_rs_test_tsfn_state_ptr() -> *mut AtomicI32 {
  BROWSER_TSFN_STATE.counters.as_ptr().cast_mut()
}

fn active_test() -> Result<Arc<BrowserBoundedTsfn>> {
  BOUNDED_TSFN
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .as_ref()
    .map(|test| Arc::clone(&test.tsfn))
    .ok_or_else(|| Error::from_reason("bounded browser TSFN test is not active"))
}

fn wait_for_state(index: usize, failure: &str) -> Result<()> {
  let deadline = Instant::now() + Duration::from_secs(10);
  while BROWSER_TSFN_STATE.load(index) == 0 {
    if BROWSER_TSFN_STATE.load(UNEXPECTED) != 0 || Instant::now() >= deadline {
      return Err(Error::from_reason(format!(
        "{failure}: {:?}",
        BROWSER_TSFN_STATE.snapshot()
      )));
    }
    std::hint::spin_loop();
  }
  Ok(())
}

#[napi(skip_typescript)]
pub fn prepare_bounded_tsfn_owner_abort(
  callback: Function<u32, ()>,
  post_native: bool,
) -> Result<()> {
  let mut stored = BOUNDED_TSFN
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner);
  if stored.is_some() {
    return Err(Error::from_reason(
      "bounded browser TSFN test is already active",
    ));
  }

  let scenario = if post_native {
    SCENARIO_POST_NATIVE_ABORT
  } else {
    SCENARIO_DEFERRED_ABORT
  };
  BROWSER_TSFN_STATE.reset(scenario);
  let tsfn: Arc<BrowserBoundedTsfn> = Arc::new(
    callback
      .build_threadsafe_function::<u32>()
      .max_queue_size::<1>()
      .build_callback(|ctx| Ok(ctx.value))?,
  );
  if BROWSER_TSFN_STATE.load(CLEANUP_HOOK_ADDED) != 1
    || BROWSER_TSFN_STATE.load(CLEANUP_TRACKING_ARMED) != 0
  {
    return Err(Error::from_reason(format!(
      "TSFN owner cleanup hook registration was not observed exactly once: {:?}",
      BROWSER_TSFN_STATE.snapshot()
    )));
  }

  *stored = Some(BrowserBoundedTsfnTest {
    tsfn: Arc::clone(&tsfn),
  });
  drop(stored);

  let blocking_tsfn = Arc::clone(&tsfn);
  thread::spawn(move || {
    BROWSER_TSFN_STATE.store(WORKER_READY, 1);
    let deadline = Instant::now() + Duration::from_secs(10);
    while BROWSER_TSFN_STATE.load(WORKER_RELEASED) == 0 {
      if Instant::now() >= deadline {
        BROWSER_TSFN_STATE.fail(1);
        BROWSER_TSFN_STATE.store(BLOCKING_RETURNED, 1);
        return;
      }
      std::hint::spin_loop();
    }
    if blocking_tsfn.call(0, ThreadsafeFunctionCallMode::NonBlocking) != Status::Ok {
      BROWSER_TSFN_STATE.fail(2);
      BROWSER_TSFN_STATE.store(BLOCKING_RETURNED, 1);
      return;
    }
    BROWSER_TSFN_STATE.store(FIRST_ENQUEUED, 1);
    BROWSER_TSFN_STATE.store(HOST_CALL_ARMED, 1);
    let status = blocking_tsfn.call(1, ThreadsafeFunctionCallMode::Blocking);
    match scenario {
      SCENARIO_DEFERRED_ABORT if status == Status::Closing => {
        BROWSER_TSFN_STATE.store(BLOCKING_STATUS, BLOCKING_STATUS_CLOSING);
      }
      SCENARIO_POST_NATIVE_ABORT if status == Status::Ok => {
        BROWSER_TSFN_STATE.store(BLOCKING_STATUS, BLOCKING_STATUS_OK);
      }
      _ => BROWSER_TSFN_STATE.fail(3),
    }
    BROWSER_TSFN_STATE.store(BLOCKING_RETURNED, 1);
  });

  Ok(())
}

#[napi(skip_typescript)]
pub fn bounded_tsfn_owner_abort_state() -> Vec<i32> {
  BROWSER_TSFN_STATE.snapshot()
}

#[napi(skip_typescript)]
pub fn abort_bounded_tsfn_from_owner_agent() -> Result<()> {
  let tsfn = active_test()?;
  match BROWSER_TSFN_STATE.load(SCENARIO) {
    SCENARIO_DEFERRED_ABORT => {
      BROWSER_TSFN_STATE.store(WORKER_RELEASED, 1);
      wait_for_state(
        NATIVE_QUEUE_CONFIRMED,
        "bounded call did not enter native N-API with a full queue",
      )?;
      wait_for_state(
        NATIVE_WAIT_ENTERED,
        "bounded call did not enter emnapi's condition wait",
      )?;
      wait_for_state(
        NATIVE_WAIT_ADDRESS_CONFIRMED,
        "bounded call did not wait on emnapi's TSFN condition word",
      )?;
      wait_for_state(
        LIFECYCLE_GATE_ENTERED,
        "public nonblocking call did not hold the lifecycle read guard",
      )?;
      if BROWSER_TSFN_STATE.load(NATIVE_ABORT_CALLED) != 0
        || BROWSER_TSFN_STATE.load(BLOCKING_RETURNED) != 0
        || BROWSER_TSFN_STATE.load(LIFECYCLE_CALL_RETURNED) != 0
      {
        return Err(Error::from_reason(format!(
          "deferred-abort precondition was not preserved: {:?}",
          BROWSER_TSFN_STATE.snapshot()
        )));
      }
      tsfn.abort()?;
      if BROWSER_TSFN_STATE.load(NATIVE_ABORT_CALLED) != 0 {
        return Err(Error::from_reason(
          "owner abort reached native N-API while the lifecycle read guard was held",
        ));
      }
      BROWSER_TSFN_STATE.store(OWNER_ABORT_RETURNED, 1);
      BROWSER_TSFN_STATE.store(LIFECYCLE_GATE_RELEASED, 1);
      wait_for_state(
        NATIVE_ABORT_CALLED,
        "the lifecycle guard did not finish the deferred native abort",
      )?;
    }
    SCENARIO_POST_NATIVE_ABORT => {
      wait_for_state(
        AFTER_NATIVE_ENTERED,
        "bounded call did not pause after returning from native N-API",
      )?;
      if BROWSER_TSFN_STATE.load(BLOCKING_RETURNED) != 0
        || BROWSER_TSFN_STATE.load(NATIVE_ABORT_CALLED) != 0
      {
        return Err(Error::from_reason(format!(
          "post-native abort precondition was not preserved: {:?}",
          BROWSER_TSFN_STATE.snapshot()
        )));
      }
      tsfn.abort()?;
      if BROWSER_TSFN_STATE.load(NATIVE_ABORT_CALLED) != 1
        || BROWSER_TSFN_STATE.load(BLOCKING_RETURNED) != 0
      {
        return Err(Error::from_reason(format!(
          "owner abort did not return inside the post-native blocking-call window: {:?}",
          BROWSER_TSFN_STATE.snapshot()
        )));
      }
      BROWSER_TSFN_STATE.store(OWNER_ABORT_RETURNED, 1);
    }
    _ => {
      return Err(Error::from_reason(
        "bounded browser TSFN test scenario is invalid",
      ));
    }
  }
  Ok(())
}

#[napi(skip_typescript)]
pub fn release_bounded_tsfn_native_wait() -> Result<()> {
  let tsfn = active_test()?;
  if BROWSER_TSFN_STATE.load(WORKER_RELEASED) == 0 {
    BROWSER_TSFN_STATE.store(WORKER_RELEASED, 1);
    if BROWSER_TSFN_STATE.load(SCENARIO) == SCENARIO_DEFERRED_ABORT {
      wait_for_state(
        NATIVE_QUEUE_CONFIRMED,
        "bounded call did not enter native N-API with a full queue",
      )?;
      wait_for_state(
        NATIVE_WAIT_ENTERED,
        "bounded call did not enter emnapi's condition wait",
      )?;
      wait_for_state(
        NATIVE_WAIT_ADDRESS_CONFIRMED,
        "bounded call did not wait on emnapi's TSFN condition word",
      )?;
      BROWSER_TSFN_STATE.store(LIFECYCLE_GATE_ARMED, 1);
      thread::spawn(move || {
        let status = tsfn.call(2, ThreadsafeFunctionCallMode::NonBlocking);
        if BROWSER_TSFN_STATE.load(SCENARIO) != SCENARIO_DEFERRED_ABORT {
          return;
        }
        if status == Status::QueueFull {
          BROWSER_TSFN_STATE.store(LIFECYCLE_CALL_STATUS, LIFECYCLE_STATUS_QUEUE_FULL);
        } else {
          BROWSER_TSFN_STATE.fail(4);
        }
        BROWSER_TSFN_STATE.store(LIFECYCLE_CALL_RETURNED, 1);
      });
      wait_for_state(
        LIFECYCLE_GATE_ENTERED,
        "reused public-call worker did not hold the lifecycle read guard",
      )?;
    }
    return Ok(());
  }

  BROWSER_TSFN_STATE.store(LIFECYCLE_GATE_RELEASED, 1);
  BROWSER_TSFN_STATE.store(AFTER_NATIVE_RELEASED, 1);
  tsfn.abort()
}

#[napi(skip_typescript)]
pub fn finish_bounded_tsfn_owner_abort() -> Result<()> {
  let mut stored = BOUNDED_TSFN
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner);
  if stored.is_none() {
    return Ok(());
  }

  let scenario = BROWSER_TSFN_STATE.load(SCENARIO);
  let common_complete = BROWSER_TSFN_STATE.load(BLOCKING_RETURNED) == 1
    && BROWSER_TSFN_STATE.load(OWNER_ABORT_RETURNED) == 1
    && BROWSER_TSFN_STATE.load(NATIVE_ABORT_CALLED) == 1
    && BROWSER_TSFN_STATE.load(CLEANUP_HOOK_ADDED) == 1
    && BROWSER_TSFN_STATE.load(CLEANUP_HOOK_REMOVED) == 1
    && BROWSER_TSFN_STATE.load(UNEXPECTED) == 0;
  let scenario_complete = match scenario {
    SCENARIO_DEFERRED_ABORT => {
      BROWSER_TSFN_STATE.load(BLOCKING_STATUS) == BLOCKING_STATUS_CLOSING
        && BROWSER_TSFN_STATE.load(LIFECYCLE_CALL_RETURNED) == 1
        && BROWSER_TSFN_STATE.load(LIFECYCLE_CALL_STATUS) == LIFECYCLE_STATUS_QUEUE_FULL
    }
    SCENARIO_POST_NATIVE_ABORT => {
      BROWSER_TSFN_STATE.load(BLOCKING_STATUS) == BLOCKING_STATUS_OK
        && BROWSER_TSFN_STATE.load(NATIVE_WAIT_RETURNED) == 1
        && BROWSER_TSFN_STATE.load(AFTER_NATIVE_ENTERED) == 1
        && BROWSER_TSFN_STATE.load(AFTER_NATIVE_RELEASED) == 1
        && BROWSER_TSFN_STATE.load(SLOT_RELEASE_CONFIRMED) == 1
    }
    _ => false,
  };
  let snapshot = BROWSER_TSFN_STATE.snapshot();
  stored.take();
  BROWSER_TSFN_STATE.store(SCENARIO, 0);
  if !common_complete || !scenario_complete {
    return Err(Error::from_reason(format!(
      "bounded browser TSFN teardown has not completed: {:?}",
      snapshot
    )));
  }
  Ok(())
}
