use napi::bindgen_prelude::*;

#[macro_use]
extern crate napi_macro;

#[napi]
pub enum Kind {
  Dog,
  Cat = 2,
  Duck,
}

#[napi(constructor)]
pub struct Animal {
  #[napi(readonly)]
  pub kind: Kind,

  #[napi(skip)]
  pub name: String,
}

#[napi]
impl Animal {
  #[napi]
  pub fn get_kind(&self) -> Kind {
    self.kind
  }

  #[napi(getter = name)]
  pub fn get_name(&self) -> String {
    get_animal_name(self)
  }

  #[napi(setter = name)]
  pub fn set_name(&mut self, name: String) {
    update_animal_name(self, name);
  }
}

#[napi]
pub fn get_animal_name(animal: &Animal) -> String {
  animal.name.clone()
}

#[napi]
pub fn update_animal_name(animal: &mut Animal, name: String) {
  animal.name = name;
}

#[napi]
pub fn test(a: i32) {
  println!("{}", a);
}
