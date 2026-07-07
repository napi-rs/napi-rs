use std::{
  ptr,
  rc::Rc,
  sync::{Arc, Mutex},
};

use crate::{check_status, sys, Env, Error, JsValue, Result, Status, Value, ValueType};

mod array;
mod arraybuffer;
#[cfg(feature = "napi6")]
mod bigint;
mod boolean;
mod buffer;
mod class;
#[cfg(all(feature = "chrono_date", feature = "napi5"))]
mod date;
mod either;
mod external;
mod function;
mod map;
mod nil;
mod number;
mod object;
mod os_string;
mod promise;
mod promise_raw;
mod scope;
#[cfg(feature = "serde-json")]
mod serde;
mod set;
#[cfg(feature = "web_stream")]
mod stream;
mod string;
mod symbol;
mod task;
mod value_ref;

pub use crate::js_values::Unknown;
#[cfg(feature = "napi5")]
pub use crate::JsDate as Date;
pub use array::*;
pub use arraybuffer::*;
#[cfg(feature = "napi6")]
pub use bigint::*;
pub use buffer::*;
pub use class::*;
pub use either::*;
pub use external::*;
pub use function::*;
pub use nil::*;
pub use object::*;
pub use promise::*;
pub use promise_raw::*;
pub use scope::*;
#[cfg(feature = "web_stream")]
pub use stream::*;
pub use string::*;
pub use symbol::*;
pub use task::*;
pub use value_ref::*;

pub trait TypeName {
  fn type_name() -> &'static str;

  fn value_type() -> ValueType;
}

pub trait ToNapiValue: Sized {
  /// This function called to convert rust values to napi values
  ///
  /// # Safety
  /// The caller must guarantee that the `env` is a valid napi env pointer and the returned `napi_value` is a valid js value pointer.
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value>;

  fn into_unknown(self, env: &Env) -> Result<Unknown<'_>> {
    let napi_val = unsafe { Self::to_napi_value(env.0, self)? };
    Ok(Unknown(
      Value {
        env: env.0,
        value: napi_val,
        value_type: ValueType::Unknown,
      },
      std::marker::PhantomData,
    ))
  }
}

pub(crate) fn ensure_same_env(
  owner_env: sys::napi_env,
  destination_env: sys::napi_env,
) -> Result<()> {
  if owner_env != destination_env {
    return Err(Error::new(
      Status::InvalidArg,
      "A borrowed JavaScript value cannot be used with a different napi_env".to_owned(),
    ));
  }
  Ok(())
}

#[derive(Clone)]
pub(crate) struct NapiValueOwner {
  env: sys::napi_env,
  owner_thread: std::thread::ThreadId,
  #[cfg(all(feature = "napi4", not(feature = "noop")))]
  custom_gc_handle: Option<std::sync::Arc<crate::bindgen_prelude::CustomGcHandle>>,
  // N-API 1-3 have no thread-safe disposal primitive. Keep every wrapper that
  // relies on auto traits bound to the thread where its reference was created.
  #[cfg(not(feature = "napi4"))]
  thread_affinity: std::marker::PhantomData<Rc<()>>,
}

impl NapiValueOwner {
  pub(crate) fn new(env: sys::napi_env) -> Self {
    Self {
      env,
      owner_thread: std::thread::current().id(),
      #[cfg(all(feature = "napi4", not(feature = "noop")))]
      custom_gc_handle: crate::bindgen_prelude::current_custom_gc_handle(env),
      #[cfg(not(feature = "napi4"))]
      thread_affinity: std::marker::PhantomData,
    }
  }

  pub(crate) fn env(&self) -> sys::napi_env {
    self.env
  }

  pub(crate) fn ensure_access(&self, env: sys::napi_env, value_type: &str) -> Result<()> {
    if self.env != env {
      return Err(Error::new(
        Status::InvalidArg,
        format!("A JavaScript {value_type} cannot be used with a different napi_env"),
      ));
    }
    if self.owner_thread != std::thread::current().id() {
      return Err(Error::new(
        Status::InvalidArg,
        format!("A JavaScript {value_type} cannot be accessed outside its owner thread"),
      ));
    }
    #[cfg(all(feature = "napi4", not(feature = "noop")))]
    if self
      .custom_gc_handle
      .as_ref()
      .is_some_and(|handle| !handle.can_access_from_current_thread(env))
    {
      return Err(Error::new(
        Status::InvalidArg,
        format!("A JavaScript {value_type} cannot be accessed after its owner napi_env has closed"),
      ));
    }
    Ok(())
  }

