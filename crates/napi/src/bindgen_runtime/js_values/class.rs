use std::any::type_name;
use std::ffi::CString;
use std::marker::PhantomData;
use std::ops::{Deref, DerefMut};
use std::ptr;

use crate::{
  bindgen_runtime::{
    raw_finalize_unchecked, FromNapiValue, JsObjectValue, Object, ObjectFinalize, Reference,
    Result, TypeName, ValidateNapiValue,
  },
  check_status, sys, Env, JsValue, Property, PropertyAttributes, Value, ValueType,
};

#[derive(Clone, Copy)]
pub struct This<'env, T = Object<'env>> {
  pub object: T,
  _phantom: &'env PhantomData<()>,
}

impl<T> From<T> for This<'_, T> {
  fn from(value: T) -> Self {
    Self {
      object: value,
      _phantom: &PhantomData,
    }
  }
}

impl<T> Deref for This<'_, T> {
  type Target = T;

  fn deref(&self) -> &Self::Target {
    &self.object
  }
}

impl<T> DerefMut for This<'_, T> {
  fn deref_mut(&mut self) -> &mut Self::Target {
    &mut self.object
  }
}

impl<'env, T: JsValue<'env>> JsValue<'env> for This<'_, T> {
  fn value(&self) -> Value {
    self.object.value()
  }
}

impl<T: FromNapiValue> FromNapiValue for This<'_, T> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    Ok(Self {
      object: T::from_napi_value(env, napi_val)?,
      _phantom: &PhantomData,
    })
  }
}

#[derive(Clone, Copy)]
pub struct ClassInstance<'env, T: 'env> {
  pub value: sys::napi_value,
  env: sys::napi_env,
  inner: *mut T,
  _phantom: &'env PhantomData<()>,
}

impl<'env, T: 'env> JsValue<'env> for ClassInstance<'env, T> {
  fn value(&self) -> Value {
    Value {
      env: self.env,
      value: self.value,
      value_type: ValueType::Object,
    }
  }
}

impl<'env, T: 'env> JsObjectValue<'env> for ClassInstance<'env, T> {}

impl<'env, T: 'env> ClassInstance<'env, T> {
  #[doc(hidden)]
  pub unsafe fn new(value: sys::napi_value, env: sys::napi_env, inner: *mut T) -> Self {
    Self {
      value,
      env,
      inner: unsafe { &mut *inner },
      _phantom: &PhantomData,
    }
  }

  pub fn as_object<'a>(&self, env: &'a Env) -> Object<'a> {
    Object(
      Value {
        env: env.raw(),
        value: self.value,
        value_type: ValueType::Object,
      },
      PhantomData,
    )
  }

  /// Assign this `ClassInstance` to another `This` object
  ///
  /// Extends the lifetime of `ClassInstance` to `This`.
  pub fn assign_to_this<'a, 'this, U>(
    &'a self,
    name: &'a str,
    this: &'a mut This<U>,
  ) -> Result<ClassInstance<'this, T>>
  where
    'this: 'env,
    U: FromNapiValue + JsValue<'this>,
  {
    let name = CString::new(name)?;
    check_status!(
      unsafe {
        sys::napi_set_named_property(self.env, this.object.raw(), name.as_ptr(), self.value)
      },
      "Failed to assign ClassInstance<{}> to this",
      std::any::type_name::<T>()
    )?;
    let val: ClassInstance<'this, T> = ClassInstance {
      value: self.value,
      env: self.env,
      inner: self.inner,
      _phantom: &PhantomData,
    };
    Ok(val)
  }

  /// Assign this `ClassInstance` to another `This` object with `PropertyAttributes`.
  ///
  /// Extends the lifetime of `ClassInsatnce` to `This`.
  pub fn assign_to_this_with_attributes<'a, 'this, U>(
    &'a self,
    name: &'a str,
    attributes: PropertyAttributes,
    this: &'a mut This<U>,
  ) -> Result<ClassInstance<'this, T>>
  where
    'this: 'env,
    U: FromNapiValue + JsValue<'this>,
  {
    let property = Property::new()
      .with_utf8_name(name)?
      .with_value(self)
      .with_property_attributes(attributes);

    check_status!(
      unsafe {
        sys::napi_define_properties(
          self.env,
          this.object.value().value,
          1,
          [property.raw()].as_ptr(),
        )
      },
      "Failed to define properties on This in `assign_to_this_with_attributes`"
    )?;

    let val: ClassInstance<'this, T> = ClassInstance {
      value: self.value,
      env: self.env,
      inner: self.inner,
      _phantom: &PhantomData,
    };
    Ok(val)
  }
}

