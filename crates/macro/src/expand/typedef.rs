#[cfg(feature = "type-def")]
mod type_def;
#[cfg(feature = "type-def")]
pub use self::type_def::*;

#[cfg(not(feature = "type-def"))]
pub mod noop;
#[cfg(not(feature = "type-def"))]
pub use self::noop::*;
