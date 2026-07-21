use std::cell::{LazyCell, RefCell};
use std::ffi::c_void;
use std::hash::BuildHasherDefault;
use std::ops::Deref;
use std::ptr;
use std::sync::{
  atomic::{AtomicBool, Ordering},
  Arc, Weak,
};

use nohash_hasher::NoHashHasher;

use crate::{
  bindgen_runtime::{
    FromNapiValue, MaybeTypeTag, NapiValueOwner, PersistedPerInstanceHashMap, ToNapiValue,
  },
  check_status, Env, Error, Result, Status,
};

type RefInformation = (
  /* wrapped_value */ *mut c_void,
  /* napi_ref */ crate::sys::napi_ref,
  /* finalize_callbacks */ *const FinalizeCallbacks,
  /* owner */ NapiValueOwner,
);

pub(crate) type FinalizeCallback = Box<dyn FnMut()>;

pub(crate) struct FinalizeCallbacks {
  alive: AtomicBool,
  callbacks: RefCell<Vec<FinalizeCallback>>,
}

impl FinalizeCallbacks {
  pub(crate) fn new(callback: FinalizeCallback) -> Self {
    Self {
      alive: AtomicBool::new(true),
      callbacks: RefCell::new(vec![callback]),
    }
  }

  pub(crate) fn push(&self, callback: FinalizeCallback) {
    self.callbacks.borrow_mut().push(callback);
  }

  pub(crate) fn is_alive(&self) -> bool {
    self.alive.load(Ordering::Acquire)
  }

  pub(crate) fn close(&self) {
    self.alive.store(false, Ordering::Release);
  }

  /// Shared values may depend on earlier shared values, so callers must consume
  /// this list in reverse registration order.
  pub(crate) fn take(&self) -> Vec<FinalizeCallback> {
    std::mem::take(&mut *self.callbacks.borrow_mut())
  }

  #[cfg(test)]
  pub(crate) fn len(&self) -> usize {
    self.callbacks.borrow().len()
  }
}

impl Drop for FinalizeCallbacks {
  fn drop(&mut self) {
    self.alive.store(false, Ordering::Release);
    for callback in std::mem::take(self.callbacks.get_mut()).into_iter().rev() {
      crate::bindgen_runtime::catch_unwind_safely(|| drop(callback));
    }
  }
}

thread_local! {
  pub(crate) static REFERENCE_MAP: LazyCell<
    PersistedPerInstanceHashMap<*mut c_void, RefInformation, BuildHasherDefault<NoHashHasher<usize>>>,
  > = LazyCell::new(Default::default);
}

/// Create a [`napi_ref`](https://nodejs.org/api/n-api.html#napi_ref) from `Class` instance.
///
/// Unref the [`napi_ref`](https://nodejs.org/api/n-api.html#napi_ref) when the `Reference` is dropped.
///
/// `Reference` is neither `Send` nor `Sync`: it owns a thread-affine Node-API reference and points
/// at a class value that JavaScript may access through another wrapper.
pub struct Reference<T> {
  raw: *mut T,
  napi_ref: crate::sys::napi_ref,
  owner: NapiValueOwner,
  // the finalize callbacks can only be written with the `Env` passed in
  // So we can use `RefCell` rather than a lock here
  finalize_callbacks: Arc<FinalizeCallbacks>,
}

pub(crate) fn add_ref(
  env: crate::sys::napi_env,
  key: *mut c_void,
  wrapped_value: *mut c_void,
  napi_ref: crate::sys::napi_ref,
  finalize_callbacks: *const FinalizeCallbacks,
) {
  REFERENCE_MAP.with(|cell| {
    cell.borrow_mut(|map| {
      if let Some((_, previous_ref, previous_callbacks, previous_owner)) = map.insert(
        key,
        (
          wrapped_value,
          napi_ref,
          finalize_callbacks,
          NapiValueOwner::new(env),
        ),
      ) {
        let previous_callbacks = unsafe { Arc::from_raw(previous_callbacks) };
        previous_callbacks.close();
        unsafe { crate::sys::napi_delete_reference(previous_owner.env(), previous_ref) };
      }
    })
  });
}

