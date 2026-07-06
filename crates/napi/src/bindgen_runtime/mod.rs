use std::ffi::c_void;
use std::sync::Arc;

pub use callback_info::*;
pub use class_accessor::*;
pub use env::*;
pub use iterator::Generator;
pub use js_values::*;
pub use module_register::*;

use super::sys;
use crate::{Error, JsError, Result, Status};

#[cfg(any(feature = "tokio_rt", feature = "async-runtime"))]
pub mod async_iterator;
#[cfg(any(feature = "tokio_rt", feature = "async-runtime"))]
pub use async_iterator::AsyncGenerator;
mod callback_info;
mod class_accessor;
mod env;
mod error;
pub mod iterator;
mod js_values;
mod module_register;

pub trait ObjectFinalize: Sized {
  /// Runs custom finalization before the native value is dropped.
  ///
  /// The runtime retains ownership so a panic from this method and a panic from
  /// `Drop` can be contained independently at the Node-API boundary.
  #[allow(unused)]
  fn finalize(&mut self, env: Env) -> Result<()> {
    Ok(())
  }
}

#[doc(hidden)]
pub fn panic_to_error(e: Box<dyn std::any::Any + Send>) -> Error {
  let message = {
    if let Some(string) = e.downcast_ref::<String>() {
      string.clone()
    } else if let Some(string) = e.downcast_ref::<&str>() {
      string.to_string()
    } else {
      format!("panic from Rust code: {:?}", e)
    }
  };
  catch_unwind_safely(|| drop(e));
  Error::new(Status::GenericFailure, message)
}

pub(crate) fn catch_unwind_safely(f: impl FnOnce()) {
  if let Err(payload) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
    // A malicious panic payload may panic again from Drop. Leaking only that exceptional
    // payload is preferable to a double panic crossing an FFI or teardown boundary.
    std::mem::forget(payload);
  }
}

#[cfg_attr(feature = "noop", allow(dead_code))]
pub(crate) fn with_runtime_teardown_guard<T>(f: impl FnOnce() -> T) -> T {
  #[cfg(all(
    not(feature = "noop"),
    any(feature = "async-runtime", feature = "tokio_rt")
  ))]
  {
    crate::tokio_runtime::with_runtime_teardown_guard(f)
  }
  #[cfg(not(all(
    not(feature = "noop"),
    any(feature = "async-runtime", feature = "tokio_rt")
  )))]
  {
    f()
  }
}

pub(crate) fn with_runtime_finalizer_guard<T>(_env: sys::napi_env, f: impl FnOnce() -> T) -> T {
  #[cfg(all(
    not(feature = "noop"),
    any(feature = "async-runtime", feature = "tokio_rt")
  ))]
  {
    crate::tokio_runtime::with_runtime_finalizer_guard(_env, f)
  }
  #[cfg(not(all(
    not(feature = "noop"),
    any(feature = "async-runtime", feature = "tokio_rt")
  )))]
  {
    f()
  }
}

/// # Safety
///
/// called when node wrapper objects destroyed
#[doc(hidden)]
pub(crate) unsafe extern "C" fn raw_finalize_unchecked<T: ObjectFinalize>(
  env: sys::napi_env,
  finalize_data: *mut c_void,
  _finalize_hint: *mut c_void,
) {
  let data: Box<T> = unsafe { Box::from_raw(finalize_data.cast()) };
  unsafe { finalize_object(env, *data, finalize_data) };
}

pub(crate) unsafe fn finalize_object<T: ObjectFinalize>(
  env: sys::napi_env,
  data: T,
  finalize_data: *mut c_void,
) {
  unsafe {
    finalize_object_with(env, data, finalize_data, |env, reference| {
      sys::napi_delete_reference(env, reference)
    });
  }
}

