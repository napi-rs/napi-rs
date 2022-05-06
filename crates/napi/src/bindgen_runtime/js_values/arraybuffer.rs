use std::ffi::c_void;
use std::mem;
use std::ops::{Deref, DerefMut};
use std::ptr;

pub use crate::js_values::TypedArrayType;
use crate::{check_status, sys, Error, Result, Status};

use super::{FromNapiValue, ToNapiValue, TypeName, ValidateNapiValue};

macro_rules! impl_typed_array {
  ($name:ident, $rust_type:ident, $typed_array_type:expr) => {
    pub struct $name {
      data: *mut $rust_type,
      length: usize,
      data_managed_type: DataManagedType,
      byte_offset: usize,
      finalizer_notify: Box<dyn FnOnce(*mut $rust_type, usize)>,
    }

    impl $name {
      fn noop_finalize(_data: *mut $rust_type, _length: usize) {}

      pub fn new(mut data: Vec<$rust_type>) -> Self {
        let ret = $name {
          data: data.as_mut_ptr(),
          length: data.len(),
          data_managed_type: DataManagedType::Owned,
          byte_offset: 0,
          finalizer_notify: Box::new(Self::noop_finalize),
        };
        mem::forget(data);
        ret
      }

      pub fn with_data_copied<D>(data: D) -> Self
      where
        D: AsRef<[$rust_type]>,
      {
        let mut data_copied = data.as_ref().to_vec();
        let ret = $name {
          data: data_copied.as_mut_ptr(),
          length: data.as_ref().len(),
          data_managed_type: DataManagedType::Owned,
          finalizer_notify: Box::new(Self::noop_finalize),
          byte_offset: 0,
        };
        mem::forget(data_copied);
        ret
      }

      /// # Safety
      ///
      /// The caller will be notified when the data is deallocated by vm
      pub unsafe fn with_external_data<F>(data: *mut $rust_type, length: usize, notify: F) -> Self
      where
        F: 'static + FnOnce(*mut $rust_type, usize),
      {
        $name {
          data,
          length,
          data_managed_type: DataManagedType::External,
          finalizer_notify: Box::new(notify),
          byte_offset: 0,
        }
      }
    }

    impl Deref for $name {
      type Target = [$rust_type];

      fn deref(&self) -> &Self::Target {
        unsafe { std::slice::from_raw_parts(self.data, self.length) }
      }
    }

    impl DerefMut for $name {
      fn deref_mut(&mut self) -> &mut Self::Target {
        unsafe { std::slice::from_raw_parts_mut(self.data, self.length) }
      }
    }

    impl AsRef<[$rust_type]> for $name {
      fn as_ref(&self) -> &[$rust_type] {
        unsafe { std::slice::from_raw_parts(self.data, self.length) }
          .split_at(self.byte_offset)
          .1
      }
    }

    impl AsMut<[$rust_type]> for $name {
      fn as_mut(&mut self) -> &mut [$rust_type] {
        unsafe { std::slice::from_raw_parts_mut(self.data, self.length) }
          .split_at_mut(self.byte_offset)
          .1
      }
    }

    impl TypeName for $name {
      fn type_name() -> &'static str {
        concat!("TypedArray<", stringify!($rust_type), ">")
      }

      fn value_type() -> crate::ValueType {
        crate::ValueType::Object
      }
    }

    impl ValidateNapiValue for $name {
      unsafe fn validate(
        env: sys::napi_env,
        napi_val: sys::napi_value,
      ) -> Result<$crate::sys::napi_value> {
        let mut is_typed_array = false;
        check_status!(
          unsafe { sys::napi_is_typedarray(env, napi_val, &mut is_typed_array) },
          "Failed to check if value is typed array"
        )?;
        if !is_typed_array {
          return Err(Error::new(
            Status::InvalidArg,
            "Expected a TypedArray value".to_owned(),
          ));
        }
        Ok(ptr::null_mut())
      }
    }

    impl FromNapiValue for $name {
      unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
        let mut typed_array_type = 0;
        let mut length = 0;
        let mut data = ptr::null_mut();
        let mut array_buffer = ptr::null_mut();
        let mut byte_offset = 0;
        check_status!(
          unsafe {
            sys::napi_get_typedarray_info(
              env,
              napi_val,
              &mut typed_array_type,
              &mut length,
              &mut data,
              &mut array_buffer,
              &mut byte_offset,
            )
          },
          "Get TypedArray info failed"
        )?;
        if typed_array_type != $typed_array_type as i32 {
          return Err(Error::new(
            Status::InvalidArg,
            format!("Expected $name, got {}", typed_array_type),
          ));
        }
        Ok($name {
          data: data as *mut $rust_type,
          length,
          byte_offset,
          data_managed_type: DataManagedType::Vm,
          finalizer_notify: Box::new(Self::noop_finalize),
        })
      }
    }

    impl ToNapiValue for $name {
      unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
        let mut arraybuffer_value = ptr::null_mut();
        let ratio = mem::size_of::<$rust_type>() / mem::size_of::<u8>();
        let length = val.length * ratio;
        let hint_ptr = Box::into_raw(Box::new((
          val.data_managed_type,
          val.length,
          val.finalizer_notify,
        )));
        check_status!(
          if length == 0 {
            // Rust uses 0x1 as the data pointer for empty buffers,
            // but NAPI/V8 only allows multiple buffers to have
            // the same data pointer if it's 0x0.
            unsafe {
              sys::napi_create_arraybuffer(env, length, ptr::null_mut(), &mut arraybuffer_value)
            }
          } else {
            unsafe {
              sys::napi_create_external_arraybuffer(
                env,
                val.data as *mut c_void,
                length,
                Some(finalizer::<$rust_type>),
                hint_ptr as *mut c_void,
                &mut arraybuffer_value,
              )
            }
          },
          "Create external arraybuffer failed"
        )?;
        let mut napi_val = ptr::null_mut();
        check_status!(
          unsafe {
            sys::napi_create_typedarray(
              env,
              $typed_array_type as i32,
              val.length,
              arraybuffer_value,
              0,
              &mut napi_val,
            )
          },
          "Create TypedArray failed"
        )?;
        Ok(napi_val)
      }
    }
  };
}

