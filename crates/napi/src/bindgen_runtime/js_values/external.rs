use std::{
  any::TypeId,
  ops::{Deref, DerefMut},
};

use crate::{check_status, sys, Error, Status, TaggedObject};

use super::{FromNapiValue, ToNapiValue, TypeName, ValidateNapiValue};

pub struct External<T: 'static> {
  obj: *mut TaggedObject<T>,
  size_hint: usize,
  pub adjusted_size: i64,
}

impl<T: 'static> TypeName for External<T> {
  fn type_name() -> &'static str {
    "External"
  }

  fn value_type() -> crate::ValueType {
    crate::ValueType::External
  }
}

impl<T: 'static> ValidateNapiValue for External<T> {}

impl<T: 'static> External<T> {
  pub fn new(value: T) -> Self {
    Self {
      obj: Box::into_raw(Box::new(TaggedObject::new(value))),
      size_hint: 0,
      adjusted_size: 0,
    }
  }

  /// `size_hint` is a value to tell Node.js GC how much memory is used by this `External` object.
  ///
  /// If getting the exact `size_hint` is difficult, you can provide an approximate value, it's only effect to the GC.
  ///
  /// If your `External` object is not effect to GC, you can use `External::new` instead.
  pub fn new_with_size_hint(value: T, size_hint: usize) -> Self {
    Self {
      obj: Box::into_raw(Box::new(TaggedObject::new(value))),
      size_hint,
      adjusted_size: 0,
    }
  }
}

impl<T: 'static> FromNapiValue for External<T> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> crate::Result<Self> {
    let mut unknown_tagged_object = std::ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_value_external(env, napi_val, &mut unknown_tagged_object) },
      "Failed to get external value"
    )?;

    let type_id = unknown_tagged_object as *const TypeId;
    if unsafe { *type_id } == TypeId::of::<T>() {
      let tagged_object = unknown_tagged_object as *mut TaggedObject<T>;
      Ok(Self {
        obj: tagged_object,
        size_hint: 0,
        adjusted_size: 0,
      })
    } else {
      Err(Error::new(
        Status::InvalidArg,
        "T on `get_value_external` is not the type of wrapped object".to_owned(),
      ))
    }
  }
}

impl<T: 'static> AsRef<T> for External<T> {
  fn as_ref(&self) -> &T {
    unsafe { Box::leak(Box::from_raw(self.obj)).object.as_ref().unwrap() }
  }
}

impl<T: 'static> AsMut<T> for External<T> {
  fn as_mut(&mut self) -> &mut T {
    unsafe { Box::leak(Box::from_raw(self.obj)).object.as_mut().unwrap() }
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
  unsafe fn to_napi_value(env: sys::napi_env, mut val: Self) -> crate::Result<sys::napi_value> {
    let mut napi_value = std::ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_create_external(
          env,
          val.obj as *mut _,
          Some(crate::raw_finalize::<T>),
          Box::into_raw(Box::new(Some(val.size_hint as i64))) as *mut _,
          &mut napi_value,
        )
      },
      "Create external value failed"
    )?;

    let mut adjusted_external_memory_size = std::mem::MaybeUninit::new(0);

    if val.size_hint != 0 {
      check_status!(
        unsafe {
          sys::napi_adjust_external_memory(
            env,
            val.size_hint as i64,
            adjusted_external_memory_size.as_mut_ptr(),
          )
        },
        "Adjust external memory failed"
      )?;
    };

    val.adjusted_size = unsafe { adjusted_external_memory_size.assume_init() };

    Ok(napi_value)
  }
}