pub(crate) unsafe fn finalize_object_with<T: ObjectFinalize>(
  env: sys::napi_env,
  data: T,
  finalize_data: *mut c_void,
  delete_reference: impl FnMut(sys::napi_env, sys::napi_ref) -> sys::napi_status,
) {
  let mut data = std::mem::ManuallyDrop::new(data);
  let mut delete_reference = std::mem::ManuallyDrop::new(delete_reference);
  let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
    with_runtime_finalizer_guard(env, || unsafe {
      run_object_finalizer(env, &mut *data, finalize_data, &mut *delete_reference)
    })
  }))
  .unwrap_or_else(|payload| Err(panic_to_error(payload)));

  catch_unwind_safely(|| unsafe {
    std::mem::ManuallyDrop::drop(&mut delete_reference);
  });
  let mut data_drop_started = false;
  catch_unwind_safely(|| {
    with_runtime_finalizer_guard(env, || {
      data_drop_started = true;
      catch_unwind_safely(|| unsafe {
        std::mem::ManuallyDrop::drop(&mut data);
      });
    });
  });
  if !data_drop_started {
    catch_unwind_safely(|| unsafe {
      std::mem::ManuallyDrop::drop(&mut data);
    });
  }

  if let Err(err) = result {
    catch_unwind_safely(|| {
      let e: JsError = err.into();
      unsafe { e.throw_into(env) };
    });
  }
}

fn merge_object_finalize_cleanup_error(result: &mut Result<()>, cleanup_error: Error) {
  let report = format!("Object finalizer cleanup failed: {}", cleanup_error.reason);
  catch_unwind_safely(|| eprintln!("{report}"));
  if let Err(error) = result {
    error.reason.push_str("; ");
    error.reason.push_str(&cleanup_error.reason);
  } else {
    *result = Err(cleanup_error);
  }
}

unsafe fn run_object_finalizer<T: ObjectFinalize, DeleteReference>(
  env: sys::napi_env,
  data: &mut T,
  finalize_data: *mut c_void,
  delete_reference: &mut DeleteReference,
) -> Result<()>
where
  DeleteReference: FnMut(sys::napi_env, sys::napi_ref) -> sys::napi_status,
{
  let mut result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
    data.finalize(Env::from_raw(env))
  }))
  .unwrap_or_else(|payload| Err(panic_to_error(payload)));
  if let Some((_, ref_val, finalize_callbacks_ptr)) =
    REFERENCE_MAP.with(|cell| cell.borrow_mut(|reference_map| reference_map.remove(&finalize_data)))
  {
    let finalize_callbacks_rc = unsafe { Arc::from_raw(finalize_callbacks_ptr) };

    #[cfg(all(debug_assertions, not(target_family = "wasm")))]
    {
      let rc_strong_count = Arc::strong_count(&finalize_callbacks_rc);
      // If `Arc` strong count is 2, it means the finalize of referenced `Object` is called before the `fn drop` of the `Reference`
      // It always happened on exiting process
      // In general, the `fn drop` would happen first
      if rc_strong_count != 1 && rc_strong_count != 2 {
        eprintln!("Arc strong count is: {rc_strong_count}, it should be 1 or 2");
      }
    }
    for mut finalize in finalize_callbacks_rc.take().into_iter().rev() {
      catch_unwind_safely(&mut finalize);
      catch_unwind_safely(|| drop(finalize));
    }
    let delete_reference_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
      delete_reference(env, ref_val)
    }));
    let cleanup_error = match delete_reference_result {
      Ok(sys::Status::napi_ok) => None,
      Ok(delete_reference_status) => {
        let status = Status::from(delete_reference_status);
        Some(Error::new(
          status,
          format!("Delete reference in finalize callback failed {status}"),
        ))
      }
      Err(payload) => {
        let error = panic_to_error(payload);
        Some(Error::new(
          Status::GenericFailure,
          format!(
            "Delete reference in finalize callback panicked: {}",
            error.reason
          ),
        ))
      }
    };
    if let Some(cleanup_error) = cleanup_error {
      merge_object_finalize_cleanup_error(&mut result, cleanup_error);
    }
  }
  result
}

/// # Safety
///
/// called when node buffer is ready for gc
#[doc(hidden)]
pub unsafe extern "C" fn drop_buffer(
  _env: sys::napi_env,
  #[allow(unused)] finalize_data: *mut c_void,
  finalize_hint: *mut c_void,
) {
  #[cfg(all(debug_assertions, not(windows), not(target_family = "wasm")))]
  {
    js_values::BUFFER_DATA.with(|buffer_data| {
      let mut buffer = buffer_data.lock().expect("Unlock Buffer data failed");
      buffer.remove(&(finalize_data as *mut u8));
    });
  }
  unsafe {
    drop(Box::from_raw(finalize_hint as *mut Buffer));
  }
}

