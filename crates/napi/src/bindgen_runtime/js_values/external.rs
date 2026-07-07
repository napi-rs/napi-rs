use std::{
  any::{Any, TypeId},
  cell::{RefCell, UnsafeCell},
  collections::HashMap,
  ffi::c_void,
  ops::{Deref, DerefMut},
  ptr,
  sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, LazyLock, Mutex, Weak,
  },
};

use crate::{
  bindgen_runtime::{
    sys, Env, FromNapiRef, FromNapiValue, Result, Status, ToNapiValue, TypeName, Unknown,
    ValidateNapiValue,
  },
  check_status, check_status_or_throw, Error, JsExternal,
};

type EnvId = usize;

thread_local! {
  static EXTERNAL_ENV_STATES: RefCell<HashMap<EnvId, Weak<ExternalEnvState>>> =
    RefCell::new(HashMap::new());
}

struct ExternalEnvState {
  env: EnvId,
  owner_thread: std::thread::ThreadId,
  closed: AtomicBool,
}

impl ExternalEnvState {
  fn new(env: sys::napi_env) -> Self {
    Self {
      env: env as EnvId,
      owner_thread: std::thread::current().id(),
      closed: AtomicBool::new(false),
    }
  }

  fn is_open_for(&self, env: sys::napi_env) -> bool {
    self.env == env as EnvId && !self.closed.load(Ordering::Acquire)
  }

  fn is_open_on_owner_thread(&self) -> bool {
    self.owner_thread == std::thread::current().id() && !self.closed.load(Ordering::Acquire)
  }

  fn ensure_open_for(&self, env: sys::napi_env) -> Result<()> {
    if self.env != env as EnvId {
      return Err(Error::new(
        Status::InvalidArg,
        "An ExternalRef cannot be used with a different napi_env".to_owned(),
      ));
    }
    if self.owner_thread != std::thread::current().id() {
      return Err(Error::new(
        Status::InvalidArg,
        "An ExternalRef cannot be used outside its owner thread".to_owned(),
      ));
    }
    if self.closed.load(Ordering::Acquire) {
      return Err(Error::new(
        Status::InvalidArg,
        "An ExternalRef cannot be used after its owner environment has closed".to_owned(),
      ));
    }
    Ok(())
  }

  #[cfg(not(feature = "noop"))]
  fn close(&self) {
    self.closed.store(true, Ordering::Release);
  }
}

type ExternalToken = usize;

struct ExternalProvenance {
  type_id: TypeId,
  env: Arc<ExternalEnvState>,
  owner_ref: sys::napi_ref,
  control: Box<dyn Any>,
}

// Registry entries are inserted, resolved, and removed only by the owning N-API environment.
// The unsafe Send implementation permits the process-wide registry to hold non-Send External<T>
// values without allowing those values to be accessed from a foreign environment.
unsafe impl Send for ExternalProvenance {}

static NEXT_EXTERNAL_TOKEN: AtomicUsize = AtomicUsize::new(1);
static EXTERNAL_PROVENANCE: LazyLock<Mutex<HashMap<ExternalToken, ExternalProvenance>>> =
  LazyLock::new(|| Mutex::new(HashMap::new()));

fn allocate_external_token() -> Result<ExternalToken> {
  let mut current = NEXT_EXTERNAL_TOKEN.load(Ordering::Relaxed);
  loop {
    let next = current.checked_add(1).ok_or_else(|| {
      Error::new(
        Status::GenericFailure,
        "External token space has been exhausted".to_owned(),
      )
    })?;
    match NEXT_EXTERNAL_TOKEN.compare_exchange_weak(
      current,
      next,
      Ordering::Relaxed,
      Ordering::Relaxed,
    ) {
      Ok(_) => return Ok(current),
      Err(observed) => current = observed,
    }
  }
}

fn external_token(pointer: *mut c_void) -> Option<ExternalToken> {
  let token = pointer as ExternalToken;
  (token != 0).then_some(token)
}

fn register_external_provenance<T: 'static>(
  token: ExternalToken,
  env: Arc<ExternalEnvState>,
  owner_ref: sys::napi_ref,
  control: Arc<ExternalControlBlock<T>>,
) -> Result<()> {
  let mut registry = EXTERNAL_PROVENANCE
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner);
  if registry.contains_key(&token) {
    return Err(Error::new(
      Status::GenericFailure,
      "External token was already registered".to_owned(),
    ));
  }
  registry.insert(
    token,
    ExternalProvenance {
      type_id: TypeId::of::<T>(),
      env,
      owner_ref,
      control: Box::new(control),
    },
  );
  Ok(())
}

