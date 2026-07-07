use std::{cell::Cell, ptr::NonNull, rc::Rc};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CleanupEnvHookState {
  Registered,
  Running,
  Finished,
}

struct CleanupEnvHookStateGuard(Rc<Cell<CleanupEnvHookState>>);

impl Drop for CleanupEnvHookStateGuard {
  fn drop(&mut self) {
    self.0.set(CleanupEnvHookState::Finished);
  }
}

pub(crate) struct CleanupEnvHookData<T: 'static> {
  pub(crate) data: T,
  pub(crate) hook: Box<dyn FnOnce(T)>,
}

unsafe fn drop_cleanup_env_hook_data<T: 'static>(data: NonNull<CleanupEnvHookData<T>>) {
  let CleanupEnvHookData { data, hook } = unsafe { *Box::from_raw(data.as_ptr()) };
  drop(data);
  drop(hook);
}

pub(crate) struct PendingCleanupEnvHook<T: 'static> {
  data: Option<NonNull<CleanupEnvHookData<T>>>,
  state: Rc<Cell<CleanupEnvHookState>>,
}

impl<T: 'static> PendingCleanupEnvHook<T> {
  pub(crate) fn new<F>(data: T, hook: F) -> Self
  where
    F: 'static + FnOnce(T),
  {
    let state = Rc::new(Cell::new(CleanupEnvHookState::Registered));
    let callback_state = Rc::clone(&state);
    Self {
      data: NonNull::new(Box::into_raw(Box::new(CleanupEnvHookData {
        data,
        hook: Box::new(move |data| {
          let previous_state = callback_state.replace(CleanupEnvHookState::Running);
          debug_assert_eq!(previous_state, CleanupEnvHookState::Registered);
          let _state_guard = CleanupEnvHookStateGuard(Rc::clone(&callback_state));
          hook(data);
        }),
      }))),
      state,
    }
  }

  #[cfg(not(all(target_family = "wasm", feature = "noop")))]
  pub(crate) fn as_ptr(&self) -> *mut CleanupEnvHookData<T> {
    self
      .data
      .expect("cleanup hook data must be present")
      .as_ptr()
  }

  pub(crate) fn commit(mut self) -> CleanupEnvHook<T> {
    CleanupEnvHook {
      data: self.data.take(),
      state: Rc::clone(&self.state),
    }
  }
}

impl<T: 'static> Drop for PendingCleanupEnvHook<T> {
  fn drop(&mut self) {
    if let Some(data) = self.data.take() {
      unsafe { drop_cleanup_env_hook_data(data) };
    }
  }
}

/// Created by [`crate::Env::add_env_cleanup_hook`] and consumed by
/// [`crate::Env::remove_env_cleanup_hook`].
///
/// The handle intentionally does not implement `Clone` or `Copy`: successful removal reclaims the
/// registered callback allocation, so only one handle may own the right to remove it.
pub struct CleanupEnvHook<T: 'static> {
  data: Option<NonNull<CleanupEnvHookData<T>>>,
  state: Rc<Cell<CleanupEnvHookState>>,
}

impl<T: 'static> CleanupEnvHook<T> {
  #[cfg(not(all(target_family = "wasm", feature = "noop")))]
  pub(crate) fn registered_ptr(&self) -> Option<*mut CleanupEnvHookData<T>> {
    (self.state.get() != CleanupEnvHookState::Finished).then(|| {
      self
        .data
        .expect("cleanup hook data must be present")
        .as_ptr()
    })
  }

  pub(crate) unsafe fn reclaim(mut self) {
    let data = self.data.take().expect("cleanup hook data must be present");
    if self.state.get() == CleanupEnvHookState::Registered {
      unsafe { drop_cleanup_env_hook_data(data) };
    }
  }
}

#[cfg(all(target_family = "wasm", feature = "noop"))]
impl<T: 'static> Drop for CleanupEnvHook<T> {
  fn drop(&mut self) {
    if let Some(data) = self.data.take() {
      unsafe { drop_cleanup_env_hook_data(data) };
    }
  }
}

#[cfg(test)]
mod tests {
  use std::{cell::Cell, rc::Rc};

  use super::*;

  struct DropProbe(Rc<Cell<usize>>);

  impl Drop for DropProbe {
    fn drop(&mut self) {
      self.0.set(self.0.get() + 1);
    }
  }

  #[test]
  fn failed_registration_reclaims_data_and_callback_capture() {
    let data_drops = Rc::new(Cell::new(0));
    let capture_drops = Rc::new(Cell::new(0));
    let callback_calls = Rc::new(Cell::new(0));
    let capture = DropProbe(Rc::clone(&capture_drops));
    let callback_calls_in_hook = Rc::clone(&callback_calls);

    let pending = PendingCleanupEnvHook::new(DropProbe(Rc::clone(&data_drops)), move |_data| {
      callback_calls_in_hook.set(callback_calls_in_hook.get() + 1);
      drop(capture);
    });
    drop(pending);

    assert_eq!(data_drops.get(), 1);
    assert_eq!(capture_drops.get(), 1);
    assert_eq!(callback_calls.get(), 0);
  }
}
