use napi::{
  bindgen_prelude::{Either, Function, Promise},
  Result,
};

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
