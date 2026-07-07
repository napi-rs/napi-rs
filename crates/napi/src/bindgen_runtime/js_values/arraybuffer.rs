use std::ffi::{c_void, CString};
use std::marker::PhantomData;
use std::mem;
use std::ops::Deref;
use std::ptr::{self, NonNull};

use crate::{
  bindgen_prelude::{
    FromNapiValue, JsObjectValue, JsValue, This, ToNapiValue, TypeName, ValidateNapiValue,
  },
  bindgen_runtime::NapiValueOwner,
  check_status, sys, Env, Error, Result, Status, Value, ValueType,
};

#[repr(i32)]
#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash)]
#[non_exhaustive]
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
  #[cfg(feature = "napi6")]
  BigInt64,
  #[cfg(feature = "napi6")]
  BigUint64,

  /// compatible with higher versions
  Unknown = 1024,
}

impl AsRef<str> for TypedArrayType {
  fn as_ref(&self) -> &str {
    match self {
      TypedArrayType::Int8 => "Int8",
      TypedArrayType::Uint8 => "Uint8",
      TypedArrayType::Uint8Clamped => "Uint8Clamped",
      TypedArrayType::Int16 => "Int16",
      TypedArrayType::Uint16 => "Uint16",
      TypedArrayType::Int32 => "Int32",
      TypedArrayType::Uint32 => "Uint32",
      TypedArrayType::Float32 => "Float32",
      TypedArrayType::Float64 => "Float64",
      #[cfg(feature = "napi6")]
      TypedArrayType::BigInt64 => "BigInt64",
      #[cfg(feature = "napi6")]
      TypedArrayType::BigUint64 => "BigUint64",
      TypedArrayType::Unknown => "Unknown",
    }
  }
}

impl From<sys::napi_typedarray_type> for TypedArrayType {
  fn from(value: sys::napi_typedarray_type) -> Self {
    match value {
      sys::TypedarrayType::int8_array => Self::Int8,
      sys::TypedarrayType::uint8_array => Self::Uint8,
      sys::TypedarrayType::uint8_clamped_array => Self::Uint8Clamped,
      sys::TypedarrayType::int16_array => Self::Int16,
      sys::TypedarrayType::uint16_array => Self::Uint16,
      sys::TypedarrayType::int32_array => Self::Int32,
      sys::TypedarrayType::uint32_array => Self::Uint32,
      sys::TypedarrayType::float32_array => Self::Float32,
      sys::TypedarrayType::float64_array => Self::Float64,
      #[cfg(feature = "napi6")]
      sys::TypedarrayType::bigint64_array => Self::BigInt64,
      #[cfg(feature = "napi6")]
      sys::TypedarrayType::biguint64_array => Self::BigUint64,
      _ => Self::Unknown,
    }
  }
}

impl From<TypedArrayType> for sys::napi_typedarray_type {
  fn from(value: TypedArrayType) -> sys::napi_typedarray_type {
    value as i32
  }
}

#[cfg(target_family = "wasm")]
extern "C" {
  fn emnapi_sync_memory(
    env: crate::sys::napi_env,
    js_to_wasm: bool,
    arraybuffer_or_view: *mut crate::sys::napi_value,
    byte_offset: usize,
    length: usize,
  ) -> crate::sys::napi_status;
}

fn checked_typed_array_byte_length<T>(length: usize) -> Result<usize> {
  length.checked_mul(mem::size_of::<T>()).ok_or_else(|| {
    Error::new(
      Status::InvalidArg,
      format!(
        "TypedArray length {length} overflows the byte length for {}",
        std::any::type_name::<T>()
      ),
    )
  })
}

#[derive(Clone, Copy)]
/// Represents a JavaScript ArrayBuffer
pub struct ArrayBuffer<'env> {
  pub(crate) value: Value,
  pub(crate) data: &'env [u8],
}

impl<'env> JsValue<'env> for ArrayBuffer<'env> {
  fn value(&self) -> Value {
    self.value
  }
}

impl<'env> JsObjectValue<'env> for ArrayBuffer<'env> {}

impl TypeName for ArrayBuffer<'_> {
  fn type_name() -> &'static str {
    "ArrayBuffer"
  }

  fn value_type() -> ValueType {
    ValueType::Object
  }
}

impl FromNapiValue for ArrayBuffer<'_> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let value = Value {
      env,
      value: napi_val,
      value_type: ValueType::Object,
    };
    let mut data = ptr::null_mut();
    let mut byte_length = 0;
    check_status!(unsafe {
      sys::napi_get_arraybuffer_info(env, napi_val, &mut data, &mut byte_length)
    })?;
    Ok(ArrayBuffer {
      value,
      data: if data.is_null() {
        &[]
      } else {
        unsafe { std::slice::from_raw_parts(data as *const u8, byte_length) }
      },
    })
  }
}

impl Deref for ArrayBuffer<'_> {
  type Target = [u8];

  fn deref(&self) -> &Self::Target {
    self.data
  }
}

impl<'env> ArrayBuffer<'env> {
  /// Create a new `ArrayBuffer` from a `Vec<u8>`.
  pub fn from_data<D: Into<Vec<u8>>>(env: &Env, data: D) -> Result<Self> {
    let mut buf = ptr::null_mut();
    let mut data = data.into();
    let mut inner_ptr = data.as_mut_ptr();
    #[cfg(all(debug_assertions, not(windows), not(target_family = "wasm")))]
    {
      let is_existed = super::BUFFER_DATA.with(|buffer_data| {
        let buffer = buffer_data.lock().expect("Unlock buffer data failed");
        buffer.contains(&inner_ptr)
      });
      if is_existed {
        panic!("Share the same data between different buffers is not allowed, see: https://github.com/nodejs/node/issues/32463#issuecomment-631974747");
      }
    }
    let len = data.len();
    if len == 0 {
      check_status!(
        unsafe { sys::napi_create_arraybuffer(env.0, 0, ptr::null_mut(), &mut buf) },
        "Failed to create empty arraybuffer"
      )?;
      return Ok(Self {
        value: Value {
          env: env.0,
          value: buf,
          value_type: ValueType::Object,
        },
        data: &[],
      });
    }
    let cap = data.capacity();
    let finalize_hint = Box::into_raw(Box::new((len, cap)));
    let mut status = unsafe {
      sys::napi_create_external_arraybuffer(
        env.0,
        inner_ptr.cast(),
        data.len(),
        Some(finalize_slice::<u8>),
        finalize_hint.cast(),
        &mut buf,
      )
    };
    if status == napi_sys::Status::napi_no_external_buffers_allowed {
      unsafe {
        drop(Box::from_raw(finalize_hint));
      }
      let mut underlying_data = ptr::null_mut();
      status =
        unsafe { sys::napi_create_arraybuffer(env.0, data.len(), &mut underlying_data, &mut buf) };
      check_status!(status, "Failed to create arraybuffer")?;
      if len > 0 {
        let underlying_slice: &mut [u8] =
          unsafe { std::slice::from_raw_parts_mut(underlying_data.cast(), len) };
        underlying_slice.copy_from_slice(data.as_slice());
      }
      inner_ptr = underlying_data.cast();
    } else if status == sys::Status::napi_ok {
      mem::forget(data);
    } else {
      unsafe {
        drop(Box::from_raw(finalize_hint));
      }
      check_status!(status, "Failed to create arraybuffer")?;
    }
    Ok(Self {
      value: Value {
        env: env.0,
        value: buf,
        value_type: ValueType::Object,
      },
      data: if len == 0 {
        &[]
      } else {
        unsafe { std::slice::from_raw_parts(inner_ptr.cast(), len) }
      },
    })
  }

