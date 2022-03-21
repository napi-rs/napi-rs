use std::any::TypeId;
use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::c_void;
use std::ops::{Deref, DerefMut};

use crate::{check_status, Error, Result, Status};

type RefInformation = (*mut c_void, crate::sys::napi_env, crate::sys::napi_ref);

thread_local! {
  static REFERENCE_MAP: RefCell<HashMap<TypeId, RefInformation>> = Default::default();
}

/// ### Experimental feature
///
/// Create a `reference` from `Class` instance.
/// Unref the `Reference` when the `Reference` is dropped.
pub struct Reference<T> {
  raw: *mut T,
  napi_ref: crate::sys::napi_ref,
  env: crate::sys::napi_env,
}

unsafe impl<T: Send> Send for Reference<T> {}
unsafe impl<T: Sync> Sync for Reference<T> {}

impl<T> Drop for Reference<T> {
  fn drop(&mut self) {
    let status = unsafe { crate::sys::napi_reference_unref(self.env, self.napi_ref, &mut 0) };
    debug_assert!(
      status == crate::sys::Status::napi_ok,
      "Reference unref failed"
    );
  }
}

impl<T> Reference<T> {
  #[doc(hidden)]
  pub fn add_ref(t: TypeId, value: RefInformation) {
    REFERENCE_MAP.with(|map| {
      map.borrow_mut().insert(t, value);
    });
  }

  #[doc(hidden)]
  pub fn from_typeid(t: TypeId) -> Result<Self> {
    if let Some((wrapped_value, env, napi_ref)) =
      REFERENCE_MAP.with(|map| map.borrow().get(&t).cloned())
    {
      check_status!(
        unsafe { crate::sys::napi_reference_ref(env, napi_ref, &mut 0) },
        "Failed to ref napi reference"
      )?;
      Ok(Self {
        raw: wrapped_value as *mut T,
        env,
        napi_ref,
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
  pub fn share_with<S, F: FnOnce(&'static mut T) -> Result<S>>(
    self,
    f: F,
  ) -> Result<SharedReference<T, S>> {
    let s = f(Box::leak(unsafe { Box::from_raw(self.raw) }))?;
    Ok(SharedReference {
      raw: Box::into_raw(Box::new(s)),
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

impl<T> Clone for Reference<T> {
  fn clone(&self) -> Self {
    let mut ref_count = 0;
    let status = unsafe { crate::sys::napi_reference_ref(self.env, self.napi_ref, &mut ref_count) };
    debug_assert!(
      status == crate::sys::Status::napi_ok,
      "Reference ref failed"
    );
    Self {
      raw: self.raw,
      napi_ref: self.napi_ref,
      env: self.env,
    }
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

impl<T, S: 'static> SharedReference<T, S> {
  pub fn share_with<U, F: FnOnce(&'static mut S) -> Result<U>>(
    self,
    f: F,
  ) -> Result<SharedReference<T, U>> {
    let s = f(Box::leak(unsafe { Box::from_raw(self.raw) }))?;
    Ok(SharedReference {
      raw: Box::into_raw(Box::new(s)),
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

impl<T, S> Clone for SharedReference<T, S> {
  fn clone(&self) -> Self {
    let status =
      unsafe { crate::sys::napi_reference_ref(self.owner.env, self.owner.napi_ref, &mut 0) };
    debug_assert!(
      status == crate::sys::Status::napi_ok,
      "Reference ref failed"
    );
    Self {
      raw: self.raw,
      owner: self.owner.clone(),
    }
  }
}