  pub(crate) fn release_reference(&self, reference: sys::napi_ref) -> sys::napi_status {
    if reference.is_null() {
      return sys::Status::napi_ok;
    }
    #[cfg(all(feature = "napi4", not(feature = "noop")))]
    if let Some(handle) = self.custom_gc_handle.as_ref() {
      return handle.release_reference(reference);
    }
    #[cfg(not(feature = "noop"))]
    {
      if self.owner_thread != std::thread::current().id() {
        return sys::Status::napi_closing;
      }
      let mut ref_count = 0;
      let status = unsafe { sys::napi_reference_unref(self.env, reference, &mut ref_count) };
      if status != sys::Status::napi_ok {
        return status;
      }
      if ref_count != 0 {
        return sys::Status::napi_generic_failure;
      }
      unsafe { sys::napi_delete_reference(self.env, reference) }
    }
    #[cfg(feature = "noop")]
    {
      sys::Status::napi_ok
    }
  }
}

impl ToNapiValue for sys::napi_value {
  unsafe fn to_napi_value(_env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    Ok(val)
  }
}

impl<'env, T: JsValue<'env>> ToNapiValue for T {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    let value = val.value();
    ensure_same_env(value.env, env)?;
    Ok(value.value)
  }
}

pub trait FromNapiValue: Sized {
  /// This function called to convert napi values to native rust values
  ///
  /// # Safety
  ///
  /// The caller must ensure that:
  /// - The `env` is a valid napi env pointer
  /// - The `napi_val` is a valid js value pointer
  /// - The `napi_val` is a valid type that can be converted into `Self` using [ValidateNapiValue::validate]
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self>;

  fn from_unknown(value: Unknown) -> Result<Self> {
    unsafe { Self::from_napi_value(value.0.env, value.0.value) }
  }
}

pub trait FromNapiRef {
  /// This function called to convert napi values to native rust values
  ///
  /// # Safety
  ///
  /// The caller must ensure that:
  /// - The `env` is a valid napi env pointer
  /// - The `napi_val` is a valid js value pointer
  /// - The `napi_val` is a valid type that can be converted into `Self` using [ValidateNapiValue::validate]
  unsafe fn from_napi_ref(env: sys::napi_env, napi_val: sys::napi_value) -> Result<&'static Self>;
}

pub trait FromNapiMutRef {
  /// This function called to convert napi values to native rust values
  ///
  /// # Safety
  ///
  /// The caller must ensure that:
  /// - The `env` is a valid napi env pointer
  /// - The `napi_val` is a valid js value pointer
  /// - The `napi_val` is a valid type that can be converted into `Self` using [ValidateNapiValue::validate]
  unsafe fn from_napi_mut_ref(
    env: sys::napi_env,
    napi_val: sys::napi_value,
  ) -> Result<&'static mut Self>;
}

impl<T: FromNapiRef + 'static> FromNapiValue for &T {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    unsafe { T::from_napi_ref(env, napi_val) }
  }
}

impl<T: FromNapiMutRef + 'static> FromNapiValue for &mut T {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    unsafe { T::from_napi_mut_ref(env, napi_val) }
  }
}

pub trait ValidateNapiValue: TypeName {
  /// This function called to validate whether napi value passed to rust is valid type.
  ///
  /// The reason why this function return `napi_value` is that if a `Promise<T>` passed in
  /// we need to return `Promise.reject(T)`, not the `T`.
  /// So we need to create `Promise.reject(T)` in this function.
  ///
  /// # Safety
  ///
  /// The caller must ensure that:
  /// - The `env` is a valid napi env pointer
  /// - The `napi_val` is a valid js value pointer
  unsafe fn validate(env: sys::napi_env, napi_val: sys::napi_value) -> Result<sys::napi_value> {
    let value_type = Self::value_type();

    let mut result = -1;
    check_status!(
      unsafe { sys::napi_typeof(env, napi_val, &mut result) },
      "Failed to detect napi value type",
    )?;

    let received_type = ValueType::from(result);
    if value_type == received_type {
      Ok(ptr::null_mut())
    } else {
      Err(Error::new(
        Status::InvalidArg,
        format!("Expect value to be {value_type}, but received {received_type}"),
      ))
    }
  }
}