impl<T> Drop for Reference<T> {
  fn drop(&mut self) {
    let rc_strong_count = Arc::strong_count(&self.finalize_callbacks);
    let mut ref_count = 0;
    // If Rc strong count == 1, then the referenced object is dropped on GC
    // It would happen when the process is exiting
    // In general, the `drop` of the `Reference` would happen first
    if rc_strong_count > 1
      && self.finalize_callbacks.is_alive()
      && self
        .owner
        .ensure_access(self.owner.env(), "Reference")
        .is_ok()
    {
      let status = unsafe {
        crate::sys::napi_reference_unref(self.owner.env(), self.napi_ref, &mut ref_count)
      };
      debug_assert!(
        status == crate::sys::Status::napi_ok,
        "Reference unref failed, status code: {}",
        crate::Status::from(status)
      );
    };
  }
}

impl<T> Reference<T> {
  #[allow(clippy::not_unsafe_ptr_arg_deref)]
  pub(crate) fn add_ref(
    env: crate::sys::napi_env,
    t: *mut c_void,
    value: (*mut c_void, crate::sys::napi_ref, *const FinalizeCallbacks),
  ) {
    add_ref(env, t, value.0, value.1, value.2);
  }

  #[doc(hidden)]
  pub unsafe fn from_value_ptr(t: *mut c_void, env: crate::sys::napi_env) -> Result<Self> {
    if let Some((wrapped_value, napi_ref, finalize_callbacks_ptr, owner)) =
      REFERENCE_MAP.with(|cell| cell.borrow_mut(|map| map.get(&t).cloned()))
    {
      owner.ensure_access(env, "Reference")?;
      let mut ref_count = 0;
      check_status!(
        unsafe { crate::sys::napi_reference_ref(env, napi_ref, &mut ref_count) },
        "Failed to ref napi reference"
      )?;
      let finalize_callbacks_raw = unsafe { Arc::from_raw(finalize_callbacks_ptr) };
      let finalize_callbacks = finalize_callbacks_raw.clone();
      // Leak the raw finalize callbacks
      let _ = Arc::into_raw(finalize_callbacks_raw);
      Ok(Self {
        raw: wrapped_value.cast(),
        napi_ref,
        owner,
        finalize_callbacks,
      })
    } else {
      Err(Error::new(
        Status::InvalidArg,
        format!("Class for Type {t:?} not found"),
      ))
    }
  }
}

impl<T> ToNapiValue for Reference<T> {
  unsafe fn to_napi_value(env: crate::sys::napi_env, val: Self) -> Result<crate::sys::napi_value> {
    val.get_value(env)
  }
}

impl<T: MaybeTypeTag> FromNapiValue for Reference<T> {
  unsafe fn from_napi_value(
    env: crate::sys::napi_env,
    napi_val: crate::sys::napi_value,
  ) -> Result<Self> {
    let mut value = ptr::null_mut();
    check_status!(
      unsafe { crate::sys::napi_unwrap(env, napi_val, &mut value) },
      "Unwrap value [{}] from class Reference failed",
      std::any::type_name::<T>(),
    )?;

    // Reject a wrong-class / prototype-spoofed object before adopting it as a
    // `Reference<T>`. Compiled only on napi8 NATIVE targets (the `T: MaybeTypeTag`
    // bound provides `T::type_tag()` only there; elsewhere this is the pre-tag
    // path).
    #[cfg(all(feature = "napi8", not(target_family = "wasm")))]
    unsafe {
      crate::bindgen_runtime::validate_type_tag(
        env,
        napi_val,
        &T::type_tag(),
        std::any::type_name::<T>(),
      )?
    };

    unsafe { Reference::from_value_ptr(value.cast(), env) }
  }
}

impl<T> Reference<T> {
  fn ensure_access(&self, env: crate::sys::napi_env) -> Result<()> {
    self.owner.ensure_access(env, "Reference")?;
    if !self.finalize_callbacks.is_alive() {
      return Err(Error::new(
        Status::InvalidArg,
        "A JavaScript Reference cannot be accessed after its object has been finalized".to_owned(),
      ));
    }
    Ok(())
  }