unsafe extern "C" fn finalizer<T>(
  _env: sys::napi_env,
  finalize_data: *mut c_void,
  finalize_hint: *mut c_void,
) {
  let (data_managed_type, length, finalizer_notify) = unsafe {
    *Box::from_raw(finalize_hint as *mut (DataManagedType, usize, Box<dyn FnOnce(*mut T, usize)>))
  };
  match data_managed_type {
    DataManagedType::Vm => {
      // do nothing
    }
    DataManagedType::Owned => {
      let length = length;
      unsafe { Vec::from_raw_parts(finalize_data as *mut T, length, length) };
    }
    DataManagedType::External => {
      (finalizer_notify)(finalize_data as *mut T, length);
    }
  }
}

enum DataManagedType {
  /// Vm managed data, passed in from JavaScript
  Vm,
  /// Rust owned data, which need to be deallocated in the finalizer
  Owned,
  /// External data, which need to be notice to the owner in finalizer
  External,
}

impl_typed_array!(Int8Array, i8, TypedArrayType::Int8);
impl_typed_array!(Uint8Array, u8, TypedArrayType::Uint8);
impl_typed_array!(Uint8ClampedArray, u8, TypedArrayType::Uint8Clamped);
impl_typed_array!(Int16Array, i16, TypedArrayType::Int16);
impl_typed_array!(Uint16Array, u16, TypedArrayType::Uint16);
impl_typed_array!(Int32Array, i32, TypedArrayType::Int32);
impl_typed_array!(Uint32Array, u32, TypedArrayType::Uint32);
impl_typed_array!(Float32Array, f32, TypedArrayType::Float32);
impl_typed_array!(Float64Array, f64, TypedArrayType::Float64);
#[cfg(feature = "napi6")]
impl_typed_array!(BigInt64Array, i64, TypedArrayType::BigInt64);
#[cfg(feature = "napi6")]
impl_typed_array!(BigUint64Array, u64, TypedArrayType::BigUint64);