impl<T: TypeName> TypeName for Option<T> {
  fn type_name() -> &'static str {
    T::type_name()
  }

  fn value_type() -> ValueType {
    T::value_type()
  }
}

impl<T: ValidateNapiValue> ValidateNapiValue for Option<T> {
  unsafe fn validate(env: sys::napi_env, napi_val: sys::napi_value) -> Result<sys::napi_value> {
    let mut result = -1;
    check_status!(
      unsafe { sys::napi_typeof(env, napi_val, &mut result) },
      "Failed to detect napi value type",
    )?;

    let received_type = ValueType::from(result);
    if received_type == ValueType::Null || received_type == ValueType::Undefined {
      Ok(ptr::null_mut())
    } else if let Ok(validate_ret) = unsafe { T::validate(env, napi_val) } {
      Ok(validate_ret)
    } else {
      Err(Error::new(
        Status::InvalidArg,
        format!(
          "Expect value to be Option<{}>, but received {}",
          T::value_type(),
          received_type
        ),
      ))
    }
  }
}

impl<T> FromNapiValue for Option<T>
where
  T: FromNapiValue,
{
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let mut val_type = 0;

    check_status!(
      unsafe { sys::napi_typeof(env, napi_val, &mut val_type) },
      "Failed to convert napi value into rust type `Option<T>`",
    )?;

    match val_type {
      sys::ValueType::napi_undefined | sys::ValueType::napi_null => Ok(None),
      _ => Ok(Some(unsafe { T::from_napi_value(env, napi_val)? })),
    }
  }
}

impl<T> ToNapiValue for Option<T>
where
  T: ToNapiValue,
{
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    match val {
      Some(val) => unsafe { T::to_napi_value(env, val) },
      None => {
        let mut ptr = ptr::null_mut();
        check_status!(
          unsafe { sys::napi_get_null(env, &mut ptr) },
          "Failed to convert rust type `Option<T>` into napi value",
        )?;
        Ok(ptr)
      }
    }
  }
}

impl<T> ToNapiValue for Result<T>
where
  T: ToNapiValue,
{
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    match val {
      Ok(v) => unsafe { T::to_napi_value(env, v) },
      Err(e) => {
        let error_code = unsafe { String::to_napi_value(env, format!("{:?}", e.status))? };
        let reason = unsafe { String::to_napi_value(env, e.reason.clone())? };
        let mut error = ptr::null_mut();
        check_status!(
          unsafe { sys::napi_create_error(env, error_code, reason, &mut error) },
          "Failed to create napi error"
        )?;

        Ok(error)
      }
    }
  }
}

impl<T: TypeName> TypeName for Rc<T> {
  fn type_name() -> &'static str {
    T::type_name()
  }

  fn value_type() -> ValueType {
    T::value_type()
  }
}

impl<T: ValidateNapiValue> ValidateNapiValue for Rc<T> {
  unsafe fn validate(env: sys::napi_env, napi_val: sys::napi_value) -> Result<sys::napi_value> {
    let mut result = -1;
    check_status!(
      unsafe { sys::napi_typeof(env, napi_val, &mut result) },
      "Failed to detect napi value type",
    )?;

    let received_type = ValueType::from(result);
    if let Ok(validate_ret) = unsafe { T::validate(env, napi_val) } {
      Ok(validate_ret)
    } else {
      Err(Error::new(
        Status::InvalidArg,
        format!(
          "Expect value to be Rc<{}>, but received {}",
          T::value_type(),
          received_type
        ),
      ))
    }
  }
}

impl<T> FromNapiValue for Rc<T>
where
  T: FromNapiValue,
{
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    Ok(Rc::new(unsafe { T::from_napi_value(env, napi_val)? }))
  }
}

impl<T> ToNapiValue for Rc<T>
where
  T: ToNapiValue + Clone,
{
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    unsafe { T::to_napi_value(env, (*val).clone()) }
  }
}