impl<'env, T: 'env> TypeName for ClassInstance<'env, T>
where
  &'env T: TypeName,
{
  fn type_name() -> &'static str {
    type_name::<&T>()
  }

  fn value_type() -> ValueType {
    <&T>::value_type()
  }
}

impl<'env, T: 'env> ValidateNapiValue for ClassInstance<'env, T>
where
  &'env T: ValidateNapiValue,
{
  unsafe fn validate(
    env: sys::napi_env,
    napi_val: sys::napi_value,
  ) -> crate::Result<sys::napi_value> {
    unsafe { <&'env T>::validate(env, napi_val) }
  }
}

impl<'env, T: 'env> FromNapiValue for ClassInstance<'env, T> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> crate::Result<Self> {
    let mut value = ptr::null_mut();
    check_status!(
      unsafe { sys::napi_unwrap(env, napi_val, &mut value) },
      "Unwrap value [{}] from class failed",
      type_name::<T>(),
    )?;
    let value = unsafe { Box::from_raw(value as *mut T) };
    Ok(Self {
      value: napi_val,
      inner: Box::leak(value),
      env,
      _phantom: &PhantomData,
    })
  }
}

impl<'env, T: 'env> Deref for ClassInstance<'env, T> {
  type Target = T;

  fn deref(&self) -> &Self::Target {
    unsafe { &*self.inner }
  }
}

impl<'env, T: 'env> DerefMut for ClassInstance<'env, T> {
  fn deref_mut(&mut self) -> &mut Self::Target {
    unsafe { &mut *self.inner }
  }
}

impl<'env, T: 'env> AsRef<T> for ClassInstance<'env, T> {
  fn as_ref(&self) -> &T {
    unsafe { &*self.inner }
  }
}

pub trait JavaScriptClassExt: Sized {
  fn into_instance(self, env: &Env) -> Result<ClassInstance<'_, Self>>;
  fn into_reference(self, env: Env) -> Result<Reference<Self>>;
  fn instance_of<'env, V: JsValue<'env>>(env: &Env, value: &V) -> Result<bool>;
}

struct FactoryCallGuard {
  previous: bool,
}

impl FactoryCallGuard {
  fn new() -> Self {
    let previous =
      crate::__private::___CALL_FROM_FACTORY.with(|factory_call| factory_call.replace(true));
    Self { previous }
  }
}

impl Drop for FactoryCallGuard {
  fn drop(&mut self) {
    crate::__private::___CALL_FROM_FACTORY.with(|factory_call| factory_call.set(self.previous));
  }
}

struct PendingFinalizeCallbacks {
  callbacks: Option<std::sync::Arc<super::value_ref::FinalizeCallbacks>>,
}

impl PendingFinalizeCallbacks {
  fn with_callback(callback: super::value_ref::FinalizeCallback) -> Self {
    // `Reference` needs atomic ref-counting for its `unsafe impl Sync`; the callback list is
    // only accessed on the JavaScript thread.
    #[allow(clippy::arc_with_non_send_sync)]
    let callbacks = std::sync::Arc::new(super::value_ref::FinalizeCallbacks::new(callback));
    Self {
      callbacks: Some(callbacks),
    }
  }

  fn as_ptr(&self) -> *const super::value_ref::FinalizeCallbacks {
    std::sync::Arc::as_ptr(
      self
        .callbacks
        .as_ref()
        .expect("callbacks already transferred"),
    )
  }

  fn transfer(mut self) {
    let callbacks = self
      .callbacks
      .take()
      .expect("callbacks already transferred");
    let _ = std::sync::Arc::into_raw(callbacks);
  }
}

impl Drop for PendingFinalizeCallbacks {
  fn drop(&mut self) {
    drop(self.callbacks.take());
  }
}

trait NewInstanceOps {
  fn initial_finalize_callback() -> super::value_ref::FinalizeCallback {
    Box::new(|| {})
  }

