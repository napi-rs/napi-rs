use std::{
  any::TypeId,
  ops::{Deref, DerefMut},
};

use super::{FromNapiMutRef, FromNapiRef, FromNapiValue, ToNapiValue, TypeName, ValidateNapiValue};
use crate::{check_status, sys, Error, Status};

#[repr(C)]
pub struct External<T: 'static> {
  type_id: TypeId,
  obj: T,
  size_hint: usize,
  pub adjusted_size: i64,
}

unsafe impl<T: 'static + Send> Send for External<T> {}
unsafe impl<T: 'static + Sync> Sync for External<T> {}

impl<T: 'static> TypeName for &External<T> {
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
}

impl<T: 'static> FromNapiMutRef for External<T> {
  unsafe fn from_napi_mut_ref(
    env: sys::napi_env,
    napi_val: sys::napi_value,
  ) -> crate::Result<&'static mut Self> {
    let mut unknown_tagged_object = std::ptr::null_mut();
    check_status!(
      unsafe { sys::napi_get_value_external(env, napi_val, &mut unknown_tagged_object) },
      "Failed to get external value"
    )?;

    let type_id = unknown_tagged_object as *const TypeId;
    if unsafe { *type_id } == TypeId::of::<T>() {
      let tagged_object = unknown_tagged_object as *mut External<T>;
      Ok(Box::leak(unsafe { Box::from_raw(tagged_object) }))
    } else {
      Err(Error::new(
        Status::InvalidArg,
        format!(
          "<{}> on `External` is not the type of wrapped object",
          std::any::type_name::<T>()
        ),
      ))
    }
  }
}

impl<T: 'static> FromNapiRef for External<T> {
  unsafe fn from_napi_ref(
    env: sys::napi_env,
    napi_val: sys::napi_value,
  ) -> crate::Result<&'static Self> {
    unsafe { Self::from_napi_mut_ref(env, napi_val) }.map(|v| v as &Self)
  }
}

impl<T: 'static> FromNapiValue for &mut External<T> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> crate::Result<Self> {
    External::from_napi_mut_ref(env, napi_val)
  }
}

impl<T: 'static> FromNapiValue for &External<T> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> crate::Result<Self> {
    External::from_napi_ref(env, napi_val)
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
    let mut napi_value = std::ptr::null_mut();
    let size_hint = val.size_hint as i64;
    let size_hint_ptr = Box::into_raw(Box::new(size_hint));
    let obj_ptr = Box::into_raw(Box::new(val));
    check_status!(
      unsafe {
        sys::napi_create_external(
          env,
          obj_ptr.cast(),
          Some(crate::raw_finalize::<External<T>>),
          size_hint_ptr.cast(),
          &mut napi_value,
        )
      },
      "Create external value failed"
    )?;

    #[cfg(not(target_family = "wasm"))]
    {
      let mut adjusted_external_memory_size = std::mem::MaybeUninit::new(0);

      if size_hint != 0 {
        check_status!(
          unsafe {
            sys::napi_adjust_external_memory(
              env,
              size_hint,
              adjusted_external_memory_size.as_mut_ptr(),
            )
          },
          "Adjust external memory failed"
        )?;
      };

      (Box::leak(unsafe { Box::from_raw(obj_ptr) })).adjusted_size =
        unsafe { adjusted_external_memory_size.assume_init() };
    }

    Ok(napi_value)
  }
}
