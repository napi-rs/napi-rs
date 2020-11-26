use std::mem;
use std::ops::Deref;
use std::os::raw::c_void;
use std::ptr;

use super::{Value, ValueType};
use crate::check_status;
use crate::{sys, JsUnknown, NapiValue, Ref, Result};

pub struct JsArrayBuffer(pub(crate) Value);

pub struct JsArrayBufferValue {
  pub(crate) value: JsArrayBuffer,
  data: mem::ManuallyDrop<Vec<u8>>,
}

pub struct JsTypedArray(pub(crate) Value);

pub struct JsTypedArrayValue {
  pub arraybuffer: JsArrayBuffer,
  _data: *mut c_void,
  pub byte_offset: u64,
  pub length: u64,
  pub typedarray_type: TypedArrayType,
}

pub struct JsDataView(pub(crate) Value);

pub struct JsDataViewValue {
  pub arraybuffer: JsArrayBuffer,
  _data: *mut c_void,
  pub byte_offset: u64,
  pub length: u64,
}

#[repr(i32)]
#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash)]
pub enum TypedArrayType {
  Int8 = 0,
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

  /// compatible with higher versions
  Unknown = 1024,
}

impl From<sys::napi_typedarray_type> for TypedArrayType {
  fn from(value: sys::napi_typedarray_type) -> Self {
    match value {
      sys::TypedarrayType::napi_int8_array => Self::Int8,
      sys::TypedarrayType::napi_uint8_array => Self::Uint8,
      sys::TypedarrayType::napi_uint8_clamped_array => Self::Uint8Clamped,
      sys::TypedarrayType::napi_int16_array => Self::Int16,
      sys::TypedarrayType::napi_uint16_array => Self::Uint16,
      sys::TypedarrayType::napi_int32_array => Self::Int32,
      sys::TypedarrayType::napi_uint32_array => Self::Uint32,
      sys::TypedarrayType::napi_float32_array => Self::Float32,
      sys::TypedarrayType::napi_float64_array => Self::Float64,
      sys::TypedarrayType::napi_bigint64_array => Self::BigInt64,
      sys::TypedarrayType::napi_biguint64_array => Self::BigUint64,
      _ => Self::Unknown,
    }
  }
}

impl From<TypedArrayType> for sys::napi_typedarray_type {
  fn from(value: TypedArrayType) -> sys::napi_typedarray_type {
    value as _
  }
}

impl JsArrayBuffer {
  #[cfg(feature = "napi7")]
  #[inline]
  pub fn detach(self) -> Result<()> {
    check_status!(unsafe { sys::napi_detach_arraybuffer(self.0.env, self.0.value) })
  }

  #[cfg(feature = "napi7")]
  #[inline]
  pub fn is_detached(&self) -> Result<bool> {
    let mut is_detached = false;
    check_status!(unsafe {
      sys::napi_is_detached_arraybuffer(self.0.env, self.0.value, &mut is_detached)
    })?;
    Ok(is_detached)
  }

  #[inline]
  pub fn into_value(self) -> Result<JsArrayBufferValue> {
    let mut data = ptr::null_mut();
    let mut len: usize = 0;
    check_status!(unsafe {
      sys::napi_get_arraybuffer_info(
        self.0.env,
        self.0.value,
        &mut data,
        &mut len as *mut usize as *mut _,
      )
    })?;
    Ok(JsArrayBufferValue {
      data: mem::ManuallyDrop::new(unsafe { Vec::from_raw_parts(data as *mut _, len, len) }),
      value: self,
    })
  }

  #[inline]
  pub fn into_typedarray(
    self,
    typedarray_type: TypedArrayType,
    length: u64,
    byte_offset: u64,
  ) -> Result<JsTypedArray> {
    let mut typedarray_value = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_create_typedarray(
        self.0.env,
        typedarray_type.into(),
        length as _,
        self.0.value,
        byte_offset as _,
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
  pub fn into_dataview(self, length: u64, byte_offset: u64) -> Result<JsDataView> {
    let mut dataview_value = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_create_dataview(
        self.0.env,
        length as _,
        self.0.value,
        byte_offset as _,
        &mut dataview_value,
      )
    })?;
    Ok(JsDataView(Value {
      env: self.0.env,
      value: dataview_value,
      value_type: ValueType::Object,
    }))
  }

  #[inline]
  pub fn into_ref(self) -> Result<Ref<JsArrayBufferValue>> {
    Ref::new(self.0, 1, self.into_value()?)
  }
}

impl JsArrayBufferValue {
  #[inline]
  pub fn new(value: JsArrayBuffer, data: Vec<u8>) -> Self {
    JsArrayBufferValue {
      value,
      data: mem::ManuallyDrop::new(data),
    }
  }

  #[inline]
  pub fn into_raw(self) -> JsArrayBuffer {
    self.value
  }

  #[inline]
  pub fn into_unknown(self) -> JsUnknown {
    unsafe { JsUnknown::from_raw_unchecked(self.value.0.env, self.value.0.value) }
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
  #[inline]
  pub fn into_value(self) -> Result<JsTypedArrayValue> {
    let mut typedarray_type = 0;
    let mut len = 0u64;
    let mut data = ptr::null_mut();
    let mut arraybuffer_value = ptr::null_mut();
    let mut byte_offset = 0u64;
    check_status!(unsafe {
      sys::napi_get_typedarray_info(
        self.0.env,
        self.0.value,
        &mut typedarray_type,
        &mut len as *mut u64 as *mut _,
        &mut data,
        &mut arraybuffer_value,
        &mut byte_offset as *mut u64 as *mut _,
      )
    })?;

    Ok(JsTypedArrayValue {
      _data: data,
      length: len,
      byte_offset,
      typedarray_type: typedarray_type.into(),
      arraybuffer: unsafe { JsArrayBuffer::from_raw_unchecked(self.0.env, arraybuffer_value) },
    })
  }
}

impl JsDataView {
  #[inline]
  pub fn into_value(self) -> Result<JsDataViewValue> {
    let mut length = 0u64;
    let mut byte_offset = 0u64;
    let mut arraybuffer_value = ptr::null_mut();
    let mut data = ptr::null_mut();

    check_status!(unsafe {
      sys::napi_get_dataview_info(
        self.0.env,
        self.0.value,
        &mut length as *mut u64 as *mut _,
        &mut data,
        &mut arraybuffer_value,
        &mut byte_offset as *mut u64 as *mut _,
      )
    })?;
    Ok(JsDataViewValue {
      arraybuffer: unsafe { JsArrayBuffer::from_raw_unchecked(self.0.env, arraybuffer_value) },
      byte_offset,
      length,
      _data: data,
    })
  }
}