  pub(crate) fn get_value(&self, env: crate::sys::napi_env) -> Result<crate::sys::napi_value> {
    self.ensure_access(env)?;
    let mut result = ptr::null_mut();
    check_status!(
      unsafe { crate::sys::napi_get_reference_value(env, self.napi_ref, &mut result) },
      "Failed to get reference value"
    )?;
    Ok(result)
  }

  pub fn clone(&self, env: Env) -> Result<Self> {
    self.ensure_access(env.0)?;
    let mut ref_count = 0;
    check_status!(
      unsafe { crate::sys::napi_reference_ref(env.0, self.napi_ref, &mut ref_count) },
      "Failed to ref napi reference"
    )?;
    Ok(Self {
      raw: self.raw,
      napi_ref: self.napi_ref,
      owner: self.owner.clone(),
      finalize_callbacks: self.finalize_callbacks.clone(),
    })
  }

  pub fn downgrade(&self) -> WeakReference<T>
  where
    T: 'static,
  {
    WeakReference {
      raw: self.raw,
      napi_ref: self.napi_ref,
      owner: self.owner.clone(),
      finalize_callbacks: Arc::downgrade(&self.finalize_callbacks),
    }
  }

  /// Access the referenced class value while preventing overlapping mutable callbacks.
  pub fn with<R>(&self, f: impl FnOnce(&T) -> R) -> Result<R> {
    self.ensure_access(self.owner.env())?;
    let _borrow = crate::bindgen_runtime::acquire_native_borrow(self.raw, false)?;
    Ok(f(unsafe { &*self.raw }))
  }

  /// Mutably access the referenced class value while preventing all overlapping callbacks.
  pub fn with_mut<R>(&self, f: impl FnOnce(&mut T) -> R) -> Result<R> {
    self.ensure_access(self.owner.env())?;
    let _borrow = crate::bindgen_runtime::acquire_native_borrow(self.raw, true)?;
    Ok(f(unsafe { &mut *self.raw }))
  }

  /// Create an owner-tied value that may borrow this class value.
  ///
  /// # Safety
  ///
  /// The caller must guarantee exclusive access to `T` for the duration of `f`. If the returned
  /// `S` contains references to `T`, no mutable access to `T` may occur for the lifetime of the
  /// returned `SharedReference`. Those references must remain reachable only through that
  /// `SharedReference` and must not escape through any other side effect. The supplied `env` must be
  /// the owning environment.
  pub unsafe fn share_with<S: 'static, F: FnOnce(&'static mut T) -> Result<S>>(
    self,
    env: Env,
    f: F,
  ) -> Result<SharedReference<T, S>>
  where
    T: 'static,
  {
    self.ensure_access(env.0)?;
    let s = f(unsafe { &mut *self.raw })?;
    let mut s = Some(Box::new(s));
    let s_ptr = s
      .as_deref_mut()
      .expect("shared reference value must be present") as *mut S;
    self.finalize_callbacks.push(Box::new(move || {
      if let Some(s) = s.take() {
        drop(s);
      }
    }));
    Ok(SharedReference {
      raw: s_ptr,
      owner: self,
    })
  }
}

pub struct WeakReference<T: 'static> {
  raw: *mut T,
  napi_ref: crate::sys::napi_ref,
  owner: NapiValueOwner,
  finalize_callbacks: Weak<FinalizeCallbacks>,
}

impl<T> Clone for WeakReference<T> {
  fn clone(&self) -> Self {
    Self {
      raw: self.raw,
      napi_ref: self.napi_ref,
      owner: self.owner.clone(),
      finalize_callbacks: self.finalize_callbacks.clone(),
    }
  }
}

impl<T: 'static> ToNapiValue for WeakReference<T> {
  unsafe fn to_napi_value(env: crate::sys::napi_env, val: Self) -> Result<crate::sys::napi_value> {
    val.owner.ensure_access(env, "WeakReference")?;
    if Weak::strong_count(&val.finalize_callbacks) == 0 {
      return Err(Error::new(
        Status::GenericFailure,
        format!(
          "The original reference that WeakReference<{}> is pointing to is dropped",
          std::any::type_name::<T>()
        ),
      ));
    };
    if !val
      .finalize_callbacks
      .upgrade()
      .is_some_and(|callbacks| callbacks.is_alive())
    {
      return Err(Error::new(
        Status::InvalidArg,
        "A JavaScript WeakReference cannot be accessed after its object has been finalized"
          .to_owned(),
      ));
    }
    let mut result = ptr::null_mut();
    check_status!(
      unsafe { crate::sys::napi_get_reference_value(env, val.napi_ref, &mut result) },
      "Failed to get reference value"
    )?;
    Ok(result)
  }
}