fn unregister_external_provenance(pointer: *mut c_void) -> Option<ExternalProvenance> {
  let token = external_token(pointer)?;
  EXTERNAL_PROVENANCE
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .remove(&token)
}

fn clone_external_control_unchecked<T: 'static>(
  pointer: *mut c_void,
) -> Option<Arc<ExternalControlBlock<T>>> {
  let token = external_token(pointer)?;
  let registry = EXTERNAL_PROVENANCE
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner);
  let provenance = registry.get(&token)?;
  if provenance.type_id != TypeId::of::<T>() || !provenance.env.is_open_on_owner_thread() {
    return None;
  }
  provenance
    .control
    .downcast_ref::<Arc<ExternalControlBlock<T>>>()
    .map(Arc::clone)
}

fn clone_external_control<T: 'static>(
  pointer: *mut c_void,
  env: sys::napi_env,
  napi_val: sys::napi_value,
) -> Result<Arc<ExternalControlBlock<T>>> {
  let Some(token) = external_token(pointer) else {
    return Err(Error::new(
      Status::InvalidArg,
      "The External value is not backed by a shareable napi-rs allocation".to_owned(),
    ));
  };
  let registry = EXTERNAL_PROVENANCE
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner);
  let Some(provenance) = registry.get(&token) else {
    return Err(Error::new(
      Status::InvalidArg,
      "The External value is not backed by a shareable napi-rs allocation".to_owned(),
    ));
  };
  if provenance.type_id != TypeId::of::<T>() {
    return Err(Error::new(
      Status::InvalidArg,
      format!(
        "<{}> on `External` is not the type of wrapped object",
        std::any::type_name::<T>()
      ),
    ));
  }
  provenance.env.ensure_open_for(env)?;

  let mut owner_value = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_get_reference_value(env, provenance.owner_ref, &mut owner_value) },
    "Failed to resolve the owning External value"
  )?;
  if owner_value.is_null() {
    return Err(Error::new(
      Status::InvalidArg,
      "The External value is no longer owned by a live napi-rs allocation".to_owned(),
    ));
  }
  let mut is_owner_value = false;
  check_status!(
    unsafe { sys::napi_strict_equals(env, owner_value, napi_val, &mut is_owner_value) },
    "Failed to validate the owning External value"
  )?;
  if !is_owner_value {
    return Err(Error::new(
      Status::InvalidArg,
      "The External token does not belong to this JavaScript External value".to_owned(),
    ));
  }

  provenance
    .control
    .downcast_ref::<Arc<ExternalControlBlock<T>>>()
    .map(Arc::clone)
    .ok_or_else(|| {
      Error::new(
        Status::InvalidArg,
        "The External value has an invalid napi-rs control block".to_owned(),
      )
    })
}

fn external_env_state(env: sys::napi_env) -> Result<Arc<ExternalEnvState>> {
  let existing =
    EXTERNAL_ENV_STATES.with(|states| states.borrow().get(&(env as EnvId)).and_then(Weak::upgrade));
  if let Some(state) = existing {
    state.ensure_open_for(env)?;
    return Ok(state);
  }

  let state = Arc::new(ExternalEnvState::new(env));
  register_external_env_cleanup(env, Arc::clone(&state))?;
  EXTERNAL_ENV_STATES.with(|states| {
    states
      .borrow_mut()
      .insert(env as EnvId, Arc::downgrade(&state));
  });
  Ok(state)
}

#[cfg(all(feature = "napi3", not(feature = "noop")))]
fn register_external_env_cleanup(env: sys::napi_env, state: Arc<ExternalEnvState>) -> Result<()> {
  let data = Box::into_raw(Box::new(state));
  #[cfg(not(target_family = "wasm"))]
  let status =
    unsafe { sys::napi_add_env_cleanup_hook(env, Some(external_env_cleanup), data.cast()) };
  #[cfg(target_family = "wasm")]
  let status =
    unsafe { crate::napi_add_env_cleanup_hook(env, Some(external_env_cleanup), data.cast()) };
  if status != sys::Status::napi_ok {
    drop(unsafe { Box::from_raw(data) });
  }
  check_status!(status, "Failed to add External environment cleanup hook")
}