  /// Mostly the same with `from_data`
  ///
  /// Provided `finalize_callback` will be called when `[u8]` got dropped.
  /// You can pass in `noop_finalize` if you have nothing to do in finalize phase.
  ///
  /// ## Safety
  ///
  /// The caller must ensure that:
  /// - The data pointer is valid for the lifetime of the buffer and points to a memory region of at least `len` bytes
  /// - The finalize callback properly cleans up the data
  ///
  /// ### Notes
  ///
  /// JavaScript may mutate the data passed in to this buffer when writing the buffer.
  /// However, some JavaScript runtimes do not support external buffers (notably electron!)
  /// in which case modifications may be lost.
  ///
  /// If you need to support these runtimes, you should create a buffer by other means and then
  /// later copy the data back out.
  pub unsafe fn from_external<T: 'env, F: FnOnce(Env, T)>(
    env: &Env,
    data: *mut u8,
    len: usize,
    finalize_hint: T,
    finalize_callback: F,
  ) -> Result<Self> {
    if data.is_null() || std::ptr::eq(data, crate::EMPTY_VEC.as_ptr()) {
      return Err(Error::new(
        Status::InvalidArg,
        "Borrowed data should not be null".to_owned(),
      ));
    }
    #[cfg(all(debug_assertions, not(windows), not(target_family = "wasm")))]
    {
      let is_existed = super::BUFFER_DATA.with(|buffer_data| {
        let buffer = buffer_data.lock().expect("Unlock buffer data failed");
        buffer.contains(&data)
      });
      if is_existed {
        panic!("Share the same data between different buffers is not allowed, see: https://github.com/nodejs/node/issues/32463#issuecomment-631974747");
      }
    }
    let hint_ptr = Box::into_raw(Box::new((finalize_hint, finalize_callback)));
    let mut arraybuffer_value = ptr::null_mut();
    let mut result_data = data;
    let mut status = unsafe {
      sys::napi_create_external_arraybuffer(
        env.0,
        data.cast(),
        len,
        Some(crate::env::raw_finalize_with_custom_callback::<T, F>),
        hint_ptr.cast(),
        &mut arraybuffer_value,
      )
    };
    if status == sys::Status::napi_no_external_buffers_allowed {
      let (hint, finalize) = *Box::from_raw(hint_ptr);
      let mut underlying_data = ptr::null_mut();
      status = unsafe {
        sys::napi_create_arraybuffer(env.0, len, &mut underlying_data, &mut arraybuffer_value)
      };
      // Copy data before calling finalize, since finalize may free the source data
      if status == sys::Status::napi_ok && len > 0 {
        unsafe { std::ptr::copy_nonoverlapping(data.cast(), underlying_data, len) };
      }
      if status == sys::Status::napi_ok {
        result_data = underlying_data.cast();
      }
      // Always call finalize to clean up caller's resources, even on error
      finalize(*env, hint);
      check_status!(status, "Failed to create arraybuffer from data")?;
    } else if status != sys::Status::napi_ok {
      let (hint, finalize) = *Box::from_raw(hint_ptr);
      finalize(*env, hint);
      check_status!(status, "Failed to create arraybuffer from data")?;
    }

    Ok(Self {
      value: Value {
        env: env.0,
        value: arraybuffer_value,
        value_type: ValueType::Object,
      },
      data: if len == 0 {
        &[]
      } else {
        unsafe { std::slice::from_raw_parts(result_data.cast(), len) }
      },
    })
  }

  /// Copy data from a `&[u8]` and create a `ArrayBuffer` from it.
  pub fn copy_from<D: AsRef<[u8]>>(env: &Env, data: D) -> Result<Self> {
    let data = data.as_ref();
    let len = data.len();
    let mut arraybuffer_value = ptr::null_mut();
    let mut underlying_data = ptr::null_mut();

    check_status!(
      unsafe {
        sys::napi_create_arraybuffer(env.0, len, &mut underlying_data, &mut arraybuffer_value)
      },
      "Failed to create ArrayBuffer"
    )?;
    if len > 0 {
      unsafe { std::ptr::copy_nonoverlapping(data.as_ptr(), underlying_data.cast(), len) };
    }

    Ok(Self {
      value: Value {
        env: env.0,
        value: arraybuffer_value,
        value_type: ValueType::Object,
      },
      data: if len == 0 {
        &[]
      } else {
        unsafe { std::slice::from_raw_parts(underlying_data.cast(), len) }
      },
    })
  }

  #[cfg(feature = "napi7")]
  /// Generally, an ArrayBuffer is non-detachable if it has been detached before.
  ///
  /// The engine may impose additional conditions on whether an ArrayBuffer is detachable.
  ///
  /// For example, V8 requires that the ArrayBuffer be external, that is, created with napi_create_external_arraybuffer
  ///
  /// # Safety
  ///
  /// Detaching invalidates the backing memory cached by every Rust wrapper for this JavaScript
  /// `ArrayBuffer`. The caller must ensure that no references into the backing store, copied
  /// `ArrayBuffer` values, or other wrappers for the same backing store are accessed after
  /// detachment begins. This includes aliases produced by independent argument conversions and
  /// `TypedArray::arraybuffer`.
  pub unsafe fn detach(self) -> Result<()> {
    check_status!(unsafe { sys::napi_detach_arraybuffer(self.value.env, self.value.value) })
  }

  #[cfg(feature = "napi7")]
  /// The ArrayBuffer is considered `detached` if its internal data is null.
  ///
  /// This API represents the invocation of the `ArrayBuffer` `IsDetachedBuffer` operation as defined in [Section 24.1.1.2](https://tc39.es/ecma262/#sec-isdetachedbuffer) of the ECMAScript Language Specification.
  pub fn is_detached(&self) -> Result<bool> {
    let mut is_detached = false;
    check_status!(unsafe {
      sys::napi_is_detached_arraybuffer(self.value.env, self.value.value, &mut is_detached)
    })?;
    Ok(is_detached)
  }

  /// # Safety
  ///
  /// This is literally undefined behavior, as the JS side may always modify the underlying buffer,
  /// without synchronization.
  pub unsafe fn as_mut(&mut self) -> &mut [u8] {
    std::slice::from_raw_parts_mut(self.data.as_ptr() as *mut u8, self.data.len())
  }
}

#[derive(Clone, Copy)]
/// Represents a JavaScript ArrayBuffer
pub struct TypedArray<'env> {
  pub(crate) value: Value,
  pub typed_array_type: TypedArrayType,
  pub arraybuffer: ArrayBuffer<'env>,
  pub byte_offset: usize,
}

impl TypeName for TypedArray<'_> {
  fn type_name() -> &'static str {
    "TypedArray"
  }

  fn value_type() -> ValueType {
    ValueType::Object
  }
}

impl ValidateNapiValue for TypedArray<'_> {
  unsafe fn validate(env: sys::napi_env, napi_val: sys::napi_value) -> Result<sys::napi_value> {
    let mut is_typedarray = false;
    check_status!(
      unsafe { sys::napi_is_typedarray(env, napi_val, &mut is_typedarray) },
      "Failed to validate TypedArray"
    )?;
    if !is_typedarray {
      return Err(Error::new(
        Status::InvalidArg,
        "Value is not a TypedArray".to_owned(),
      ));
    }
    Ok(ptr::null_mut())
  }
}

impl<'env> JsValue<'env> for TypedArray<'env> {
  fn value(&self) -> Value {
    self.value
  }
}

impl<'env> JsObjectValue<'env> for TypedArray<'env> {}

impl FromNapiValue for TypedArray<'_> {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
    let mut typed_array_type = 0;
    let mut _data = ptr::null_mut();
    let mut _length = 0;
    let mut arraybuffer = ptr::null_mut();
    let mut byte_offset = 0;
    check_status!(
      unsafe {
        sys::napi_get_typedarray_info(
          env,
          napi_val,
          &mut typed_array_type,
          &mut _length,
          &mut _data,
          &mut arraybuffer,
          &mut byte_offset,
        )
      },
      "Failed to get typedarray info"
    )?;
    let mut arraybuffer_data = ptr::null_mut();
    let mut byte_length = 0;
    check_status!(
      unsafe {
        sys::napi_get_arraybuffer_info(env, arraybuffer, &mut arraybuffer_data, &mut byte_length)
      },
      "Failed to get TypedArray backing ArrayBuffer info"
    )?;
    Ok(Self {
      value: Value {
        env,
        value: napi_val,
        value_type: ValueType::Object,
      },
      typed_array_type: typed_array_type.into(),
      byte_offset,
      arraybuffer: ArrayBuffer {
        value: Value {
          env,
          value: arraybuffer,
          value_type: ValueType::Object,
        },
        data: if byte_length == 0 {
          &[]
        } else {
          unsafe { std::slice::from_raw_parts(arraybuffer_data.cast(), byte_length) }
        },
      },
    })
  }
}

