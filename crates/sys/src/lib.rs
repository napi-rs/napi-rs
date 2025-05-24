// borrowed from https://github.com/neon-bindings/neon/tree/main/crates/neon/src/sys/bindings

#![allow(ambiguous_glob_reexports)]

#[cfg(any(target_env = "msvc", feature = "dyn-symbols"))]
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
          $name: {
            let symbol: Result<libloading::Symbol<unsafe extern "C" fn ($(_: $ptype,)*)$( -> $rtype)*>, libloading::Error> = host.get(stringify!($name).as_bytes());
            match symbol {
              Ok(f) => *f,
              Err(e) => {
                #[cfg(debug_assertions)] {
                  eprintln!("Load Node-API [{}] from host runtime failed: {}", stringify!($name), e);
                }
                NAPI.$name
              }
            }
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

#[cfg(not(any(target_env = "msvc", feature = "dyn-symbols")))]
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

/// Loads N-API symbols from host process.
/// Must be called at least once before using any functions in bindings or
/// they will panic.
/// Safety: `env` must be a valid `napi_env` for the current thread
#[cfg(any(target_env = "msvc", feature = "dyn-symbols"))]
#[allow(clippy::missing_safety_doc)]
pub unsafe fn setup() -> libloading::Library {
  match load_all() {
    Err(err) => panic!("{}", err),
    Ok(l) => l,
  }
}