  unsafe fn get_reference_value(
    env: sys::napi_env,
    ctor_ref: sys::napi_ref,
    ctor: *mut sys::napi_value,
  ) -> sys::napi_status;

  unsafe fn new_instance(
    env: sys::napi_env,
    ctor: sys::napi_value,
    result: *mut sys::napi_value,
  ) -> sys::napi_status;

  unsafe fn wrap(
    env: sys::napi_env,
    instance: sys::napi_value,
    wrapped_value: *mut std::ffi::c_void,
    finalize: sys::napi_finalize,
    object_ref: *mut sys::napi_ref,
  ) -> sys::napi_status;

  unsafe fn delete_reference(env: sys::napi_env, object_ref: sys::napi_ref) -> sys::napi_status {
    unsafe { sys::napi_delete_reference(env, object_ref) }
  }
}

struct NodeApiNewInstanceOps;

impl NewInstanceOps for NodeApiNewInstanceOps {
  unsafe fn get_reference_value(
    env: sys::napi_env,
    ctor_ref: sys::napi_ref,
    ctor: *mut sys::napi_value,
  ) -> sys::napi_status {
    unsafe { sys::napi_get_reference_value(env, ctor_ref, ctor) }
  }

  unsafe fn new_instance(
    env: sys::napi_env,
    ctor: sys::napi_value,
    result: *mut sys::napi_value,
  ) -> sys::napi_status {
    unsafe { sys::napi_new_instance(env, ctor, 0, std::ptr::null_mut(), result) }
  }

  unsafe fn wrap(
    env: sys::napi_env,
    instance: sys::napi_value,
    wrapped_value: *mut std::ffi::c_void,
    finalize: sys::napi_finalize,
    object_ref: *mut sys::napi_ref,
  ) -> sys::napi_status {
    unsafe {
      sys::napi_wrap(
        env,
        instance,
        wrapped_value,
        finalize,
        std::ptr::null_mut(),
        object_ref,
      )
    }
  }
}

unsafe fn construct_instance<T, O: NewInstanceOps>(
  env: sys::napi_env,
  ctor_ref: sys::napi_ref,
) -> Result<sys::napi_value> {
  let mut ctor = std::ptr::null_mut();
  check_status!(
    unsafe { O::get_reference_value(env, ctor_ref, &mut ctor) },
    "Failed to get constructor reference of class `{}`",
    type_name::<T>(),
  )?;

  let mut result = std::ptr::null_mut();
  {
    let _factory_call = FactoryCallGuard::new();
    check_status!(
      unsafe { O::new_instance(env, ctor, &mut result) },
      "Failed to construct class `{}`",
      type_name::<T>(),
    )?;
  }
  Ok(result)
}

unsafe fn wrap_instance<T, O: NewInstanceOps>(
  env: sys::napi_env,
  instance: sys::napi_value,
  wrapped_value: *mut std::ffi::c_void,
  finalize: sys::napi_finalize,
) -> Result<(sys::napi_ref, PendingFinalizeCallbacks)> {
  let finalize_callbacks = PendingFinalizeCallbacks::with_callback(O::initial_finalize_callback());
  let mut object_ref = std::ptr::null_mut();
  check_status!(
    unsafe { O::wrap(env, instance, wrapped_value, finalize, &mut object_ref) },
    "Failed to wrap native object of class `{}`",
    type_name::<T>(),
  )?;
  Ok((object_ref, finalize_callbacks))
}

struct OwnedClassValue<T> {
  raw: *mut T,
  is_zst: bool,
}

impl<T> OwnedClassValue<T> {
  fn new(value: T) -> Self {
    if std::mem::size_of::<T>() == 0 {
      let layout = Self::zst_layout();
      let raw = unsafe { std::alloc::alloc(layout) }.cast::<T>();
      if raw.is_null() {
        std::alloc::handle_alloc_error(layout);
      }
      unsafe { raw.write(value) };
      Self { raw, is_zst: true }
    } else {
      Self {
        raw: Box::into_raw(Box::new(value)),
        is_zst: false,
      }
    }
  }

  unsafe fn from_raw(raw: *mut T) -> Self {
    Self {
      raw,
      is_zst: std::mem::size_of::<T>() == 0,
    }
  }

  fn as_ptr(&self) -> *mut T {
    self.raw
  }