trait Finalizer {
  type RustType;

  fn finalizer_notify(&self) -> *mut dyn FnOnce(*mut Self::RustType, usize);
}

macro_rules! impl_typed_array {
  ($name:ident, $rust_type:ident, $typed_array_type:expr) => {
    pub struct $name {
      data: *mut $rust_type,
      length: usize,
      capacity: usize,
      #[allow(unused)]
      byte_offset: usize,
      raw: Option<(crate::sys::napi_ref, NapiValueOwner)>,
      finalizer_notify: *mut dyn FnOnce(*mut $rust_type, usize),
    }

    /// SAFETY: This is undefined behavior, as the JS side may always modify the underlying buffer,
    /// without synchronization. Also see the docs for the `DerfMut` impl.
    #[cfg(feature = "napi4")]
    unsafe impl Send for $name {}
    #[cfg(feature = "napi4")]
    unsafe impl Sync for $name {}

    impl Finalizer for $name {
      type RustType = $rust_type;

      fn finalizer_notify(&self) -> *mut dyn FnOnce(*mut Self::RustType, usize) {
        self.finalizer_notify
      }
    }

    impl Drop for $name {
      fn drop(&mut self) {
        if let Some((ref_, owner)) = self.raw.as_ref() {
          debug_assert!(!ref_.is_null());
          let status = owner.release_reference(*ref_);
          assert!(
            status == sys::Status::napi_ok || status == sys::Status::napi_closing,
            "Release TypedArray reference failed {}",
            Status::from(status)
          );
          return;
        }
        self.release_data_ownership();
      }
    }

    impl $name {
      fn clear_data_ownership(&mut self) {
        self.data = ptr::null_mut();
        self.length = 0;
        self.capacity = 0;
        self.finalizer_notify = ptr::null_mut::<fn(*mut $rust_type, usize)>();
      }

      fn release_data_ownership(&mut self) {
        let data = self.data;
        let length = self.length;
        let capacity = self.capacity;
        let finalizer_notify = self.finalizer_notify();
        self.clear_data_ownership();
        if !finalizer_notify.is_null() {
          let finalizer = unsafe { Box::from_raw(finalizer_notify) };
          (finalizer)(data, length);
        } else if !data.is_null() {
          drop(unsafe { Vec::from_raw_parts(data, length, capacity) });
        }
      }

      #[cfg(target_family = "wasm")]
      pub fn sync(&mut self, env: &crate::Env) {
        if let Some((reference, owner)) = self.raw.as_ref() {
          if owner.ensure_access(env.raw(), "TypedArray").is_err() {
            crate::check_status_or_throw!(
              env.raw(),
              sys::Status::napi_invalid_arg,
              "A JavaScript TypedArray cannot be synced through a different napi_env or after its \
               owner has closed"
            );
            return;
          }
          let mut value = ptr::null_mut();
          crate::check_status_or_throw!(
            env.raw(),
            unsafe { crate::sys::napi_get_reference_value(env.raw(), *reference, &mut value) },
            "Failed to get reference value from TypedArray while syncing"
          );
          crate::check_status_or_throw!(
            env.raw(),
            unsafe {
              crate::sys::napi_get_typedarray_info(
                env.raw(),
                value,
                &mut ($typed_array_type as i32) as *mut i32,
                &mut self.length as *mut usize,
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
              )
            },
            "Failed to refresh TypedArray info while syncing"
          );
          crate::check_status_or_throw!(
            env.raw(),
            unsafe {
              let Some(byte_length) = self.length.checked_mul(mem::size_of::<$rust_type>()) else {
                crate::check_status_or_throw!(
                  env.raw(),
                  sys::Status::napi_invalid_arg,
                  "TypedArray byte length overflow while syncing memory"
                );
                return;
              };
              emnapi_sync_memory(env.raw(), false, &mut value, 0, byte_length)
            },
            "Failed to sync memory"
          );
        } else {
          return;
        }
      }

      pub fn new(mut data: Vec<$rust_type>) -> Self {
        data.shrink_to_fit();
        let ret = $name {
          data: data.as_mut_ptr(),
          length: data.len(),
          capacity: data.capacity(),
          byte_offset: 0,
          raw: None,
          finalizer_notify: ptr::null_mut::<fn(*mut $rust_type, usize)>(),
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
          capacity: data_copied.capacity(),
          finalizer_notify: ptr::null_mut::<fn(*mut $rust_type, usize)>(),
          raw: None,
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
          capacity: length,
          finalizer_notify: Box::into_raw(Box::new(notify)),
          raw: None,
          byte_offset: 0,
        }
      }

      #[allow(clippy::should_implement_trait)]
      /// # Safety
      ///
      /// This is literally undefined behavior, as the JS side may always modify the underlying buffer,
      /// without synchronization.
      pub unsafe fn as_mut(&mut self) -> &mut [$rust_type] {
        if self.data.is_null() {
          return &mut [];
        }

        unsafe { std::slice::from_raw_parts_mut(self.data, self.length) }
      }
    }

    impl Deref for $name {
      type Target = [$rust_type];

      fn deref(&self) -> &Self::Target {
        self.as_ref()
      }
    }

    impl AsRef<[$rust_type]> for $name {
      fn as_ref(&self) -> &[$rust_type] {
        if self.data.is_null() {
          return &[];
        }

        unsafe { std::slice::from_raw_parts(self.data, self.length) }
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
            format!(
              "Expected {}, got {}Array",
              stringify!($name),
              TypedArrayType::from(typed_array_type).as_ref()
            ),
          ));
        }
        let mut ref_ = ptr::null_mut();
        check_status!(
          unsafe { sys::napi_create_reference(env, napi_val, 1, &mut ref_) },
          "Failed to create reference from TypedArray"
        )?;
        Ok($name {
          data: data.cast(),
          length,
          capacity: length,
          byte_offset,
          raw: Some((ref_, NapiValueOwner::new(env))),
          finalizer_notify: ptr::null_mut::<fn(*mut $rust_type, usize)>(),
        })
      }
    }

    impl ToNapiValue for $name {
      unsafe fn to_napi_value(env: sys::napi_env, mut val: Self) -> Result<sys::napi_value> {
        if let Some((ref_, owner)) = val.raw.as_ref() {
          owner.ensure_access(env, "TypedArray")?;
          let mut napi_value = std::ptr::null_mut();
          check_status!(
            unsafe { sys::napi_get_reference_value(env, *ref_, &mut napi_value) },
            "Failed to get reference from ArrayBuffer"
          )?;
          check_status!(
            unsafe { sys::napi_delete_reference(env, *ref_) },
            "Failed to delete reference in ArrayBuffer::to_napi_value"
          )?;
          val.raw = None;
          val.clear_data_ownership();
          return Ok(napi_value);
        }
        let mut arraybuffer_value = ptr::null_mut();
        let val_length = val.length;
        let length = checked_typed_array_byte_length::<$rust_type>(val_length)?;
        let val_data = val.data;
        if length == 0 {
          // Rust uses 0x1 as the data pointer for empty buffers,
          // but NAPI/V8 only allows multiple buffers to have
          // the same data pointer if it's 0x0.
          check_status!(
            unsafe {
              sys::napi_create_arraybuffer(env, length, ptr::null_mut(), &mut arraybuffer_value)
            },
            "Create external arraybuffer failed"
          )?;
        } else {
          let hint_ptr = Box::into_raw(Box::new(val));
          let mut status = unsafe {
            sys::napi_create_external_arraybuffer(
              env,
              val_data.cast(),
              length,
              Some(finalizer::<$rust_type, $name>),
              hint_ptr.cast(),
              &mut arraybuffer_value,
            )
          };
          if status == napi_sys::Status::napi_no_external_buffers_allowed {
            let hint = unsafe { Box::from_raw(hint_ptr) };
            let mut underlying_data = ptr::null_mut();
            status = unsafe {
              sys::napi_create_arraybuffer(
                env,
                length,
                &mut underlying_data,
                &mut arraybuffer_value,
              )
            };
            check_status!(status, "Create external arraybuffer failed")?;
            if length > 0 {
              unsafe { std::ptr::copy_nonoverlapping(hint.data.cast(), underlying_data, length) };
            }
          } else if status != sys::Status::napi_ok {
            drop(unsafe { Box::from_raw(hint_ptr) });
            check_status!(status, "Create external arraybuffer failed")?;
          } else {
            debug_assert_eq!(status, sys::Status::napi_ok);
          }
        }
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
        if let Some((ref_, owner)) = val.raw.as_ref() {
          owner.ensure_access(env, "TypedArray")?;
          let mut napi_value = std::ptr::null_mut();
          check_status!(
            unsafe { sys::napi_get_reference_value(env, *ref_, &mut napi_value) },
            "Failed to get reference from ArrayBuffer"
          )?;
          return Ok(napi_value);
        }
        let mut arraybuffer_value = ptr::null_mut();
        let val_length = val.length;
        let length = checked_typed_array_byte_length::<$rust_type>(val_length)?;
        let val_data = val.data;
        if length == 0 {
          // Rust uses 0x1 as the data pointer for empty buffers,
          // but NAPI/V8 only allows multiple buffers to have
          // the same data pointer if it's 0x0.
          check_status!(
            unsafe {
              sys::napi_create_arraybuffer(env, length, ptr::null_mut(), &mut arraybuffer_value)
            },
            "Create external arraybuffer failed"
          )?;
        } else {
          // manually copy the data instead of implement `Clone` & `Copy` for TypedArray
          // the TypedArray can't be copied if raw is not None
          let val_copy = $name {
            data: val.data,
            length: val.length,
            capacity: val.capacity,
            byte_offset: val.byte_offset,
            raw: None,
            finalizer_notify: val.finalizer_notify,
          };
          let hint_ptr = Box::into_raw(Box::new(val_copy));
          let mut status = unsafe {
            sys::napi_create_external_arraybuffer(
              env,
              val_data.cast(),
              length,
              Some(finalizer::<$rust_type, $name>),
              hint_ptr.cast(),
              &mut arraybuffer_value,
            )
          };
          if status == napi_sys::Status::napi_no_external_buffers_allowed {
            let mut hint = unsafe { Box::from_raw(hint_ptr) };
            // The fallback copies the data. Keep `val` as the sole source owner until the
            // TypedArray reference is committed, so every later error leaves it usable.
            hint.clear_data_ownership();
            let mut underlying_data = ptr::null_mut();
            status = unsafe {
              sys::napi_create_arraybuffer(
                env,
                length,
                &mut underlying_data,
                &mut arraybuffer_value,
              )
            };
            check_status!(status, "Create external arraybuffer failed")?;
            if length > 0 {
              unsafe { std::ptr::copy_nonoverlapping(val_data.cast(), underlying_data, length) };
            }
          } else if status == sys::Status::napi_ok {
            // N-API owns the hint from this point. Clear the original before any later fallible call.
            val.clear_data_ownership();
          } else {
            // N-API rejected the external ArrayBuffer without taking the hint. Restore sole
            // ownership to `val` before returning the error.
            let mut hint = unsafe { Box::from_raw(hint_ptr) };
            hint.clear_data_ownership();
            check_status!(status, "Create external arraybuffer failed")?;
          }
        }
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
        let mut ref_ = ptr::null_mut();
        check_status!(
          unsafe { sys::napi_create_reference(env, napi_val, 1, &mut ref_) },
          "Failed to create reference in TypedArray::to_napi_value"
        )?;
        val.raw = Some((ref_, NapiValueOwner::new(env)));
        // External ArrayBuffer success already transferred ownership and cleared these fields.
        // Empty and copied fallback values stay Rust-owned until the reference commit above.
        val.release_data_ownership();
        Ok(napi_val)
      }
    }
  };
}