#[cfg(all(not(feature = "napi3"), not(feature = "noop")))]
fn register_external_env_cleanup(env: sys::napi_env, state: Arc<ExternalEnvState>) -> Result<()> {
  let data = Box::into_raw(Box::new(state));
  let mut sentinel = ptr::null_mut();
  let status = unsafe {
    sys::napi_create_external(
      env,
      data.cast(),
      Some(external_env_sentinel_finalize),
      ptr::null_mut(),
      &mut sentinel,
    )
  };
  if status != sys::Status::napi_ok {
    drop(unsafe { Box::from_raw(data) });
    return Err(Error::new(
      Status::from(status),
      "Failed to create External environment cleanup sentinel".to_owned(),
    ));
  }

  let mut sentinel_ref = ptr::null_mut();
  check_status!(
    unsafe { sys::napi_create_reference(env, sentinel, 1, &mut sentinel_ref) },
    "Failed to retain External environment cleanup sentinel"
  )
}

#[cfg(feature = "noop")]
fn register_external_env_cleanup(_env: sys::napi_env, _state: Arc<ExternalEnvState>) -> Result<()> {
  Ok(())
}

#[cfg(not(feature = "noop"))]
fn close_external_env(data: *mut c_void) {
  let state = unsafe { Box::from_raw(data.cast::<Arc<ExternalEnvState>>()) };
  state.close();
  let identity = Arc::as_ptr(&state);
  let _ = EXTERNAL_ENV_STATES.try_with(|states| {
    let mut states = states.borrow_mut();
    if states
      .get(&state.env)
      .is_some_and(|registered| registered.as_ptr() == identity)
    {
      states.remove(&state.env);
    }
  });
}

#[cfg(all(feature = "napi3", not(feature = "noop")))]
unsafe extern "C" fn external_env_cleanup(data: *mut c_void) {
  crate::bindgen_runtime::with_runtime_teardown_guard(|| {
    crate::bindgen_runtime::catch_unwind_safely(|| close_external_env(data));
  });
}

#[cfg(all(not(feature = "napi3"), not(feature = "noop")))]
unsafe extern "C" fn external_env_sentinel_finalize(
  env: sys::napi_env,
  data: *mut c_void,
  _hint: *mut c_void,
) {
  crate::bindgen_runtime::with_runtime_finalizer_guard(env, || {
    crate::bindgen_runtime::catch_unwind_safely(|| close_external_env(data));
  });
}

#[repr(C)]
pub struct External<T: 'static> {
  type_id: TypeId,
  obj: T,
  size_hint: usize,
  pub adjusted_size: i64,
}

#[repr(C)]
struct ExternalControlBlock<T: 'static> {
  external: UnsafeCell<External<T>>,
  env: Arc<ExternalEnvState>,
}

impl<T: 'static> ExternalControlBlock<T> {
  fn new(external: External<T>, env: Arc<ExternalEnvState>) -> Arc<Self> {
    Arc::new(Self {
      external: UnsafeCell::new(external),
      env,
    })
  }
}

impl<T: 'static> TypeName for &External<T> {
  fn type_name() -> &'static str {
    "External"
  }

  fn value_type() -> crate::ValueType {
    crate::ValueType::External
  }
}

impl<T: 'static> TypeName for &mut External<T> {
  fn type_name() -> &'static str {
    "External"
  }

  fn value_type() -> crate::ValueType {
    crate::ValueType::External
  }
}

impl<T: 'static> From<T> for External<T> {
  fn from(t: T) -> Self {
    External::new(t)
  }
}

impl<T: 'static> ValidateNapiValue for &External<T> {}

