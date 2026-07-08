use std::{sync::Arc, thread, time::Duration};

#[cfg(napi_tsfn_native_wait_test)]
use std::{
  os::raw::c_int,
  ptr,
  sync::{
    atomic::{AtomicI32, AtomicPtr, AtomicU32, Ordering},
    Mutex,
  },
  time::Instant,
};

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
use std::cell::RefCell;

#[cfg(not(target_family = "wasm"))]
use std::{
  future::Future,
  pin::pin,
  sync::{
    atomic::{AtomicBool, AtomicI32, Ordering},
    mpsc::{channel, sync_channel, Receiver, RecvTimeoutError, Sender, SyncSender},
    Mutex,
  },
  task::{Context, Poll},
  thread::JoinHandle,
};

use napi::{
  bindgen_prelude::*,
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, UnknownReturnValue},
  UnknownRef,
};

use crate::class::Animal;

#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_BLOCKING_WORKER_READY_INDEX: usize = 0;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_ABORT_WORKER_READY_INDEX: usize = 1;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_BLOCKING_WORKER_RELEASED_INDEX: usize = 2;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_FIRST_ENQUEUED_INDEX: usize = 3;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_HOST_CALL_ARMED_INDEX: usize = 4;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_NATIVE_QUEUE_CONFIRMED_INDEX: usize = 5;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_NATIVE_WAIT_ENTERED_INDEX: usize = 6;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_NATIVE_WAIT_RETURNED_INDEX: usize = 7;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_AFTER_NATIVE_ENTERED_INDEX: usize = 8;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_AFTER_NATIVE_RELEASED_INDEX: usize = 9;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_BLOCKING_RETURNED_INDEX: usize = 10;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_BLOCKING_CLOSING_INDEX: usize = 11;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_NON_OWNER_ABORT_STARTED_INDEX: usize = 12;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_NON_OWNER_WAIT_ENTERED_INDEX: usize = 13;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_NON_OWNER_ABORT_RETURNED_INDEX: usize = 14;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_NON_OWNER_ABORT_OK_INDEX: usize = 15;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_OWNER_AGENT_CONFIRMED_INDEX: usize = 16;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_OWNER_WAIT_ATTEMPTED_INDEX: usize = 17;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_OWNER_ABORT_RETURNED_INDEX: usize = 18;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_FINALIZER_ENTERED_INDEX: usize = 19;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_FINALIZER_COMPLETED_INDEX: usize = 20;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_FINALIZER_OBSERVED_BLOCKED_CALLER_INDEX: usize = 21;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_SHARED_STATE_CONFIRMED_INDEX: usize = 22;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_BLOCKING_CURRENT_AGENT_INDEX: usize = 23;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_ABORT_CURRENT_AGENT_INDEX: usize = 24;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_OWNER_CURRENT_AGENT_INDEX: usize = 25;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_CAPTURED_OWNER_AGENT_INDEX: usize = 26;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_ABORT_OBSERVED_INACTIVE_INDEX: usize = 27;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_NATIVE_WAIT_ADDRESS_CONFIRMED_INDEX: usize = 28;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_UNEXPECTED_INDEX: usize = 29;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_LIFECYCLE_LOCK_ENTERED_INDEX: usize = 30;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_LIFECYCLE_LOCK_RELEASED_INDEX: usize = 31;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_LIFECYCLE_LOCK_EXITED_INDEX: usize = 32;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_CLEANUP_CONTEXT_ALLOCATED_INDEX: usize = 33;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_CLEANUP_CONTEXT_RELEASED_INDEX: usize = 34;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_COUNTER_COUNT: usize = 35;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_BROWSER_WINDOW_AGENT: u8 = 1;
#[cfg(napi_tsfn_native_wait_test)]
const BROWSER_TSFN_WORKER_AGENT: u8 = 3;

#[cfg(napi_tsfn_native_wait_test)]
struct BrowserTsfnState {
  counters: [AtomicI32; BROWSER_TSFN_COUNTER_COUNT],
  blocking_handle_state_ptr: AtomicU32,
  owner_cleanup_context_baseline: usize,
}

#[cfg(napi_tsfn_native_wait_test)]
type BrowserBoundedTsfn = ThreadsafeFunction<u32, (), u32, Status, false, false, 1>;

#[cfg(napi_tsfn_native_wait_test)]
struct BrowserBoundedTsfnTest {
  tsfn: Arc<BrowserBoundedTsfn>,
  state: Arc<BrowserTsfnState>,
}

#[cfg(napi_tsfn_native_wait_test)]
static BROWSER_BOUNDED_TSFN: Mutex<Option<BrowserBoundedTsfnTest>> = Mutex::new(None);
#[cfg(napi_tsfn_native_wait_test)]
static BROWSER_POST_CALL_TSFN: Mutex<Option<BrowserBoundedTsfnTest>> = Mutex::new(None);
#[cfg(napi_tsfn_native_wait_test)]
static BROWSER_TSFN_STATE: AtomicPtr<BrowserTsfnState> = AtomicPtr::new(ptr::null_mut());
#[cfg(napi_tsfn_native_wait_test)]
static BROWSER_TSFN_STATE_PTR: AtomicU32 = AtomicU32::new(0);

#[cfg(napi_tsfn_native_wait_test)]
#[link(wasm_import_module = "env")]
extern "C" {
  fn _emnapi_is_main_browser_thread() -> c_int;
}

#[cfg(napi_tsfn_native_wait_test)]
impl BrowserTsfnState {
  fn new(owner_cleanup_context_baseline: usize) -> Arc<Self> {
    Arc::new(Self {
      counters: std::array::from_fn(|_| AtomicI32::new(0)),
      blocking_handle_state_ptr: AtomicU32::new(0),
      owner_cleanup_context_baseline,
    })
  }

  fn counter(&self, index: usize) -> &AtomicI32 {
    &self.counters[index]
  }

  fn store(&self, index: usize, value: i32) {
    self.counter(index).store(value, Ordering::SeqCst);
  }

  fn load(&self, index: usize) -> i32 {
    self.counter(index).load(Ordering::SeqCst)
  }

  fn snapshot(&self) -> Vec<i32> {
    (0..BROWSER_TSFN_COUNTER_COUNT)
      .map(|index| self.load(index))
      .collect()
  }

  fn fail(&self, code: i32) {
    let _ = self
      .counter(BROWSER_TSFN_UNEXPECTED_INDEX)
      .compare_exchange(0, code, Ordering::SeqCst, Ordering::SeqCst);
    self.store(BROWSER_TSFN_AFTER_NATIVE_RELEASED_INDEX, 1);
  }
}

#[cfg(napi_tsfn_native_wait_test)]
#[no_mangle]
pub extern "C" fn __napi_rs_test_tsfn_state_ptr() -> *mut AtomicU32 {
  ptr::addr_of!(BROWSER_TSFN_STATE_PTR).cast_mut()
}

#[cfg(napi_tsfn_native_wait_test)]
fn browser_tsfn_test() -> Result<(Arc<BrowserBoundedTsfn>, Arc<BrowserTsfnState>)> {
  BROWSER_BOUNDED_TSFN
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .as_ref()
    .map(|test| (Arc::clone(&test.tsfn), Arc::clone(&test.state)))
    .ok_or_else(|| {
      Error::new(
        Status::GenericFailure,
        "bounded browser TSFN owner-abort test is not active",
      )
    })
}

#[cfg(napi_tsfn_native_wait_test)]
fn wait_for_browser_tsfn_state(
  state: &BrowserTsfnState,
  index: usize,
  failure: &'static str,
) -> Result<()> {
  let deadline = Instant::now() + Duration::from_secs(10);
  while state.load(index) == 0 {
    if state.load(BROWSER_TSFN_UNEXPECTED_INDEX) != 0 || Instant::now() >= deadline {
      state.fail(1);
      return Err(Error::new(
        Status::GenericFailure,
        format!("{failure}: {:?}", state.snapshot()),
      ));
    }
    std::hint::spin_loop();
  }
  Ok(())
}