  fn into_raw(mut self) -> *mut T {
    let raw = self.raw;
    self.raw = std::ptr::null_mut();
    raw
  }

  unsafe fn into_value(mut self) -> T {
    let raw = self.raw;
    self.raw = std::ptr::null_mut();
    if self.is_zst {
      let value = unsafe { raw.read() };
      unsafe { std::alloc::dealloc(raw.cast(), Self::zst_layout()) };
      value
    } else {
      *unsafe { Box::from_raw(raw) }
    }
  }

  fn zst_layout() -> std::alloc::Layout {
    std::alloc::Layout::from_size_align(1, std::mem::align_of::<T>())
      .expect("class ZST alignment must form a valid allocation layout")
  }
}

impl<T> Drop for OwnedClassValue<T> {
  fn drop(&mut self) {
    if self.raw.is_null() {
      return;
    }
    unsafe {
      if self.is_zst {
        std::ptr::drop_in_place(self.raw);
        std::alloc::dealloc(self.raw.cast(), Self::zst_layout());
      } else {
        drop(Box::from_raw(self.raw));
      }
    }
  }
}

unsafe extern "C" fn raw_finalize_owned_class<T: ObjectFinalize, O: NewInstanceOps>(
  env: sys::napi_env,
  finalize_data: *mut std::ffi::c_void,
  _finalize_hint: *mut std::ffi::c_void,
) {
  let data = unsafe { OwnedClassValue::<T>::from_raw(finalize_data.cast()).into_value() };
  unsafe {
    crate::bindgen_runtime::finalize_object_with(env, data, finalize_data, |env, object_ref| {
      O::delete_reference(env, object_ref)
    });
  }
}

unsafe fn new_instance_with_owned_value_and_ops<T: ObjectFinalize, O: NewInstanceOps>(
  env: sys::napi_env,
  value: T,
  ctor_ref: sys::napi_ref,
) -> Result<(sys::napi_value, *mut T)> {
  let value = OwnedClassValue::new(value);
  let wrapped_value = value.as_ptr();
  let result = unsafe { construct_instance::<T, O>(env, ctor_ref)? };
  let (object_ref, finalize_callbacks) = unsafe {
    wrap_instance::<T, O>(
      env,
      result,
      wrapped_value.cast(),
      Some(raw_finalize_owned_class::<T, O>),
    )?
  };

  // `napi_wrap` now owns the native value. Disarm its rollback guard before registering
  // reference metadata so an unexpected panic cannot double-drop the value.
  let wrapped_value = value.into_raw();
  let finalize_callbacks_ptr = finalize_callbacks.as_ptr();
  super::value_ref::add_ref(
    env,
    wrapped_value.cast(),
    wrapped_value.cast(),
    object_ref,
    finalize_callbacks_ptr,
  );
  finalize_callbacks.transfer();
  Ok((result, wrapped_value))
}

/// Creates a JavaScript class instance while retaining ownership of `value` until `napi_wrap`
/// succeeds.
///
/// # Safety
///
/// `env` and `ctor_ref` must belong to the current JavaScript environment.
#[doc(hidden)]
pub unsafe fn new_instance_with_owned_value<T: ObjectFinalize>(
  env: sys::napi_env,
  value: T,
  ctor_ref: sys::napi_ref,
) -> Result<(sys::napi_value, *mut T)> {
  unsafe { new_instance_with_owned_value_and_ops::<T, NodeApiNewInstanceOps>(env, value, ctor_ref) }
}

/// # Safety
///
/// create instance of class
#[doc(hidden)]
pub unsafe fn new_instance<T: 'static + ObjectFinalize>(
  env: sys::napi_env,
  wrapped_value: *mut std::ffi::c_void,
  ctor_ref: sys::napi_ref,
) -> Result<sys::napi_value> {
  let result = unsafe { construct_instance::<T, NodeApiNewInstanceOps>(env, ctor_ref)? };
  let (object_ref, finalize_callbacks) = unsafe {
    wrap_instance::<T, NodeApiNewInstanceOps>(
      env,
      result,
      wrapped_value,
      Some(raw_finalize_unchecked::<T>),
    )?
  };
  let finalize_callbacks_ptr = finalize_callbacks.as_ptr();
  Reference::<T>::add_ref(
    env,
    wrapped_value,
    (wrapped_value, object_ref, finalize_callbacks_ptr),
  );
  finalize_callbacks.transfer();
  Ok(result)
}