impl<T: 'static> External<T> {
  pub fn new(value: T) -> Self {
    Self {
      type_id: TypeId::of::<T>(),
      obj: value,
      size_hint: 0,
      adjusted_size: 0,
    }
  }

  pub(crate) unsafe fn from_napi_value_impl(
    env: sys::napi_env,
    napi_val: sys::napi_value,
    unknown_tagged_object: *mut c_void,
  ) -> Result<&'static Self> {
    let control = clone_external_control::<T>(unknown_tagged_object, env, napi_val)?;
    let external = control.external.get();
    Ok(unsafe { &*external })
  }

  /// Turn a raw pointer (from napi) pointing to an External into a mutable reference to the inner object.
  ///
  /// # Safety
  /// The token must come from a live napi-rs External value, and the caller must guarantee
  /// exclusive access to it for the returned reference's lifetime.
  pub unsafe fn inner_from_raw_mut(unknown_tagged_object: *mut c_void) -> Option<&'static mut T> {
    let control = clone_external_control_unchecked::<T>(unknown_tagged_object)?;
    let external = control.external.get();
    Some(unsafe { &mut (*external).obj })
  }

  pub(crate) unsafe fn inner_from_napi_value_mut(
    env: sys::napi_env,
    napi_val: sys::napi_value,
    unknown_tagged_object: *mut c_void,
  ) -> Result<&'static mut T> {
    let control = clone_external_control::<T>(unknown_tagged_object, env, napi_val)?;
    let external = control.external.get();
    Ok(unsafe { &mut (*external).obj })
  }

  /// Turn a raw pointer (from napi) pointing to an External into a reference inner object.
  ///
  /// # Safety
  /// The token must come from a live napi-rs External value that remains rooted for the returned
  /// reference's lifetime.
  pub unsafe fn inner_from_raw(unknown_tagged_object: *mut c_void) -> Option<&'static T> {
    let control = clone_external_control_unchecked::<T>(unknown_tagged_object)?;
    let external = control.external.get();
    Some(unsafe { &(*external).obj })
  }

  /// `size_hint` is a value to tell Node.js GC how much memory is used by this `External` object.
  ///
  /// If getting the exact `size_hint` is difficult, you can provide an approximate value, it's only effect to the GC.
  ///
  /// If your `External` object is not effect to GC, you can use `External::new` instead.
  pub fn new_with_size_hint(value: T, size_hint: usize) -> Self {
    Self {
      type_id: TypeId::of::<T>(),
      obj: value,
      size_hint,
      adjusted_size: 0,
    }
  }

  /// convert `External<T>` to `Unknown`
  pub fn into_unknown(self, env: &Env) -> Result<Unknown<'_>> {
    let napi_value = unsafe { ToNapiValue::to_napi_value(env.0, self)? };
    Ok(unsafe { Unknown::from_raw_unchecked(env.0, napi_value) })
  }

  /// Convert `External<T>` to `JsExternal`
  pub fn into_js_external(self, env: &Env) -> Result<JsExternal<'_>> {
    let napi_value = unsafe { ToNapiValue::to_napi_value(env.0, self)? };
    unsafe { JsExternal::from_napi_value(env.0, napi_value) }
  }

  #[allow(clippy::wrong_self_convention)]
  unsafe fn to_napi_value_impl(
    self,
    env: sys::napi_env,
  ) -> Result<(sys::napi_value, Arc<ExternalControlBlock<T>>)> {
    let mut napi_value = ptr::null_mut();
    #[cfg(not(target_family = "wasm"))]
    let size_hint = self.size_hint as i64;
    let control = ExternalControlBlock::new(self, external_env_state(env)?);
    let token = allocate_external_token()?;
    let token_ptr = ptr::without_provenance_mut::<c_void>(token);
    #[cfg(not(target_family = "wasm"))]
    let size_hint_ptr = Box::into_raw(Box::new(0i64));
    #[cfg(target_family = "wasm")]
    let size_hint_ptr: *mut i64 = ptr::null_mut();
    let status = unsafe {
      sys::napi_create_external(
        env,
        token_ptr,
        Some(raw_finalize_external),
        size_hint_ptr.cast(),
        &mut napi_value,
      )
    };
    if status != sys::Status::napi_ok {
      #[cfg(not(target_family = "wasm"))]
      drop(unsafe { Box::from_raw(size_hint_ptr) });
      return Err(Error::new(
        Status::from(status),
        "Create external value failed".to_owned(),
      ));
    }

    let mut owner_ref = ptr::null_mut();
    let status = unsafe { sys::napi_create_reference(env, napi_value, 0, &mut owner_ref) };
    if status != sys::Status::napi_ok {
      return Err(Error::new(
        Status::from(status),
        "Failed to create External owner reference".to_owned(),
      ));
    }
    if let Err(error) = register_external_provenance(
      token,
      Arc::clone(&control.env),
      owner_ref,
      Arc::clone(&control),
    ) {
      let _ = unsafe { sys::napi_delete_reference(env, owner_ref) };
      return Err(error);
    }

    #[cfg(not(target_family = "wasm"))]
    {
      let mut adjusted_external_memory_size = std::mem::MaybeUninit::new(0);

      if size_hint != 0 {
        let status = unsafe {
          sys::napi_adjust_external_memory(
            env,
            size_hint,
            adjusted_external_memory_size.as_mut_ptr(),
          )
        };
        check_status!(status, "Adjust external memory failed")?;
        unsafe { *size_hint_ptr = size_hint };
      };

      unsafe {
        (*control.external.get()).adjusted_size = adjusted_external_memory_size.assume_init();
      }
    }

    Ok((napi_value, control))
  }
}

