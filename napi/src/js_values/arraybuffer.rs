use std::mem;
use std::ops::Deref;
use std::ptr;

use super::{Value, ValueType};
use crate::error::check_status;
use crate::{sys, JsUnknown, NapiValue, Ref, Result};

#[repr(transparent)]
#[derive(Debug, Clone, Copy)]
pub struct JsArrayBuffer(pub(crate) Value);

#[derive(Debug)]
pub struct JsArrayBufferValue {
  pub(crate) value: JsArrayBuffer,
  data: mem::ManuallyDrop<Vec<u8>>,
}

#[repr(transparent)]
#[derive(Debug, Clone, Copy)]
pub struct JsTypedArray(pub(crate) Value);

#[derive(Debug)]
pub struct JsTypedArrayValue<T> {
  pub arraybuffer: JsArrayBuffer,
  pub data: mem::ManuallyDrop<Vec<T>>,
  pub byte_offset: u64,
  pub length: u64,
  pub typedarray_type: TypedArrayType,
}

#[derive(Debug)]
pub enum TypedArrayType {
  Int8,
  Uint8,
  Uint8Clamped,
  Int16,
  Uint16,
  Int32,
  Uint32,
  Float32,
  Float64,
  BigInt64,
  BigUint64,
}

impl From<sys::napi_typedarray_type> for TypedArrayType {
  fn from(value: sys::napi_typedarray_type) -> Self {
    match value {
      sys::napi_typedarray_type::napi_int8_array => Self::Int8,
      sys::napi_typedarray_type::napi_uint8_array => Self::Uint8,
      sys::napi_typedarray_type::napi_uint8_clamped_array => Self::Uint8Clamped,
      sys::napi_typedarray_type::napi_int16_array => Self::Int16,
      sys::napi_typedarray_type::napi_uint16_array => Self::Uint16,
      sys::napi_typedarray_type::napi_int32_array => Self::Int32,
      sys::napi_typedarray_type::napi_uint32_array => Self::Uint32,
      sys::napi_typedarray_type::napi_float32_array => Self::Float32,
      sys::napi_typedarray_type::napi_float64_array => Self::Float64,
      sys::napi_typedarray_type::napi_bigint64_array => Self::BigInt64,
      sys::napi_typedarray_type::napi_biguint64_array => Self::BigUint64,
    }
  }
}

impl From<TypedArrayType> for sys::napi_typedarray_type {
  fn from(value: TypedArrayType) -> Self {
    match value {
      TypedArrayType::Int8 => sys::napi_typedarray_type::napi_int8_array,
      TypedArrayType::Uint8 => sys::napi_typedarray_type::napi_uint8_array,
      TypedArrayType::Uint8Clamped => sys::napi_typedarray_type::napi_uint8_clamped_array,
      TypedArrayType::Int16 => sys::napi_typedarray_type::napi_int16_array,
      TypedArrayType::Uint16 => sys::napi_typedarray_type::napi_uint16_array,
      TypedArrayType::Int32 => sys::napi_typedarray_type::napi_int32_array,
      TypedArrayType::Uint32 => sys::napi_typedarray_type::napi_uint32_array,
      TypedArrayType::Float32 => sys::napi_typedarray_type::napi_float32_array,
      TypedArrayType::Float64 => sys::napi_typedarray_type::napi_float64_array,
      TypedArrayType::BigInt64 => sys::napi_typedarray_type::napi_bigint64_array,
      TypedArrayType::BigUint64 => sys::napi_typedarray_type::napi_biguint64_array,
    }
  }
}

impl JsArrayBuffer {
  pub fn into_value(self) -> Result<JsArrayBufferValue> {
    let mut data = ptr::null_mut();
    let mut len: u64 = 0;
    check_status(unsafe {
      sys::napi_get_arraybuffer_info(self.0.env, self.0.value, &mut data, &mut len)
    })?;
    Ok(JsArrayBufferValue {
      data: mem::ManuallyDrop::new(unsafe {
        Vec::from_raw_parts(data as *mut _, len as usize, len as usize)
      }),
      value: self,
    })
  }

  pub fn create_typed_array(
    &self,
    typedarray_type: TypedArrayType,
    length: u64,
    byte_offset: u64,
  ) -> Result<JsTypedArray> {
    let mut typedarray_value = ptr::null_mut();
    check_status(unsafe {
      sys::napi_create_typedarray(
        self.0.env,
        typedarray_type.into(),
        length,
        self.0.value,
        byte_offset,
        &mut typedarray_value,
      )
    })?;
    Ok(JsTypedArray(Value {
      env: self.0.env,
      value: typedarray_value,
      value_type: ValueType::Object,
    }))
  }

  #[inline]
  pub fn into_ref(self) -> Result<Ref<JsArrayBufferValue>> {
    Ref::new(self.0, 1, self.into_value()?)
  }
}

impl JsArrayBufferValue {
  pub fn new(value: JsArrayBuffer, data: Vec<u8>) -> Self {
    JsArrayBufferValue {
      value,
      data: mem::ManuallyDrop::new(data),
    }
  }

  pub fn into_raw(self) -> JsArrayBuffer {
    self.value
  }

  pub fn into_unknown(self) -> JsUnknown {
    JsUnknown::from_raw_unchecked(self.value.0.env, self.value.0.value)
  }
}

impl AsRef<[u8]> for JsArrayBufferValue {
  fn as_ref(&self) -> &[u8] {
    self.data.as_slice()
  }
}

impl Deref for JsArrayBufferValue {
  type Target = [u8];

  fn deref(&self) -> &[u8] {
    self.data.as_slice()
  }
}

impl JsTypedArray {
  /// get TypeArray info
  /// https://nodejs.org/api/n-api.html#n_api_napi_get_typedarray_info
  ///
  /// ***Warning***: Use caution while using this API since the underlying data buffer is managed by the VM.
  pub fn into_value<T>(self) -> Result<JsTypedArrayValue<T>> {
    let mut typedarray_type = sys::napi_typedarray_type::napi_int8_array;
    let mut len = 0u64;
    let mut data = ptr::null_mut();
    let mut array_buffer = ptr::null_mut();
    let mut byte_offset = 0u64;
    check_status(unsafe {
      sys::napi_get_typedarray_info(
        self.0.env,
        self.0.value,
        &mut typedarray_type,
        &mut len,
        &mut data,
        &mut array_buffer,
        &mut byte_offset,
      )
    })?;

    Ok(JsTypedArrayValue {
      data: mem::ManuallyDrop::new(unsafe {
        Vec::from_raw_parts(data as *mut T, len as usize, len as usize)
      }),
      length: len,
      byte_offset,
      typedarray_type: typedarray_type.into(),
      arraybuffer: JsArrayBuffer::from_raw_unchecked(self.0.env, array_buffer),
    })
  }
}