#[cfg(napi_tsfn_native_wait_test)]
#[napi(skip_typescript)]
pub fn prepare_bounded_tsfn_owner_abort(callback: Function<u32, ()>) -> Result<()> {
  let owner_cleanup_context_baseline = BrowserBoundedTsfn::__test_owner_cleanup_context_count();
  let state = BrowserTsfnState::new(owner_cleanup_context_baseline);
  let tsfn: Arc<BrowserBoundedTsfn> = Arc::new(
    callback
      .build_threadsafe_function::<u32>()
      .max_queue_size::<1>()
      .build_callback(|ctx| Ok(ctx.value))?,
  );
  if BrowserBoundedTsfn::__test_owner_cleanup_context_count() != owner_cleanup_context_baseline + 1
  {
    return Err(Error::new(
      Status::GenericFailure,
      "bounded TSFN owner cleanup context was not retained exactly once",
    ));
  }
  state.store(BROWSER_TSFN_CLEANUP_CONTEXT_ALLOCATED_INDEX, 1);
  let (blocking_active, owner_agent, current_agent, is_owner_agent) =
    tsfn.__test_blocking_call_state();
  if blocking_active
    || owner_agent != BROWSER_TSFN_BROWSER_WINDOW_AGENT
    || current_agent != BROWSER_TSFN_BROWSER_WINDOW_AGENT
    || !is_owner_agent
  {
    return Err(Error::new(
      Status::GenericFailure,
      "bounded TSFN was not created by the browser-window owner agent",
    ));
  }
  state.store(
    BROWSER_TSFN_CAPTURED_OWNER_AGENT_INDEX,
    i32::from(owner_agent),
  );

  let wait_state = Arc::clone(&state);
  tsfn.__test_register_blocking_wait_observer(move || {
    if unsafe { _emnapi_is_main_browser_thread() != 0 } {
      wait_state.store(BROWSER_TSFN_OWNER_WAIT_ATTEMPTED_INDEX, 1);
      false
    } else {
      wait_state.store(BROWSER_TSFN_NON_OWNER_WAIT_ENTERED_INDEX, 1);
      true
    }
  })?;

  let finalizer_state = Arc::clone(&state);
  // SAFETY: The finalizer releases the only bounded caller from its test gate,
  // then waits until both native workers have returned without depending on a
  // queued JavaScript callback.
  unsafe {
    tsfn.register_finalizer(move || {
      finalizer_state.store(BROWSER_TSFN_FINALIZER_ENTERED_INDEX, 1);
      if finalizer_state.load(BROWSER_TSFN_AFTER_NATIVE_ENTERED_INDEX) == 0
        || finalizer_state.load(BROWSER_TSFN_AFTER_NATIVE_RELEASED_INDEX) != 0
        || finalizer_state.load(BROWSER_TSFN_BLOCKING_RETURNED_INDEX) != 0
        || finalizer_state.load(BROWSER_TSFN_NON_OWNER_ABORT_RETURNED_INDEX) != 0
      {
        finalizer_state.fail(10);
      } else {
        finalizer_state.store(BROWSER_TSFN_FINALIZER_OBSERVED_BLOCKED_CALLER_INDEX, 1);
        finalizer_state.store(BROWSER_TSFN_AFTER_NATIVE_RELEASED_INDEX, 1);
      }

      let deadline = Instant::now() + Duration::from_secs(10);
      while finalizer_state.load(BROWSER_TSFN_BLOCKING_RETURNED_INDEX) == 0
        || finalizer_state.load(BROWSER_TSFN_NON_OWNER_ABORT_RETURNED_INDEX) == 0
      {
        if Instant::now() >= deadline {
          finalizer_state.fail(11);
          break;
        }
        std::hint::spin_loop();
      }
      finalizer_state.store(BROWSER_TSFN_FINALIZER_COMPLETED_INDEX, 1);
    })
  }?;

  let mut stored = BROWSER_BOUNDED_TSFN
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner);
  if stored.is_some() {
    return Err(Error::new(
      Status::GenericFailure,
      "bounded browser TSFN owner-abort test is already active",
    ));
  }
  *stored = Some(BrowserBoundedTsfnTest {
    tsfn: Arc::clone(&tsfn),
    state: Arc::clone(&state),
  });
  BROWSER_TSFN_STATE.store(Arc::as_ptr(&state).cast_mut(), Ordering::Release);
  BROWSER_TSFN_STATE_PTR.store(state.counters.as_ptr() as usize as u32, Ordering::Release);
  drop(stored);

  let worker_tsfn = Arc::clone(&tsfn);
  let worker_state = Arc::clone(&state);
  thread::spawn(move || {
    worker_state.store(BROWSER_TSFN_BLOCKING_WORKER_READY_INDEX, 1);
    let release_deadline = Instant::now() + Duration::from_secs(10);
    while worker_state.load(BROWSER_TSFN_BLOCKING_WORKER_RELEASED_INDEX) == 0 {
      if Instant::now() >= release_deadline {
        worker_state.fail(20);
        worker_state.store(BROWSER_TSFN_BLOCKING_RETURNED_INDEX, 1);
        return;
      }
      std::hint::spin_loop();
    }

    let first_status = worker_tsfn.call(0, ThreadsafeFunctionCallMode::NonBlocking);
    if first_status != Status::Ok {
      worker_state.fail(21);
      worker_state.store(BROWSER_TSFN_BLOCKING_RETURNED_INDEX, 1);
      return;
    }
    worker_state.store(BROWSER_TSFN_FIRST_ENQUEUED_INDEX, 1);
    let (blocking_active, owner_agent, current_agent, is_owner_agent) =
      worker_tsfn.__test_blocking_call_state();
    worker_state.store(
      BROWSER_TSFN_BLOCKING_CURRENT_AGENT_INDEX,
      i32::from(current_agent),
    );
    if blocking_active
      || owner_agent != BROWSER_TSFN_BROWSER_WINDOW_AGENT
      || current_agent != BROWSER_TSFN_WORKER_AGENT
      || is_owner_agent
    {
      worker_state.fail(22);
      worker_state.store(BROWSER_TSFN_BLOCKING_RETURNED_INDEX, 1);
      return;
    }
    worker_state.blocking_handle_state_ptr.store(
      worker_tsfn.__test_handle_state_ptr() as u32,
      Ordering::Release,
    );

    let before_native_tsfn = Arc::clone(&worker_tsfn);
    let before_native_state = Arc::clone(&worker_state);
    let after_native_state = Arc::clone(&worker_state);
    let blocking_status = worker_tsfn.__test_call_bounded_blocking(
      1,
      move || {
        let (active, owner_agent, current_agent, is_owner_agent) =
          before_native_tsfn.__test_blocking_call_state();
        if !active
          || owner_agent != BROWSER_TSFN_BROWSER_WINDOW_AGENT
          || current_agent != BROWSER_TSFN_WORKER_AGENT
          || is_owner_agent
        {
          before_native_state.fail(23);
        } else {
          before_native_state.store(BROWSER_TSFN_HOST_CALL_ARMED_INDEX, 1);
        }
      },
      move |_| {
        after_native_state.store(BROWSER_TSFN_AFTER_NATIVE_ENTERED_INDEX, 1);
        let deadline = Instant::now() + Duration::from_secs(10);
        while after_native_state.load(BROWSER_TSFN_AFTER_NATIVE_RELEASED_INDEX) == 0 {
          if Instant::now() >= deadline {
            after_native_state.fail(24);
            break;
          }
          std::hint::spin_loop();
        }
      },
    );
    if blocking_status == Status::Closing {
      worker_state.store(BROWSER_TSFN_BLOCKING_CLOSING_INDEX, 1);
    } else {
      worker_state.fail(25);
    }
    worker_state.store(BROWSER_TSFN_BLOCKING_RETURNED_INDEX, 1);
  });

  let abort_tsfn = Arc::clone(&tsfn);
  let abort_state = Arc::clone(&state);
  thread::spawn(move || {
    abort_state.store(BROWSER_TSFN_ABORT_WORKER_READY_INDEX, 1);
    if wait_for_browser_tsfn_state(
      &abort_state,
      BROWSER_TSFN_NATIVE_WAIT_ENTERED_INDEX,
      "bounded call did not enter emnapi's native condition wait",
    )
    .is_err()
    {
      abort_state.store(BROWSER_TSFN_NON_OWNER_ABORT_RETURNED_INDEX, 1);
      return;
    }

    abort_state.store(BROWSER_TSFN_NON_OWNER_ABORT_STARTED_INDEX, 1);
    let (blocking_active, owner_agent, current_agent, is_owner_agent) =
      abort_tsfn.__test_blocking_call_state();
    abort_state.store(
      BROWSER_TSFN_ABORT_CURRENT_AGENT_INDEX,
      i32::from(current_agent),
    );
    if !blocking_active
      || owner_agent != BROWSER_TSFN_BROWSER_WINDOW_AGENT
      || current_agent != BROWSER_TSFN_WORKER_AGENT
      || is_owner_agent
    {
      abort_state.fail(30);
      abort_state.store(BROWSER_TSFN_NON_OWNER_ABORT_RETURNED_INDEX, 1);
      return;
    }
    if abort_state
      .blocking_handle_state_ptr
      .load(Ordering::Acquire)
      != abort_tsfn.__test_handle_state_ptr() as u32
    {
      abort_state.fail(31);
      abort_state.store(BROWSER_TSFN_NON_OWNER_ABORT_RETURNED_INDEX, 1);
      return;
    }
    abort_state.store(BROWSER_TSFN_SHARED_STATE_CONFIRMED_INDEX, 1);

    match abort_tsfn.abort() {
      Ok(()) => abort_state.store(BROWSER_TSFN_NON_OWNER_ABORT_OK_INDEX, 1),
      Err(_) => abort_state.fail(32),
    }
    let (blocking_active, _, _, _) = abort_tsfn.__test_blocking_call_state();
    if blocking_active {
      abort_state.fail(33);
    } else {
      abort_state.store(BROWSER_TSFN_ABORT_OBSERVED_INACTIVE_INDEX, 1);
    }
    abort_state.store(BROWSER_TSFN_NON_OWNER_ABORT_RETURNED_INDEX, 1);
  });

  let lifecycle_tsfn = Arc::clone(&tsfn);
  let lifecycle_state = Arc::clone(&state);
  thread::spawn(move || {
    lifecycle_tsfn.__test_with_lifecycle_read_lock(|| {
      lifecycle_state.store(BROWSER_TSFN_LIFECYCLE_LOCK_ENTERED_INDEX, 1);
      let deadline = Instant::now() + Duration::from_secs(10);
      while lifecycle_state.load(BROWSER_TSFN_LIFECYCLE_LOCK_RELEASED_INDEX) == 0 {
        if Instant::now() >= deadline {
          lifecycle_state.fail(34);
          break;
        }
        std::hint::spin_loop();
      }
    });
    lifecycle_state.store(BROWSER_TSFN_LIFECYCLE_LOCK_EXITED_INDEX, 1);
  });
  Ok(())
}

#[cfg(napi_tsfn_native_wait_test)]
#[napi(skip_typescript)]
pub fn bounded_tsfn_owner_abort_state() -> Vec<i32> {
  BROWSER_BOUNDED_TSFN
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .as_ref()
    .map_or_else(
      || vec![0; BROWSER_TSFN_COUNTER_COUNT],
      |test| {
        if BrowserBoundedTsfn::__test_owner_cleanup_context_count()
          == test.state.owner_cleanup_context_baseline
        {
          test
            .state
            .store(BROWSER_TSFN_CLEANUP_CONTEXT_RELEASED_INDEX, 1);
        }
        test.state.snapshot()
      },
    )
}

#[cfg(napi_tsfn_native_wait_test)]
#[napi(skip_typescript)]
pub fn abort_bounded_tsfn_from_owner_agent() -> Result<()> {
  let (tsfn, state) = browser_tsfn_test()?;
  state.store(BROWSER_TSFN_BLOCKING_WORKER_RELEASED_INDEX, 1);
  wait_for_browser_tsfn_state(
    &state,
    BROWSER_TSFN_NATIVE_QUEUE_CONFIRMED_INDEX,
    "bounded browser TSFN call did not enter native N-API with a full open queue",
  )?;
  wait_for_browser_tsfn_state(
    &state,
    BROWSER_TSFN_NATIVE_WAIT_ENTERED_INDEX,
    "bounded browser TSFN call did not enter emnapi's condition wait",
  )?;
  wait_for_browser_tsfn_state(
    &state,
    BROWSER_TSFN_NATIVE_WAIT_ADDRESS_CONFIRMED_INDEX,
    "bounded browser TSFN call did not wait on emnapi's TSFN condition word",
  )?;
  wait_for_browser_tsfn_state(
    &state,
    BROWSER_TSFN_LIFECYCLE_LOCK_ENTERED_INDEX,
    "browser TSFN lifecycle read lock was not held by the worker",
  )?;
  wait_for_browser_tsfn_state(
    &state,
    BROWSER_TSFN_NON_OWNER_ABORT_STARTED_INDEX,
    "non-owner abort did not contend with the lifecycle read lock",
  )?;
  if state.load(BROWSER_TSFN_BLOCKING_RETURNED_INDEX) != 0
    || state.load(BROWSER_TSFN_NON_OWNER_ABORT_RETURNED_INDEX) != 0
    || state.load(BROWSER_TSFN_HOST_CALL_ARMED_INDEX) != 0
    || state.load(BROWSER_TSFN_NATIVE_WAIT_RETURNED_INDEX) != 0
    || state.load(BROWSER_TSFN_AFTER_NATIVE_RELEASED_INDEX) != 0
  {
    state.fail(40);
    return Err(Error::new(
      Status::GenericFailure,
      "bounded browser TSFN did not remain blocked during non-owner abort",
    ));
  }

  let (blocking_active, owner_agent, current_agent, is_owner_agent) =
    tsfn.__test_blocking_call_state();
  state.store(
    BROWSER_TSFN_OWNER_CURRENT_AGENT_INDEX,
    i32::from(current_agent),
  );
  if !blocking_active
    || owner_agent != BROWSER_TSFN_BROWSER_WINDOW_AGENT
    || current_agent != BROWSER_TSFN_BROWSER_WINDOW_AGENT
    || !is_owner_agent
  {
    state.fail(41);
    return Err(Error::new(
      Status::GenericFailure,
      "owner abort did not run on the browser window agent",
    ));
  }
  state.store(BROWSER_TSFN_OWNER_AGENT_CONFIRMED_INDEX, 1);
  tsfn.abort()?;
  if state.load(BROWSER_TSFN_OWNER_WAIT_ATTEMPTED_INDEX) != 0 {
    state.fail(42);
    return Err(Error::new(
      Status::GenericFailure,
      "owner abort attempted to synchronously wait for the blocking caller",
    ));
  }
  state.store(BROWSER_TSFN_OWNER_ABORT_RETURNED_INDEX, 1);
  state.store(BROWSER_TSFN_LIFECYCLE_LOCK_RELEASED_INDEX, 1);
  wait_for_browser_tsfn_state(
    &state,
    BROWSER_TSFN_LIFECYCLE_LOCK_EXITED_INDEX,
    "worker lifecycle lock did not release after owner abort returned",
  )?;
  wait_for_browser_tsfn_state(
    &state,
    BROWSER_TSFN_AFTER_NATIVE_ENTERED_INDEX,
    "bounded browser TSFN call did not return from native N-API after deferred abort",
  )?;
  wait_for_browser_tsfn_state(
    &state,
    BROWSER_TSFN_NON_OWNER_WAIT_ENTERED_INDEX,
    "non-owner abort did not enter the synchronized blocking-call wait",
  )?;
  Ok(())
}

