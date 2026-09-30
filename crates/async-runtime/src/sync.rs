//! The `Mutex` and `Condvar` this crate locks and waits with, and its thread
//! join.
//!
//! On every target but `wasm32-wasip1-threads` (and outside this crate's
//! tests) these are `std::sync::Mutex`, `std::sync::Condvar` and
//! `JoinHandle::join` themselves: nothing changes there.
//!
//! # Threaded WASI: shutdown waits stop after a thread crash
//!
//! A pool thread that traps unwinds nothing. The locks it held stay held, the
//! work it was running never retires, and it never exits. The host runs
//! `begin_shutdown` and `finish_shutdown` on its JavaScript thread, and a
//! plain `lock`, `wait` or `join` there on any of those parks that thread in
//! `memory.atomic.wait32` for good -- before the loader can see the crash.
//!
//! So both shutdown phases open a [`BoundedWaits`] scope, and inside it this
//! thread waits in slices of at most `WAIT_SLICE` (1 ms): a contended lock is
//! tried again after each slice, a condvar wait unlocks, sleeps one slice and
//! locks again the same way (its callers loop on their predicate anyway, as
//! for any spurious wakeup), and a join waits for the thread to finish first.
//! The condvar wait cannot use std's `wait_timeout`: the timeout bounds only
//! the sleep, and the lock is taken back with an unbounded wait, which never
//! ends if a pool thread took the lock meanwhile and then trapped.
//!
//! Before each slice this thread reads the crash flag
//! (`napi_sys::wasi_thread_crash`), a word in the shared linear memory that
//! the cli's worker raises with `Atomics.store` when its wasm thread dies
//! (napi's `napi_wasm_thread_crash_flag_address` export gives the loader its
//! address), and once that is up the wait traps with `unreachable`. The
//! worker raises the loader's own crash flag first, so the loader reports
//! that trap as the crash. emnapi's `wasi_wait.c` does the same for waits in C; std's `Mutex` and `Condvar`
//! call `memory.atomic.wait32` directly, so they never reach it.
//!
//! Outside a scope the waits are std's own, so pool threads never wait in
//! slices. `lock` only tries the lock first, before it reads the scope flag,
//! which is the same first step `std::sync::Mutex::lock` takes.

#[cfg(not(any(napi_runtime_wasi_threads, test)))]
pub(crate) use std::sync::{Condvar, Condvar as UnboundedCondvar, Mutex, MutexGuard};

#[cfg(any(napi_runtime_wasi_threads, test))]
pub(crate) use bounded::{Condvar, Mutex, MutexGuard, UnboundedCondvar};
#[cfg(all(test, panic = "unwind"))]
pub(crate) use bounded::{GaveUpAfterThreadCrash, watch_crash_flag_for_test};

/// The longest a wait inside [`BoundedWaits`] sleeps before it checks the
/// crash flag again: 1 ms, like emnapi's waits on the runtime thread.
#[cfg(any(napi_runtime_wasi_threads, test))]
const WAIT_SLICE: std::time::Duration = std::time::Duration::from_millis(1);

/// Makes this thread's waits stop after a thread crash until it is dropped;
/// see the module docs. Nothing on targets other than `wasm32-wasip1-threads`.
#[must_use]
pub(crate) struct BoundedWaits {
  #[cfg(any(napi_runtime_wasi_threads, test))]
  previous: bool,
}

impl BoundedWaits {
  pub(crate) fn enter() -> Self {
    Self {
      #[cfg(any(napi_runtime_wasi_threads, test))]
      previous: bounded::IN_SCOPE.replace(true),
    }
  }
}

#[cfg(any(napi_runtime_wasi_threads, test))]
impl Drop for BoundedWaits {
  fn drop(&mut self) {
    bounded::IN_SCOPE.set(self.previous);
  }
}

/// `handle.join()`. Inside [`BoundedWaits`] it first waits in slices for the
/// thread to finish: a thread that trapped never does.
#[cfg(napi_runtime_os_threads)]
pub(crate) fn join<T>(handle: std::thread::JoinHandle<T>) -> std::thread::Result<T> {
  #[cfg(any(napi_runtime_wasi_threads, test))]
  if bounded::in_scope() {
    while !handle.is_finished() {
      bounded::wait_one_slice();
    }
  }
  handle.join()
}

