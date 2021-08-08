use super::{check_status, sys, Result};

macro_rules! map_single_copy_val {
	( $( ($name:literal, $t:ty, $get:ident, $create:ident) ,)* ) => {
		$(
      impl $crate::bindgen_prelude::TypeName for $t {
        fn type_name() -> &'static str {
          $name
        }
      }

      impl $crate::bindgen_prelude::ToNapiValue for $t {
        unsafe fn to_napi_value(env: $crate::sys::napi_env, val: $t) -> Result<$crate::sys::napi_value> {
          let mut ptr = std::ptr::null_mut();

          check_status!(
            sys::$create(env, val, &mut ptr),
						"Failed to convert rust type `{}` into napi value",
						$name,
          )?;

          Ok(ptr)
        }
      }

      impl $crate::bindgen_prelude::FromNapiValue for $t {
				unsafe fn from_napi_value(env: $crate::sys::napi_env, napi_val: $crate::sys::napi_value) -> Result<Self> {
					let mut ret = std::mem::MaybeUninit::<$t>::uninit();

          check_status!(
            sys::$get(env, napi_val, ret.as_mut_ptr()),
						"Failed to convert napi value into rust type `{}`",
            $name
          )?;

					Ok(ret.assume_init())
				}
      }
		)*
	};
}

map_single_copy_val!(
  ("u32", u32, napi_get_value_uint32, napi_create_uint32),
  ("i32", i32, napi_get_value_int32, napi_create_int32),
  ("i64", i64, napi_get_value_int64, napi_create_int64),
  ("bool", bool, napi_get_value_bool, napi_get_boolean),
  ("f64", f64, napi_get_value_double, napi_create_double),
);