#[cfg(napi_tsfn_native_wait_test)]
#[napi(skip_typescript)]
pub fn release_bounded_tsfn_native_wait() -> Result<()> {
  let (tsfn, state) = browser_tsfn_test()?;
  state.store(BROWSER_TSFN_AFTER_NATIVE_RELEASED_INDEX, 1);
  tsfn.abort()?;
  Ok(())
}

#[cfg(napi_tsfn_native_wait_test)]
#[napi(skip_typescript)]
pub fn finish_bounded_tsfn_owner_abort() -> Result<()> {
  let mut stored = BROWSER_BOUNDED_TSFN
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner);
  let Some(test) = stored.as_ref() else {
    return Ok(());
  };
  if test.state.load(BROWSER_TSFN_BLOCKING_RETURNED_INDEX) == 0
    || test.state.load(BROWSER_TSFN_NON_OWNER_ABORT_RETURNED_INDEX) == 0
    || test.state.load(BROWSER_TSFN_FINALIZER_COMPLETED_INDEX) == 0
    || test.state.load(BROWSER_TSFN_CLEANUP_CONTEXT_RELEASED_INDEX) == 0
  {
    return Err(Error::new(
      Status::GenericFailure,
      "bounded browser TSFN teardown has not completed",
    ));
  }
  BROWSER_TSFN_STATE.store(ptr::null_mut(), Ordering::Release);
  BROWSER_TSFN_STATE_PTR.store(0, Ordering::Release);
  stored.take();
  Ok(())
}

#[cfg(napi_tsfn_native_wait_test)]
fn browser_post_call_tsfn_test() -> Result<(Arc<BrowserBoundedTsfn>, Arc<BrowserTsfnState>)> {
  BROWSER_POST_CALL_TSFN
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .as_ref()
    .map(|test| (Arc::clone(&test.tsfn), Arc::clone(&test.state)))
    .ok_or_else(|| {
      Error::new(
        Status::GenericFailure,
        "bounded browser TSFN post-call abort test is not active",
      )
    })
}

#[cfg(napi_tsfn_native_wait_test)]
#[napi(skip_typescript)]
pub fn prepare_bounded_tsfn_post_call_abort(callback: Function<u32, ()>) -> Result<()> {
  let owner_cleanup_context_baseline = BrowserBoundedTsfn::__test_owner_cleanup_context_count();
  let state = BrowserTsfnState::new(owner_cleanup_context_baseline);
  let tsfn: Arc<BrowserBoundedTsfn> = Arc::new(
    callback
      .build_threadsafe_function::<u32>()
      .max_queue_size::<1>()
      .build_callback(|ctx| Ok(ctx.value))?,
  );
  if BrowserBoundedTsfn::__test_owner_cleanup_context_count() != owner_cleanup_context_baseline + 1
  {
    return Err(Error::new(
      Status::GenericFailure,
      "post-call TSFN owner cleanup context was not retained exactly once",
    ));
  }
  state.store(BROWSER_TSFN_CLEANUP_CONTEXT_ALLOCATED_INDEX, 1);

  let finalizer_state = Arc::clone(&state);
  unsafe {
    tsfn.register_finalizer(move || {
      finalizer_state.store(BROWSER_TSFN_FINALIZER_ENTERED_INDEX, 1);
      finalizer_state.store(BROWSER_TSFN_FINALIZER_COMPLETED_INDEX, 1);
    })
  }?;

  let mut stored = BROWSER_POST_CALL_TSFN
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner);
  if stored.is_some() {
    return Err(Error::new(
      Status::GenericFailure,
      "bounded browser TSFN post-call abort test is already active",
    ));
  }
  *stored = Some(BrowserBoundedTsfnTest {
    tsfn: Arc::clone(&tsfn),
    state: Arc::clone(&state),
  });
  BROWSER_TSFN_STATE.store(Arc::as_ptr(&state).cast_mut(), Ordering::Release);
  BROWSER_TSFN_STATE_PTR.store(state.counters.as_ptr() as usize as u32, Ordering::Release);
  drop(stored);

  thread::spawn(move || {
    state.store(BROWSER_TSFN_BLOCKING_WORKER_READY_INDEX, 1);
    let release_deadline = Instant::now() + Duration::from_secs(10);
    while state.load(BROWSER_TSFN_BLOCKING_WORKER_RELEASED_INDEX) == 0 {
      if Instant::now() >= release_deadline {
        state.fail(60);
        state.store(BROWSER_TSFN_BLOCKING_RETURNED_INDEX, 1);
        return;
      }
      std::hint::spin_loop();
    }
    if tsfn.call(0, ThreadsafeFunctionCallMode::NonBlocking) != Status::Ok {
      state.fail(61);
      state.store(BROWSER_TSFN_BLOCKING_RETURNED_INDEX, 1);
      return;
    }
    state.store(BROWSER_TSFN_FIRST_ENQUEUED_INDEX, 1);

    let before_state = Arc::clone(&state);
    let after_state = Arc::clone(&state);
    let status = tsfn.__test_call_bounded_blocking(
      1,
      move || before_state.store(BROWSER_TSFN_HOST_CALL_ARMED_INDEX, 1),
      move |status| {
        if status != Status::Ok {
          after_state.fail(62);
          return;
        }
        after_state.store(BROWSER_TSFN_AFTER_NATIVE_ENTERED_INDEX, 1);
        let deadline = Instant::now() + Duration::from_secs(10);
        while after_state.load(BROWSER_TSFN_AFTER_NATIVE_RELEASED_INDEX) == 0 {
          if Instant::now() >= deadline {
            after_state.fail(63);
            break;
          }
          std::hint::spin_loop();
        }
      },
    );
    if status == Status::Ok {
      state.store(BROWSER_TSFN_BLOCKING_CLOSING_INDEX, 1);
    } else {
      state.fail(64);
    }
    state.store(BROWSER_TSFN_BLOCKING_RETURNED_INDEX, 1);
  });
  Ok(())
}

#[cfg(napi_tsfn_native_wait_test)]
#[napi(skip_typescript)]
pub fn arm_bounded_tsfn_post_call_native_wait() -> Result<()> {
  let (_, state) = browser_post_call_tsfn_test()?;
  state.store(BROWSER_TSFN_BLOCKING_WORKER_RELEASED_INDEX, 1);
  wait_for_browser_tsfn_state(
    &state,
    BROWSER_TSFN_NATIVE_QUEUE_CONFIRMED_INDEX,
    "post-call TSFN did not enter native N-API with a full queue",
  )?;
  wait_for_browser_tsfn_state(
    &state,
    BROWSER_TSFN_NATIVE_WAIT_ENTERED_INDEX,
    "post-call TSFN did not enter emnapi's condition wait",
  )?;
  wait_for_browser_tsfn_state(
    &state,
    BROWSER_TSFN_NATIVE_WAIT_ADDRESS_CONFIRMED_INDEX,
    "post-call TSFN did not wait on emnapi's TSFN condition word",
  )?;
  if state.load(BROWSER_TSFN_AFTER_NATIVE_ENTERED_INDEX) != 0
    || state.load(BROWSER_TSFN_BLOCKING_RETURNED_INDEX) != 0
  {
    state.fail(65);
    return Err(Error::new(
      Status::GenericFailure,
      "post-call TSFN left the native bounded wait while the browser owner was blocked",
    ));
  }
  Ok(())
}

#[cfg(napi_tsfn_native_wait_test)]
#[napi(skip_typescript)]
pub fn bounded_tsfn_post_call_abort_state() -> Vec<i32> {
  BROWSER_POST_CALL_TSFN
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .as_ref()
    .map_or_else(
      || vec![0; BROWSER_TSFN_COUNTER_COUNT],
      |test| {
        if BrowserBoundedTsfn::__test_owner_cleanup_context_count()
          == test.state.owner_cleanup_context_baseline
        {
          test
            .state
            .store(BROWSER_TSFN_CLEANUP_CONTEXT_RELEASED_INDEX, 1);
        }
        test.state.snapshot()
      },
    )
}

#[cfg(napi_tsfn_native_wait_test)]
#[napi(skip_typescript)]
pub fn abort_bounded_tsfn_post_call_from_owner_agent() -> Result<()> {
  let (tsfn, state) = browser_post_call_tsfn_test()?;
  if state.load(BROWSER_TSFN_AFTER_NATIVE_ENTERED_INDEX) == 0
    || state.load(BROWSER_TSFN_BLOCKING_RETURNED_INDEX) != 0
  {
    return Err(Error::new(
      Status::GenericFailure,
      "bounded TSFN call was not paused after a successful native call",
    ));
  }
  let (_, owner_agent, current_agent, is_owner_agent) = tsfn.__test_blocking_call_state();
  if owner_agent != BROWSER_TSFN_BROWSER_WINDOW_AGENT
    || current_agent != BROWSER_TSFN_BROWSER_WINDOW_AGENT
    || !is_owner_agent
  {
    state.fail(66);
    return Err(Error::new(
      Status::GenericFailure,
      "post-call TSFN abort did not run on the browser owner agent",
    ));
  }
  state.store(BROWSER_TSFN_OWNER_AGENT_CONFIRMED_INDEX, 1);
  tsfn.abort()?;
  state.store(BROWSER_TSFN_OWNER_ABORT_RETURNED_INDEX, 1);
  Ok(())
}

#[cfg(napi_tsfn_native_wait_test)]
#[napi(skip_typescript)]
pub fn release_bounded_tsfn_post_call_slot() -> Result<()> {
  let (_, state) = browser_post_call_tsfn_test()?;
  state.store(BROWSER_TSFN_AFTER_NATIVE_RELEASED_INDEX, 1);
  Ok(())
}