#[cfg(any(napi_runtime_wasi_threads, test))]
mod bounded {
  use std::{
    cell::Cell,
    fmt,
    ops::{Deref, DerefMut},
    sync::{LockResult, PoisonError, TryLockError, TryLockResult, WaitTimeoutResult},
    time::Duration,
  };

  use super::WAIT_SLICE;

  thread_local! {
    /// Whether this thread is inside a [`super::BoundedWaits`] scope.
    pub(super) static IN_SCOPE: Cell<bool> = const { Cell::new(false) };
  }

  pub(super) fn in_scope() -> bool {
    IN_SCOPE.with(Cell::get)
  }

  /// `std::sync::Mutex`, whose `lock` waits in slices inside a scope.
  pub(crate) struct Mutex<T: ?Sized>(std::sync::Mutex<T>);

  impl<T> Mutex<T> {
    pub(crate) const fn new(value: T) -> Self {
      Self(std::sync::Mutex::new(value))
    }
  }

  impl<T: ?Sized> Mutex<T> {
    pub(crate) fn lock(&self) -> LockResult<MutexGuard<'_, T>> {
      match self.0.try_lock() {
        Ok(guard) => Ok(self.guard(guard)),
        Err(TryLockError::Poisoned(poisoned)) => Err(self.poisoned(poisoned)),
        Err(TryLockError::WouldBlock) if in_scope() => self.lock_in_slices(),
        Err(TryLockError::WouldBlock) => self.wrap(self.0.lock()),
      }
    }

