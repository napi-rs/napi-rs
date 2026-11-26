use napi_derive::napi;

#[napi(disposable)]
pub fn free_fn() {}

#[napi(disposable)]
pub enum BadEnum {
  A,
}

#[napi(disposable)]
pub const BAD_CONST: u32 = 1;

#[napi(disposable)]
pub type BadType = u32;

#[napi(disposable)]
mod bad_mod {
  #[napi]
  pub fn inner() {}
}

#[napi]
pub struct PlainClass {
  #[napi(disposable)]
  pub bad_field: u32,
}

#[napi(disposable)]
impl PlainClass {}

#[napi]
impl PlainClass {
  #[napi(disposable)]
  pub fn bad_method(&self) {}
}

#[napi(disposable, object)]
pub struct DisposableObject {
  pub a: u32,
}

#[napi(disposable, array)]
pub struct DisposableArray(pub u32);

#[napi(disposable, transparent)]
pub struct DisposableTransparent(pub u32);

#[napi(disposable, iterator)]
pub struct DisposableIterator {}

#[napi(disposable, async_iterator)]
pub struct DisposableAsyncIterator {}

#[napi(disposable)]
pub struct DisposableWithFieldSymbol {
  #[napi(well_known_symbol = "dispose")]
  pub dispose_field: bool,
}

#[napi(disposable)]
pub struct DisposableWithManualMethod {}

#[napi]
impl DisposableWithManualMethod {
  #[napi(well_known_symbol = "dispose")]
  pub fn dispose_method(&self) {}
}

#[napi(disposable)]
pub struct DisposableWithManualGetter {}

#[napi]
impl DisposableWithManualGetter {
  #[napi(getter, well_known_symbol = "dispose")]
  pub fn dispose_getter(&self) -> u32 {
    1
  }
}

#[napi(disposable)]
pub struct DisposableWithManualSetter {}

#[napi]
impl DisposableWithManualSetter {
  #[napi(setter, well_known_symbol = "dispose")]
  pub fn dispose_setter(&mut self, _v: u32) {}
}

fn main() {}