#[cfg(napi_tsfn_native_wait_test)]
#[napi(skip_typescript)]
pub fn finish_bounded_tsfn_post_call_abort() -> Result<()> {
  let mut stored = BROWSER_POST_CALL_TSFN
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner);
  let Some(test) = stored.as_ref() else {
    return Ok(());
  };
  if test.state.load(BROWSER_TSFN_BLOCKING_RETURNED_INDEX) == 0
    || test.state.load(BROWSER_TSFN_ABORT_OBSERVED_INACTIVE_INDEX) == 0
    || test.state.load(BROWSER_TSFN_FINALIZER_COMPLETED_INDEX) == 0
    || test.state.load(BROWSER_TSFN_CLEANUP_CONTEXT_RELEASED_INDEX) == 0
  {
    return Err(Error::new(
      Status::GenericFailure,
      "bounded TSFN post-call teardown has not completed",
    ));
  }
  BROWSER_TSFN_STATE.store(ptr::null_mut(), Ordering::Release);
  BROWSER_TSFN_STATE_PTR.store(0, Ordering::Release);
  stored.take();
  Ok(())
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
type ForeignEnvReferTsfn = ThreadsafeFunction<(), (), (), Status, false, false, 0>;

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
thread_local! {
  static FOREIGN_ENV_REFER_TSFN: RefCell<Option<ForeignEnvReferTsfn>> = const { RefCell::new(None) };
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "stashThreadsafeFunctionForEnvOwnership")]
fn stash_threadsafe_function_for_env_ownership(
  #[napi(ts_arg_type = "() => void")] value: ForeignEnvReferTsfn,
) {
  FOREIGN_ENV_REFER_TSFN.with(|stored| *stored.borrow_mut() = Some(value));
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "verifyThreadsafeFunctionOwnerEnv")]
#[allow(deprecated)]
fn verify_threadsafe_function_owner_env(env: &Env) -> Result<()> {
  FOREIGN_ENV_REFER_TSFN.with(|stored| {
    let mut stored = stored.borrow_mut();
    let value = stored
      .as_mut()
      .ok_or_else(|| Error::from_reason("no ThreadsafeFunction was stashed"))?;
    value.unref(env)?;
    value.refer(env)
  })
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "referThreadsafeFunctionForEnvOwnership")]
#[allow(deprecated)]
fn refer_threadsafe_function_for_env_ownership(env: &Env) -> Result<()> {
  FOREIGN_ENV_REFER_TSFN.with(|stored| {
    stored
      .borrow_mut()
      .as_mut()
      .ok_or_else(|| Error::from_reason("no ThreadsafeFunction was stashed"))?
      .refer(env)
  })
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "unrefThreadsafeFunctionForEnvOwnership")]
#[allow(deprecated)]
fn unref_threadsafe_function_for_env_ownership(env: &Env) -> Result<()> {
  FOREIGN_ENV_REFER_TSFN.with(|stored| {
    stored
      .borrow_mut()
      .as_mut()
      .ok_or_else(|| Error::from_reason("no ThreadsafeFunction was stashed"))?
      .unref(env)
  })
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "disposeThreadsafeFunctionForEnvOwnership")]
fn dispose_threadsafe_function_for_env_ownership() {
  FOREIGN_ENV_REFER_TSFN.with(|stored| drop(stored.borrow_mut().take()));
}

#[cfg(not(target_family = "wasm"))]
const TSFN_TEARDOWN_PAYLOAD_DROP_INDEX: usize = 0;
#[cfg(not(target_family = "wasm"))]
const TSFN_TEARDOWN_QUEUE_FULL_INDEX: usize = 1;
#[cfg(not(target_family = "wasm"))]
const TSFN_TEARDOWN_UNEXPECTED_INDEX: usize = 2;
#[cfg(not(target_family = "wasm"))]
const TSFN_TEARDOWN_JS_CALLBACK_INDEX: usize = 3;
#[cfg(not(target_family = "wasm"))]
const TSFN_CLOSING_FINALIZER_DROP_INDEX: usize = 4;
#[cfg(not(target_family = "wasm"))]
const TSFN_QUIESCENCE_FINALIZER_INDEX: usize = 5;
#[cfg(not(target_family = "wasm"))]
const TSFN_QUIESCENCE_JOIN_INDEX: usize = 6;
#[cfg(not(target_family = "wasm"))]
const TSFN_TEARDOWN_WAITER_ERROR_MASK_INDEX: usize = 7;
#[cfg(not(target_family = "wasm"))]
const TSFN_TEARDOWN_WAITER_SETTLED_MASK_INDEX: usize = 8;
#[cfg(not(target_family = "wasm"))]
const TSFN_TEARDOWN_COUNTER_COUNT: usize = 9;
#[cfg(not(target_family = "wasm"))]
const TSFN_SCENARIO_WORKER_BIT: i32 = 1;
#[cfg(not(target_family = "wasm"))]
const TSFN_CALLEE_HANDLED_CALL_ASYNC_WAITER_BIT: i32 = 1;
#[cfg(not(target_family = "wasm"))]
const TSFN_CALL_ASYNC_CATCH_WAITER_BIT: i32 = 1 << 1;
#[cfg(not(target_family = "wasm"))]
const TSFN_BOUNDED_CALL_ASYNC_CATCH_WAITER_BIT: i32 = 1 << 2;
#[cfg(not(target_family = "wasm"))]
const TSFN_UNHANDLED_CALL_ASYNC_WAITER_BIT: i32 = 1 << 3;
#[cfg(not(target_family = "wasm"))]
const TSFN_BLOCKING_CALLBACK_ENTERED_INDEX: usize = 0;
#[cfg(not(target_family = "wasm"))]
const TSFN_BLOCKING_QUEUE_FILLED_INDEX: usize = 1;
#[cfg(not(target_family = "wasm"))]
const TSFN_BLOCKING_CALL_STARTED_INDEX: usize = 2;
#[cfg(not(target_family = "wasm"))]
const TSFN_BLOCKING_CALL_RETURNED_INDEX: usize = 3;
#[cfg(not(target_family = "wasm"))]
const TSFN_BLOCKING_CALLBACK_MASK_INDEX: usize = 4;
#[cfg(not(target_family = "wasm"))]
const TSFN_BLOCKING_COMPLETED_INDEX: usize = 5;
#[cfg(not(target_family = "wasm"))]
const TSFN_BLOCKING_UNEXPECTED_INDEX: usize = 6;
#[cfg(not(target_family = "wasm"))]
const TSFN_BLOCKING_COUNTER_COUNT: usize = 7;
#[cfg(not(target_family = "wasm"))]
const TSFN_BLOCKING_CALLBACK_MASK: i32 = 0b111;
#[cfg(not(target_family = "wasm"))]
const TSFN_TEST_TIMEOUT: Duration = Duration::from_secs(10);
#[cfg(not(target_family = "wasm"))]
const TSFN_FINALIZER_LIVENESS_POLL_INTERVAL: Duration = Duration::from_millis(10);

#[cfg(not(target_family = "wasm"))]
struct TsfnTeardownState {
  counters: Int32Array,
}

#[cfg(not(target_family = "wasm"))]
impl TsfnTeardownState {
  fn new(counters: Int32Array) -> Result<Arc<Self>> {
    if counters.len() < TSFN_TEARDOWN_COUNTER_COUNT {
      return Err(Error::new(
        Status::InvalidArg,
        format!(
          "TSFN teardown counter array requires at least {TSFN_TEARDOWN_COUNTER_COUNT} entries"
        ),
      ));
    }
    Ok(Arc::new(Self { counters }))
  }

  fn counter(&self, index: usize) -> &AtomicI32 {
    // JavaScript owns the SharedArrayBuffer and accesses these slots only through Atomics.
    // Int32Array elements have the same size and alignment as AtomicI32.
    unsafe {
      &*self
        .counters
        .as_ref()
        .as_ptr()
        .add(index)
        .cast::<AtomicI32>()
    }
  }

  fn add(&self, index: usize) {
    self.counter(index).fetch_add(1, Ordering::SeqCst);
  }

  fn record_bit(&self, index: usize, bit: i32) {
    debug_assert_eq!(bit.count_ones(), 1);
    if self.counter(index).fetch_or(bit, Ordering::SeqCst) & bit != 0 {
      self.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
    }
  }

  fn load(&self, index: usize) -> i32 {
    self.counter(index).load(Ordering::SeqCst)
  }
}

#[cfg(not(target_family = "wasm"))]
struct TsfnBlockingState {
  counters: Int32Array,
}

#[cfg(not(target_family = "wasm"))]
impl TsfnBlockingState {
  fn new(counters: Int32Array) -> Result<Arc<Self>> {
    if counters.len() < TSFN_BLOCKING_COUNTER_COUNT {
      return Err(Error::new(
        Status::InvalidArg,
        format!(
          "TSFN blocking counter array requires at least {TSFN_BLOCKING_COUNTER_COUNT} entries"
        ),
      ));
    }
    let state = Arc::new(Self { counters });
    for index in 0..TSFN_BLOCKING_COUNTER_COUNT {
      if state.load(index) != 0 {
        return Err(Error::new(
          Status::InvalidArg,
          "TSFN blocking counters must be zero-initialized",
        ));
      }
    }
    Ok(state)
  }

  fn counter(&self, index: usize) -> &AtomicI32 {
    // JavaScript owns the SharedArrayBuffer and accesses these slots only through Atomics.
    // Int32Array elements have the same size and alignment as AtomicI32.
    unsafe {
      &*self
        .counters
        .as_ref()
        .as_ptr()
        .add(index)
        .cast::<AtomicI32>()
    }
  }

  fn store(&self, index: usize, value: i32) {
    self.counter(index).store(value, Ordering::SeqCst);
  }

  fn add(&self, index: usize) {
    self.counter(index).fetch_add(1, Ordering::SeqCst);
  }

  fn load(&self, index: usize) -> i32 {
    self.counter(index).load(Ordering::SeqCst)
  }

  fn wait_for(&self, index: usize, expected: i32) -> bool {
    let deadline = std::time::Instant::now() + TSFN_TEST_TIMEOUT;
    while self.load(index) != expected && std::time::Instant::now() < deadline {
      thread::sleep(Duration::from_millis(1));
    }
    self.load(index) == expected
  }

  fn finish_with_error(&self) {
    self.add(TSFN_BLOCKING_UNEXPECTED_INDEX);
    self.store(TSFN_BLOCKING_COMPLETED_INDEX, 1);
  }
}

#[cfg(not(target_family = "wasm"))]
struct PostFinalizeAddonProbe {
  entered_path: String,
  release_path: String,
  completed_path: String,
}

#[cfg(not(target_family = "wasm"))]
impl PostFinalizeAddonProbe {
  fn from_paths(
    entered_path: Option<String>,
    release_path: Option<String>,
    completed_path: Option<String>,
  ) -> Result<Option<Self>> {
    match (entered_path, release_path, completed_path) {
      (None, None, None) => Ok(None),
      (Some(entered_path), Some(release_path), Some(completed_path)) => Ok(Some(Self {
        entered_path,
        release_path,
        completed_path,
      })),
      _ => Err(Error::new(
        Status::InvalidArg,
        "post-finalization probe paths must be provided together",
      )),
    }
  }

