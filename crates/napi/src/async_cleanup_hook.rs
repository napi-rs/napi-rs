use std::{
  cell::{Cell, RefCell},
  ffi::c_void,
  ptr,
  rc::Rc,
};

use crate::{sys, Status};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AsyncCleanupHookState {
  Registered,
  Running,
  Removing,
  Removed,
}

pub(crate) struct AsyncCleanupHookData {
  state: Cell<AsyncCleanupHookState>,
  callback: RefCell<Option<Box<dyn FnOnce()>>>,
}

impl AsyncCleanupHookData {
  pub(crate) fn new<F>(callback: F) -> Rc<Self>
  where
    F: FnOnce() + 'static,
  {
    Rc::new(Self {
      state: Cell::new(AsyncCleanupHookState::Registered),
      callback: RefCell::new(Some(Box::new(callback))),
    })
  }

  pub(crate) fn native_data(data: &Rc<Self>) -> *mut c_void {
    Rc::into_raw(Rc::clone(data)).cast_mut().cast()
  }

  pub(crate) unsafe fn reclaim_native_data(data: *mut c_void) {
    drop(unsafe { Rc::from_raw(data.cast::<Self>()) });
  }

  pub(crate) unsafe fn run_callback(
    handle: sys::napi_async_cleanup_hook_handle,
    data: *mut c_void,
  ) {
    let remove_error = unsafe {
      Self::run_callback_with(handle, data, |handle| {
        sys::napi_remove_async_cleanup_hook(handle)
      })
    };
    if let Some(status) = remove_error {
      crate::bindgen_runtime::catch_unwind_safely(|| {
        panic!(
          "Remove async cleanup hook failed after async cleanup callback: {}",
          Status::from(status)
        );
      });
    }
  }

  unsafe fn run_callback_with(
    handle: sys::napi_async_cleanup_hook_handle,
    data: *mut c_void,
    remove: impl FnOnce(sys::napi_async_cleanup_hook_handle) -> sys::napi_status,
  ) -> Option<sys::napi_status> {
    crate::bindgen_runtime::with_runtime_teardown_guard(|| {
      let data_ptr = data.cast::<Self>();
      let data_ref = unsafe { &*data_ptr };
      if data_ref.state.get() != AsyncCleanupHookState::Registered {
        return None;
      }
      data_ref.state.set(AsyncCleanupHookState::Running);
      let data = unsafe { Rc::from_raw(data_ptr) };
      let callback = data.callback.borrow_mut().take();
      if let Some(callback) = callback {
        crate::bindgen_runtime::catch_unwind_safely(callback);
      }

      if !handle.is_null() {
        let status = remove(handle);
        if status != sys::Status::napi_ok {
          data.state.set(AsyncCleanupHookState::Registered);
          // The runtime may still retain the native callback pointer after a failed removal.
          // Preserve that ownership token and leave the hook retryable.
          std::mem::forget(data);
          return Some(status);
        }
      }
      data.state.set(AsyncCleanupHookState::Removed);
      None
    })
  }
}

/// A uniquely owned removable asynchronous environment cleanup hook.
///
/// Dropping this handle removes the hook and reclaims its callback allocation. Call [`forget`]
/// to leave the native registration responsible for invoking and reclaiming the callback.
///
/// [`forget`]: Self::forget
pub struct AsyncCleanupHook {
  handle: sys::napi_async_cleanup_hook_handle,
  data: Option<Rc<AsyncCleanupHookData>>,
}

impl AsyncCleanupHook {
  pub(crate) fn new(
    handle: sys::napi_async_cleanup_hook_handle,
    data: Rc<AsyncCleanupHookData>,
  ) -> Self {
    Self {
      handle,
      data: Some(data),
    }
  }

  /// Leave the hook registered until environment cleanup.
  pub fn forget(mut self) {
    self.handle = ptr::null_mut();
    self.data.take();
  }

  fn remove_with(
    &mut self,
    remove: impl FnOnce(sys::napi_async_cleanup_hook_handle) -> sys::napi_status,
  ) -> sys::napi_status {
    if self.handle.is_null() {
      self.data.take();
      return sys::Status::napi_ok;
    }
    let Some(data) = self.data.take() else {
      self.handle = ptr::null_mut();
      return sys::Status::napi_ok;
    };

    match data.state.get() {
      AsyncCleanupHookState::Registered => {
        data.state.set(AsyncCleanupHookState::Removing);
        let status = remove(self.handle);
        if status == sys::Status::napi_ok {
          data.state.set(AsyncCleanupHookState::Removed);
          unsafe {
            AsyncCleanupHookData::reclaim_native_data(
              Rc::as_ptr(&data).cast_mut().cast::<c_void>(),
            );
          }
          self.handle = ptr::null_mut();
        } else {
          data.state.set(AsyncCleanupHookState::Registered);
          self.data = Some(data);
        }
        status
      }
      AsyncCleanupHookState::Running | AsyncCleanupHookState::Removed => {
        self.handle = ptr::null_mut();
        sys::Status::napi_ok
      }
      AsyncCleanupHookState::Removing => {
        self.data = Some(data);
        sys::Status::napi_generic_failure
      }
    }
  }
}

impl Drop for AsyncCleanupHook {
  fn drop(&mut self) {
    let status = self.remove_with(|handle| unsafe { sys::napi_remove_async_cleanup_hook(handle) });
    assert!(
      status == sys::Status::napi_ok,
      "Delete async cleanup hook failed: {}",
      Status::from(status)
    );
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
  fn failed_registration_reclaims_callback_capture() {
    let capture_drops = Rc::new(Cell::new(0));
    let capture = DropProbe(Rc::clone(&capture_drops));
    let data = AsyncCleanupHookData::new(move || drop(capture));
    let native_data = AsyncCleanupHookData::native_data(&data);

    unsafe { AsyncCleanupHookData::reclaim_native_data(native_data) };
    drop(data);

    assert_eq!(capture_drops.get(), 1);
  }

  #[test]
  fn failed_callback_removal_can_be_retried_by_the_handle() {
    let capture_drops = Rc::new(Cell::new(0));
    let capture = DropProbe(Rc::clone(&capture_drops));
    let data = AsyncCleanupHookData::new(move || drop(capture));
    let native_data = AsyncCleanupHookData::native_data(&data);
    let handle = 1usize as sys::napi_async_cleanup_hook_handle;

    let remove_error = unsafe {
      AsyncCleanupHookData::run_callback_with(handle, native_data, |_| {
        sys::Status::napi_generic_failure
      })
    };

    assert_eq!(remove_error, Some(sys::Status::napi_generic_failure));
    assert_eq!(capture_drops.get(), 1);
    assert_eq!(data.state.get(), AsyncCleanupHookState::Registered);
    assert!(data.callback.borrow().is_none());

    let mut hook = AsyncCleanupHook::new(handle, data);
    assert_eq!(
      hook.remove_with(|_| sys::Status::napi_ok),
      sys::Status::napi_ok
    );
    assert!(hook.handle.is_null());
    assert!(hook.data.is_none());
    drop(hook);

    assert_eq!(capture_drops.get(), 1);
  }
}
