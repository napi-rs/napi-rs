use napi::{
  bindgen_prelude::{Buffer, ClassInstance, This, Uint8Array},
  Env, Result,
};

use crate::r#enum::Kind;

/// `constructor` option for `struct` requires all fields to be public,
/// otherwise tag impl fn as constructor
/// #[napi(constructor)]
#[napi]
pub struct Animal {
  #[napi(readonly)]
  /// Kind of animal
  pub kind: Kind,

  name: String,
}

#[napi]
impl Animal {
  /// This is the constructor
  #[napi(constructor)]
  pub fn new(kind: Kind, name: String) -> Self {
    Animal { kind, name }
  }

  /// This is a factory method
  #[napi(factory)]
  pub fn with_kind(kind: Kind) -> Self {
    Animal {
      kind,
      name: "Default".to_owned(),
    }
  }

  #[napi(getter)]
  pub fn get_name(&self) -> &str {
    self.name.as_str()
  }

  #[napi(setter)]
  pub fn set_name(&mut self, name: String) {
    self.name = name;
  }

  #[napi(getter, js_name = "type")]
  pub fn kind(&self) -> Kind {
    self.kind
  }

  #[napi(setter, js_name = "type")]
  pub fn set_kind(&mut self, kind: Kind) {
    self.kind = kind;
  }

  /// This is a
  /// multi-line comment
  /// with an emoji 🚀
  #[napi]
  pub fn whoami(&self) -> String {
    match self.kind {
      Kind::Dog => {
        format!("Dog: {}", self.name)
      }
      Kind::Cat => format!("Cat: {}", self.name),
      Kind::Duck => format!("Duck: {}", self.name),
    }
  }

  #[napi]
  /// This is static...
  pub fn get_dog_kind() -> Kind {
    Kind::Dog
  }

  #[napi]
  /// Here are some characters and character sequences
  /// that should be escaped correctly:
  /// \[]{}/\:""
  pub fn return_other_class(&self) -> Dog {
    Dog {
      name: "Doge".to_owned(),
    }
  }

  #[napi]
  pub fn return_other_class_with_custom_constructor(&self) -> Bird {
    Bird::new("parrot".to_owned())
  }

  #[napi]
  pub fn override_individual_arg_on_method(
    &self,
    normal_ty: String,
    #[napi(ts_arg_type = "{n: string}")] overridden_ty: napi::JsObject,
  ) -> Bird {
    let obj = overridden_ty.coerce_to_object().unwrap();
    let the_n: Option<String> = obj.get("n").unwrap();

    Bird::new(format!("{}-{}", normal_ty, the_n.unwrap()))
  }
}

#[napi(constructor)]
pub struct Dog {
  pub name: String,
}

#[napi]
pub struct Bird {
  pub name: String,
}

#[napi]
impl Bird {
  #[napi(constructor)]
  pub fn new(name: String) -> Self {
    Bird { name }
  }

  #[napi]
  pub fn get_count(&self) -> u32 {
    1234
  }
}

/// Smoking test for type generation
#[napi]
#[repr(transparent)]
pub struct Blake2bHasher(u32);

#[napi]
impl Blake2bHasher {
  #[napi(factory)]
  pub fn with_key(key: &Blake2bKey) -> Self {
    Blake2bHasher(key.get_inner())
  }
}

#[napi]
impl Blake2bHasher {
  #[napi]
  pub fn update(&mut self, data: Buffer) {
    self.0 += data.len() as u32;
  }
}

#[napi]
pub struct Blake2bKey(u32);

impl Blake2bKey {
  fn get_inner(&self) -> u32 {
    self.0
  }
}

#[napi]
pub struct Context {
  data: String,
  pub maybe_need: Option<bool>,
  pub buffer: Uint8Array,
}

// Test for return `napi::Result` and `Result`
#[napi]
impl Context {
  #[napi(constructor)]
  pub fn new() -> napi::Result<Self> {
    Ok(Self {
      data: "not empty".into(),
      maybe_need: None,
      buffer: Uint8Array::new(vec![0, 1, 2, 3]),
    })
  }