impl<T: 'static> WeakReference<T> {
  pub fn upgrade(&self, env: Env) -> Result<Option<Reference<T>>> {
    self.owner.ensure_access(env.0, "WeakReference")?;
    if let Some(finalize_callbacks) = self.finalize_callbacks.upgrade() {
      if !finalize_callbacks.is_alive() {
        return Ok(None);
      }
      let mut ref_count = 0;
      check_status!(
        unsafe { crate::sys::napi_reference_ref(env.0, self.napi_ref, &mut ref_count) },
        "Failed to ref napi reference"
      )?;
      Ok(Some(Reference {
        raw: self.raw,
        napi_ref: self.napi_ref,
        owner: self.owner.clone(),
        finalize_callbacks,
      }))
    } else {
      Ok(None)
    }
  }

  /// Access the value if its owning JavaScript object is still alive.
  pub fn with<R>(&self, f: impl FnOnce(&T) -> R) -> Result<Option<R>> {
    match self.upgrade(Env::from_raw(self.owner.env()))? {
      Some(reference) => reference.with(f).map(Some),
      None => Ok(None),
    }
  }
}

/// ### Experimental feature
///
/// Create a `SharedReference` from an existed `Reference`.
pub struct SharedReference<T: 'static, S: 'static> {
  raw: *mut S,
  owner: Reference<T>,
}

impl<T: 'static, S: 'static> SharedReference<T, S> {
  pub fn clone(&self, env: Env) -> Result<Self> {
    Ok(SharedReference {
      raw: self.raw,
      owner: self.owner.clone(env)?,
    })
  }

  pub fn clone_owner(&self, env: Env) -> Result<Reference<T>> {
    self.owner.clone(env)
  }

  /// Create another owner-tied value that may borrow this shared value.
  ///
  /// # Safety
  ///
  /// The caller must guarantee exclusive access to `S` for the duration of `f`. If the returned
  /// `U` contains references to `S`, no mutable access to `S` may occur for the lifetime of the
  /// returned `SharedReference`. Those references must remain reachable only through that
  /// `SharedReference` and must not escape through any other side effect. The supplied `env` must be
  /// the owning environment.
  pub unsafe fn share_with<U: 'static, F: FnOnce(&'static mut S) -> Result<U>>(
    self,
    env: Env,
    f: F,
  ) -> Result<SharedReference<T, U>> {
    self.owner.ensure_access(env.0)?;
    let value = f(unsafe { &mut *self.raw })?;
    let mut value = Some(Box::new(value));
    let raw = value
      .as_deref_mut()
      .expect("shared reference value must be present") as *mut U;
    self.owner.finalize_callbacks.push(Box::new(move || {
      if let Some(value) = value.take() {
        drop(value);
      }
    }));
    Ok(SharedReference {
      raw,
      owner: self.owner,
    })
  }
}

impl<T: 'static, S: 'static> ToNapiValue for SharedReference<T, S> {
  unsafe fn to_napi_value(env: crate::sys::napi_env, val: Self) -> Result<crate::sys::napi_value> {
    val.owner.ensure_access(env)?;
    let mut result = ptr::null_mut();
    check_status!(
      unsafe { crate::sys::napi_get_reference_value(env, val.owner.napi_ref, &mut result) },
      "Failed to get reference value"
    )?;
    Ok(result)
  }
}

impl<T: 'static, S: 'static> Deref for SharedReference<T, S> {
  type Target = S;

  fn deref(&self) -> &Self::Target {
    assert!(
      self.owner.finalize_callbacks.is_alive(),
      "A JavaScript SharedReference cannot be accessed after its object has been finalized"
    );
    unsafe { &*self.raw }
  }
}