macro_rules! impl_from_slice {
  ($name:ident, $slice_type:ident, $rust_type:ident, $typed_array_type:expr) => {
    #[derive(Clone, Copy)]
    pub struct $slice_type<'env> {
      pub(crate) inner: NonNull<$rust_type>,
      pub(crate) length: usize,
      raw_value: sys::napi_value,
      env: sys::napi_env,
      _marker: PhantomData<&'env ()>,
    }

    impl <'env> $slice_type<'env> {
      #[doc = " Create a new `"]
      #[doc = stringify!($slice_type)]
      #[doc = "` from a `Vec<"]
      #[doc = stringify!($rust_type)]
      #[doc = ">`."]
      pub fn from_data<D: Into<Vec<$rust_type>>>(env: &Env, data: D) -> Result<Self> {
        let mut buf = ptr::null_mut();
        let mut data = data.into();
        let mut inner_ptr = data.as_mut_ptr();
        #[cfg(all(debug_assertions, not(windows), not(target_family = "wasm")))]
        {
          let is_existed = super::BUFFER_DATA.with(|buffer_data| {
            let buffer = buffer_data.lock().expect("Unlock buffer data failed");
            buffer.contains(&inner_ptr.cast())
          });
          if is_existed {
            panic!("Share the same data between different buffers is not allowed, see: https://github.com/nodejs/node/issues/32463#issuecomment-631974747");
          }
        }
        let len = data.len();
        let array_buffer_len = checked_typed_array_byte_length::<$rust_type>(len)?;
        if len == 0 {
          check_status!(
            unsafe { sys::napi_create_arraybuffer(env.0, 0, ptr::null_mut(), &mut buf) },
            "Failed to create empty ArrayBuffer"
          )?;
          let mut napi_val = ptr::null_mut();
          check_status!(
            unsafe {
              sys::napi_create_typedarray(
                env.0,
                $typed_array_type as i32,
                0,
                buf,
                0,
                &mut napi_val,
              )
            },
            "Create empty TypedArray failed"
          )?;
          return Ok(Self {
            inner: NonNull::dangling(),
            length: 0,
            raw_value: napi_val,
            env: env.0,
            _marker: PhantomData,
          });
        }
        let cap = data.capacity();
        let finalize_hint = Box::into_raw(Box::new((len, cap)));
        let mut status = unsafe {
          sys::napi_create_external_arraybuffer(
            env.0,
            inner_ptr.cast(),
            array_buffer_len,
            Some(finalize_slice::<$rust_type>),
            finalize_hint.cast(),
            &mut buf,
          )
        };
        if status == napi_sys::Status::napi_no_external_buffers_allowed {
          unsafe {
            drop(Box::from_raw(finalize_hint));
          }
          let mut underlying_data = ptr::null_mut();
          status = unsafe {
            sys::napi_create_arraybuffer(
              env.0,
              array_buffer_len,
              &mut underlying_data,
              &mut buf,
            )
          };
          check_status!(status, "Failed to create buffer slice from data")?;
          if array_buffer_len > 0 {
            let underlying_slice: &mut [u8] =
              unsafe { std::slice::from_raw_parts_mut(underlying_data.cast(), array_buffer_len) };
            underlying_slice.copy_from_slice(unsafe { core::slice::from_raw_parts(inner_ptr.cast(), array_buffer_len) });
          }
          inner_ptr = underlying_data.cast();
        } else if status == sys::Status::napi_ok {
          mem::forget(data);
        } else {
          unsafe {
            drop(Box::from_raw(finalize_hint));
          }
          check_status!(status, "Failed to create buffer slice from data")?;
        }

        let mut napi_val = ptr::null_mut();
        check_status!(
          unsafe {
            sys::napi_create_typedarray(
              env.0,
              $typed_array_type as i32,
              len,
              buf,
              0,
              &mut napi_val,
            )
          },
          "Create TypedArray failed"
        )?;

        Ok(Self {
          inner: if len == 0 {
            NonNull::dangling()
          } else {
            unsafe { NonNull::new_unchecked(inner_ptr.cast()) }
          },
          length: len,
          raw_value: napi_val,
          env: env.0,
          _marker: PhantomData,
        })
      }

      #[doc = "Mostly the same with `from_data`"]
      #[doc = ""]
      #[doc = "Provided `finalize_callback` will be called when `"]
      #[doc = stringify!($slice_type)]
      #[doc = "` got dropped."]
      #[doc = "You can pass in `noop_finalize` if you have nothing to do in finalize phase."]
      #[doc = ""]
      #[doc = "## Safety"]
      #[doc = ""]
      #[doc = "The caller must ensure that:"]
      #[doc = "- The data pointer is valid for the lifetime of the buffer and points to a memory region of at least `len` elements"]
      #[doc = "- The finalize callback properly cleans up the data"]
      #[doc = ""]
      #[doc = "### Notes"]
      #[doc = ""]
      #[doc = "JavaScript may mutate the data passed in to this buffer when writing the buffer."]
      #[doc = "However, some JavaScript runtimes do not support external buffers (notably electron!)"]
      #[doc = "in which case modifications may be lost."]
      #[doc = ""]
      #[doc = "If you need to support these runtimes, you should create a buffer by other means and then"]
      #[doc = "later copy the data back out."]
      pub unsafe fn from_external<T: 'env, F: FnOnce(Env, T)>(
        env: &Env,
        data: *mut $rust_type,
        data_len: usize,
        finalize_hint: T,
        finalize_callback: F,
      ) -> Result<Self> {
        if data.is_null() || data as *const u8 == crate::EMPTY_VEC.as_ptr() {
          return Err(Error::new(
            Status::InvalidArg,
            "Borrowed data should not be null".to_owned(),
          ));
        }
        #[cfg(all(debug_assertions, not(windows), not(target_family = "wasm")))]
        {
          let is_existed = super::BUFFER_DATA.with(|buffer_data| {
            let buffer = buffer_data.lock().expect("Unlock buffer data failed");
            buffer.contains(&data.cast())
          });
          if is_existed {
            panic!("Share the same data between different buffers is not allowed, see: https://github.com/nodejs/node/issues/32463#issuecomment-631974747");
          }
        }
        let array_buffer_len = checked_typed_array_byte_length::<$rust_type>(data_len)?;
        let hint_ptr = Box::into_raw(Box::new((finalize_hint, finalize_callback)));
        let mut arraybuffer_value = ptr::null_mut();
        let mut result_data = data;
        let mut status = unsafe {
          sys::napi_create_external_arraybuffer(
            env.0,
            data.cast(),
            array_buffer_len,
            Some(crate::env::raw_finalize_with_custom_callback::<T, F>),
            hint_ptr.cast(),
            &mut arraybuffer_value,
          )
        };
        if status == sys::Status::napi_no_external_buffers_allowed {
          let (hint, finalize) = *Box::from_raw(hint_ptr);
          let mut underlying_data = ptr::null_mut();
          status = unsafe {
            sys::napi_create_arraybuffer(
              env.0,
              array_buffer_len,
              &mut underlying_data,
              &mut arraybuffer_value,
            )
          };
          // Copy data before calling finalize, since finalize may free the source data
          if status == sys::Status::napi_ok && array_buffer_len > 0 {
            let underlying_slice: &mut [u8] =
              unsafe { std::slice::from_raw_parts_mut(underlying_data.cast(), array_buffer_len) };
            underlying_slice.copy_from_slice(unsafe { std::slice::from_raw_parts(data.cast(), array_buffer_len) });
          }
          if status == sys::Status::napi_ok {
            result_data = underlying_data.cast();
          }
          // Always call finalize to clean up caller's resources, even on error
          finalize(*env, hint);
          check_status!(status, "Failed to create arraybuffer from data")?;
        } else if status != sys::Status::napi_ok {
          let (hint, finalize) = *Box::from_raw(hint_ptr);
          finalize(*env, hint);
          check_status!(status, "Failed to create arraybuffer from data")?;
        }

        let mut napi_val = ptr::null_mut();
        check_status!(
          unsafe {
            sys::napi_create_typedarray(
              env.0,
              $typed_array_type as i32,
              data_len,
              arraybuffer_value,
              0,
              &mut napi_val,
            )
          },
          "Create TypedArray failed"
        )?;

        Ok(Self {
          inner: if data_len == 0 {
            NonNull::dangling()
          } else {
            unsafe { NonNull::new_unchecked(result_data.cast()) }
          },
          length: data_len,
          raw_value: napi_val,
          env: env.0,
          _marker: PhantomData,
        })
      }

      #[doc = "Copy data from a `&["]
      #[doc = stringify!($rust_type)]
      #[doc = "]` and create a `"]
      #[doc = stringify!($slice_type)]
      #[doc = "` from it."]
      pub fn copy_from<D: AsRef<[$rust_type]>>(env: &Env, data: D) -> Result<Self> {
        let data = data.as_ref();
        let len = data.len();
        let byte_length = checked_typed_array_byte_length::<$rust_type>(len)?;
        let mut arraybuffer_value = ptr::null_mut();
        let mut underlying_data = ptr::null_mut();

        check_status!(
          unsafe {
            sys::napi_create_arraybuffer(
              env.0,
              byte_length,
              &mut underlying_data,
              &mut arraybuffer_value,
            )
          },
          "Failed to create ArrayBuffer"
        )?;
        if byte_length > 0 {
          unsafe {
            std::ptr::copy_nonoverlapping(
              data.as_ptr().cast::<u8>(),
              underlying_data.cast(),
              byte_length,
            )
          };
        }

        let mut napi_val = ptr::null_mut();
        check_status!(
          unsafe {
            sys::napi_create_typedarray(
              env.0,
              $typed_array_type as i32,
              len,
              arraybuffer_value,
              0,
              &mut napi_val,
            )
          },
          "Create TypedArray failed"
        )?;

        Ok(Self {
          inner: if len == 0 {
            NonNull::dangling()
          } else {
            unsafe { NonNull::new_unchecked(underlying_data.cast()) }
          },
          length: len,
          raw_value: napi_val,
          env: env.0,
          _marker: PhantomData,
        })
      }

      /// Create from `ArrayBuffer`
      pub fn from_arraybuffer(arraybuffer: &ArrayBuffer<'env>, byte_offset: usize, length: usize) -> Result<$slice_type<'env>> {
        let env = arraybuffer.value.env;
        let mut typed_array = ptr::null_mut();
        check_status!(unsafe {
          sys::napi_create_typedarray(env, $typed_array_type.into(), length, arraybuffer.value().value, byte_offset, &mut typed_array)
        }, "Failed to create TypedArray from ArrayBuffer")?;

        unsafe { FromNapiValue::from_napi_value(env, typed_array) }
      }

      /// extends the lifetime of the `TypedArray` to the lifetime of the `This`
      pub fn assign_to_this<'a, U>(&self, this: This<'a, U>, name: &str) -> Result<$slice_type<'a>>
      where
        U: FromNapiValue + JsObjectValue<'a>,
      {
        let this_value = this.object.value();
        super::ensure_same_env(self.env, this_value.env)?;
        let name = CString::new(name)?;
        check_status!(
          unsafe { sys::napi_set_named_property(self.env, this_value.value, name.as_ptr(), self.raw_value) },
          "Failed to assign {} to this",
          $slice_type::type_name()
        )?;
        Ok($slice_type {
          env: self.env,
          raw_value: self.raw_value,
          inner: self.inner,
          length: self.length,
          _marker: PhantomData,
        })
      }

      #[allow(clippy::should_implement_trait)]
      /// # Safety
      ///
      /// This is literally undefined behavior, as the JS side may always modify the underlying buffer,
      /// without synchronization.
      pub unsafe fn as_mut(&mut self) -> &mut [$rust_type] {
        unsafe { core::slice::from_raw_parts_mut(self.inner.as_ptr(), self.length) }
      }

      #[doc = "Convert a `"]
      #[doc = stringify!($slice_type)]
      #[doc = "` to a `"]
      #[doc = stringify!($name)]
      #[doc = "`."]
      #[doc = ""]
      #[doc = "This will perform a `napi_create_reference` internally."]
      pub fn into_typed_array(self, env: &Env) -> Result<$name> {
        super::ensure_same_env(self.env, env.0)?;
        unsafe { $name::from_napi_value(env.0, self.raw_value) }
      }
    }

    impl<'env> JsValue<'env> for $slice_type<'env> {
      fn value(&self) -> Value {
        Value {
          env: self.env,
          value: self.raw_value,
          value_type: ValueType::Object,
        }
      }
    }

    impl<'env> JsObjectValue<'env> for $slice_type<'env> { }

    impl ToNapiValue for &$slice_type<'_> {
      unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
        super::ensure_same_env(val.env, env)?;
        Ok(val.raw_value)
      }
    }

    impl ToNapiValue for &mut $slice_type<'_> {
      unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
        super::ensure_same_env(val.env, env)?;
        Ok(val.raw_value)
      }
    }

    impl FromNapiValue for $slice_type<'_> {
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
        // From the docs of `napi_get_typedarray_info`:
        // > [out] data: The underlying data buffer of the node::Buffer. If length is 0, this may be
        // > NULL or any other pointer value.
        //
        // In order to guarantee that `slice::from_raw_parts` is sound, the pointer must be non-null, so
        // let's make sure it always is, even in the case of `napi_get_typedarray_info` returning a null
        // ptr.
        Ok(Self {
          inner: if length == 0 {
            ptr::NonNull::dangling()
          } else {
            ptr::NonNull::new_unchecked(data.cast())
          },
          length,
          raw_value: napi_val,
          env,
          _marker: PhantomData,
        })
      }
    }

    impl TypeName for $slice_type<'_> {
      fn type_name() -> &'static str {
        concat!("TypedArray<", stringify!($rust_type), ">")
      }

      fn value_type() -> crate::ValueType {
        crate::ValueType::Object
      }
    }

    impl ValidateNapiValue for $slice_type<'_> {
      unsafe fn validate(env: sys::napi_env, napi_val: sys::napi_value) -> Result<sys::napi_value> {
        let mut is_typed_array = false;
        check_status!(
          unsafe { sys::napi_is_typedarray(env, napi_val, &mut is_typed_array) },
          "Failed to validate napi typed array"
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

    impl AsRef<[$rust_type]> for $slice_type<'_> {
      fn as_ref(&self) -> &[$rust_type] {
        unsafe { core::slice::from_raw_parts(self.inner.as_ptr(), self.length) }
      }
    }

    impl Deref for $slice_type<'_> {
      type Target = [$rust_type];

      fn deref(&self) -> &Self::Target {
        self.as_ref()
      }
    }

    impl FromNapiValue for &mut [$rust_type] {
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
        Ok(if length == 0 {
          &mut []
        } else {
          unsafe { core::slice::from_raw_parts_mut(data as *mut $rust_type, length) }
        })
      }
    }

    impl FromNapiValue for &[$rust_type] {
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
        Ok(if length == 0 {
          &[]
        } else {
          unsafe { core::slice::from_raw_parts_mut(data as *mut $rust_type, length) }
        })
      }
    }

    impl TypeName for &mut [$rust_type] {
      fn type_name() -> &'static str {
        concat!("TypedArray<", stringify!($rust_type), ">")
      }

      fn value_type() -> crate::ValueType {
        crate::ValueType::Object
      }
    }

    impl TypeName for &[$rust_type] {
      fn type_name() -> &'static str {
        concat!("TypedArray<", stringify!($rust_type), ">")
      }

      fn value_type() -> crate::ValueType {
        crate::ValueType::Object
      }
    }

    impl ValidateNapiValue for &[$rust_type] {
      unsafe fn validate(env: sys::napi_env, napi_val: sys::napi_value) -> Result<sys::napi_value> {
        let mut is_typed_array = false;
        check_status!(
          unsafe { sys::napi_is_typedarray(env, napi_val, &mut is_typed_array) },
          "Failed to validate napi typed array"
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

    impl ValidateNapiValue for &mut [$rust_type] {
      unsafe fn validate(env: sys::napi_env, napi_val: sys::napi_value) -> Result<sys::napi_value> {
        let mut is_typed_array = false;
        check_status!(
          unsafe { sys::napi_is_typedarray(env, napi_val, &mut is_typed_array) },
          "Failed to validate napi typed array"
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
  };
}

unsafe extern "C" fn finalizer<Data, T: Finalizer<RustType = Data> + AsRef<[Data]>>(
  env: sys::napi_env,
  _finalize_data: *mut c_void,
  finalize_hint: *mut c_void,
) {
  crate::bindgen_runtime::with_runtime_finalizer_guard(env, || {
    crate::bindgen_runtime::catch_unwind_safely(|| {
      let data = unsafe { *Box::from_raw(finalize_hint as *mut T) };
      drop(data);
    });
  });
}

unsafe extern "C" fn finalize_slice<Data>(
  env: sys::napi_env,
  finalize_data: *mut c_void,
  finalize_hint: *mut c_void,
) {
  crate::bindgen_runtime::with_runtime_finalizer_guard(env, || {
    crate::bindgen_runtime::catch_unwind_safely(|| {
      let (length, capacity): (usize, usize) =
        *unsafe { Box::from_raw(finalize_hint as *mut (usize, usize)) };
      if finalize_data.is_null() {
        return;
      }
      drop(unsafe { Vec::from_raw_parts(finalize_data.cast::<Data>(), length, capacity) });
    });
  });
}

impl_typed_array!(Int8Array, i8, TypedArrayType::Int8);
impl_from_slice!(Int8Array, Int8ArraySlice, i8, TypedArrayType::Int8);
impl_typed_array!(Uint8Array, u8, TypedArrayType::Uint8);
impl_from_slice!(Uint8Array, Uint8ArraySlice, u8, TypedArrayType::Uint8);
impl_typed_array!(Uint8ClampedArray, u8, TypedArrayType::Uint8Clamped);
impl_typed_array!(Int16Array, i16, TypedArrayType::Int16);
impl_from_slice!(Int16Array, Int16ArraySlice, i16, TypedArrayType::Int16);
impl_typed_array!(Uint16Array, u16, TypedArrayType::Uint16);
impl_from_slice!(Uint16Array, Uint16ArraySlice, u16, TypedArrayType::Uint16);
impl_typed_array!(Int32Array, i32, TypedArrayType::Int32);
impl_from_slice!(Int32Array, Int32ArraySlice, i32, TypedArrayType::Int32);
impl_typed_array!(Uint32Array, u32, TypedArrayType::Uint32);
impl_from_slice!(Uint32Array, Uint32ArraySlice, u32, TypedArrayType::Uint32);
impl_typed_array!(Float32Array, f32, TypedArrayType::Float32);
impl_from_slice!(
  Float32Array,
  Float32ArraySlice,
  f32,
  TypedArrayType::Float32
);
impl_typed_array!(Float64Array, f64, TypedArrayType::Float64);
impl_from_slice!(
  Float64Array,
  Float64ArraySlice,
  f64,
  TypedArrayType::Float64
);
#[cfg(feature = "napi6")]
impl_typed_array!(BigInt64Array, i64, TypedArrayType::BigInt64);
#[cfg(feature = "napi6")]
impl_from_slice!(
  BigInt64Array,
  BigInt64ArraySlice,
  i64,
  TypedArrayType::BigInt64
);
#[cfg(feature = "napi6")]
impl_typed_array!(BigUint64Array, u64, TypedArrayType::BigUint64);
#[cfg(feature = "napi6")]
impl_from_slice!(
  BigUint64Array,
  BigUint64ArraySlice,
  u64,
  TypedArrayType::BigUint64
);

impl Uint8Array {
  /// Create a new JavaScript `Uint8Array` from a Rust `String` without copying the underlying data.
  pub fn from_string(mut s: String) -> Self {
    let len = s.len();
    let cap = s.capacity();
    let ret = Self {
      data: s.as_mut_ptr(),
      length: len,
      capacity: cap,
      finalizer_notify: Box::into_raw(Box::new(move |data, _| {
        drop(unsafe { String::from_raw_parts(data, len, cap) });
      })),
      byte_offset: 0,
      raw: None,
    };
    mem::forget(s);
    ret
  }
}

#[derive(Clone, Copy)]
/// Zero copy Uint8ClampedArray slice shared between Rust and Node.js.
/// It can only be used in non-async context and the lifetime is bound to the fn closure.
/// If you want to use Node.js `Uint8ClampedArray` in async context or want to extend the lifetime, use `Uint8ClampedArray` instead.
pub struct Uint8ClampedSlice<'scope> {
  pub(crate) inner: NonNull<u8>,
  pub(crate) length: usize,
  raw_value: sys::napi_value,
  env: sys::napi_env,
  _marker: PhantomData<&'scope ()>,
}

impl FromNapiValue for Uint8ClampedSlice<'_> {
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
    if typed_array_type != TypedArrayType::Uint8Clamped as i32 {
      return Err(Error::new(
        Status::InvalidArg,
        format!("Expected $name, got {typed_array_type}"),
      ));
    }
    Ok(Self {
      inner: if length == 0 {
        NonNull::dangling()
      } else {
        unsafe { NonNull::new_unchecked(data.cast()) }
      },
      length,
      raw_value: napi_val,
      env,
      _marker: PhantomData,
    })
  }
}

impl<'env> JsValue<'env> for Uint8ClampedSlice<'env> {
  fn value(&self) -> Value {
    Value {
      env: self.env,
      value: self.raw_value,
      value_type: ValueType::Object,
    }
  }
}