  #[napi(factory)]
  pub fn with_data(data: String) -> Result<Self> {
    Ok(Self {
      data,
      maybe_need: Some(true),
      buffer: Uint8Array::new(vec![0, 1, 2, 3]),
    })
  }

  #[napi(factory)]
  pub fn with_buffer(buf: Uint8Array) -> Self {
    Self {
      data: "not empty".into(),
      maybe_need: None,
      buffer: buf,
    }
  }

  #[napi]
  pub fn method(&self) -> String {
    self.data.clone()
  }
}

#[napi(constructor)]
pub struct AnimalWithDefaultConstructor {
  pub name: String,
  pub kind: u32,
}

// Test for skip_typescript
#[napi]
pub struct NinjaTurtle {
  pub name: String,
  #[napi(skip_typescript)]
  pub mask_color: String,
}

#[napi]
impl NinjaTurtle {
  /// Create your ninja turtle! 🐢
  #[napi(factory)]
  pub fn new_raph() -> Self {
    Self {
      name: "Raphael".to_owned(),
      mask_color: "Red".to_owned(),
    }
  }

  /// We are not going to expose this character, so we just skip it...
  #[napi(factory, skip_typescript)]
  pub fn new_leo() -> Self {
    Self {
      name: "Leonardo".to_owned(),
      mask_color: "Blue".to_owned(),
    }
  }

  #[napi]
  pub fn get_mask_color(&self) -> &str {
    self.mask_color.as_str()
  }

  #[napi]
  pub fn get_name(&self) -> &str {
    self.name.as_str()
  }

  #[napi]
  pub fn return_this(&self, this: This) -> This {
    this
  }
}

#[napi(js_name = "Assets")]
pub struct JsAssets {}

#[napi]
impl JsAssets {
  #[napi(constructor)]
  #[allow(clippy::new_without_default)]
  pub fn new() -> Self {
    JsAssets {}
  }

  #[napi]
  pub fn get(&mut self, _id: u32) -> Option<JsAsset> {
    Some(JsAsset {})
  }
}

#[napi(js_name = "Asset")]
pub struct JsAsset {}

#[napi]
impl JsAsset {
  #[napi(constructor)]
  #[allow(clippy::new_without_default)]
  pub fn new() -> Self {
    Self {}
  }

  #[napi(getter)]
  pub fn get_file_path(&self) -> u32 {
    1
  }
}

#[napi]
pub struct Optional {}

#[napi]
impl Optional {
  #[napi]
  pub fn option_end(required: String, optional: Option<String>) -> String {
    match optional {
      None => required,
      Some(optional) => format!("{} {}", required, optional),
    }
  }

  #[napi]
  pub fn option_start(optional: Option<String>, required: String) -> String {
    match optional {
      None => required,
      Some(optional) => format!("{} {}", optional, required),
    }
  }

  #[napi]
  pub fn option_start_end(
    optional1: Option<String>,
    required: String,
    optional2: Option<String>,
  ) -> String {
    match (optional1, optional2) {
      (None, None) => required,
      (None, Some(optional2)) => format!("{} {}", required, optional2),
      (Some(optional1), None) => format!("{} {}", optional1, required),
      (Some(optional1), Some(optional2)) => format!("{} {} {}", optional1, required, optional2),
    }
  }

  #[napi]
  pub fn option_only(optional: Option<String>) -> String {
    match optional {
      None => "".to_string(),
      Some(optional) => optional,
    }
  }
}

#[napi(object)]
pub struct ObjectFieldClassInstance {
  pub bird: ClassInstance<Bird>,
}

#[napi]
pub fn create_object_with_class_field(env: Env) -> Result<ObjectFieldClassInstance> {
  Ok(ObjectFieldClassInstance {
    bird: Bird {
      name: "Carolyn".to_owned(),
    }
    .into_instance(env)?,
  })
}

#[napi]
pub fn receive_object_with_class_field(
  object: ObjectFieldClassInstance,
) -> Result<ClassInstance<Bird>> {
  Ok(object.bird)
}

#[napi(constructor)]
pub struct NotWritableClass {
  #[napi(writable = false)]
  pub name: String,
}

#[napi]
impl NotWritableClass {
  #[napi(writable = false)]
  pub fn set_name(&mut self, name: String) {
    self.name = name;
  }
}