unsafe extern "C" fn raw_finalize_external(
  env: sys::napi_env,
  finalize_data: *mut c_void,
  finalize_hint: *mut c_void,
) {
  #[cfg(target_family = "wasm")]
  let _ = finalize_hint;
  crate::bindgen_runtime::with_runtime_finalizer_guard(env, || {
    if !finalize_data.is_null() {
      crate::bindgen_runtime::catch_unwind_safely(|| {
        if let Some(provenance) = unregister_external_provenance(finalize_data) {
          debug_assert_eq!(provenance.env.env, env as EnvId);
          if !provenance.owner_ref.is_null() {
            let status = unsafe { sys::napi_delete_reference(env, provenance.owner_ref) };
            debug_assert!(
              status == sys::Status::napi_ok || status == sys::Status::napi_closing,
              "Deleting External owner reference failed"
            );
          }
          drop(provenance);
        }
      });
    }
    #[cfg(not(target_family = "wasm"))]
    if !finalize_hint.is_null() {
      crate::bindgen_runtime::catch_unwind_safely(|| {
        let size_hint = unsafe { *Box::from_raw(finalize_hint.cast::<i64>()) };
        if size_hint != 0 {
          let mut adjusted = 0i64;
          let status = unsafe { sys::napi_adjust_external_memory(env, -size_hint, &mut adjusted) };
          debug_assert!(
            status == sys::Status::napi_ok,
            "Calling napi_adjust_external_memory failed"
          );
        }
      });
    }
  });
}

impl<T: 'static> FromNapiRef for External<T> {
  unsafe fn from_napi_ref(
    env: sys::napi_env,
    napi_val: sys::napi_value,
  ) -> crate::Result<&'static Self> {
    let mut unknown_tagged_object = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_value_external(env, napi_val, &mut unknown_tagged_object) },
      "Failed to get external value"
    )?;
    let control = clone_external_control::<T>(unknown_tagged_object, env, napi_val)?;
    unsafe {
      crate::bindgen_runtime::register_legacy_native_borrow_with_value(
        env,
        napi_val,
        control.external.get(),
        false,
      )
    }?;
    let external = control.external.get();
    Ok(unsafe { &*external })
  }
}

impl<T: 'static> AsRef<T> for External<T> {
  fn as_ref(&self) -> &T {
    &self.obj
  }
}

impl<T: 'static> AsMut<T> for External<T> {
  fn as_mut(&mut self) -> &mut T {
    &mut self.obj
  }
}

impl<T: 'static> Deref for External<T> {
  type Target = T;

  fn deref(&self) -> &Self::Target {
    self.as_ref()
  }
}

impl<T: 'static> DerefMut for External<T> {
  fn deref_mut(&mut self) -> &mut Self::Target {
    self.as_mut()
  }
}

impl<T: 'static> ToNapiValue for External<T> {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> crate::Result<sys::napi_value> {
    let (napi_value, _) = unsafe { val.to_napi_value_impl(env)? };
    Ok(napi_value)
  }
}

/// `ExternalRef` keeps both the JavaScript `External` and its Rust allocation alive.
///
/// The reference can only be converted back to JavaScript through its owning environment. During
/// environment teardown, the JavaScript reference is closed before finalizers run; the Rust value
/// remains available through immutable `Deref` access until the last `ExternalRef` is dropped.
/// Mutable access is deliberately not provided because multiple `ExternalRef` values can point to
/// the same allocation; wrap `T` in an interior-mutability type when shared mutation is required.
pub struct ExternalRef<T: 'static> {
  control: Arc<ExternalControlBlock<T>>,
  pub(crate) raw: sys::napi_ref,
  pub(crate) env: sys::napi_env,
}

impl<T: 'static> TypeName for ExternalRef<T> {
  fn type_name() -> &'static str {
    "External"
  }

  fn value_type() -> crate::ValueType {
    crate::ValueType::External
  }
}

impl<T: 'static> ValidateNapiValue for ExternalRef<T> {}

