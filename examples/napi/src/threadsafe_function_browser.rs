use std::{
  ptr,
  sync::{
    atomic::{AtomicI32, AtomicU32, Ordering},
    Arc, Mutex,
  },
  thread,
  time::{Duration, Instant},
};

use napi::{
  bindgen_prelude::*,
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};

const BLOCKING_WORKER_READY: usize = 0;
const BLOCKING_WORKER_RELEASED: usize = 2;
const FIRST_ENQUEUED: usize = 3;
const HOST_CALL_ARMED: usize = 4;
const NATIVE_QUEUE_CONFIRMED: usize = 5;
const NATIVE_WAIT_ENTERED: usize = 6;
const BLOCKING_RETURNED: usize = 10;
const BLOCKING_CLOSING: usize = 11;
const OWNER_ABORT_RETURNED: usize = 18;
const FINALIZER_ENTERED: usize = 19;
const FINALIZER_COMPLETED: usize = 20;
const NATIVE_WAIT_ADDRESS_CONFIRMED: usize = 28;
const UNEXPECTED: usize = 29;
const COUNTER_COUNT: usize = 35;

type BrowserBoundedTsfn = ThreadsafeFunction<u32, (), u32, Status, false, false, 1>;

struct BrowserTsfnState {
  counters: [AtomicI32; COUNTER_COUNT],
}

impl BrowserTsfnState {
  fn new() -> Arc<Self> {
    Arc::new(Self {
      counters: std::array::from_fn(|_| AtomicI32::new(0)),
    })
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

struct BrowserBoundedTsfnTest {
  tsfn: Arc<BrowserBoundedTsfn>,
  state: Arc<BrowserTsfnState>,
}

static BOUNDED_TSFN: Mutex<Option<BrowserBoundedTsfnTest>> = Mutex::new(None);
static TSFN_STATE_PTR: AtomicU32 = AtomicU32::new(0);

#[no_mangle]
pub extern "C" fn __napi_rs_test_tsfn_state_ptr() -> *mut AtomicU32 {
  ptr::addr_of!(TSFN_STATE_PTR).cast_mut()
}

fn active_test() -> Result<(Arc<BrowserBoundedTsfn>, Arc<BrowserTsfnState>)> {
  BOUNDED_TSFN
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .as_ref()
    .map(|test| (Arc::clone(&test.tsfn), Arc::clone(&test.state)))
    .ok_or_else(|| Error::from_reason("bounded browser TSFN test is not active"))
}

fn wait_for_state(state: &BrowserTsfnState, index: usize, failure: &str) -> Result<()> {
  let deadline = Instant::now() + Duration::from_secs(10);
  while state.load(index) == 0 {
    if state.load(UNEXPECTED) != 0 || Instant::now() >= deadline {
      return Err(Error::from_reason(format!(
        "{failure}: {:?}",
        state.snapshot()
      )));
    }
    std::hint::spin_loop();
  }
  Ok(())
}

#[napi(skip_typescript)]
pub fn prepare_bounded_tsfn_owner_abort(callback: Function<u32, ()>) -> Result<()> {
  let state = BrowserTsfnState::new();
  let tsfn: Arc<BrowserBoundedTsfn> = Arc::new(
    callback
      .build_threadsafe_function::<u32>()
      .max_queue_size::<1>()
      .build_callback(|ctx| Ok(ctx.value))?,
  );
  let finalizer_state = Arc::clone(&state);
  unsafe {
    tsfn.register_finalizer(move || {
      finalizer_state.store(FINALIZER_ENTERED, 1);
      finalizer_state.store(FINALIZER_COMPLETED, 1);
    })
  }?;

  let mut stored = BOUNDED_TSFN
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner);
  if stored.is_some() {
    return Err(Error::from_reason(
      "bounded browser TSFN test is already active",
    ));
  }
  *stored = Some(BrowserBoundedTsfnTest {
    tsfn: Arc::clone(&tsfn),
    state: Arc::clone(&state),
  });
  TSFN_STATE_PTR.store(state.counters.as_ptr() as usize as u32, Ordering::Release);
  drop(stored);

  thread::spawn(move || {
    state.store(BLOCKING_WORKER_READY, 1);
    let deadline = Instant::now() + Duration::from_secs(10);
    while state.load(BLOCKING_WORKER_RELEASED) == 0 {
      if Instant::now() >= deadline {
        state.fail(1);
        state.store(BLOCKING_RETURNED, 1);
        return;
      }
      std::hint::spin_loop();
    }
    if tsfn.call(0, ThreadsafeFunctionCallMode::NonBlocking) != Status::Ok {
      state.fail(2);
      state.store(BLOCKING_RETURNED, 1);
      return;
    }
    state.store(FIRST_ENQUEUED, 1);
    state.store(HOST_CALL_ARMED, 1);
    if tsfn.call(1, ThreadsafeFunctionCallMode::Blocking) == Status::Closing {
      state.store(BLOCKING_CLOSING, 1);
    } else {
      state.fail(3);
    }
    state.store(BLOCKING_RETURNED, 1);
  });
  Ok(())
}

#[napi(skip_typescript)]
pub fn bounded_tsfn_owner_abort_state() -> Vec<i32> {
  BOUNDED_TSFN
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .as_ref()
    .map_or_else(|| vec![0; COUNTER_COUNT], |test| test.state.snapshot())
}

#[napi(skip_typescript)]
pub fn abort_bounded_tsfn_from_owner_agent() -> Result<()> {
  let (tsfn, state) = active_test()?;
  state.store(BLOCKING_WORKER_RELEASED, 1);
  wait_for_state(
    &state,
    NATIVE_QUEUE_CONFIRMED,
    "bounded call did not enter native N-API with a full queue",
  )?;
  wait_for_state(
    &state,
    NATIVE_WAIT_ENTERED,
    "bounded call did not enter emnapi's condition wait",
  )?;
  wait_for_state(
    &state,
    NATIVE_WAIT_ADDRESS_CONFIRMED,
    "bounded call did not wait on emnapi's TSFN condition word",
  )?;
  if state.load(BLOCKING_RETURNED) != 0 {
    return Err(Error::from_reason(
      "bounded call returned before the owner aborted the TSFN",
    ));
  }
  tsfn.abort()?;
  state.store(OWNER_ABORT_RETURNED, 1);
  Ok(())
}

#[napi(skip_typescript)]
pub fn release_bounded_tsfn_native_wait() -> Result<()> {
  let (tsfn, state) = active_test()?;
  state.store(BLOCKING_WORKER_RELEASED, 1);
  tsfn.abort()
}

#[napi(skip_typescript)]
pub fn finish_bounded_tsfn_owner_abort() -> Result<()> {
  let mut stored = BOUNDED_TSFN
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner);
  let Some(test) = stored.as_ref() else {
    return Ok(());
  };
  if test.state.load(BLOCKING_RETURNED) == 0
    || test.state.load(BLOCKING_CLOSING) == 0
    || test.state.load(FINALIZER_COMPLETED) == 0
  {
    return Err(Error::from_reason(
      "bounded browser TSFN teardown has not completed",
    ));
  }
  TSFN_STATE_PTR.store(0, Ordering::Release);
  stored.take();
  Ok(())
}