impl<'env> JsObjectValue<'env> for Uint8ClampedSlice<'env> {}

impl TypeName for Uint8ClampedSlice<'_> {
  fn type_name() -> &'static str {
    "Uint8ClampedArray"
  }

  fn value_type() -> ValueType {
    ValueType::Object
  }
}

impl ValidateNapiValue for Uint8ClampedSlice<'_> {
  unsafe fn validate(env: sys::napi_env, napi_val: sys::napi_value) -> Result<sys::napi_value> {
    let mut is_typedarray = false;
    check_status!(
      unsafe { sys::napi_is_typedarray(env, napi_val, &mut is_typedarray) },
      "Failed to validate typed buffer"
    )?;
    if !is_typedarray {
      return Err(Error::new(
        Status::InvalidArg,
        "Expected a TypedArray value".to_owned(),
      ));
    }
    Ok(ptr::null_mut())
  }
}

impl AsRef<[u8]> for Uint8ClampedSlice<'_> {
  fn as_ref(&self) -> &[u8] {
    unsafe { core::slice::from_raw_parts(self.inner.as_ptr(), self.length) }
  }
}

impl Deref for Uint8ClampedSlice<'_> {
  type Target = [u8];

  fn deref(&self) -> &Self::Target {
    unsafe { core::slice::from_raw_parts(self.inner.as_ptr(), self.length) }
  }
}