impl<T> ToNapiValue for &Rc<T>
where
  T: ToNapiValue + Clone,
{
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    unsafe { T::to_napi_value(env, (**val).clone()) }
  }
}

impl<T> ToNapiValue for &mut Rc<T>
where
  T: ToNapiValue + Clone,
{
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    unsafe { T::to_napi_value(env, (**val).clone()) }
  }
}

impl<T: TypeName> TypeName for Arc<T> {
  fn type_name() -> &'static str {
    T::type_name()
  }

  fn value_type() -> ValueType {
    T::value_type()
  }
}

impl<T: ValidateNapiValue> ValidateNapiValue for Arc<T> {
  unsafe fn validate(env: sys::napi_env, napi_val: sys::napi_value) -> Result<sys::napi_value> {
    let mut result = -1;
    check_status!(
      unsafe { sys::napi_typeof(env, napi_val, &mut result) },
      "Failed to detect napi value type",
    )?;

    let received_type = ValueType::from(result);
    if let Ok(validate_ret) = unsafe { T::validate(env, napi_val) } {
      Ok(validate_ret)
    } else {
      Err(Error::new(
        Status::InvalidArg,
        format!(
          "Expect value to be Arc<{}>, but received {}",
          T::value_type(),
          received_type
        ),
      ))
    }
  }
}

impl<T> FromNapiValue for Arc<T>
where
  T: FromNapiValue,
{
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    Ok(Arc::new(unsafe { T::from_napi_value(env, napi_val)? }))
  }
}

impl<T> ToNapiValue for Arc<T>
where
  T: ToNapiValue + Clone,
{
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    unsafe { T::to_napi_value(env, (*val).clone()) }
  }
}

impl<T> ToNapiValue for &Arc<T>
where
  T: ToNapiValue + Clone,
{
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    unsafe { T::to_napi_value(env, (**val).clone()) }
  }
}

impl<T> ToNapiValue for &mut Arc<T>
where
  T: ToNapiValue + Clone,
{
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    unsafe { T::to_napi_value(env, (**val).clone()) }
  }
}

impl<T: TypeName> TypeName for Mutex<T> {
  fn type_name() -> &'static str {
    T::type_name()
  }

  fn value_type() -> ValueType {
    T::value_type()
  }
}

impl<T: ValidateNapiValue> ValidateNapiValue for Mutex<T> {
  unsafe fn validate(env: sys::napi_env, napi_val: sys::napi_value) -> Result<sys::napi_value> {
    let mut result = -1;
    check_status!(
      unsafe { sys::napi_typeof(env, napi_val, &mut result) },
      "Failed to detect napi value type",
    )?;

    let received_type = ValueType::from(result);
    if let Ok(validate_ret) = unsafe { T::validate(env, napi_val) } {
      Ok(validate_ret)
    } else {
      Err(Error::new(
        Status::InvalidArg,
        format!(
          "Expect value to be Mutex<{}>, but received {}",
          T::value_type(),
          received_type
        ),
      ))
    }
  }
}

impl<T> FromNapiValue for Mutex<T>
where
  T: FromNapiValue,
{
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    Ok(Mutex::new(unsafe { T::from_napi_value(env, napi_val)? }))
  }
}

impl<T> ToNapiValue for Mutex<T>
where
  T: ToNapiValue + Clone,
{
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    unsafe {
      match val.lock() {
        Ok(inner) => T::to_napi_value(env, inner.clone()),
        Err(_) => Err(Error::new(
          Status::GenericFailure,
          "Failed to acquire a lock",
        )),
      }
    }
  }
}

impl<T> ToNapiValue for &Mutex<T>
where
  T: ToNapiValue + Clone,
{
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    unsafe {
      match val.lock() {
        Ok(inner) => T::to_napi_value(env, inner.clone()),
        Err(_) => Err(Error::new(
          Status::GenericFailure,
          "Failed to acquire a lock",
        )),
      }
    }
  }
}

impl<T> ToNapiValue for &mut Mutex<T>
where
  T: ToNapiValue + Clone,
{
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
    ToNapiValue::to_napi_value(env, &*val)
  }
}