#[cfg(test)]
mod tests {
  use std::{
    cell::Cell,
    sync::{
      atomic::{AtomicUsize, Ordering},
      Arc,
    },
  };

  use super::*;

  struct DropCounter(Arc<AtomicUsize>);

  impl Drop for DropCounter {
    fn drop(&mut self) {
      self.0.fetch_add(1, Ordering::SeqCst);
    }
  }

  impl ObjectFinalize for DropCounter {}

  static WRAP_FAILURE_CALLBACK_DROPS: AtomicUsize = AtomicUsize::new(0);
  static SUCCESS_VALUE_DROPS: AtomicUsize = AtomicUsize::new(0);
  static SUCCESS_FINALIZE_CALLS: AtomicUsize = AtomicUsize::new(0);
  static SUCCESS_CALLBACK_CALLS: AtomicUsize = AtomicUsize::new(0);
  static SUCCESS_REFERENCE_DELETES: AtomicUsize = AtomicUsize::new(0);

  thread_local! {
    static SUCCESS_FINALIZER: Cell<sys::napi_finalize> = const { Cell::new(None) };
  }

  const SUCCESS_OBJECT_REF: usize = 0x1001;

  struct StaticDropCounter(&'static AtomicUsize);

  impl Drop for StaticDropCounter {
    fn drop(&mut self) {
      self.0.fetch_add(1, Ordering::SeqCst);
    }
  }

  struct EndToEndValue;

  impl Drop for EndToEndValue {
    fn drop(&mut self) {
      SUCCESS_VALUE_DROPS.fetch_add(1, Ordering::SeqCst);
    }
  }

  impl ObjectFinalize for EndToEndValue {
    fn finalize(&mut self, _env: Env) -> Result<()> {
      SUCCESS_FINALIZE_CALLS.fetch_add(1, Ordering::SeqCst);
      Ok(())
    }
  }

  struct ConstructionFailureOps;

  impl NewInstanceOps for ConstructionFailureOps {
    unsafe fn get_reference_value(
      _env: sys::napi_env,
      _ctor_ref: sys::napi_ref,
      ctor: *mut sys::napi_value,
    ) -> sys::napi_status {
      unsafe { ctor.write(std::ptr::NonNull::dangling().as_ptr()) };
      sys::Status::napi_ok
    }

    unsafe fn new_instance(
      _env: sys::napi_env,
      _ctor: sys::napi_value,
      _result: *mut sys::napi_value,
    ) -> sys::napi_status {
      sys::Status::napi_generic_failure
    }

    unsafe fn wrap(
      _env: sys::napi_env,
      _instance: sys::napi_value,
      _wrapped_value: *mut std::ffi::c_void,
      _finalize: sys::napi_finalize,
      _object_ref: *mut sys::napi_ref,
    ) -> sys::napi_status {
      panic!("wrap must not run after construction failure")
    }
  }

  struct WrapFailureOps;

  impl NewInstanceOps for WrapFailureOps {
    fn initial_finalize_callback() -> super::super::value_ref::FinalizeCallback {
      let mut callback_drop = Some(StaticDropCounter(&WRAP_FAILURE_CALLBACK_DROPS));
      Box::new(move || drop(callback_drop.take()))
    }

    unsafe fn get_reference_value(
      _env: sys::napi_env,
      _ctor_ref: sys::napi_ref,
      ctor: *mut sys::napi_value,
    ) -> sys::napi_status {
      unsafe { ctor.write(std::ptr::NonNull::dangling().as_ptr()) };
      sys::Status::napi_ok
    }

    unsafe fn new_instance(
      _env: sys::napi_env,
      _ctor: sys::napi_value,
      result: *mut sys::napi_value,
    ) -> sys::napi_status {
      unsafe { result.write(std::ptr::NonNull::dangling().as_ptr()) };
      sys::Status::napi_ok
    }

    unsafe fn wrap(
      _env: sys::napi_env,
      _instance: sys::napi_value,
      _wrapped_value: *mut std::ffi::c_void,
      _finalize: sys::napi_finalize,
      _object_ref: *mut sys::napi_ref,
    ) -> sys::napi_status {
      sys::Status::napi_generic_failure
    }
  }

  struct SuccessfulOps;

  impl NewInstanceOps for SuccessfulOps {
    fn initial_finalize_callback() -> super::super::value_ref::FinalizeCallback {
      Box::new(|| {
        SUCCESS_CALLBACK_CALLS.fetch_add(1, Ordering::SeqCst);
      })
    }

    unsafe fn get_reference_value(
      _env: sys::napi_env,
      _ctor_ref: sys::napi_ref,
      ctor: *mut sys::napi_value,
    ) -> sys::napi_status {
      unsafe { ctor.write(0x1002usize as sys::napi_value) };
      sys::Status::napi_ok
    }

    unsafe fn new_instance(
      _env: sys::napi_env,
      _ctor: sys::napi_value,
      result: *mut sys::napi_value,
    ) -> sys::napi_status {
      unsafe { result.write(0x1003usize as sys::napi_value) };
      sys::Status::napi_ok
    }

    unsafe fn wrap(
      _env: sys::napi_env,
      _instance: sys::napi_value,
      _wrapped_value: *mut std::ffi::c_void,
      finalize: sys::napi_finalize,
      object_ref: *mut sys::napi_ref,
    ) -> sys::napi_status {
      assert!(finalize.is_some());
      SUCCESS_FINALIZER.with(|slot| slot.set(finalize));
      unsafe { object_ref.write(SUCCESS_OBJECT_REF as sys::napi_ref) };
      sys::Status::napi_ok
    }

    unsafe fn delete_reference(_env: sys::napi_env, object_ref: sys::napi_ref) -> sys::napi_status {
      assert_eq!(object_ref as usize, SUCCESS_OBJECT_REF);
      SUCCESS_REFERENCE_DELETES.fetch_add(1, Ordering::SeqCst);
      sys::Status::napi_ok
    }
  }

  #[test]
  fn factory_call_guard_restores_nested_prior_true_state() {
    crate::__private::___CALL_FROM_FACTORY.with(|factory_call| factory_call.set(true));

    {
      let _outer = FactoryCallGuard::new();
      crate::__private::___CALL_FROM_FACTORY.with(|factory_call| assert!(factory_call.get()));
      {
        let _inner = FactoryCallGuard::new();
        crate::__private::___CALL_FROM_FACTORY.with(|factory_call| assert!(factory_call.get()));
      }
      crate::__private::___CALL_FROM_FACTORY.with(|factory_call| assert!(factory_call.get()));
    }

    crate::__private::___CALL_FROM_FACTORY.with(|factory_call| {
      assert!(factory_call.get());
      factory_call.set(false);
    });
  }

  #[test]
  fn factory_call_guard_restores_state_during_unwind() {
    crate::__private::___CALL_FROM_FACTORY.with(|factory_call| factory_call.set(false));

    let result = std::panic::catch_unwind(|| {
      let _guard = FactoryCallGuard::new();
      crate::__private::___CALL_FROM_FACTORY.with(|factory_call| assert!(factory_call.get()));
      panic!("factory construction panic");
    });

    assert!(result.is_err());
    crate::__private::___CALL_FROM_FACTORY.with(|factory_call| assert!(!factory_call.get()));
  }

  #[test]
  fn owned_class_value_is_dropped_when_construction_fails_and_factory_state_is_restored() {
    let drops = Arc::new(AtomicUsize::new(0));
    crate::__private::___CALL_FROM_FACTORY.with(|factory_call| factory_call.set(false));

    let result = unsafe {
      new_instance_with_owned_value_and_ops::<DropCounter, ConstructionFailureOps>(
        std::ptr::null_mut(),
        DropCounter(drops.clone()),
        std::ptr::null_mut(),
      )
    };

    assert!(result.is_err());
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    crate::__private::___CALL_FROM_FACTORY.with(|factory_call| assert!(!factory_call.get()));
  }

  #[test]
  fn owned_class_value_and_finalize_callbacks_are_reclaimed_when_wrap_fails() {
    WRAP_FAILURE_CALLBACK_DROPS.store(0, Ordering::SeqCst);
    let value_drops = Arc::new(AtomicUsize::new(0));

    let result = unsafe {
      new_instance_with_owned_value_and_ops::<DropCounter, WrapFailureOps>(
        std::ptr::null_mut(),
        DropCounter(value_drops.clone()),
        std::ptr::null_mut(),
      )
    };

    assert!(result.is_err());
    assert_eq!(value_drops.load(Ordering::SeqCst), 1);
    assert_eq!(WRAP_FAILURE_CALLBACK_DROPS.load(Ordering::SeqCst), 1);
  }

  #[test]
  fn successful_owned_class_conversion_finalizes_all_transferred_state_once() {
    SUCCESS_VALUE_DROPS.store(0, Ordering::SeqCst);
    SUCCESS_FINALIZE_CALLS.store(0, Ordering::SeqCst);
    SUCCESS_CALLBACK_CALLS.store(0, Ordering::SeqCst);
    SUCCESS_REFERENCE_DELETES.store(0, Ordering::SeqCst);
    SUCCESS_FINALIZER.with(|slot| slot.set(None));
    let env = 0x1004usize as sys::napi_env;

    let (_, wrapped_value) = unsafe {
      new_instance_with_owned_value_and_ops::<EndToEndValue, SuccessfulOps>(
        env,
        EndToEndValue,
        0x1005usize as sys::napi_ref,
      )
    }
    .expect("the fake Node-API operations must complete");

    assert_eq!(SUCCESS_VALUE_DROPS.load(Ordering::SeqCst), 0);
    assert_eq!(SUCCESS_FINALIZE_CALLS.load(Ordering::SeqCst), 0);
    assert_eq!(SUCCESS_CALLBACK_CALLS.load(Ordering::SeqCst), 0);
    assert_eq!(SUCCESS_REFERENCE_DELETES.load(Ordering::SeqCst), 0);
    assert!(super::super::value_ref::REFERENCE_MAP.with(|references| {
      references.borrow_mut(|references| references.contains_key(&wrapped_value.cast()))
    }));

    let finalize = SUCCESS_FINALIZER
      .with(Cell::take)
      .expect("napi_wrap must receive the owned-value raw finalizer");
    unsafe { finalize(env, wrapped_value.cast(), std::ptr::null_mut()) };

    assert_eq!(SUCCESS_FINALIZE_CALLS.load(Ordering::SeqCst), 1);
    assert_eq!(SUCCESS_VALUE_DROPS.load(Ordering::SeqCst), 1);
    assert_eq!(SUCCESS_CALLBACK_CALLS.load(Ordering::SeqCst), 1);
    assert_eq!(SUCCESS_REFERENCE_DELETES.load(Ordering::SeqCst), 1);
    assert!(!super::super::value_ref::REFERENCE_MAP.with(|references| {
      references.borrow_mut(|references| references.contains_key(&wrapped_value.cast()))
    }));
  }

  #[test]
  fn transferred_owned_class_value_is_finalized_exactly_once() {
    let drops = Arc::new(AtomicUsize::new(0));
    let value = OwnedClassValue::new(DropCounter(drops.clone()));
    let raw = value.into_raw();

    assert_eq!(drops.load(Ordering::SeqCst), 0);
    let value = unsafe { OwnedClassValue::from_raw(raw).into_value() };
    assert_eq!(drops.load(Ordering::SeqCst), 0);
    drop(value);
    assert_eq!(drops.load(Ordering::SeqCst), 1);
  }

  static ZST_DROPS: AtomicUsize = AtomicUsize::new(0);

  #[repr(align(64))]
  struct AlignedZst;

  impl Drop for AlignedZst {
    fn drop(&mut self) {
      ZST_DROPS.fetch_add(1, Ordering::SeqCst);
    }
  }

  #[test]
  fn owned_zst_class_values_have_unique_aligned_storage_and_drop_once() {
    ZST_DROPS.store(0, Ordering::SeqCst);
    let first = OwnedClassValue::new(AlignedZst);
    let second = OwnedClassValue::new(AlignedZst);

    assert_ne!(first.as_ptr(), second.as_ptr());
    assert_eq!(
      first.as_ptr() as usize % std::mem::align_of::<AlignedZst>(),
      0
    );
    assert_eq!(
      second.as_ptr() as usize % std::mem::align_of::<AlignedZst>(),
      0
    );

    drop(first);
    drop(second);
    assert_eq!(ZST_DROPS.load(Ordering::SeqCst), 2);
  }
}