impl<T: 'static> Drop for ExternalRef<T> {
  fn drop(&mut self) {
    if !self.control.env.is_open_for(self.env) {
      return;
    }
    check_status_or_throw!(
      self.env,
      unsafe { sys::napi_delete_reference(self.env, self.raw) },
      "Failed to delete reference on external value"
    );
  }
}

impl<T: 'static> ExternalRef<T> {
  pub fn new(env: &Env, value: T) -> Result<Self> {
    let external = External::new(value);
    let mut ref_ptr = ptr::null_mut();
    let (napi_val, control) = unsafe { external.to_napi_value_impl(env.0)? };
    check_status!(
      unsafe { sys::napi_create_reference(env.0, napi_val, 1, &mut ref_ptr) },
      "Failed to create reference on external value"
    )?;
    Ok(ExternalRef {
      control,
      raw: ref_ptr,
      env: env.0,
    })
  }

  /// Get the raw JsExternal value from the reference
  pub fn get_value(&self) -> Result<JsExternal<'_>> {
    self.control.env.ensure_open_for(self.env)?;
    let mut napi_val = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_reference_value(self.env, self.raw, &mut napi_val) },
      "Failed to get reference value on external value"
    )?;
    unsafe { JsExternal::from_napi_value(self.env, napi_val) }
  }
}

impl<T: 'static> FromNapiValue for ExternalRef<T> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> crate::Result<Self> {
    let mut unknown_tagged_object = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_value_external(env, napi_val, &mut unknown_tagged_object) },
      "Failed to get external value"
    )?;

    let control = clone_external_control::<T>(unknown_tagged_object, env, napi_val)?;

    let mut ref_ptr = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_create_reference(env, napi_val, 1, &mut ref_ptr) },
      "Failed to create reference on external value"
    )?;

    Ok(ExternalRef {
      control,
      raw: ref_ptr,
      env,
    })
  }
}

impl<T: 'static> ToNapiValue for ExternalRef<T> {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> crate::Result<sys::napi_value> {
    val.control.env.ensure_open_for(env)?;
    let mut value = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_reference_value(val.env, val.raw, &mut value) },
      "Failed to get reference value on external value"
    )?;
    Ok(value)
  }
}

impl<T: 'static> ToNapiValue for &ExternalRef<T> {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> crate::Result<sys::napi_value> {
    val.control.env.ensure_open_for(env)?;
    let mut value = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_reference_value(val.env, val.raw, &mut value) },
      "Failed to get reference value on external value"
    )?;
    Ok(value)
  }
}

impl<T: 'static> Deref for ExternalRef<T> {
  type Target = T;

  fn deref(&self) -> &Self::Target {
    unsafe { &(*self.control.external.get()).obj }
  }
}

#[cfg(all(test, not(feature = "noop")))]
mod tests {
  use std::{cell::Cell, rc::Rc, sync::Arc};

  use super::{External, ExternalControlBlock, ExternalEnvState, ExternalRef};

  struct DropProbe(Rc<Cell<bool>>);

  impl Drop for DropProbe {
    fn drop(&mut self) {
      self.0.set(true);
    }
  }

  #[test]
  fn external_ref_control_keeps_value_alive_after_js_owner_is_released() {
    let env = 0x1000usize as crate::sys::napi_env;
    let dropped = Rc::new(Cell::new(false));
    let env_state = Arc::new(ExternalEnvState::new(env));
    let control = ExternalControlBlock::new(
      External::new(DropProbe(Rc::clone(&dropped))),
      Arc::clone(&env_state),
    );
    let js_owner = Arc::clone(&control);
    let reference = ExternalRef {
      control,
      raw: std::ptr::null_mut(),
      env,
    };

    drop(js_owner);
    assert!(!dropped.get());
    assert!(!reference.0.get());

    env_state.close();
    drop(reference);
    assert!(dropped.get());
  }

  #[test]
  fn external_ref_environment_rejects_foreign_and_closed_access() {
    let env = 0x1000usize as crate::sys::napi_env;
    let foreign_env = 0x2000usize as crate::sys::napi_env;
    let state = ExternalEnvState::new(env);

    let foreign = state.ensure_open_for(foreign_env).unwrap_err();
    assert_eq!(foreign.status, crate::Status::InvalidArg);
    assert!(foreign.reason.contains("different napi_env"));

    state.close();
    let closed = state.ensure_open_for(env).unwrap_err();
    assert_eq!(closed.status, crate::Status::InvalidArg);
    assert!(closed.reason.contains("owner environment has closed"));
  }
}