/// # Safety
///
/// called when node buffer slice is ready for gc
#[doc(hidden)]
pub unsafe extern "C" fn drop_buffer_slice(
  _env: sys::napi_env,
  finalize_data: *mut c_void,
  finalize_hint: *mut c_void,
) {
  let (len, cap): (usize, usize) = *unsafe { Box::from_raw(finalize_hint.cast()) };
  #[cfg(all(debug_assertions, not(windows), not(target_family = "wasm")))]
  {
    js_values::BUFFER_DATA.with(|buffer_data| {
      let mut buffer = buffer_data.lock().expect("Unlock Buffer data failed");
      buffer.remove(&(finalize_data as *mut u8));
    });
  }
  if finalize_data.is_null() {
    return;
  }
  unsafe {
    drop(Vec::from_raw_parts(finalize_data, len, cap));
  }
}

/// Create an object with properties
///
/// When the `experimental` feature is enabled, uses `node_api_create_object_with_properties`
/// which creates the object with all properties in a single optimized call.
/// Otherwise falls back to `napi_create_object` + `napi_define_properties`.
#[doc(hidden)]
#[cfg(not(feature = "noop"))]
#[inline]
pub unsafe fn create_object_with_properties(
  env: sys::napi_env,
  properties: &[sys::napi_property_descriptor],
) -> Result<sys::napi_value> {
  use crate::check_status;

  let mut obj_ptr = std::ptr::null_mut();

  #[cfg(all(
    feature = "experimental",
    feature = "node_version_detect",
    not(target_family = "wasm")
  ))]
  {
    let node_version = NODE_VERSION.get().unwrap();
    if !properties.is_empty()
      && ((node_version.major == 25 && node_version.minor >= 2) || node_version.major > 25)
    {
      // Convert property names from C strings to napi_value
      let mut names: Vec<sys::napi_value> = Vec::with_capacity(properties.len());
      let mut values: Vec<sys::napi_value> = Vec::with_capacity(properties.len());

      for prop in properties {
        let mut name_value = std::ptr::null_mut();
        // utf8name is a null-terminated C string, use -1 to auto-detect length
        check_status!(
          sys::napi_create_string_utf8(env, prop.utf8name, -1, &mut name_value),
          "Failed to create property name string",
        )?;
        names.push(name_value);
        values.push(prop.value);
      }

      let mut result_obj = std::ptr::null_mut();
      check_status!(
        sys::node_api_create_object_with_properties(
          env,
          std::ptr::null_mut(), // prototype_or_null
          names.as_ptr(),
          values.as_ptr(),
          properties.len(),
          &mut result_obj,
        ),
        "Failed to create object with properties",
      )?;
      return Ok(result_obj);
    }
  }

  // Fallback: create object then define properties
  check_status!(
    sys::napi_create_object(env, &mut obj_ptr),
    "Failed to create object",
  )?;

  if !properties.is_empty() {
    check_status!(
      sys::napi_define_properties(env, obj_ptr, properties.len(), properties.as_ptr()),
      "Failed to define properties",
    )?;
  }

  Ok(obj_ptr)
}