  fn spawn(self, retained_tsfn: Option<ScenarioTsfn>) -> Result<()> {
    let (ready, started) = sync_channel(0);
    thread::spawn(move || {
      let entered_result = std::fs::write(&self.entered_path, b"entered")
        .map_err(|error| format!("failed to create post-finalization entered marker: {error}"));
      if ready.send(entered_result).is_err() {
        return;
      }

      let deadline = std::time::Instant::now() + Duration::from_secs(60);
      while !std::path::Path::new(&self.release_path).exists()
        && std::time::Instant::now() < deadline
      {
        thread::sleep(Duration::from_millis(1));
      }
      if !std::path::Path::new(&self.release_path).exists() {
        return;
      }
      if retained_tsfn.as_ref().is_some_and(|tsfn| !tsfn.aborted()) {
        return;
      }

      execute_post_finalize_addon_probe(&self.completed_path);
      drop(retained_tsfn);
    });
    started
      .recv()
      .map_err(|error| {
        Error::new(
          Status::GenericFailure,
          format!("post-finalization probe thread exited during setup: {error}"),
        )
      })?
      .map_err(|reason| Error::new(Status::GenericFailure, reason))
  }
}

#[cfg(not(target_family = "wasm"))]
#[inline(never)]
fn execute_post_finalize_addon_probe(completed_path: &str) {
  let _ = std::fs::write(completed_path, b"completed");
}

#[cfg(not(target_family = "wasm"))]
struct TsfnTeardownThread {
  stop: Sender<()>,
  worker: Mutex<Option<JoinHandle<()>>>,
  state: Arc<TsfnTeardownState>,
  identity_bit: i32,
}

#[cfg(not(target_family = "wasm"))]
impl TsfnTeardownThread {
  fn new(state: Arc<TsfnTeardownState>, identity_bit: i32) -> (Arc<Self>, Receiver<()>) {
    let (stop, stopped) = channel();
    (
      Arc::new(Self {
        stop,
        worker: Mutex::new(None),
        state,
        identity_bit,
      }),
      stopped,
    )
  }

  fn install(&self, worker: JoinHandle<()>) {
    let previous = self
      .worker
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .replace(worker);
    debug_assert!(previous.is_none());
  }

  fn quiesce(&self) {
    self
      .state
      .record_bit(TSFN_QUIESCENCE_FINALIZER_INDEX, self.identity_bit);
    #[cfg(not(feature = "noop"))]
    if try_start_async_runtime().is_ok() {
      self.state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
    }
    let _ = self.stop.send(());
    let worker = self
      .worker
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .take();
    match worker {
      Some(worker) => {
        if worker.join().is_err() {
          self.state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
        }
        // Each worker owns its TSFN's last Rust handle. Reaching this point
        // proves that handle Drop completed while the native finalizer was
        // active; the identity bit lets JavaScript assert every worker did so.
        self
          .state
          .record_bit(TSFN_QUIESCENCE_JOIN_INDEX, self.identity_bit);
      }
      None => self.state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX),
    }
  }
}

#[cfg(not(target_family = "wasm"))]
struct TsfnFinalizerLivenessControl {
  stop: Sender<()>,
  worker: Mutex<Option<JoinHandle<()>>>,
  joined_path: String,
}

#[cfg(not(target_family = "wasm"))]
impl TsfnFinalizerLivenessControl {
  fn install(&self, worker: JoinHandle<()>) {
    let previous = self
      .worker
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .replace(worker);
    debug_assert!(previous.is_none());
  }

  fn quiesce(&self) {
    let _ = self.stop.send(());
    let worker = self
      .worker
      .lock()
      .unwrap_or_else(std::sync::PoisonError::into_inner)
      .take()
      .expect("TSFN finalizer liveness worker must be installed");
    worker
      .join()
      .expect("TSFN finalizer liveness worker must not panic");
    std::fs::write(&self.joined_path, b"joined")
      .expect("TSFN finalizer liveness marker must be writable");
  }
}

#[cfg(not(target_family = "wasm"))]
fn start_tsfn_finalizer_liveness_worker<const WEAK: bool>(
  callback: Function<(), ()>,
  manual_stop_path: String,
  joined_path: String,
) -> Result<()> {
  let (stop, stopped) = channel();
  let control = Arc::new(TsfnFinalizerLivenessControl {
    stop,
    worker: Mutex::new(None),
    joined_path,
  });
  let finalizer_control = Arc::clone(&control);
  // SAFETY: The finalizer signals and joins the only native worker retaining
  // the TSFN, and never waits for a JavaScript callback or queued payload.
  let tsfn = unsafe {
    callback
      .build_threadsafe_function::<()>()
      .weak::<WEAK>()
      .build_callback_with_finalizer(|_| Ok(()), move || finalizer_control.quiesce())
  }?;
  let (ready, started) = sync_channel(0);
  let worker = thread::spawn(move || {
    if ready.send(()).is_err() {
      return;
    }
    loop {
      match stopped.recv_timeout(TSFN_FINALIZER_LIVENESS_POLL_INTERVAL) {
        Ok(()) | Err(RecvTimeoutError::Disconnected) => break,
        Err(RecvTimeoutError::Timeout) => {
          if std::path::Path::new(&manual_stop_path).exists() {
            break;
          }
        }
      }
    }
    drop(tsfn);
  });
  control.install(worker);
  started.recv().map_err(|error| {
    Error::new(
      Status::GenericFailure,
      format!("TSFN finalizer liveness worker exited during setup: {error}"),
    )
  })
}

#[cfg(not(target_family = "wasm"))]
#[napi]
pub fn start_referenced_tsfn_finalizer_liveness_worker(
  callback: Function<(), ()>,
  manual_stop_path: String,
  joined_path: String,
) -> Result<()> {
  start_tsfn_finalizer_liveness_worker::<false>(callback, manual_stop_path, joined_path)
}

#[cfg(not(target_family = "wasm"))]
#[napi]
pub fn start_weak_tsfn_finalizer_liveness_worker(
  callback: Function<(), ()>,
  manual_stop_path: String,
  joined_path: String,
) -> Result<()> {
  start_tsfn_finalizer_liveness_worker::<true>(callback, manual_stop_path, joined_path)
}

#[cfg(not(target_family = "wasm"))]
struct TsfnTeardownPayload {
  state: Arc<TsfnTeardownState>,
}

#[cfg(not(target_family = "wasm"))]
type ReentrantTsfn = ThreadsafeFunction<TsfnReentrantPayload, (), (), Status, false, false, 0>;

#[cfg(not(target_family = "wasm"))]
struct TsfnReentrantPayload {
  tsfn: Option<ReentrantTsfn>,
  state: Arc<TsfnTeardownState>,
}

#[cfg(not(target_family = "wasm"))]
impl Drop for TsfnReentrantPayload {
  fn drop(&mut self) {
    self.state.add(TSFN_TEARDOWN_PAYLOAD_DROP_INDEX);
    if let Some(tsfn) = self.tsfn.take() {
      let status = tsfn.call(
        TsfnReentrantPayload {
          tsfn: None,
          state: Arc::clone(&self.state),
        },
        ThreadsafeFunctionCallMode::NonBlocking,
      );
      if status != Status::Closing {
        self.state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
      }
    }
  }
}

#[cfg(not(target_family = "wasm"))]
impl Drop for TsfnTeardownPayload {
  fn drop(&mut self) {
    self.state.add(TSFN_TEARDOWN_PAYLOAD_DROP_INDEX);
  }
}

#[cfg(not(target_family = "wasm"))]
impl TsfnTeardownPayload {
  fn plain(state: Arc<TsfnTeardownState>) -> Self {
    Self { state }
  }
}

#[cfg(not(target_family = "wasm"))]
#[derive(Clone, Copy)]
enum TsfnTeardownWaiterExpectation {
  CallbackResult,
  OneshotCanceled,
}

#[cfg(not(target_family = "wasm"))]
fn record_tsfn_teardown_waiter_result(
  state: &TsfnTeardownState,
  identity_bit: i32,
  expectation: TsfnTeardownWaiterExpectation,
  result: Result<()>,
) {
  let expected_error = match (expectation, result) {
    (TsfnTeardownWaiterExpectation::CallbackResult, Err(error)) => {
      error.status == Status::PendingException
        || (error.status == Status::GenericFailure
          && error.reason == "Receive value from threadsafe function sender failed")
    }
    (TsfnTeardownWaiterExpectation::OneshotCanceled, Err(error)) => {
      error.status == Status::GenericFailure && error.reason == "oneshot canceled"
    }
    _ => false,
  };
  if expected_error {
    state.record_bit(TSFN_TEARDOWN_WAITER_ERROR_MASK_INDEX, identity_bit);
  } else {
    state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
  }
  state.record_bit(TSFN_TEARDOWN_WAITER_SETTLED_MASK_INDEX, identity_bit);
}

#[cfg(not(target_family = "wasm"))]
fn drive_tsfn_teardown_waiter<F>(
  future: F,
  state: Arc<TsfnTeardownState>,
  identity_bit: i32,
  expectation: TsfnTeardownWaiterExpectation,
  ready: SyncSender<std::result::Result<(), String>>,
) where
  F: Future<Output = Result<()>>,
{
  let mut future = pin!(future);
  let waker = futures::task::noop_waker();
  let mut context = Context::from_waker(&waker);
  match future.as_mut().poll(&mut context) {
    Poll::Pending => {
      if ready.send(Ok(())).is_err() {
        return;
      }
    }
    Poll::Ready(result) => {
      state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
      let _ = ready.send(Err(format!(
        "TSFN teardown waiter completed before environment teardown: {result:?}"
      )));
      return;
    }
  }

  record_tsfn_teardown_waiter_result(
    &state,
    identity_bit,
    expectation,
    futures::executor::block_on(future),
  );
}

