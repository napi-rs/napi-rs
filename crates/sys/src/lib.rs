// borrowed from https://github.com/neon-bindings/neon/tree/main/crates/neon/src/sys/bindings

#![allow(ambiguous_glob_reexports)]

#[cfg(any(
  target_env = "msvc",
  all(not(target_family = "wasm"), feature = "dyn-symbols")
))]
#[inline(never)]
unsafe fn load_symbol(
  host: &libloading::Library,
  name: &'static [u8],
) -> Option<*mut std::ffi::c_void> {
  match unsafe { host.get::<unsafe extern "C" fn()>(name) } {
    Ok(symbol) => unsafe { symbol.try_as_raw_ptr() },
    Err(_) => None,
  }
}

#[cfg(any(
  target_env = "msvc",
  all(not(target_family = "wasm"), feature = "dyn-symbols")
))]
macro_rules! generate {
  (@stub_fn $name:ident($($param:ident: $ptype:ty,)*) -> napi_status) => {
    unsafe extern "C" fn $name($(_: $ptype,)*) -> napi_status {
      eprintln!("Node-API symbol {} has not been loaded", stringify!($name));
      1
    }
  };
  (@stub_fn $name:ident($($param:ident: $ptype:ty,)*) -> $rtype:ty) => {
    unsafe extern "C" fn $name($(_: $ptype,)*) -> $rtype {
      eprintln!("Node-API symbol {} has not been loaded", stringify!($name));
      unsafe { std::mem::zeroed() }
    }
  };
  (@stub_fn $name:ident($($param:ident: $ptype:ty,)*)) => {
    unsafe extern "C" fn $name($(_: $ptype,)*) {
      eprintln!("Node-API symbol {} has not been loaded", stringify!($name));
    }
  };
  (extern "C" {
    $(fn $name:ident($($param:ident: $ptype:ty$(,)?)*)$( -> $rtype:ty)?;)+
  }) => {
    struct Napi {
      $(
        $name: unsafe extern "C" fn(
          $($param: $ptype,)*
        )$( -> $rtype)*,
      )*
    }

    static mut NAPI: Napi = {
      $(
        generate!(@stub_fn $name($($param: $ptype,)*) $( -> $rtype)?);
      )*

      Napi {
        $(
          $name,
        )*
      }
    };

    #[allow(clippy::missing_safety_doc)]
    pub unsafe fn load(
      host: &libloading::Library,
    ) -> Result<(), libloading::Error> {
      NAPI = Napi {
        $(
          $name: match unsafe {
            // SAFETY: every generated name identifies a Node-API function, and `setup` keeps the
            // host library alive for as long as the loaded function pointers can be called.
            $crate::load_symbol(
              host,
              concat!(stringify!($name), "\0").as_bytes(),
            )
          } {
            Some(symbol) => {
              // SAFETY: Node-API exports use the signature declared for this field. The host
              // library remains alive for as long as these function pointers can be called.
              unsafe {
                std::mem::transmute::<
                  *mut std::ffi::c_void,
                  unsafe extern "C" fn($(_: $ptype,)*)$( -> $rtype)*,
                >(symbol)
              }
            }
            // Ignore the lookup error and preserve the existing stub function.
            None => NAPI.$name,
          },
        )*
      };

      Ok(())
    }

    $(
      #[inline]
      #[allow(clippy::missing_safety_doc)]
      pub unsafe fn $name($($param: $ptype,)*)$( -> $rtype)* {
        (NAPI.$name)($($param,)*)
      }
    )*
  };
}

#[cfg(any(
  target_family = "wasm",
  all(not(target_env = "msvc"), not(feature = "dyn-symbols"))
))]
macro_rules! generate {
  (extern "C" {
    $(fn $name:ident($($param:ident: $ptype:ty$(,)?)*)$( -> $rtype:ty)?;)+
  }) => {
    extern "C" {
      $(
        pub fn $name($($param: $ptype,)*)$( -> $rtype)*;
      ) *
    }
  };
}

mod functions;
mod types;

pub use functions::*;
pub use types::*;

#[cfg(any(
  target_env = "msvc",
  all(not(target_family = "wasm"), feature = "dyn-symbols")
))]
/// Loads N-API symbols from host process.
/// Must be called at least once before using any functions in bindings or
/// they will panic
///
/// # Safety
///
/// The returned Library must be kept alive as long as any N-API
pub unsafe fn setup() -> libloading::Library {
  match load_all() {
    Err(err) => panic!("{}", err),
    Ok(l) => l,
  }
}
