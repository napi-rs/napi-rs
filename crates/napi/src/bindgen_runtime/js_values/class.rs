use std::any::type_name;
use std::ffi::CString;
use std::marker::PhantomData;
use std::ops::{Deref, DerefMut};
use std::ptr;

use super::Object;
use crate::{
  bindgen_runtime::{
    raw_finalize_unchecked, FromNapiValue, ObjectFinalize, Reference, Result, TypeName,
    ValidateNapiValue,
  },
  check_status, sys, Env, NapiRaw, NapiValue, ValueType,
};
use crate::{Property, PropertyAttributes};

pub struct This<'scope, T: FromNapiValue = Object> {
  pub object: T,
  _phantom: &'scope PhantomData<()>,
}

impl<T: FromNapiValue> From<T> for This<'_, T> {
  fn from(value: T) -> Self {
    Self {
      object: value,
      _phantom: &PhantomData,
    }
  }
}

impl<T: NapiValue> Deref for This<'_, T> {
  type Target = T;

  fn deref(&self) -> &Self::Target {
    &self.object
  }
}

impl<T: NapiValue> DerefMut for This<'_, T> {
  fn deref_mut(&mut self) -> &mut Self::Target {
    &mut self.object
  }
}

impl<T: NapiValue> NapiRaw for This<'_, T> {
  unsafe fn raw(&self) -> napi_sys::napi_value {
    self.object.raw()
  }
}

impl<T: NapiValue> NapiValue for This<'_, T> {
  unsafe fn from_raw(env: napi_sys::napi_env, value: napi_sys::napi_value) -> Result<Self> {
    Ok(Self {
      object: T::from_raw(env, value)?,
      _phantom: &PhantomData,
    })
  }

  unsafe fn from_raw_unchecked(env: napi_sys::napi_env, value: napi_sys::napi_value) -> Self {
    Self {
      object: T::from_raw_unchecked(env, value),
      _phantom: &PhantomData,
    }
  }
}

pub struct ClassInstance<'env, T: 'env> {
  pub value: sys::napi_value,
  env: sys::napi_env,
  inner: *mut T,
  _phantom: &'env PhantomData<()>,
}

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

  pub fn as_object(&self, env: &Env) -> Object {
    unsafe { Object::from_raw_unchecked(env.raw(), self.value) }
  }

  /// Assign this `ClassInstance` to another `This` object
  ///
  /// Extends the lifetime of `ClassInsatnce` to `This`.
  pub fn assign_to_this<'a, 'this, U>(
    &'a self,
    name: &'a str,
    this: &'a mut This<U>,
  ) -> Result<ClassInstance<'this, T>>
  where
    'this: 'env,
    U: FromNapiValue + NapiRaw,
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
    U: FromNapiValue + NapiRaw,
  {
    let property = Property::new(name)?
      .with_value(&self)
      .with_property_attributes(attributes);

    check_status!(
      unsafe {
        sys::napi_define_properties(self.env, this.object.raw(), 1, [property.raw()].as_ptr())
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

impl<'env, T: 'env> NapiRaw for ClassInstance<'env, T> {
  unsafe fn raw(&self) -> sys::napi_value {
    self.value
  }
}

impl<'env, T: 'env> NapiRaw for &ClassInstance<'env, T> {
  unsafe fn raw(&self) -> sys::napi_value {
    self.value
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
  fn into_instance(self, env: &Env) -> Result<ClassInstance<Self>>;
  fn into_reference(self, env: Env) -> Result<Reference<Self>>;
  fn instance_of<V: NapiRaw>(env: Env, value: V) -> Result<bool>;
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
  let mut ctor = std::ptr::null_mut();
  check_status!(
    sys::napi_get_reference_value(env, ctor_ref, &mut ctor),
    "Failed to get constructor reference of class `{}`",
    type_name::<T>(),
  )?;

  let mut result = std::ptr::null_mut();
  crate::__private::___CALL_FROM_FACTORY
    .with(|inner| inner.store(true, std::sync::atomic::Ordering::Relaxed));
  check_status!(
    sys::napi_new_instance(env, ctor, 0, std::ptr::null_mut(), &mut result),
    "Failed to construct class `{}`",
    type_name::<T>(),
  )?;
  crate::__private::___CALL_FROM_FACTORY
    .with(|inner| inner.store(false, std::sync::atomic::Ordering::Relaxed));
  let mut object_ref = std::ptr::null_mut();
  let initial_finalize: Box<dyn FnOnce()> = Box::new(|| {});
  let finalize_callbacks_ptr = std::rc::Rc::into_raw(std::rc::Rc::new(std::cell::Cell::new(
    Box::into_raw(initial_finalize),
  )));
  check_status!(
    sys::napi_wrap(
      env,
      result,
      wrapped_value,
      Some(raw_finalize_unchecked::<T>),
      std::ptr::null_mut(),
      &mut object_ref,
    ),
    "Failed to wrap native object of class `{}`",
    type_name::<T>(),
  )?;
  Reference::<T>::add_ref(
    env,
    wrapped_value,
    (wrapped_value, object_ref, finalize_callbacks_ptr),
  );
  Ok(result)
}
