#[cfg(windows)]
macro_rules! generate {
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

      #[inline(never)]
      fn panic_load<T>() -> T {
          panic!("Must load N-API bindings")
      }

      static mut NAPI: Napi = {
          $(
              unsafe extern "C" fn $name($(_: $ptype,)*)$( -> $rtype)* {
                  panic_load()
              }
          )*

          Napi {
              $(
                  $name,
              )*
          }
      };

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
                        debug_assert!({
                          println!("Load Node-API [{}] from host runtime failed: {}", stringify!($name), e);
                          true
                        });
                        return Ok(());
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

#[cfg(not(windows))]
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

#[cfg(windows)]
use std::sync::Once;

mod functions;
mod types;

pub use functions::*;
pub use types::*;

#[cfg(windows)]
static SETUP: Once = Once::new();

/// Loads N-API symbols from host process.
/// Must be called at least once before using any functions in bindings or
/// they will panic.
/// Safety: `env` must be a valid `napi_env` for the current thread
#[cfg(windows)]
#[allow(clippy::missing_safety_doc)]
pub unsafe fn setup() {
  SETUP.call_once(|| {
    if let Err(err) = load() {
      panic!("{}", err);
    }
  });
}
