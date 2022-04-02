use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::ffi::c_void;
use std::ops::{Deref, DerefMut};
use std::rc::Rc;

use crate::{check_status, Env, Error, Result, Status};

type RefInformation = (
  *mut c_void,
  crate::sys::napi_ref,
  *const Cell<*mut dyn FnOnce()>,
);

thread_local! {
  pub(crate) static REFERENCE_MAP: RefCell<HashMap<*mut c_void, RefInformation>> = Default::default();
}

/// ### Experimental feature
///
/// Create a `reference` from `Class` instance.
/// Unref the `Reference` when the `Reference` is dropped.
pub struct Reference<T> {
  raw: *mut T,
  napi_ref: crate::sys::napi_ref,
  env: *mut c_void,
  finalize_callbacks: Rc<Cell<*mut dyn FnOnce()>>,
}

unsafe impl<T: Send> Send for Reference<T> {}
unsafe impl<T: Sync> Sync for Reference<T> {}

impl<T> Drop for Reference<T> {
  fn drop(&mut self) {
    let status = unsafe {
      crate::sys::napi_reference_unref(self.env as crate::sys::napi_env, self.napi_ref, &mut 0)
    };
    debug_assert!(
      status == crate::sys::Status::napi_ok,
      "Reference unref failed"
    );
  }
}

impl<T> Reference<T> {
  #[doc(hidden)]
  pub fn add_ref(t: *mut c_void, value: RefInformation) {
    REFERENCE_MAP.with(|map| {
      map.borrow_mut().insert(t, value);
    });
  }

  #[doc(hidden)]
  pub unsafe fn from_value_ptr(t: *mut c_void, env: crate::sys::napi_env) -> Result<Self> {
    if let Some((wrapped_value, napi_ref, finalize_callbacks_ptr)) =
      REFERENCE_MAP.with(|map| map.borrow().get(&t).cloned())
    {
      check_status!(
        unsafe { crate::sys::napi_reference_ref(env, napi_ref, &mut 0) },
        "Failed to ref napi reference"
      )?;
      let finalize_callbacks_raw = unsafe { Rc::from_raw(finalize_callbacks_ptr) };
      let finalize_callbacks = finalize_callbacks_raw.clone();
      // Leak the raw finalize callbacks
      Rc::into_raw(finalize_callbacks_raw);
      Ok(Self {
        raw: wrapped_value as *mut T,
        napi_ref,
        env: env as *mut c_void,
        finalize_callbacks,
      })
    } else {
      Err(Error::new(
        Status::InvalidArg,
        format!("Class for Type {:?} not found", t),
      ))
    }
  }
}

impl<T: 'static> Reference<T> {
  pub fn clone(&self, env: Env) -> Result<Self> {
    let mut ref_count = 0;
    check_status!(
      unsafe { crate::sys::napi_reference_ref(env.0, self.napi_ref, &mut ref_count) },
      "Failed to ref napi reference"
    )?;
    Ok(Self {
      raw: self.raw,
      napi_ref: self.napi_ref,
      env: env.0 as *mut c_void,
      finalize_callbacks: self.finalize_callbacks.clone(),
    })
  }

  /// Safety to share because caller can provide `Env`
  pub fn share_with<S: 'static, F: FnOnce(&'static mut T) -> Result<S>>(
    self,
    #[allow(unused_variables)] env: Env,
    f: F,
  ) -> Result<SharedReference<T, S>> {
    let s = f(Box::leak(unsafe { Box::from_raw(self.raw) }))?;
    let s_ptr = Box::into_raw(Box::new(s));
    let prev_drop_fn = unsafe { Box::from_raw(self.finalize_callbacks.get()) };
    let drop_fn = Box::new(move || {
      unsafe { Box::from_raw(s_ptr) };
      prev_drop_fn();
    });
    self.finalize_callbacks.set(Box::into_raw(drop_fn));
    Ok(SharedReference {
      raw: s_ptr,
      owner: self,
    })
  }
}

impl<T> Deref for Reference<T> {
  type Target = T;

  fn deref(&self) -> &Self::Target {
    unsafe { Box::leak(Box::from_raw(self.raw)) }
  }
}

impl<T> DerefMut for Reference<T> {
  fn deref_mut(&mut self) -> &mut Self::Target {
    unsafe { Box::leak(Box::from_raw(self.raw)) }
  }
}

/// ### Experimental feature
///
/// Create a `SharedReference` from an existed `Reference`.
pub struct SharedReference<T, S> {
  raw: *mut S,
  owner: Reference<T>,
}

unsafe impl<T: Send, S: Send> Send for SharedReference<T, S> {}
unsafe impl<T: Sync, S: Sync> Sync for SharedReference<T, S> {}

impl<T: 'static, S: 'static> SharedReference<T, S> {
  pub fn clone(&self, env: Env) -> Result<Self> {
    Ok(SharedReference {
      raw: self.raw,
      owner: self.owner.clone(env)?,
    })
  }

  /// Safety to share because caller can provide `Env`
  pub fn share_with<U: 'static, F: FnOnce(&'static mut S) -> Result<U>>(
    self,
    #[allow(unused_variables)] env: Env,
    f: F,
  ) -> Result<SharedReference<T, U>> {
    let s = f(Box::leak(unsafe { Box::from_raw(self.raw) }))?;
    let raw = Box::into_raw(Box::new(s));
    let prev_drop_fn = unsafe { Box::from_raw(self.owner.finalize_callbacks.get()) };
    let drop_fn = Box::new(move || {
      unsafe { Box::from_raw(raw) };
      prev_drop_fn();
    });
    self.owner.finalize_callbacks.set(Box::into_raw(drop_fn));
    Ok(SharedReference {
      raw,
      owner: self.owner,
    })
  }
}

impl<T, S> Deref for SharedReference<T, S> {
  type Target = S;

  fn deref(&self) -> &Self::Target {
    unsafe { Box::leak(Box::from_raw(self.raw)) }
  }
}

impl<T, S> DerefMut for SharedReference<T, S> {
  fn deref_mut(&mut self) -> &mut Self::Target {
    unsafe { Box::leak(Box::from_raw(self.raw)) }
  }
}