impl<'env> Uint8ClampedSlice<'env> {
  /// Create a new `Uint8ClampedSlice` from `Vec<u8>`
  pub fn from_data<D: Into<Vec<u8>>>(env: &Env, data: D) -> Result<Self> {
    let mut buf = ptr::null_mut();
    let mut data: Vec<u8> = data.into();
    let mut inner_ptr = data.as_mut_ptr();
    #[cfg(all(debug_assertions, not(windows), not(target_family = "wasm")))]
    {
      let is_existed = super::BUFFER_DATA.with(|buffer_data| {
        let buffer = buffer_data.lock().expect("Unlock buffer data failed");
        buffer.contains(&inner_ptr)
      });
      if is_existed {
        panic!("Share the same data between different buffers is not allowed, see: https://github.com/nodejs/node/issues/32463#issuecomment-631974747");
      }
    }
    let len = data.len();
    if len == 0 {
      check_status!(
        unsafe { sys::napi_create_arraybuffer(env.0, 0, ptr::null_mut(), &mut buf) },
        "Failed to create empty ArrayBuffer"
      )?;
      let mut napi_val = ptr::null_mut();
      check_status!(
        unsafe {
          sys::napi_create_typedarray(
            env.0,
            TypedArrayType::Uint8Clamped as i32,
            0,
            buf,
            0,
            &mut napi_val,
          )
        },
        "Create empty TypedArray failed"
      )?;
      return Ok(Self {
        inner: NonNull::dangling(),
        length: 0,
        raw_value: napi_val,
        env: env.0,
        _marker: PhantomData,
      });
    }
    let cap = data.capacity();
    let finalize_hint = Box::into_raw(Box::new((len, cap)));
    let mut status = unsafe {
      sys::napi_create_external_arraybuffer(
        env.0,
        inner_ptr.cast(),
        data.len(),
        Some(finalize_slice::<u8>),
        finalize_hint.cast(),
        &mut buf,
      )
    };
    if status == napi_sys::Status::napi_no_external_buffers_allowed {
      unsafe {
        drop(Box::from_raw(finalize_hint));
      }
      let mut underlying_data = ptr::null_mut();
      status = unsafe { sys::napi_create_arraybuffer(env.0, len, &mut underlying_data, &mut buf) };
      check_status!(status, "Failed to create arraybuffer")?;
      if len > 0 {
        let underlying_slice: &mut [u8] =
          unsafe { std::slice::from_raw_parts_mut(underlying_data.cast(), len) };
        underlying_slice.copy_from_slice(data.as_slice());
      }
      inner_ptr = underlying_data.cast();
    } else if status == sys::Status::napi_ok {
      mem::forget(data);
    } else {
      unsafe {
        drop(Box::from_raw(finalize_hint));
      }
      check_status!(status, "Failed to create arraybuffer")?;
    }

    let mut napi_val = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_create_typedarray(
          env.0,
          TypedArrayType::Uint8Clamped as i32,
          len,
          buf,
          0,
          &mut napi_val,
        )
      },
      "Create TypedArray failed"
    )?;

    Ok(Self {
      inner: if len == 0 {
        NonNull::dangling()
      } else {
        unsafe { NonNull::new_unchecked(inner_ptr.cast()) }
      },
      length: len,
      raw_value: napi_val,
      env: env.0,
      _marker: PhantomData,
    })
  }

  /// Mostly the same with `from_data`
  ///
  /// Provided `finalize_callback` will be called when `Uint8ClampedSlice` got dropped.
  /// You can pass in `noop_finalize` if you have nothing to do in finalize phase.
  ///
  /// ## Safety
  ///
  /// The caller must ensure that:
  /// - The data pointer is valid for the lifetime of the buffer and points to a memory region of at least `len` bytes
  /// - The finalize callback properly cleans up the data
  ///
  /// ### Notes
  ///
  /// JavaScript may mutate the data passed in to this buffer when writing the buffer.
  /// However, some JavaScript runtimes do not support external buffers (notably electron!)
  /// in which case modifications may be lost.
  ///
  /// If you need to support these runtimes, you should create a buffer by other means and then
  /// later copy the data back out.
  pub unsafe fn from_external<T: 'env, F: FnOnce(Env, T)>(
    env: &Env,
    data: *mut u8,
    len: usize,
    finalize_hint: T,
    finalize_callback: F,
  ) -> Result<Self> {
    if data.is_null() || std::ptr::eq(data, crate::EMPTY_VEC.as_ptr()) {
      return Err(Error::new(
        Status::InvalidArg,
        "Borrowed data should not be null".to_owned(),
      ));
    }
    #[cfg(all(debug_assertions, not(windows), not(target_family = "wasm")))]
    {
      let is_existed = super::BUFFER_DATA.with(|buffer_data| {
        let buffer = buffer_data.lock().expect("Unlock buffer data failed");
        buffer.contains(&data)
      });
      if is_existed {
        panic!("Share the same data between different buffers is not allowed, see: https://github.com/nodejs/node/issues/32463#issuecomment-631974747");
      }
    }
    let hint_ptr = Box::into_raw(Box::new((finalize_hint, finalize_callback)));
    let mut arraybuffer_value = ptr::null_mut();
    let mut result_data = data;
    let mut status = unsafe {
      sys::napi_create_external_arraybuffer(
        env.0,
        data.cast(),
        len,
        Some(crate::env::raw_finalize_with_custom_callback::<T, F>),
        hint_ptr.cast(),
        &mut arraybuffer_value,
      )
    };
    if status == sys::Status::napi_no_external_buffers_allowed {
      let (hint, finalize) = *Box::from_raw(hint_ptr);
      let mut underlying_data = ptr::null_mut();
      status = unsafe {
        sys::napi_create_arraybuffer(env.0, len, &mut underlying_data, &mut arraybuffer_value)
      };
      // Copy data before calling finalize, since finalize may free the source data
      if status == sys::Status::napi_ok && len > 0 {
        let underlying_slice: &mut [u8] =
          unsafe { std::slice::from_raw_parts_mut(underlying_data.cast(), len) };
        underlying_slice.copy_from_slice(unsafe { std::slice::from_raw_parts(data, len) });
      }
      if status == sys::Status::napi_ok {
        result_data = underlying_data.cast();
      }
      // Always call finalize to clean up caller's resources, even on error
      finalize(*env, hint);
      check_status!(status, "Failed to create arraybuffer from data")?;
    } else if status != sys::Status::napi_ok {
      let (hint, finalize) = *Box::from_raw(hint_ptr);
      finalize(*env, hint);
      check_status!(status, "Failed to create arraybuffer from data")?;
    }

    let mut napi_val = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_create_typedarray(
          env.0,
          TypedArrayType::Uint8Clamped as i32,
          len,
          arraybuffer_value,
          0,
          &mut napi_val,
        )
      },
      "Create TypedArray failed"
    )?;

    Ok(Self {
      inner: if len == 0 {
        NonNull::dangling()
      } else {
        unsafe { NonNull::new_unchecked(result_data.cast()) }
      },
      length: len,
      raw_value: napi_val,
      env: env.0,
      _marker: PhantomData,
    })
  }

  /// Copy data from a `&[u8]` and create a `Uint8ClampedSlice` from it.
  pub fn copy_from<D: AsRef<[u8]>>(env: &Env, data: D) -> Result<Self> {
    let data = data.as_ref();
    let len = data.len();
    let mut arraybuffer_value = ptr::null_mut();
    let mut underlying_data = ptr::null_mut();

    check_status!(
      unsafe {
        sys::napi_create_arraybuffer(env.0, len, &mut underlying_data, &mut arraybuffer_value)
      },
      "Failed to create ArrayBuffer"
    )?;
    if len > 0 {
      unsafe { std::ptr::copy_nonoverlapping(data.as_ptr(), underlying_data.cast(), len) };
    }

    let mut napi_val = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_create_typedarray(
          env.0,
          TypedArrayType::Uint8Clamped as i32,
          len,
          arraybuffer_value,
          0,
          &mut napi_val,
        )
      },
      "Create TypedArray failed"
    )?;

    Ok(Self {
      inner: if len == 0 {
        NonNull::dangling()
      } else {
        unsafe { NonNull::new_unchecked(underlying_data.cast()) }
      },
      length: len,
      raw_value: napi_val,
      env: env.0,
      _marker: PhantomData,
    })
  }

  /// Create from `ArrayBuffer`
  pub fn from_arraybuffer(
    arraybuffer: &ArrayBuffer<'env>,
    byte_offset: usize,
    length: usize,
  ) -> Result<Self> {
    let env = arraybuffer.value.env;
    let mut typed_array = ptr::null_mut();
    check_status!(
      unsafe {
        sys::napi_create_typedarray(
          env,
          TypedArrayType::Uint8Clamped as i32,
          length,
          arraybuffer.value().value,
          byte_offset,
          &mut typed_array,
        )
      },
      "Failed to create TypedArray from ArrayBuffer"
    )?;

    unsafe { FromNapiValue::from_napi_value(env, typed_array) }
  }

  /// extends the lifetime of the `TypedArray` to the lifetime of the `This`
  pub fn assign_to_this<'a, U>(&self, this: This<'a, U>, name: &str) -> Result<Self>
  where
    U: FromNapiValue + JsObjectValue<'a>,
  {
    let this_value = this.object.value();
    super::ensure_same_env(self.env, this_value.env)?;
    let name = CString::new(name)?;
    check_status!(
      unsafe {
        sys::napi_set_named_property(self.env, this_value.value, name.as_ptr(), self.raw_value)
      },
      "Failed to assign {} to this",
      Self::type_name()
    )?;
    Ok(Self {
      env: self.env,
      raw_value: self.raw_value,
      inner: self.inner,
      length: self.length,
      _marker: PhantomData,
    })
  }

  #[allow(clippy::should_implement_trait)]
  /// # Safety
  ///
  /// This is literally undefined behavior, as the JS side may always modify the underlying buffer,
  /// without synchronization.
  pub unsafe fn as_mut(&mut self) -> &mut [u8] {
    core::slice::from_raw_parts_mut(self.inner.as_ptr(), self.length)
  }

  /// Convert a `Uint8ClampedSlice` to a `Uint8ClampedArray`.
  pub fn into_typed_array(self, env: &Env) -> Result<Self> {
    super::ensure_same_env(self.env, env.0)?;
    unsafe { Self::from_napi_value(env.0, self.raw_value) }
  }
}

