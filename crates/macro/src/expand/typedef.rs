#[cfg(feature = "type-def")]
pub mod typedef;
#[cfg(feature = "type-def")]
pub use self::typedef::*;

#[cfg(not(feature = "type-def"))]
pub mod noop;
#[cfg(not(feature = "type-def"))]
pub use self::noop::*;
