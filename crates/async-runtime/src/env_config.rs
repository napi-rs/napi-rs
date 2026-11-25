//! Napi-free helpers for parsing and clamping environment-derived runtime
//! configuration values.
//!
//! Hosts resolve their own environment variables before calling [`crate::configure`],
//! [`crate::install`], or [`crate::install_exact`]; these helpers keep the parsing,
//! zero-handling, and ceiling-clamping rules consistent across hosts without
//! requiring the `napi` adapter feature.

/// Parse a positive integer thread count.
///
/// Empty, zero, negative, fractional, non-numeric, or overflowing values
/// return `None`.
pub fn parse_thread_count(value: &str) -> Option<usize> {
  value
    .parse::<std::num::NonZeroUsize>()
    .ok()
    .map(std::num::NonZeroUsize::get)
}

/// Resolve an env-derived thread count: parse the raw value, treat a missing,
/// non-numeric, OR zero value as "unset" and fall back to `default`, then
/// clamp the result to `maximum`.
///
/// A `0` must never survive here because the host's module-init path feeds
/// this count into a constructor that rejects `0`: [`crate::RuntimeOptions`]
/// validation rejects a `0` thread count, which would panic an `expect()`
/// during addon load over what may be a simple typo in an environment
/// variable.
pub fn resolve_thread_count(raw: Option<String>, default: usize, maximum: usize) -> usize {
  assert!(default > 0, "the default thread count must be positive");
  assert!(maximum > 0, "the maximum thread count must be positive");
  raw
    .as_deref()
    .and_then(parse_thread_count)
    .unwrap_or(default)
    .min(maximum)
}

/// Resolve an env-derived drainer idle-linger budget (a raw
/// [`crate::DRAIN_LINGER_ENV`]-style value, MICROSECONDS) into
/// [`crate::RuntimeOptions::drain_linger`]: a missing or non-numeric value
/// keeps `fallback` (the host-provided field,
/// [`crate::DEFAULT_DRAIN_LINGER_MICROS`] by default); `0` disables lingering;
/// anything else is clamped to [`crate::MAX_DRAIN_LINGER_MICROS`] so an
/// extreme value (e.g. `u64::MAX`) tunes the wave optimization instead of
/// pinning pool workers on never-expiring lingers. [`crate::RuntimeOptions`]
/// validation re-applies the same clamp, so a host bypassing this resolver
/// cannot smuggle an unbounded budget either.
pub fn resolve_drain_linger(
  raw: Option<String>,
  fallback: std::time::Duration,
) -> std::time::Duration {
  raw
    .and_then(|value| value.trim().parse::<u64>().ok())
    .map_or(fallback, std::time::Duration::from_micros)
    .min(std::time::Duration::from_micros(
      crate::async_runtime::MAX_DRAIN_LINGER_MICROS,
    ))
}

#[cfg(test)]
mod tests {
  use std::time::Duration;

  use crate::async_runtime::{DEFAULT_DRAIN_LINGER_MICROS, MAX_DRAIN_LINGER_MICROS};

  use super::{parse_thread_count, resolve_drain_linger, resolve_thread_count};

  #[test]
  fn parse_thread_count_accepts_positive_integers_only() {
    assert_eq!(parse_thread_count("1"), Some(1));
    assert_eq!(parse_thread_count("42"), Some(42));
    assert_eq!(
      parse_thread_count(&usize::MAX.to_string()),
      Some(usize::MAX)
    );
    for invalid in ["", "0", "-1", "1.5", "abc", " 4 ", "18446744073709551616"] {
      assert_eq!(parse_thread_count(invalid), None, "input={invalid:?}");
    }
  }

  #[test]
  fn resolve_thread_count_handles_env_inputs() {
    const DEFAULT: usize = 8;
    const MAXIMUM: usize = 16;
    // A `0` typo must be treated as unset, never fed to a constructor that
    // rejects 0 (`RuntimeOptions` validation), which would panic the host's
    // module_init `expect`.
    assert_eq!(
      resolve_thread_count(Some("0".to_string()), DEFAULT, MAXIMUM),
      DEFAULT
    );
    // Valid positive numbers pass through unchanged.
    assert_eq!(
      resolve_thread_count(Some("4".to_string()), DEFAULT, MAXIMUM),
      4
    );
    // Valid but unsafe values clamp to the construction limit.
    assert_eq!(
      resolve_thread_count(Some("1000".to_string()), DEFAULT, MAXIMUM),
      MAXIMUM
    );
    assert_eq!(
      resolve_thread_count(Some(usize::MAX.to_string()), DEFAULT, MAXIMUM),
      MAXIMUM
    );
    // Parse overflow is invalid input and falls back instead of wrapping.
    assert_eq!(
      resolve_thread_count(Some("18446744073709551616".to_string()), DEFAULT, MAXIMUM),
      DEFAULT
    );
    // Non-numeric / empty / negative / fractional values fall back gracefully.
    for invalid in ["abc", "", "-1", "1.5"] {
      assert_eq!(
        resolve_thread_count(Some(invalid.to_string()), DEFAULT, MAXIMUM),
        DEFAULT,
        "input={invalid:?}"
      );
    }
    // Unset falls back to the default.
    assert_eq!(resolve_thread_count(None, DEFAULT, MAXIMUM), DEFAULT);
    // Host-derived defaults are subject to the same production ceiling.
    assert_eq!(resolve_thread_count(None, 32, MAXIMUM), MAXIMUM);
  }

  #[test]
  #[should_panic(expected = "the default thread count must be positive")]
  fn resolve_thread_count_rejects_an_invalid_default() {
    let _ = resolve_thread_count(None, 0, 1);
  }

  #[test]
  #[should_panic(expected = "the maximum thread count must be positive")]
  fn resolve_thread_count_rejects_an_invalid_maximum() {
    let _ = resolve_thread_count(None, 1, 0);
  }

  #[test]
  fn resolve_drain_linger_handles_env_inputs() {
    let fallback = Duration::from_micros(DEFAULT_DRAIN_LINGER_MICROS);
    let ceiling = Duration::from_micros(MAX_DRAIN_LINGER_MICROS);
    // Valid values pass through unchanged.
    assert_eq!(
      resolve_drain_linger(Some("250".to_string()), fallback),
      Duration::from_micros(250)
    );
    // `0` disables lingering (it is a VALUE here, unlike thread counts).
    assert_eq!(
      resolve_drain_linger(Some("0".to_string()), fallback),
      Duration::ZERO
    );
    // u64::MAX -- the exact value that used to wedge the suite through the
    // removed first-drainer OnceLock -- clamps to the ceiling.
    assert_eq!(
      resolve_drain_linger(Some(u64::MAX.to_string()), fallback),
      ceiling
    );
    // Parse overflow is invalid input and keeps the host-provided field.
    assert_eq!(
      resolve_drain_linger(Some("18446744073709551616".to_string()), fallback),
      fallback
    );
    // Non-numeric and unset keep the host-provided field.
    assert_eq!(
      resolve_drain_linger(Some("abc".to_string()), fallback),
      fallback
    );
    assert_eq!(resolve_drain_linger(None, fallback), fallback);
    // Whitespace is tolerated, matching the removed in-scheduler parse.
    assert_eq!(
      resolve_drain_linger(Some(" 750 ".to_string()), fallback),
      Duration::from_micros(750)
    );
    // An out-of-range host fallback is bounded too.
    assert_eq!(
      resolve_drain_linger(None, Duration::from_micros(u64::MAX)),
      ceiling
    );
  }
}