    #[cold]
    fn lock_in_slices(&self) -> LockResult<MutexGuard<'_, T>> {
      loop {
        wait_one_slice();
        match self.0.try_lock() {
          Ok(guard) => return Ok(self.guard(guard)),
          Err(TryLockError::Poisoned(poisoned)) => return Err(self.poisoned(poisoned)),
          Err(TryLockError::WouldBlock) => {}
        }
      }
    }

    pub(crate) fn try_lock(&self) -> TryLockResult<MutexGuard<'_, T>> {
      match self.0.try_lock() {
        Ok(guard) => Ok(self.guard(guard)),
        Err(TryLockError::Poisoned(poisoned)) => {
          Err(TryLockError::Poisoned(self.poisoned(poisoned)))
        }
        Err(TryLockError::WouldBlock) => Err(TryLockError::WouldBlock),
      }
    }

    fn guard<'a>(&'a self, guard: std::sync::MutexGuard<'a, T>) -> MutexGuard<'a, T> {
      MutexGuard { mutex: self, guard }
    }

    fn poisoned<'a>(
      &'a self,
      poisoned: PoisonError<std::sync::MutexGuard<'a, T>>,
    ) -> PoisonError<MutexGuard<'a, T>> {
      PoisonError::new(self.guard(poisoned.into_inner()))
    }

    fn wrap<'a>(
      &'a self,
      result: LockResult<std::sync::MutexGuard<'a, T>>,
    ) -> LockResult<MutexGuard<'a, T>> {
      result
        .map(|guard| self.guard(guard))
        .map_err(|poisoned| self.poisoned(poisoned))
    }

    pub(crate) fn get_mut(&mut self) -> LockResult<&mut T> {
      self.0.get_mut()
    }

    #[cfg(all(test, panic = "unwind"))]
    pub(crate) fn is_poisoned(&self) -> bool {
      self.0.is_poisoned()
    }
  }

  impl<T: Default> Default for Mutex<T> {
    fn default() -> Self {
      Self::new(T::default())
    }
  }

  impl<T: ?Sized + fmt::Debug> fmt::Debug for Mutex<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
      self.0.fmt(f)
    }
  }

  /// `std::sync::MutexGuard`, plus the [`Mutex`] it locks: a condvar wait
  /// inside a scope takes the lock back through [`Mutex::lock`].
  pub(crate) struct MutexGuard<'a, T: ?Sized> {
    mutex: &'a Mutex<T>,
    guard: std::sync::MutexGuard<'a, T>,
  }

  impl<T: ?Sized> Deref for MutexGuard<'_, T> {
    type Target = T;

    fn deref(&self) -> &T {
      &self.guard
    }
  }

  impl<T: ?Sized> DerefMut for MutexGuard<'_, T> {
    fn deref_mut(&mut self) -> &mut T {
      &mut self.guard
    }
  }

  impl<T: ?Sized + fmt::Debug> fmt::Debug for MutexGuard<'_, T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
      self.guard.fmt(f)
    }
  }

  /// `std::sync::Condvar`, whose `wait` inside a scope unlocks, sleeps one
  /// slice and locks again in slices.
  #[derive(Debug, Default)]
  pub(crate) struct Condvar(std::sync::Condvar);

  impl Condvar {
    pub(crate) const fn new() -> Self {
      Self(std::sync::Condvar::new())
    }

    pub(crate) fn wait<'a, T>(&self, guard: MutexGuard<'a, T>) -> LockResult<MutexGuard<'a, T>> {
      let MutexGuard { mutex, guard } = guard;
      if !in_scope() {
        return mutex.wrap(self.0.wait(guard));
      }
      // Not `wait_timeout`: it takes the lock back with an unbounded wait (see
      // the module docs). Unlock, sleep one slice (a notification in between
      // is not seen, but the caller re-reads its predicate within one slice),
      // and lock again in slices. The return reads as a spurious wakeup.
      drop(guard);
      wait_one_slice();
      mutex.lock()
    }

    pub(crate) fn notify_all(&self) {
      self.0.notify_all();
    }
  }

  /// `std::sync::Condvar` for a [`Mutex`]'s guards, whose waits stay std's
  /// own in a scope too: the driver parker's, as before this module had a
  /// guard type of its own.
  #[derive(Debug, Default)]
  pub(crate) struct UnboundedCondvar(std::sync::Condvar);

  impl UnboundedCondvar {
    pub(crate) fn wait<'a, T>(&self, guard: MutexGuard<'a, T>) -> LockResult<MutexGuard<'a, T>> {
      let MutexGuard { mutex, guard } = guard;
      mutex.wrap(self.0.wait(guard))
    }

    pub(crate) fn wait_timeout<'a, T>(
      &self,
      guard: MutexGuard<'a, T>,
      timeout: Duration,
    ) -> LockResult<(MutexGuard<'a, T>, WaitTimeoutResult)> {
      let MutexGuard { mutex, guard } = guard;
      match self.0.wait_timeout(guard, timeout) {
        Ok((guard, timed_out)) => Ok((mutex.guard(guard), timed_out)),
        Err(poisoned) => {
          let (guard, timed_out) = poisoned.into_inner();
          Err(PoisonError::new((mutex.guard(guard), timed_out)))
        }
      }
    }

    pub(crate) fn notify_one(&self) {
      self.0.notify_one();
    }
  }

  /// Give up if a thread crashed, else sleep one slice.
  pub(super) fn wait_one_slice() {
    if host_thread_crashed() {
      give_up();
    }
    sleep_one_slice();
  }

  /// A timed wait on a condvar nothing notifies. On `wasm32-wasip1-threads`
  /// that is a timed `memory.atomic.wait32`, the wait std's own locks rely on
  /// and the one emnapi slices with. `std::thread::sleep` would go through
  /// WASI `poll_oneoff` instead, which each host implements its own way.
  fn sleep_one_slice() {
    static SLEEP: std::sync::Mutex<()> = std::sync::Mutex::new(());
    static NEVER_NOTIFIED: std::sync::Condvar = std::sync::Condvar::new();
    let guard = SLEEP.lock().unwrap_or_else(PoisonError::into_inner);
    drop(NEVER_NOTIFIED.wait_timeout(guard, WAIT_SLICE));
  }

  fn host_thread_crashed() -> bool {
    #[cfg(all(test, panic = "unwind"))]
    if TEST_CRASH_FLAG.with(|flag| {
      flag
        .borrow()
        .as_ref()
        .is_some_and(|flag| flag.load(std::sync::atomic::Ordering::SeqCst))
    }) {
      return true;
    }
    #[cfg(napi_runtime_wasi_threads)]
    {
      napi_sys::wasi_thread_crash::thread_crashed()
    }
    #[cfg(not(napi_runtime_wasi_threads))]
    {
      false
    }
  }

  /// Stop waiting for good: a trap, which the loader catches from its cleanup
  /// call. Tests get a [`GaveUpAfterThreadCrash`] panic instead.
  #[cold]
  #[inline(never)]
  fn give_up() -> ! {
    #[cfg(test)]
    std::panic::panic_any(GaveUpAfterThreadCrash);
    #[cfg(not(test))]
    core::arch::wasm32::unreachable()
  }

  /// The panic payload of a wait that gave up, in tests.
  #[cfg(test)]
  #[derive(Debug)]
  pub(crate) struct GaveUpAfterThreadCrash;

  #[cfg(all(test, panic = "unwind"))]
  thread_local! {
    static TEST_CRASH_FLAG: std::cell::RefCell<Option<std::sync::Arc<std::sync::atomic::AtomicBool>>> =
      const { std::cell::RefCell::new(None) };
  }

  /// Tests: this thread reads `flag` as the crash flag, as well as napi's.
  #[cfg(all(test, panic = "unwind"))]
  pub(crate) fn watch_crash_flag_for_test(flag: std::sync::Arc<std::sync::atomic::AtomicBool>) {
    TEST_CRASH_FLAG.with(|slot| *slot.borrow_mut() = Some(flag));
  }
}