#[doc(hidden)]
#[cfg(feature = "noop")]
pub unsafe fn create_object_with_properties(
  _env: sys::napi_env,
  _properties: &[sys::napi_property_descriptor],
) -> Result<sys::napi_value> {
  Ok(std::ptr::null_mut())
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::{
    panic::panic_any,
    sync::atomic::{AtomicUsize, Ordering},
  };

  struct FailingFinalize;

  impl ObjectFinalize for FailingFinalize {
    fn finalize(&mut self, _env: Env) -> Result<()> {
      Err(Error::new(
        Status::GenericFailure,
        "expected finalize failure",
      ))
    }
  }

  struct PanickingFinalize;

  impl ObjectFinalize for PanickingFinalize {
    fn finalize(&mut self, _env: Env) -> Result<()> {
      panic!("expected finalize panic");
    }
  }

  struct SuccessfulFinalize;

  impl ObjectFinalize for SuccessfulFinalize {}

  struct PanickingPanicPayload;

  impl Drop for PanickingPanicPayload {
    fn drop(&mut self) {
      panic!("nested panic payload destructor");
    }
  }

  struct PanickingDrop;

  impl Drop for PanickingDrop {
    fn drop(&mut self) {
      panic_any(PanickingPanicPayload);
    }
  }

  struct PanickingFinalizeDrop(std::sync::Arc<AtomicUsize>);

  impl ObjectFinalize for PanickingFinalizeDrop {
    fn finalize(&mut self, _env: Env) -> Result<()> {
      panic!("expected finalize panic before Drop");
    }
  }

  impl Drop for PanickingFinalizeDrop {
    fn drop(&mut self) {
      self.0.fetch_add(1, Ordering::SeqCst);
      panic!("expected finalized value Drop panic");
    }
  }

  struct PanickingCallbackCapture(std::sync::Arc<AtomicUsize>);

  impl Drop for PanickingCallbackCapture {
    fn drop(&mut self) {
      self.0.fetch_add(1, Ordering::SeqCst);
      panic!("expected callback capture Drop panic");
    }
  }

  #[test]
  fn panic_to_error_contains_payload_destructor_panics() {
    let error = panic_to_error(Box::new(PanickingDrop));
    assert!(error.reason.contains("panic from Rust code"));
  }

  #[test]
  fn catch_unwind_safely_forgets_panicking_panic_payloads() {
    catch_unwind_safely(|| panic_any(PanickingPanicPayload));
  }

  fn register_reference_state(
    finalize_data: *mut c_void,
    reference: sys::napi_ref,
    callback: FinalizeCallback,
  ) -> Arc<FinalizeCallbacks> {
    #[allow(clippy::arc_with_non_send_sync)]
    let callbacks = Arc::new(FinalizeCallbacks::new(callback));
    let retained_callbacks = callbacks.clone();
    let callbacks_ptr = Arc::into_raw(callbacks);
    REFERENCE_MAP.with(|references| {
      references.borrow_mut(|references| {
        references.insert(finalize_data, (finalize_data, reference, callbacks_ptr));
      });
    });
    retained_callbacks
  }

  #[test]
  fn failed_object_finalization_still_reclaims_reference_state() {
    let finalize_data = 0x3001usize as *mut c_void;
    let reference = 0x3002usize as sys::napi_ref;
    let callback_calls = std::sync::Arc::new(AtomicUsize::new(0));
    let callback_calls_for_finalize = callback_calls.clone();
    let callback: FinalizeCallback = Box::new(move || {
      callback_calls_for_finalize.fetch_add(1, Ordering::SeqCst);
    });
    drop(register_reference_state(finalize_data, reference, callback));
    let reference_deletes = AtomicUsize::new(0);
    let mut finalizer = FailingFinalize;
    let mut delete_reference = |_, deleted_reference| {
      assert_eq!(deleted_reference, reference);
      reference_deletes.fetch_add(1, Ordering::SeqCst);
      sys::Status::napi_ok
    };

    let error = unsafe {
      run_object_finalizer(
        std::ptr::null_mut(),
        &mut finalizer,
        finalize_data,
        &mut delete_reference,
      )
    }
    .expect_err("the user finalizer error must be preserved");

    assert_eq!(error.reason, "expected finalize failure");
    assert_eq!(callback_calls.load(Ordering::SeqCst), 1);
    assert_eq!(reference_deletes.load(Ordering::SeqCst), 1);
    assert!(!REFERENCE_MAP.with(|references| {
      references.borrow_mut(|references| references.contains_key(&finalize_data))
    }));
  }

  #[test]
  fn panicking_object_finalization_still_reclaims_reference_state() {
    let finalize_data = 0x3003usize as *mut c_void;
    let reference = 0x3004usize as sys::napi_ref;
    let callback_calls = std::sync::Arc::new(AtomicUsize::new(0));
    let callback_calls_for_finalize = callback_calls.clone();
    drop(register_reference_state(
      finalize_data,
      reference,
      Box::new(move || {
        callback_calls_for_finalize.fetch_add(1, Ordering::SeqCst);
      }),
    ));
    let reference_deletes = AtomicUsize::new(0);
    let mut finalizer = PanickingFinalize;
    let mut delete_reference = |_, deleted_reference| {
      assert_eq!(deleted_reference, reference);
      reference_deletes.fetch_add(1, Ordering::SeqCst);
      sys::Status::napi_ok
    };

    let error = unsafe {
      run_object_finalizer(
        std::ptr::null_mut(),
        &mut finalizer,
        finalize_data,
        &mut delete_reference,
      )
    }
    .expect_err("the user finalizer panic must become an error");

    assert_eq!(error.reason, "expected finalize panic");
    assert_eq!(callback_calls.load(Ordering::SeqCst), 1);
    assert_eq!(reference_deletes.load(Ordering::SeqCst), 1);
    assert!(!REFERENCE_MAP.with(|references| {
      references.borrow_mut(|references| references.contains_key(&finalize_data))
    }));
  }

  #[test]
  fn panicking_reference_callback_still_deletes_reference() {
    let finalize_data = 0x3005usize as *mut c_void;
    let reference = 0x3006usize as sys::napi_ref;
    let callback_calls = std::sync::Arc::new(AtomicUsize::new(0));
    let callback_calls_for_finalize = callback_calls.clone();
    let callback_capture_drops = std::sync::Arc::new(AtomicUsize::new(0));
    let callback_capture = PanickingCallbackCapture(callback_capture_drops.clone());
    let callback_after_panic_calls = std::sync::Arc::new(AtomicUsize::new(0));
    let callback_after_panic_calls_for_finalize = callback_after_panic_calls.clone();
    let retained_callbacks = register_reference_state(
      finalize_data,
      reference,
      Box::new(move || {
        callback_after_panic_calls_for_finalize.fetch_add(1, Ordering::SeqCst);
      }),
    );
    retained_callbacks.push(Box::new(move || {
      let _keep_alive = &callback_capture;
      callback_calls_for_finalize.fetch_add(1, Ordering::SeqCst);
      panic!("expected reference callback panic");
    }));
    assert_eq!(Arc::strong_count(&retained_callbacks), 2);
    let reference_deletes = AtomicUsize::new(0);
    let mut finalizer = SuccessfulFinalize;
    let mut delete_reference = |_, deleted_reference| {
      assert_eq!(deleted_reference, reference);
      reference_deletes.fetch_add(1, Ordering::SeqCst);
      sys::Status::napi_ok
    };

    unsafe {
      run_object_finalizer(
        std::ptr::null_mut(),
        &mut finalizer,
        finalize_data,
        &mut delete_reference,
      )
    }
    .expect("a registered reference callback panic must not escape");

    assert_eq!(callback_calls.load(Ordering::SeqCst), 1);
    assert_eq!(callback_capture_drops.load(Ordering::SeqCst), 1);
    assert_eq!(callback_after_panic_calls.load(Ordering::SeqCst), 1);
    assert_eq!(reference_deletes.load(Ordering::SeqCst), 1);
    assert_eq!(retained_callbacks.len(), 0);
    assert_eq!(Arc::strong_count(&retained_callbacks), 1);
    assert!(!REFERENCE_MAP.with(|references| {
      references.borrow_mut(|references| references.contains_key(&finalize_data))
    }));
  }

  #[test]
  fn panicking_object_finalizer_and_value_drop_are_contained_separately() {
    let drop_calls = std::sync::Arc::new(AtomicUsize::new(0));
    let mut finalizer = PanickingFinalizeDrop(drop_calls.clone());
    let mut delete_reference = |_, _| sys::Status::napi_ok;

    let error = unsafe {
      run_object_finalizer(
        std::ptr::null_mut(),
        &mut finalizer,
        0x3007usize as *mut c_void,
        &mut delete_reference,
      )
    }
    .expect_err("the finalizer panic must become an error");
    assert_eq!(error.reason, "expected finalize panic before Drop");

    catch_unwind_safely(|| drop(finalizer));
    assert_eq!(drop_calls.load(Ordering::SeqCst), 1);
  }

  #[test]
  fn failed_reference_deletion_is_reported_after_cleanup() {
    let finalize_data = 0x3008usize as *mut c_void;
    let reference = 0x3009usize as sys::napi_ref;
    let callback_calls = std::sync::Arc::new(AtomicUsize::new(0));
    let callback_calls_for_finalize = callback_calls.clone();
    drop(register_reference_state(
      finalize_data,
      reference,
      Box::new(move || {
        callback_calls_for_finalize.fetch_add(1, Ordering::SeqCst);
      }),
    ));
    let mut finalizer = SuccessfulFinalize;
    let mut delete_reference = |_, deleted_reference| {
      assert_eq!(deleted_reference, reference);
      sys::Status::napi_generic_failure
    };

    let error = unsafe {
      run_object_finalizer(
        std::ptr::null_mut(),
        &mut finalizer,
        finalize_data,
        &mut delete_reference,
      )
    }
    .expect_err("a failed reference deletion must be reported");

    assert!(error
      .reason
      .contains("Delete reference in finalize callback failed"));
    assert_eq!(callback_calls.load(Ordering::SeqCst), 1);
    assert!(!REFERENCE_MAP.with(|references| {
      references.borrow_mut(|references| references.contains_key(&finalize_data))
    }));
  }
}
