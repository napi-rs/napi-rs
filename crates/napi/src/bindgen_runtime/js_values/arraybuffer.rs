use std::ffi::c_void;
use std::mem;
use std::ops::{Deref, DerefMut};
use std::ptr;
use std::sync::{
  atomic::{AtomicBool, Ordering},
  Arc,
};

pub use crate::js_values::TypedArrayType;
use crate::{check_status, sys, Error, Result, Status};

use super::{FromNapiValue, ToNapiValue, TypeName, ValidateNapiValue};

trait Finalizer {
  type RustType;

  fn finalizer(&mut self) -> Box<dyn FnOnce(*mut Self::RustType, usize)>;

  fn data_managed_type(&self) -> &DataManagedType;

  fn len(&self) -> &usize;

  fn ref_count(&self) -> usize;
}

macro_rules! impl_typed_array {
  ($name:ident, $rust_type:ident, $typed_array_type:expr) => {
    pub struct $name {
      data: *mut $rust_type,
      length: usize,
      data_managed_type: DataManagedType,
      byte_offset: usize,
      raw: Option<(crate::sys::napi_ref, crate::sys::napi_env)>,
      // Use `Arc` for ref count
      // Use `AtomicBool` for flag to indicate whether the value is dropped in VM
      drop_in_vm: Arc<AtomicBool>,
      finalizer_notify: Box<dyn FnOnce(*mut $rust_type, usize)>,
    }

    unsafe impl Send for $name {}

    impl Finalizer for $name {
      type RustType = $rust_type;

      fn finalizer(&mut self) -> Box<dyn FnOnce(*mut Self::RustType, usize)> {
        std::mem::replace(&mut self.finalizer_notify, Box::new($name::noop_finalize))
      }

      fn data_managed_type(&self) -> &DataManagedType {
        &self.data_managed_type
      }

      fn len(&self) -> &usize {
        &self.length
      }

      fn ref_count(&self) -> usize {
        Arc::strong_count(&self.drop_in_vm)
      }
    }

    impl Drop for $name {
      fn drop(&mut self) {
        if Arc::strong_count(&self.drop_in_vm) == 1 {
          if let Some((ref_, env)) = self.raw {
            crate::check_status_or_throw!(
              env,
              unsafe { sys::napi_reference_unref(env, ref_, &mut 0) },
              "Failed to delete Buffer reference in drop"
            );
            return;
          }
          if !self.drop_in_vm.load(Ordering::Acquire) {
            match &self.data_managed_type {
              DataManagedType::Owned => {
                let length = self.length;
                unsafe { Vec::from_raw_parts(self.data, length, length) };
              }
              DataManagedType::External => {
                let mut finalizer: Box<dyn FnOnce(*mut $rust_type, usize)> = Box::new(|_a, _b| {});
                std::mem::swap(&mut finalizer, &mut self.finalizer_notify);
                (finalizer)(self.data, self.length);
              }
              _ => {}
            }
          }
        }
      }
    }

    impl $name {
      fn noop_finalize(_data: *mut $rust_type, _length: usize) {}

      pub fn new(mut data: Vec<$rust_type>) -> Self {
        let ret = $name {
          data: data.as_mut_ptr(),
          length: data.len(),
          data_managed_type: DataManagedType::Owned,
          byte_offset: 0,
          raw: None,
          drop_in_vm: Arc::new(AtomicBool::new(false)),
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
          raw: None,
          drop_in_vm: Arc::new(AtomicBool::new(false)),
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
          raw: None,
          drop_in_vm: Arc::new(AtomicBool::new(false)),
          byte_offset: 0,
        }
      }
    }

    impl Clone for $name {
      /// Clone reference, the inner data is not copied nor moved
      fn clone(&self) -> $name {
        Self {
          data: self.data,
          length: self.length,
          data_managed_type: self.data_managed_type,
          finalizer_notify: Box::new(Self::noop_finalize),
          raw: self.raw,
          drop_in_vm: self.drop_in_vm.clone(),
          byte_offset: self.byte_offset,
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
      ) -> Result<crate::sys::napi_value> {
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
        let mut ref_ = ptr::null_mut();
        check_status!(
          unsafe { sys::napi_create_reference(env, napi_val, 1, &mut ref_) },
          "Failed to create reference from Buffer"
        )?;
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
          raw: Some((ref_, env)),
          drop_in_vm: Arc::new(AtomicBool::new(true)),
          data_managed_type: DataManagedType::Vm,
          finalizer_notify: Box::new(Self::noop_finalize),
        })
      }
    }

    impl ToNapiValue for $name {
      unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
        if let Some((ref_, _)) = val.raw {
          let mut napi_value = std::ptr::null_mut();
          check_status!(
            unsafe { sys::napi_get_reference_value(env, ref_, &mut napi_value) },
            "Failed to delete reference from Buffer"
          )?;
          return Ok(napi_value);
        }
        let mut arraybuffer_value = ptr::null_mut();
        let ratio = mem::size_of::<$rust_type>() / mem::size_of::<u8>();
        let length = val.length * ratio;
        let val_data = val.data;
        let val_length = val.length;
        val.drop_in_vm.store(true, Ordering::Release);
        let hint_ptr = Box::into_raw(Box::new(val));
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
                val_data as *mut c_void,
                length,
                Some(finalizer::<$rust_type, $name>),
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
              val_length,
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

    impl ToNapiValue for &mut $name {
      unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
        if let Some((ref_, _)) = val.raw {
          let mut napi_value = std::ptr::null_mut();
          check_status!(
            unsafe { sys::napi_get_reference_value(env, ref_, &mut napi_value) },
            "Failed to delete reference from Buffer"
          )?;
          Ok(napi_value)
        } else {
          let cloned_value = $name {
            drop_in_vm: val.drop_in_vm.clone(),
            data: val.data,
            length: val.length,
            data_managed_type: val.data_managed_type,
            finalizer_notify: Box::new($name::noop_finalize),
            raw: None,
            byte_offset: val.byte_offset,
          };
          unsafe { ToNapiValue::to_napi_value(env, cloned_value) }
        }
      }
    }
  };
}

unsafe extern "C" fn finalizer<Data, T: Finalizer<RustType = Data>>(
  _env: sys::napi_env,
  finalize_data: *mut c_void,
  finalize_hint: *mut c_void,
) {
  let mut data = unsafe { *Box::from_raw(finalize_hint as *mut T) };
  let data_managed_type = *data.data_managed_type();
  let length = *data.len();
  let finalizer_notify = data.finalizer();
  match data_managed_type {
    DataManagedType::Vm => {
      // do nothing
    }
    DataManagedType::Owned => {
      if data.ref_count() == 1 {
        let length = length;
        unsafe { Vec::from_raw_parts(finalize_data as *mut Data, length, length) };
      }
    }
    DataManagedType::External => {
      if data.ref_count() == 1 {
        (finalizer_notify)(finalize_data as *mut Data, length);
      }
    }
  }
}

#[derive(PartialEq, Eq, Clone, Copy)]
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