#[cfg(all(test, napi_runtime_os_threads))]
mod tests {
  use std::{
    sync::{Arc, mpsc},
    time::Duration,
  };

  use super::{BoundedWaits, Condvar, Mutex};

  /// Lock `mutex` on another thread for `hold`, and return once it is held.
  fn hold_for(mutex: &Arc<Mutex<()>>, hold: Duration) -> std::thread::JoinHandle<()> {
    let (held_tx, held_rx) = mpsc::channel();
    let mutex = Arc::clone(mutex);
    let holder = std::thread::spawn(move || {
      let guard = mutex.lock().unwrap();
      held_tx.send(()).unwrap();
      std::thread::sleep(hold);
      drop(guard);
    });
    held_rx.recv().unwrap();
    holder
  }

  #[test]
  fn a_lock_in_a_scope_is_taken_once_it_is_released() {
    let mutex = Arc::new(Mutex::new(()));
    let holder = hold_for(&mutex, Duration::from_millis(20));
    let _bounded_waits = BoundedWaits::enter();
    assert!(mutex.lock().is_ok());
    holder.join().unwrap();
  }

  #[test]
  fn a_condvar_wait_in_a_scope_returns_after_one_slice() {
    // Nothing notifies: only the slice ends the wait. A caller loops on its
    // predicate, so this reads as a spurious wakeup.
    let (returned_tx, returned_rx) = mpsc::channel();
    let waiter = std::thread::spawn(move || {
      let mutex = Mutex::new(());
      let condvar = Condvar::new();
      let _bounded_waits = BoundedWaits::enter();
      drop(condvar.wait(mutex.lock().unwrap()).unwrap());
      returned_tx.send(()).unwrap();
    });
    returned_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("a bounded condvar wait must return after one slice");
    waiter.join().unwrap();
  }

  #[test]
  fn a_condvar_wait_in_a_scope_unlocks_and_sees_the_predicate() {
    let shared = Arc::new((Mutex::new(false), Condvar::new()));
    let (locked_tx, locked_rx) = mpsc::channel();
    let waiter = {
      let shared = Arc::clone(&shared);
      std::thread::spawn(move || {
        let (mutex, condvar) = &*shared;
        let _bounded_waits = BoundedWaits::enter();
        let mut ready = mutex.lock().unwrap();
        locked_tx.send(()).unwrap();
        while !*ready {
          ready = condvar.wait(ready).unwrap();
        }
      })
    };
    locked_rx.recv().unwrap();
    // Taken once the wait unlocks.
    *shared.0.lock().unwrap() = true;
    shared.1.notify_all();
    let (returned_tx, returned_rx) = mpsc::channel();
    std::thread::spawn(move || {
      waiter.join().unwrap();
      returned_tx.send(()).unwrap();
    });
    returned_rx
      .recv_timeout(Duration::from_secs(5))
      .expect("a bounded condvar wait must see its predicate turn true");
  }

