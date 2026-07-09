// `error_try_builds` is not really a feature.
// This is used just to make the test files part of the crate so that they can get included by things
// like `cargo fmt` for example, BUT not be part of compilation when running `cargo test`.
#[cfg(feature = "error_try_builds")]
mod build_error_tests;

#[test]
#[ignore = "compiler-version-specific diagnostics; run in the dedicated stable Linux CI job"]
fn run_macro_build_tests() {
  let t = trybuild::TestCases::new();
  t.compile_fail("tests/build_error_tests/ts_arg_type_*.rs");
  t.compile_fail("tests/build_error_tests/fn_outside_impl_factory.rs");
  t.compile_fail("tests/build_error_tests/assign_js_value_to_class.rs");
  t.compile_fail("tests/build_error_tests/tsfn_thread_safety_1.rs");
  t.compile_fail("tests/build_error_tests/tsfn_thread_safety_2.rs");
  t.compile_fail("tests/build_error_tests/tsfn_thread_safety_3.rs");
  t.compile_fail("tests/build_error_tests/tsfn_thread_safety_4.rs");
  t.compile_fail("tests/build_error_tests/tsfn_thread_safety_5.rs");
  t.compile_fail("tests/build_error_tests/external_ref_*.rs");
  t.compile_fail("tests/build_error_tests/reference_family_mutability.rs");
  t.compile_fail("tests/build_error_tests/reference_family_share_with.rs");
  t.compile_fail("tests/build_error_tests/unsafe_api_migrations.rs");
  t.compile_fail("tests/build_error_tests/native_borrow_scope.rs");
  t.pass("tests/build_error_tests/tsfn_thread_safety_6.rs");
  t.compile_fail("tests/build_error_tests/tsfn_raw_api_*.rs");
  t.compile_fail("tests/build_error_tests/class_reference_field_*.rs");
  t.compile_fail("tests/build_error_tests/promise_raw_callback_lifetime_*.rs");
}
