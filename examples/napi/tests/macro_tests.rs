// `error_try_builds` is not really a feature.
// This is used just to make the test files part of the crate so that they can get included by things
// like `cargo fmt` for example, BUT not be part of compilation when running `cargo test`.
#[cfg(feature = "error_try_builds")]
mod build_error_tests;

#[test]
fn run_build_error_tests() {
  let t = trybuild::TestCases::new();
  t.compile_fail("tests/build_error_tests/ts_arg_type_*.rs");
}