  #[cfg(panic = "unwind")]
  mod after_a_thread_crash {
    use std::{
      panic::{AssertUnwindSafe, catch_unwind},
      sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
      },
      time::Duration,
    };

    use super::hold_for;
    use crate::sync::{
      BoundedWaits, Condvar, GaveUpAfterThreadCrash, Mutex, watch_crash_flag_for_test,
    };

    #[test]
    fn a_lock_outside_a_scope_still_waits_for_its_holder() {
      // Pool threads never open a scope: a crash elsewhere must not make
      // their waits give up.
      let mutex = Arc::new(Mutex::new(()));
      let holder = hold_for(&mutex, Duration::from_millis(20));
      watch_crash_flag_for_test(Arc::new(AtomicBool::new(true)));
      assert!(mutex.lock().is_ok());
      holder.join().unwrap();
    }

    #[test]
    fn a_join_in_a_scope_gives_up_on_a_thread_that_never_finishes() {
      // A pool thread that trapped never returns from its main function.
      let (release_tx, release_rx) = mpsc::channel::<()>();
      let stuck = std::thread::spawn(move || {
        let _ = release_rx.recv();
      });
      let crashed = Arc::new(AtomicBool::new(false));
      let (outcome_tx, outcome_rx) = mpsc::channel();
      let joiner = {
        let crashed = Arc::clone(&crashed);
        std::thread::spawn(move || {
          watch_crash_flag_for_test(crashed);
          let _bounded_waits = BoundedWaits::enter();
          let outcome = catch_unwind(AssertUnwindSafe(|| crate::sync::join(stuck)));
          outcome_tx
            .send(outcome.is_err_and(|payload| payload.is::<GaveUpAfterThreadCrash>()))
            .unwrap();
        })
      };
      assert!(
        outcome_rx.recv_timeout(Duration::from_millis(100)).is_err(),
        "with no thread crashed, the join must keep waiting"
      );
      crashed.store(true, Ordering::SeqCst);
      let gave_up = outcome_rx
        .recv_timeout(Duration::from_secs(5))
        .expect("the join must stop waiting once a thread crashed");
      assert!(gave_up, "the join must give up, not return");
      joiner.join().unwrap();
      drop(release_tx);
    }

    #[test]
    fn a_condvar_wait_in_a_scope_gives_up_on_a_lock_taken_during_the_wait() {
      // The wait releases the lock; a pool thread takes it and traps while
      // holding it. The wait must not take the lock back the way std's
      // `Condvar` does -- one wait for as long as the holder keeps it.
      let mutex = Arc::new(Mutex::new(false));
      let condvar = Arc::new(Condvar::new());
      let crashed = Arc::new(AtomicBool::new(false));
      let (locked_tx, locked_rx) = mpsc::channel();
      let (outcome_tx, outcome_rx) = mpsc::channel();
      let waiter = {
        let mutex = Arc::clone(&mutex);
        let condvar = Arc::clone(&condvar);
        let crashed = Arc::clone(&crashed);
        std::thread::spawn(move || {
          watch_crash_flag_for_test(crashed);
          let _bounded_waits = BoundedWaits::enter();
          let outcome = catch_unwind(AssertUnwindSafe(|| {
            let mut ready = mutex.lock().unwrap();
            locked_tx.send(()).unwrap();
            while !*ready {
              ready = condvar.wait(ready).unwrap();
            }
          }));
          outcome_tx
            .send(outcome.is_err_and(|payload| payload.is::<GaveUpAfterThreadCrash>()))
            .unwrap();
        })
      };
      locked_rx.recv().unwrap();
      // Outside a scope: this waits until the wait above released the lock.
      std::mem::forget(mutex.lock().unwrap());
      crashed.store(true, Ordering::SeqCst);
      let gave_up = outcome_rx
        .recv_timeout(Duration::from_secs(5))
        .expect("the wait must stop once a thread crashed, not re-lock without a bound");
      assert!(gave_up, "the wait must give up, not return");
      waiter.join().unwrap();
    }
  }
}