impl<T: Into<Vec<u8>>> From<T> for Uint8Array {
  fn from(data: T) -> Self {
    Uint8Array::new(data.into())
  }
}

impl<T: Into<Vec<u8>>> From<T> for Uint8ClampedArray {
  fn from(data: T) -> Self {
    Uint8ClampedArray::new(data.into())
  }
}

impl<T: Into<Vec<u16>>> From<T> for Uint16Array {
  fn from(data: T) -> Self {
    Uint16Array::new(data.into())
  }
}

impl<T: Into<Vec<u32>>> From<T> for Uint32Array {
  fn from(data: T) -> Self {
    Uint32Array::new(data.into())
  }
}

impl<T: Into<Vec<i8>>> From<T> for Int8Array {
  fn from(data: T) -> Self {
    Int8Array::new(data.into())
  }
}

impl<T: Into<Vec<i16>>> From<T> for Int16Array {
  fn from(data: T) -> Self {
    Int16Array::new(data.into())
  }
}

impl<T: Into<Vec<i32>>> From<T> for Int32Array {
  fn from(data: T) -> Self {
    Int32Array::new(data.into())
  }
}

impl<T: Into<Vec<f32>>> From<T> for Float32Array {
  fn from(data: T) -> Self {
    Float32Array::new(data.into())
  }
}

impl<T: Into<Vec<f64>>> From<T> for Float64Array {
  fn from(data: T) -> Self {
    Float64Array::new(data.into())
  }
}

#[cfg(feature = "napi6")]
impl<T: Into<Vec<i64>>> From<T> for BigInt64Array {
  fn from(data: T) -> Self {
    BigInt64Array::new(data.into())
  }
}
#[cfg(feature = "napi6")]
impl<T: Into<Vec<u64>>> From<T> for BigUint64Array {
  fn from(data: T) -> Self {
    BigUint64Array::new(data.into())
  }
}