#[cfg(not(target_family = "wasm"))]
fn prepare_tsfn_teardown_waiters(
  callback: &Function<(), ()>,
  state: &Arc<TsfnTeardownState>,
) -> Result<()> {
  let callee_handled_call_async_tsfn = callback
    .build_threadsafe_function::<TsfnTeardownPayload>()
    .callee_handled::<true>()
    .build_callback(|_| Ok(()))?;
  let call_async_catch_tsfn = callback
    .build_threadsafe_function::<TsfnTeardownPayload>()
    .build_callback(|_| Ok(()))?;
  let unhandled_call_async_tsfn = callback
    .build_threadsafe_function::<TsfnTeardownPayload>()
    .build_callback(|_| Ok(()))?;
  let bounded_call_async_catch_tsfn = callback
    .build_threadsafe_function::<TsfnTeardownPayload>()
    .max_queue_size::<1>()
    .build_callback(|_| Ok(()))?;

  let (callee_handled_call_async_ready, callee_handled_call_async_started) = sync_channel(0);
  let callee_handled_call_async_state = Arc::clone(state);
  thread::spawn(move || {
    let future = callee_handled_call_async_tsfn.call_async(Ok(TsfnTeardownPayload::plain(
      Arc::clone(&callee_handled_call_async_state),
    )));
    drive_tsfn_teardown_waiter(
      future,
      callee_handled_call_async_state,
      TSFN_CALLEE_HANDLED_CALL_ASYNC_WAITER_BIT,
      TsfnTeardownWaiterExpectation::CallbackResult,
      callee_handled_call_async_ready,
    );
  });

  let (call_async_catch_ready, call_async_catch_started) = sync_channel(0);
  let call_async_catch_state = Arc::clone(state);
  thread::spawn(move || {
    let future = call_async_catch_tsfn.call_async_catch(TsfnTeardownPayload::plain(Arc::clone(
      &call_async_catch_state,
    )));
    drive_tsfn_teardown_waiter(
      future,
      call_async_catch_state,
      TSFN_CALL_ASYNC_CATCH_WAITER_BIT,
      TsfnTeardownWaiterExpectation::CallbackResult,
      call_async_catch_ready,
    );
  });

  let (unhandled_call_async_ready, unhandled_call_async_started) = sync_channel(0);
  let unhandled_call_async_state = Arc::clone(state);
  thread::spawn(move || {
    let future = unhandled_call_async_tsfn.call_async(TsfnTeardownPayload::plain(Arc::clone(
      &unhandled_call_async_state,
    )));
    drive_tsfn_teardown_waiter(
      future,
      unhandled_call_async_state,
      TSFN_UNHANDLED_CALL_ASYNC_WAITER_BIT,
      TsfnTeardownWaiterExpectation::OneshotCanceled,
      unhandled_call_async_ready,
    );
  });

  let (bounded_ready, bounded_started) = sync_channel(0);
  let bounded_state = Arc::clone(state);
  thread::spawn(move || {
    let first = bounded_call_async_catch_tsfn
      .call_async_catch(TsfnTeardownPayload::plain(Arc::clone(&bounded_state)));
    let mut first = pin!(first);
    let waker = futures::task::noop_waker();
    let mut context = Context::from_waker(&waker);
    if let Poll::Ready(result) = first.as_mut().poll(&mut context) {
      bounded_state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
      let _ = bounded_ready.send(Err(format!(
        "bounded TSFN teardown waiter completed before environment teardown: {result:?}"
      )));
      return;
    }

    let second = bounded_call_async_catch_tsfn
      .call_async_catch(TsfnTeardownPayload::plain(Arc::clone(&bounded_state)));
    let mut second = pin!(second);
    match second.as_mut().poll(&mut context) {
      Poll::Ready(Err(error)) if error.status == Status::QueueFull => {
        if bounded_state.load(TSFN_TEARDOWN_PAYLOAD_DROP_INDEX) != 1 {
          bounded_state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
          let _ = bounded_ready.send(Err(
            "QueueFull TSFN payload was not reclaimed before the future completed".to_owned(),
          ));
          return;
        }
        bounded_state.add(TSFN_TEARDOWN_QUEUE_FULL_INDEX);
      }
      Poll::Ready(result) => {
        bounded_state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
        let _ = bounded_ready.send(Err(format!(
          "bounded TSFN second call did not fail with QueueFull: {result:?}"
        )));
        return;
      }
      Poll::Pending => {
        bounded_state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
        let _ = bounded_ready.send(Err(
          "bounded TSFN second call remained pending instead of failing with QueueFull".to_owned(),
        ));
        return;
      }
    }

    if bounded_ready.send(Ok(())).is_err() {
      return;
    }
    record_tsfn_teardown_waiter_result(
      &bounded_state,
      TSFN_BOUNDED_CALL_ASYNC_CATCH_WAITER_BIT,
      TsfnTeardownWaiterExpectation::CallbackResult,
      futures::executor::block_on(first),
    );
  });

  for started in [
    callee_handled_call_async_started,
    call_async_catch_started,
    unhandled_call_async_started,
    bounded_started,
  ] {
    started
      .recv()
      .map_err(|error| {
        Error::new(
          Status::GenericFailure,
          format!("TSFN teardown waiter thread exited during setup: {error}"),
        )
      })?
      .map_err(|reason| Error::new(Status::GenericFailure, reason))?;
  }
  Ok(())
}

#[cfg(not(target_family = "wasm"))]
type ClosingTsfn = ThreadsafeFunction<TsfnClosingPayload, (), (), Status, false, false, 0>;

#[cfg(not(target_family = "wasm"))]
struct TsfnClosingPayload {
  dropped: Arc<AtomicBool>,
  reentrant_tsfn: Option<ClosingTsfn>,
  state: Arc<TsfnTeardownState>,
}

#[cfg(not(target_family = "wasm"))]
struct TsfnClosingFinalizerDrop {
  state: Arc<TsfnTeardownState>,
}

#[cfg(not(target_family = "wasm"))]
impl Drop for TsfnClosingFinalizerDrop {
  fn drop(&mut self) {
    if self.state.load(TSFN_QUIESCENCE_FINALIZER_INDEX) != TSFN_SCENARIO_WORKER_BIT {
      self.state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
    }
    #[cfg(not(feature = "noop"))]
    if try_start_async_runtime().is_ok() {
      self.state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
    }
    self.state.add(TSFN_CLOSING_FINALIZER_DROP_INDEX);
    panic!("TSFN finalizer capture drop panic");
  }
}

#[cfg(not(target_family = "wasm"))]
impl Drop for TsfnClosingPayload {
  fn drop(&mut self) {
    self.dropped.store(true, Ordering::SeqCst);
    if let Some(tsfn) = self.reentrant_tsfn.take() {
      let status = tsfn.call(
        TsfnClosingPayload {
          dropped: Arc::clone(&self.dropped),
          reentrant_tsfn: None,
          state: Arc::clone(&self.state),
        },
        ThreadsafeFunctionCallMode::NonBlocking,
      );
      if status != Status::Closing {
        self.state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
      }
    }
  }
}

#[cfg(not(target_family = "wasm"))]
fn verify_tsfn_closing_ownership(
  callback: &Function<(), ()>,
  state: &Arc<TsfnTeardownState>,
) -> Result<()> {
  let tsfn = callback
    .build_threadsafe_function::<TsfnClosingPayload>()
    .build_callback(|_| Ok(()))?;
  // SAFETY: This TSFN has no native workers, tasks, or queued payloads.
  unsafe { tsfn.register_finalizer(|| {}) }?;
  // SAFETY: No worker exists yet. If duplicate-registration rejection regresses,
  // expect_err unwinds before one is spawned, so this empty callback cannot
  // leave native work running and never waits for JavaScript callbacks.
  let duplicate_error = unsafe { tsfn.register_finalizer(|| {}) }
    .expect_err("duplicate TSFN finalizer registration must fail");
  if duplicate_error.status != Status::InvalidArg {
    return Err(Error::new(
      Status::GenericFailure,
      format!(
        "duplicate TSFN finalizer registration returned {:?}",
        duplicate_error.status
      ),
    ));
  }

  tsfn.abort()?;
  let (finished, result) = sync_channel(0);
  let background_tsfn = tsfn.clone();
  // SAFETY: No worker has been spawned yet. If closing-state rejection regresses,
  // expect_err unwinds before the spawn below, so this empty callback cannot
  // leave native work running and never waits for JavaScript callbacks.
  let late_error = unsafe { background_tsfn.register_finalizer(|| {}) }
    .expect_err("closing TSFN finalizer registration must fail");
  if late_error.status != Status::Closing {
    return Err(Error::new(
      Status::GenericFailure,
      format!(
        "closing TSFN finalizer registration returned {:?}",
        late_error.status
      ),
    ));
  }
  let background_state = Arc::clone(state);
  let background_thread = thread::spawn(move || {
    let first_dropped = Arc::new(AtomicBool::new(false));
    let first_status = background_tsfn.call(
      TsfnClosingPayload {
        dropped: Arc::clone(&first_dropped),
        reentrant_tsfn: Some(background_tsfn.clone()),
        state: Arc::clone(&background_state),
      },
      ThreadsafeFunctionCallMode::Blocking,
    );
    if first_status != Status::Closing
      || !first_dropped.load(Ordering::SeqCst)
      || !background_tsfn.aborted()
    {
      let _ = finished.send(Err(format!(
        "first closing call was not rejected locally: status={first_status:?}, dropped={}, aborted={}",
        first_dropped.load(Ordering::SeqCst),
        background_tsfn.aborted()
      )));
      return;
    }

    let second_dropped = Arc::new(AtomicBool::new(false));
    let second_status = background_tsfn.call(
      TsfnClosingPayload {
        dropped: Arc::clone(&second_dropped),
        reentrant_tsfn: None,
        state: Arc::clone(&background_state),
      },
      ThreadsafeFunctionCallMode::NonBlocking,
    );
    if second_status != Status::Closing || !second_dropped.load(Ordering::SeqCst) {
      let _ = finished.send(Err(format!(
        "post-closing call reached N-API or leaked its payload: status={second_status:?}, dropped={}",
        second_dropped.load(Ordering::SeqCst)
      )));
      return;
    }

    drop(background_tsfn);
    let _ = finished.send(Ok(()));
  });

  let background_result = result
    .recv()
    .map_err(|error| {
      Error::new(
        Status::GenericFailure,
        format!("TSFN closing regression thread exited early: {error}"),
      )
    })
    .and_then(|result| result.map_err(|reason| Error::new(Status::GenericFailure, reason)));
  let join_result = background_thread.join().map_err(|_| {
    Error::new(
      Status::GenericFailure,
      "TSFN closing regression thread panicked",
    )
  });
  background_result.and(join_result)
}

#[cfg(not(target_family = "wasm"))]
fn verify_shared_tsfn_abort(callback: &Function<(), ()>) -> Result<()> {
  let tsfn = Arc::new(
    callback
      .build_threadsafe_function::<()>()
      .max_queue_size::<1>()
      .build_callback(|_| Ok(()))?,
  );
  // SAFETY: The only worker is joined below before this function returns, and
  // the finalizer never waits for queued JavaScript callbacks.
  unsafe { tsfn.register_finalizer(|| {}) }?;

  let first_status = tsfn.call((), ThreadsafeFunctionCallMode::NonBlocking);
  if first_status != Status::Ok {
    return Err(Error::new(
      Status::GenericFailure,
      format!("failed to fill the shared-abort TSFN queue: {first_status:?}"),
    ));
  }

  let blocking_tsfn = Arc::clone(&tsfn);
  let (entered, started) = sync_channel(0);
  let (finished, result) = sync_channel(0);
  let worker = thread::spawn(move || {
    if entered.send(()).is_err() {
      return;
    }
    let _ = finished.send(blocking_tsfn.call((), ThreadsafeFunctionCallMode::Blocking));
  });
  started.recv().map_err(|error| {
    Error::new(
      Status::GenericFailure,
      format!("shared-abort TSFN worker exited before blocking: {error}"),
    )
  })?;
  thread::sleep(Duration::from_millis(50));

  tsfn.abort()?;
  let blocking_status = result.recv_timeout(TSFN_TEST_TIMEOUT).map_err(|error| {
    Error::new(
      Status::WouldDeadlock,
      format!("shared TSFN abort did not wake its blocking caller: {error}"),
    )
  })?;
  let join_result = worker
    .join()
    .map_err(|_| Error::new(Status::GenericFailure, "shared-abort TSFN worker panicked"));
  if blocking_status != Status::Closing {
    return Err(Error::new(
      Status::GenericFailure,
      format!("shared-abort TSFN caller returned {blocking_status:?}"),
    ));
  }
  join_result
}

#[cfg(not(target_family = "wasm"))]
type ScenarioTsfn = ThreadsafeFunction<(), (), (), Status, false, false, 0>;

