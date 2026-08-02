//! Cross-crate identity fixture (issue: `#[napi]` type-def generation keying
//! references by the bare Rust identifier instead of `(namespace, js_name)`).
//!
//! `napi_shared::TimeSeriesNapi` (`examples/napi-shared/src/lib.rs`) is
//! declared `#[napi(namespace = "Sdk", js_name = "TimeSeries")]` — a
//! different Rust ident than its public JS name, in a namespace, in a
//! DIFFERENT crate. This crate's own macro expansion runs in a separate
//! rustc process from `napi-shared`'s, so it can never see `napi-shared`'s
//! `CLASS_STRUCTS`/`ALIAS` tables directly; every reference below exercises
//! the sentinel + CLI cross-fragment resolution path, not the same-crate
//! fast path. Every reference must render as `Sdk.TimeSeries` in the
//! generated `.d.ts` — never the bare `TimeSeriesNapi`, and never requiring
//! an `export type TimeSeries = TimeSeriesNapi` alias.

use napi::bindgen_prelude::Either;
use napi_derive::napi;
use napi_shared::TimeSeriesNapi;

/// Direct `&T` reference.
#[napi]
pub fn identity_accept_time_series(series: &TimeSeriesNapi) -> f64 {
  series.value
}

/// `Option<&T>`.
#[napi]
pub fn identity_accept_optional_time_series(series: Option<&TimeSeriesNapi>) -> f64 {
  series.map(|s| s.value).unwrap_or(-1.0)
}

/// `Either<&T, String>`.
#[napi]
pub fn identity_accept_time_series_or_string(input: Either<&TimeSeriesNapi, String>) -> String {
  match input {
    Either::A(series) => format!("series:{}", series.value),
    Either::B(s) => format!("string:{s}"),
  }
}

/// `Vec<T>`.
#[napi]
pub fn identity_sum_time_series(series: Vec<&TimeSeriesNapi>) -> f64 {
  series.iter().map(|s| s.value).sum()
}

/// A factory-style function returning the cross-crate class directly.
#[napi]
pub fn identity_make_time_series(value: f64) -> TimeSeriesNapi {
  TimeSeriesNapi::from_value(value)
}
