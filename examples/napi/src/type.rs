use napi::{
  bindgen_prelude::{Either, Function, Promise},
  threadsafe_function::ThreadsafeFunction,
  Result, Status,
};
use std::sync::Arc;

#[napi]
pub type CustomU32 = u32;

#[napi]
pub type MyPromise = Either<String, Promise<String>>;

#[napi]
pub type Nullable<T> = Option<T>;

#[napi(js_name = "VoidNullable<T = void>")]
pub type VoidNullable<T> = Nullable<T>;

#[napi]
pub type RuleHandler<'a, Args, Ret> = Function<'a, Args, Ret>;

#[napi(object, object_to_js = false)]
pub struct Rule<'a> {
  pub name: String,
  pub handler: RuleHandler<'a, u32, u32>,
}

#[napi]
pub fn call_rule_handler(rule: Rule, arg: u32) -> Result<u32> {
  rule.handler.call(arg)
}

#[napi(object)]
pub struct PluginLoadResult {
  pub name: String,
  pub version: String,
}

// Test fixture for ThreadsafeFunction with single argument (issue #2726)
#[napi]
pub type ExternalLinterLoadPluginCb =
  Arc<ThreadsafeFunction<String, PluginLoadResult, String, Status, false>>;

#[napi]
#[allow(unused_parens)]
pub type ExternalLinterLoadPluginCb2 =
  Arc<ThreadsafeFunction<(String), PluginLoadResult, (String), Status, false>>;

// Test fixtures for format_js_property_name function
// These test that property names are correctly quoted/unquoted in TypeScript definitions

#[napi(object)]
pub struct PropertyNameUnicodeTest {
  /// Unicode characters should NOT be quoted
  #[napi(js_name = "café")]
  pub cafe: String,
  #[napi(js_name = "日本語")]
  pub japanese: String,
  #[napi(js_name = "Ελληνικά")]
  pub greek: String,
}

#[napi(object)]
pub struct PropertyNameSpecialCharsTest {
  /// Special characters should be quoted
  #[napi(js_name = "kebab-case")]
  pub kebab_case: String,
  #[napi(js_name = "with space")]
  pub with_space: String,
  #[napi(js_name = "dot.notation")]
  pub dot_notation: String,
  #[napi(js_name = "xml:lang")]
  pub xml_lang: String,
  /// Dollar sign should be quoted for backward compatibility
  #[napi(js_name = "$var")]
  pub dollar_var: String,
}

#[napi(object)]
pub struct PropertyNameValidTest {
  /// Valid identifiers should NOT be quoted
  pub camelCase: String,
  #[allow(non_snake_case)]
  pub PascalCase: String,
  pub _private: String,
  pub with123numbers: String,
}

#[napi(object)]
pub struct PropertyNameDigitTest {
  /// Property names starting with digits should be quoted
  #[napi(js_name = "0invalid")]
  pub zero_invalid: String,
  #[napi(js_name = "123")]
  pub one_two_three: String,
}