#[cfg(not(target_family = "wasm"))]
#[napi]
pub fn prepare_tsfn_blocking_call_regression(
  callback: Function<u32, ()>,
  counters: Int32Array,
  expect_cleanup_abort: bool,
) -> Result<()> {
  let state = TsfnBlockingState::new(counters)?;
  let tsfn = callback
    .build_threadsafe_function::<u32>()
    .max_queue_size::<1>()
    .build_callback(|ctx| Ok(ctx.value))?;
  let (ready, started) = sync_channel(0);
  thread::spawn(move || {
    let first_status = tsfn.call(0, ThreadsafeFunctionCallMode::NonBlocking);
    if first_status != Status::Ok {
      let _ = ready.send(Err(format!(
        "failed to enqueue the callback gate payload: {first_status:?}"
      )));
      state.finish_with_error();
      return;
    }
    if ready.send(Ok(())).is_err() {
      let _ = tsfn.abort();
      return;
    }

    if !state.wait_for(TSFN_BLOCKING_CALLBACK_ENTERED_INDEX, 1) {
      state.finish_with_error();
      let _ = tsfn.abort();
      return;
    }
    let queued_status = tsfn.call(1, ThreadsafeFunctionCallMode::NonBlocking);
    if queued_status != Status::Ok {
      state.finish_with_error();
      let _ = tsfn.abort();
      return;
    }
    state.store(TSFN_BLOCKING_QUEUE_FILLED_INDEX, 1);
    state.store(TSFN_BLOCKING_CALL_STARTED_INDEX, 1);

    let blocking_status = tsfn.call(2, ThreadsafeFunctionCallMode::Blocking);
    if expect_cleanup_abort {
      if blocking_status != Status::Ok && blocking_status != Status::Closing {
        state.finish_with_error();
        return;
      }
      state.store(TSFN_BLOCKING_CALL_RETURNED_INDEX, 1);
      state.store(TSFN_BLOCKING_COMPLETED_INDEX, 1);
      return;
    }
    if blocking_status != Status::Ok {
      state.finish_with_error();
      return;
    }
    state.store(TSFN_BLOCKING_CALL_RETURNED_INDEX, 1);
    if !state.wait_for(
      TSFN_BLOCKING_CALLBACK_MASK_INDEX,
      TSFN_BLOCKING_CALLBACK_MASK,
    ) {
      state.finish_with_error();
      return;
    }
    state.store(TSFN_BLOCKING_COMPLETED_INDEX, 1);
  });
  started
    .recv()
    .map_err(|error| {
      Error::new(
        Status::GenericFailure,
        format!("TSFN blocking regression thread exited during setup: {error}"),
      )
    })?
    .map_err(|reason| Error::new(Status::GenericFailure, reason))
}

#[cfg(not(target_family = "wasm"))]
fn install_tsfn_holder(
  control: &Arc<TsfnTeardownThread>,
  stop: Receiver<()>,
  tsfn: ScenarioTsfn,
  state: Arc<TsfnTeardownState>,
) -> Receiver<std::result::Result<(), String>> {
  let (ready, started) = sync_channel(0);
  control.install(thread::spawn(move || {
    if ready.send(Ok(())).is_err() {
      return;
    }
    if stop.recv().is_err() || !tsfn.aborted() {
      state.add(TSFN_TEARDOWN_UNEXPECTED_INDEX);
    }
  }));
  started
}

#[cfg(not(target_family = "wasm"))]
fn wait_for_tsfn_holder(started: Receiver<std::result::Result<(), String>>) -> Result<()> {
  started
    .recv()
    .map_err(|error| {
      Error::new(
        Status::GenericFailure,
        format!("TSFN holder thread exited before setup completed: {error}"),
      )
    })?
    .map_err(|reason| Error::new(Status::GenericFailure, reason))
}

#[cfg(not(target_family = "wasm"))]
fn prepare_clean_tsfn_scenario(
  callback: &Function<(), ()>,
  state: &Arc<TsfnTeardownState>,
) -> Result<()> {
  verify_tsfn_closing_ownership(callback, state)?;
  verify_shared_tsfn_abort(callback)?;

  let (control, stop) = TsfnTeardownThread::new(Arc::clone(state), TSFN_SCENARIO_WORKER_BIT);
  let finalizer_control = Arc::clone(&control);
  // SAFETY: quiesce signals and joins the only worker that owns this TSFN and
  // never waits for a queued JavaScript callback.
  let tsfn = unsafe {
    callback
      .build_threadsafe_function::<()>()
      .build_callback_with_finalizer(|_| Ok(()), move || finalizer_control.quiesce())
  }?;
  let started = install_tsfn_holder(&control, stop, tsfn, Arc::clone(state));
  wait_for_tsfn_holder(started)
}

#[cfg(not(target_family = "wasm"))]
fn prepare_finalizer_panic_tsfn_scenario(
  callback: &Function<(), ()>,
  state: &Arc<TsfnTeardownState>,
  probe: PostFinalizeAddonProbe,
) -> Result<()> {
  let (control, stop) = TsfnTeardownThread::new(Arc::clone(state), TSFN_SCENARIO_WORKER_BIT);
  let finalizer_control = Arc::clone(&control);
  let tsfn = callback
    .build_threadsafe_function::<()>()
    .build_callback(|_| Ok(()))?;
  // SAFETY: quiesce joins the only native worker before the intentional panic.
  // The panic is used to verify that finalization retains the native module.
  unsafe {
    tsfn.register_finalizer(move || {
      finalizer_control.quiesce();
      panic!("TSFN quiescence finalizer panic");
    })
  }?;
  let started = install_tsfn_holder(&control, stop, tsfn, Arc::clone(state));
  wait_for_tsfn_holder(started)?;
  probe.spawn(None)
}

#[cfg(not(target_family = "wasm"))]
fn prepare_callback_drop_panic_tsfn_scenario(
  callback: &Function<(), ()>,
  state: &Arc<TsfnTeardownState>,
  probe: PostFinalizeAddonProbe,
) -> Result<()> {
  let callback_drop = TsfnClosingFinalizerDrop {
    state: Arc::clone(state),
  };
  let tsfn = callback
    .build_threadsafe_function::<()>()
    .build_callback(move |_| {
      let _keep_alive = &callback_drop;
      Ok(())
    })?;
  let (control, stop) = TsfnTeardownThread::new(Arc::clone(state), TSFN_SCENARIO_WORKER_BIT);
  let finalizer_control = Arc::clone(&control);
  // SAFETY: quiesce joins the only native worker before the JavaScript callback
  // capture is destroyed. The capture's Drop verifies that ordering.
  unsafe {
    tsfn.register_finalizer(move || {
      finalizer_control.quiesce();
    })
  }?;
  let started = install_tsfn_holder(&control, stop, tsfn, Arc::clone(state));
  wait_for_tsfn_holder(started)?;
  probe.spawn(None)
}

#[cfg(not(target_family = "wasm"))]
fn prepare_unregistered_finalizer_tsfn_scenario(
  callback: &Function<(), ()>,
  probe: PostFinalizeAddonProbe,
) -> Result<()> {
  let tsfn = callback
    .build_threadsafe_function::<()>()
    .build_callback(|_| Ok(()))?;
  probe.spawn(Some(tsfn))
}

#[cfg(not(target_family = "wasm"))]
fn prepare_pending_payload_tsfn_scenario(
  callback: &Function<(), ()>,
  state: &Arc<TsfnTeardownState>,
) -> Result<()> {
  let reentrant_tsfn: ReentrantTsfn = callback
    .build_threadsafe_function::<TsfnReentrantPayload>()
    .build_callback(|_| Ok(()))?;
  let reentrant_status = reentrant_tsfn.call(
    TsfnReentrantPayload {
      tsfn: Some(reentrant_tsfn.clone()),
      state: Arc::clone(state),
    },
    ThreadsafeFunctionCallMode::NonBlocking,
  );
  if reentrant_status != Status::Ok {
    return Err(Error::new(
      Status::GenericFailure,
      format!("failed to enqueue the reentrant TSFN payload: {reentrant_status:?}"),
    ));
  }
  reentrant_tsfn.abort()?;
  prepare_tsfn_teardown_waiters(callback, state)
}

#[cfg(not(target_family = "wasm"))]
#[napi]
pub fn prepare_tsfn_teardown_regression(
  callback: Function<(), ()>,
  counters: Int32Array,
  scenario: String,
  post_finalize_entered_path: Option<String>,
  post_finalize_release_path: Option<String>,
  post_finalize_completed_path: Option<String>,
) -> Result<()> {
  let state = TsfnTeardownState::new(counters)?;
  for index in 0..TSFN_TEARDOWN_COUNTER_COUNT {
    if state.load(index) != 0 {
      return Err(Error::new(
        Status::InvalidArg,
        "TSFN teardown counters must be zero-initialized",
      ));
    }
  }
  let probe = PostFinalizeAddonProbe::from_paths(
    post_finalize_entered_path,
    post_finalize_release_path,
    post_finalize_completed_path,
  )?;

  match scenario.as_str() {
    "clean" => prepare_clean_tsfn_scenario(&callback, &state),
    "finalizer-panic" => prepare_finalizer_panic_tsfn_scenario(
      &callback,
      &state,
      probe.ok_or_else(|| {
        Error::new(
          Status::InvalidArg,
          "finalizer-panic requires post-finalization probe paths",
        )
      })?,
    ),
    "callback-drop-panic" => prepare_callback_drop_panic_tsfn_scenario(
      &callback,
      &state,
      probe.ok_or_else(|| {
        Error::new(
          Status::InvalidArg,
          "callback-drop-panic requires post-finalization probe paths",
        )
      })?,
    ),
    "unregistered-finalizer" => prepare_unregistered_finalizer_tsfn_scenario(
      &callback,
      probe.ok_or_else(|| {
        Error::new(
          Status::InvalidArg,
          "unregistered-finalizer requires post-finalization probe paths",
        )
      })?,
    ),
    "pending-payload" => prepare_pending_payload_tsfn_scenario(&callback, &state),
    _ => Err(Error::new(
      Status::InvalidArg,
      format!("Unknown TSFN teardown scenario: {scenario}"),
    )),
  }
}

#[napi]
pub fn call_threadsafe_function(
  tsfn: Arc<ThreadsafeFunction<u32, UnknownReturnValue>>,
) -> Result<()> {
  for n in 0..100 {
    let tsfn = tsfn.clone();
    thread::spawn(move || {
      tsfn.call(Ok(n), ThreadsafeFunctionCallMode::NonBlocking);
    });
  }
  Ok(())
}

#[napi]
pub fn call_long_threadsafe_function(
  tsfn: ThreadsafeFunction<u32, UnknownReturnValue>,
) -> Result<()> {
  thread::spawn(move || {
    for n in 0..10 {
      thread::sleep(Duration::from_millis(100));
      tsfn.call(Ok(n), ThreadsafeFunctionCallMode::NonBlocking);
    }
  });
  Ok(())
}

#[napi]
pub fn threadsafe_function_throw_error(
  cb: ThreadsafeFunction<bool, UnknownReturnValue>,
) -> Result<()> {
  thread::spawn(move || {
    cb.call(
      Err(Error::new(
        Status::GenericFailure,
        "ThrowFromNative".to_owned(),
      )),
      ThreadsafeFunctionCallMode::Blocking,
    );
  });
  Ok(())
}

pub struct ErrorStatus(String);
impl AsRef<str> for ErrorStatus {
  fn as_ref(&self) -> &str {
    &self.0
  }
}

impl From<Status> for ErrorStatus {
  fn from(value: Status) -> Self {
    ErrorStatus(value.to_string())
  }
}

#[cfg(target_family = "wasm")]
#[napi]
pub fn drop_unregistered_weak_tsfn_for_wasi(callback: Function<(), ()>) -> Result<()> {
  let tsfn = callback
    .build_threadsafe_function::<()>()
    .weak::<true>()
    .build_callback(|_| Ok(()))?;
  drop(tsfn);
  Ok(())
}

#[napi]
pub fn threadsafe_function_throw_error_with_status(
  cb: ThreadsafeFunction<bool, UnknownReturnValue, bool, ErrorStatus>,
) -> Result<()> {
  thread::spawn(move || {
    cb.call(
      Err(Error::new(
        ErrorStatus("CustomErrorStatus".to_string()),
        "ThrowFromNative".to_owned(),
      )),
      ThreadsafeFunctionCallMode::Blocking,
    );
  });
  Ok(())
}

#[napi]
pub fn threadsafe_function_build_throw_error_with_status(
  cb: Function<'static, (), ()>,
) -> Result<()> {
  let tsfn = cb
    .build_threadsafe_function()
    .error_status::<ErrorStatus>()
    .callee_handled::<true>()
    .build()?;
  thread::spawn(move || {
    tsfn.call(
      Err(Error::new(
        ErrorStatus("CustomErrorStatus".to_string()),
        "ThrowFromNative".to_owned(),
      )),
      ThreadsafeFunctionCallMode::Blocking,
    );
  });
  Ok(())
}

#[napi]
pub fn threadsafe_function_fatal_mode(
  cb: ThreadsafeFunction<bool, UnknownReturnValue, bool, Status, false>,
) -> Result<()> {
  thread::spawn(move || {
    cb.call(true, ThreadsafeFunctionCallMode::Blocking);
  });
  Ok(())
}

#[napi]
pub fn threadsafe_function_fatal_mode_error(
  cb: ThreadsafeFunction<bool, String, bool, Status, false>,
) -> Result<()> {
  thread::spawn(move || {
    cb.call_with_return_value(true, ThreadsafeFunctionCallMode::Blocking, |ret, _| {
      ret.map(|_| ())
    });
  });
  Ok(())
}

#[napi]
pub fn threadsafe_function_rust_panic(cb: Function<(), ()>) -> Result<()> {
  let tsfn = cb
    .build_threadsafe_function::<()>()
    .build_callback(|_| -> Result<()> {
      panic!("TSFN Rust callback panic");
    })?;
  thread::spawn(move || {
    tsfn.call((), ThreadsafeFunctionCallMode::Blocking);
  });
  Ok(())
}

#[napi]
pub fn threadsafe_function_rust_panic_callee_handled(cb: Function<Error, ()>) -> Result<()> {
  let tsfn = cb
    .build_threadsafe_function::<()>()
    .callee_handled::<true>()
    .build_callback(|_| -> Result<()> {
      panic!("TSFN Rust callback handled panic");
    })?;
  thread::spawn(move || {
    tsfn.call(Ok(()), ThreadsafeFunctionCallMode::Blocking);
  });
  Ok(())
}

#[napi]
fn threadsafe_function_closure_capture(
  env: Env,
  default_value: ClassInstance<Animal>,
  func: Function<Reference<Animal>, ()>,
) -> napi::Result<()> {
  let str = "test";
  let default_value_reference = default_value.clone_reference(env)?;
  let tsfn = func
    .build_threadsafe_function::<()>()
    .build_callback(move |ctx| {
      println!("Captured in ThreadsafeFunction {}", str); // str is NULL at this point
      default_value_reference.clone(ctx.env)
    })?;

  tsfn.call((), ThreadsafeFunctionCallMode::NonBlocking);

  Ok(())
}

#[napi]
pub fn tsfn_call_with_callback(tsfn: ThreadsafeFunction<(), String>) -> napi::Result<()> {
  tsfn.call_with_return_value(
    Ok(()),
    ThreadsafeFunctionCallMode::NonBlocking,
    |value: Result<String>, _| {
      let value = value.expect("Failed to retrieve value from JS");
      println!("{}", value);
      assert_eq!(value, "ReturnFromJavaScriptRawCallback".to_owned());
      Ok(())
    },
  );
  Ok(())
}

#[napi(ts_return_type = "Promise<void>")]
pub fn tsfn_async_call<'env>(
  env: &'env Env,
  func: Function<FnArgs<(u32, u32, u32)>, String>,
) -> napi::Result<PromiseRaw<'env, ()>> {
  let tsfn = func.build_threadsafe_function().build()?;

  env.spawn_future(async move {
    let msg = tsfn.call_async((0, 1, 2).into()).await?;
    assert_eq!(msg, "ReturnFromJavaScriptRawCallback".to_owned());
    Ok(())
  })
}

#[napi]
pub fn accept_threadsafe_function(func: ThreadsafeFunction<u32>) {
  thread::spawn(move || {
    func.call(Ok(1), ThreadsafeFunctionCallMode::NonBlocking);
  });
}

#[napi]
pub fn accept_threadsafe_function_fatal(func: ThreadsafeFunction<u32, (), u32, Status, false>) {
  thread::spawn(move || {
    func.call(1, ThreadsafeFunctionCallMode::NonBlocking);
  });
}

#[napi]
pub fn accept_threadsafe_function_tuple_args(
  func: ThreadsafeFunction<FnArgs<(u32, bool, String)>>,
) {
  thread::spawn(move || {
    func.call(
      Ok((1, false, "NAPI-RS".into()).into()),
      ThreadsafeFunctionCallMode::NonBlocking,
    );
  });
}

#[napi]
pub fn accept_threadsafe_function_tuple_no_fn_args(func: ThreadsafeFunction<(u32, bool, String)>) {
  thread::spawn(move || {
    func.call(
      Ok((1, false, "NAPI-RS".into())),
      ThreadsafeFunctionCallMode::NonBlocking,
    );
  });
}

#[napi]
pub async fn tsfn_return_promise(func: ThreadsafeFunction<u32, Promise<u32>>) -> Result<u32> {
  let val = func.call_async(Ok(1)).await?.await?;
  Ok(val + 2)
}

#[napi]
pub async fn tsfn_return_promise_timeout(
  func: ThreadsafeFunction<u32, Promise<u32>>,
) -> Result<u32> {
  use tokio::time::{self, Duration};
  let promise = func.call_async(Ok(1)).await?;
  let sleep = time::sleep(Duration::from_nanos(1));
  tokio::select! {
    _ = sleep => {
      Err(Error::new(Status::GenericFailure, "Timeout".to_owned()))
    }
    value = promise => {
      Ok(value? + 2)
    }
  }
}

#[napi]
pub fn call_async_with_unknown_return_value<'env>(
  env: &'env Env,
  tsfn: ThreadsafeFunction<u32, UnknownRef>,
) -> Result<PromiseRaw<'env, u32>> {
  env.spawn_future_with_callback(
    async move {
      let return_value = tsfn.call_async(Ok(42)).await?;
      Ok(return_value)
    },
    |env, value| {
      let return_value = value.get_value(env)?;
      let return_value = match return_value.get_type()? {
        ValueType::Object => Ok(110),
        _ => Ok(100),
      };
      value.unref(env)?;
      return_value
    },
  )
}

#[napi]
pub async fn tsfn_throw_from_js(tsfn: ThreadsafeFunction<u32, Promise<u32>>) -> napi::Result<u32> {
  tsfn.call_async(Ok(42)).await?.await
}

#[napi]
pub async fn tsfn_throw_from_js_catch(
  tsfn: ThreadsafeFunction<FnArgs<(String,)>, (), FnArgs<(String,)>, Status, false>,
) -> napi::Result<()> {
  tsfn.call_async_catch(("foo".to_string(),).into()).await
}

#[napi]
pub async fn tsfn_throw_from_js_catch_handled(
  tsfn: ThreadsafeFunction<FnArgs<(String,)>, ()>,
) -> napi::Result<()> {
  tsfn.call_async_catch(Ok(("foo".to_string(),).into())).await
}

#[napi]
pub async fn tsfn_throw_from_js_catch_recover(
  tsfn: ThreadsafeFunction<FnArgs<(String,)>, (), FnArgs<(String,)>, Status, false>,
) -> napi::Result<()> {
  match tsfn.call_async_catch(("trigger".to_string(),).into()).await {
    Ok(_) => Err(Error::new(
      Status::GenericFailure,
      "expected JS callback to throw, but it returned successfully".to_owned(),
    )),
    Err(err) => {
      // err.status should be PendingException because the source was a JS throw.
      if err.status != Status::PendingException {
        return Err(Error::new(
          Status::GenericFailure,
          format!("expected PendingException, got {:?}", err.status),
        ));
      }
      // Propagate the Err. Because err.maybe_raw holds a napi_ref to the
      // original JS exception object, `ToNapiValue for Error` recovers that
      // exact object on the way back to JS — so the JS test will see the
      // original error instance with all custom properties (e.g. `code`).
      Err(err)
    }
  }
}

#[napi]
pub async fn tsfn_throw_from_js_catch_drop_in_thread(
  tsfn: ThreadsafeFunction<FnArgs<(String,)>, (), FnArgs<(String,)>, Status, false>,
) -> napi::Result<String> {
  match tsfn.call_async_catch(("foo".to_string(),).into()).await {
    Ok(()) => Err(Error::new(
      Status::GenericFailure,
      "expected JS callback to throw, but it returned successfully".to_owned(),
    )),
    Err(err) => {
      let reason = err.reason.clone();
      // Drop the error on a different thread, like error values that are sent
      // across threads in real applications. On wasm targets this used to crash
      // the wasi worker with `Cannot read properties of undefined (reading
      // 'checkGCAccess')` because the error held a `napi_ref` created on the JS
      // thread. See https://github.com/rolldown/rolldown/issues/10075
      thread::spawn(move || drop(err))
        .join()
        .map_err(|_| Error::new(Status::GenericFailure, "drop thread panicked".to_owned()))?;
      Ok(reason)
    }
  }
}

#[napi]
pub async fn tsfn_throw_from_js_callback_contains_tsfn(
  tsfn: ThreadsafeFunction<u32, Promise<u32>>,
) {
  std::thread::spawn(move || {
    if let Err(e) = napi::bindgen_prelude::block_on(async move {
      tsfn.call_async(Ok(42)).await?.await?;
      Ok::<(), Error>(())
    }) {
      println!("Error in tsfn spawned thread: {}", e);
    }
  });
}

#[napi]
pub fn spawn_thread_in_thread(tsfn: ThreadsafeFunction<u32, u32>) {
  std::thread::spawn(move || {
    std::thread::spawn(move || {
      tsfn.call(Ok(42), ThreadsafeFunctionCallMode::NonBlocking);
    });
  });
}

#[napi(object, object_to_js = false)]
pub struct Pet {
  pub name: String,
  pub kind: u32,
  pub either_tsfn: Either<String, ThreadsafeFunction<i32, i32>>,
}

#[napi]
pub fn tsfn_in_either(pet: Pet) {
  if let Either::B(tsfn) = pet.either_tsfn {
    thread::spawn(move || {
      tsfn.call(Ok(42), ThreadsafeFunctionCallMode::NonBlocking);
    });
  }
}

#[napi]
pub async fn tsfn_weak(
  tsfn: ThreadsafeFunction<(), (), (), Status, false, true>,
) -> napi::Result<()> {
  tsfn.call_async(()).await
}
