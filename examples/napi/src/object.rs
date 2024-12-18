use napi::{
  bindgen_prelude::*, threadsafe_function::ThreadsafeFunction, JsGlobal, JsNull, JsObject,
  JsUndefined, Result,
};

#[napi]
fn list_obj_keys(obj: Object) -> Vec<String> {
  Object::keys(&obj).unwrap()
}

#[napi]
fn create_obj(env: Env) -> Object {
  let mut obj = env.create_object().unwrap();
  obj.set("test", 1).unwrap();

  obj
}

#[napi]
fn get_global(env: Env) -> Result<JsGlobal> {
  env.get_global()
}

#[napi]
fn get_undefined(env: Env) -> Result<JsUndefined> {
  env.get_undefined()
}

#[napi]
fn get_null(env: Env) -> Result<JsNull> {
  env.get_null()
}

#[napi(object)]
struct AllOptionalObject {
  pub name: Option<String>,
  pub age: Option<u32>,
}

#[napi]
fn receive_all_optional_object(obj: Option<AllOptionalObject>) -> Result<()> {
  if obj.is_some() {
    assert!(obj.as_ref().unwrap().name.is_none());
    assert!(obj.as_ref().unwrap().age.is_none());
  }
  Ok(())
}

#[napi(js_name = "ALIAS")]
pub enum AliasedEnum {
  A,
  B,
}

#[napi(object, js_name = "AliasedStruct")]
pub struct StructContainsAliasedEnum {
  pub a: AliasedEnum,
  pub b: u32,
}

#[napi]
fn fn_received_aliased(mut s: StructContainsAliasedEnum, e: AliasedEnum) {
  s.a = e;
}

#[napi(object)]
pub struct StrictObject {
  pub name: String,
}

#[napi]
pub fn receive_strict_object(strict_object: StrictObject) {
  assert_eq!(strict_object.name, "strict");
}

#[napi]
pub fn get_str_from_object(env: Env) {
  let mut obj = env.create_object().unwrap();
  obj.set("name", "value").unwrap();
  assert_eq!(obj.get("name").unwrap(), Some("value".to_string()));
}

#[napi(object)]
pub struct TsTypeChanged {
  #[napi(ts_type = "object")]
  pub type_override: String,

  #[napi(ts_type = "object")]
  pub type_override_optional: Option<String>,
}

#[napi(ts_return_type = "{ value: ArrayBuffer, get getter(): number }")]
pub fn create_obj_with_property(env: Env) -> Result<JsObject> {
  let mut obj = env.create_object()?;
  let arraybuffer = env.create_arraybuffer(10)?.into_raw();
  obj.define_properties(&[
    Property::new("value")?.with_value(&arraybuffer),
    Property::new("getter")?.with_getter(get_c_callback(getter_from_obj_js_function)?),
  ])?;
  Ok(obj)
}

#[napi]
fn getter_from_obj() -> u32 {
  42
}

#[napi(object, object_to_js = false)]
struct ObjectOnlyFromJs {
  pub count: u32,
  pub callback: ThreadsafeFunction<u32>,
}

#[napi]
fn receive_object_only_from_js(
  #[napi(ts_arg_type = "{ count: number, callback: (err: Error | null, count: number) => void }")]
  obj: ObjectOnlyFromJs,
) {
  let ObjectOnlyFromJs { callback, count } = obj;
  std::thread::spawn(move || {
    callback.call(
      Ok(count),
      napi::threadsafe_function::ThreadsafeFunctionCallMode::NonBlocking,
    );
  });
}

#[napi(ts_args_type = "obj: { foo: number; bar: string; }")]
fn object_get_named_property_should_perform_typecheck(obj: Object) -> Result<()> {
  obj.get_named_property::<u32>("foo")?;
  obj.get_named_property::<String>("bar")?;
  Ok(())
}

#[napi(object, object_from_js = false)]
struct ObjectOnlyToJs {
  pub name: u32,
  pub dependencies: serde_json::Value,
}

#[napi]
fn return_object_only_to_js() -> ObjectOnlyToJs {
  ObjectOnlyToJs {
    name: 42,
    dependencies: serde_json::json!({ "@napi-rs/cli": "^3.0.0", "rollup": "^4.0.0" }),
  }
}

#[napi(object)]
pub struct TupleObject(pub u32, pub u32);

#[napi(object)]
pub struct Data<'s> {
  pub data: Either<String, BufferSlice<'s>>,
}

#[napi]
pub fn receive_buffer_slice_with_lifetime(data: Data) -> u32 {
  (match data.data {
    Either::A(s) => s.len(),
    Either::B(d) => d.len(),
  }) as u32
}

#[napi(object)]
pub struct FunctionData<'a> {
  pub handle: Function<'a, (), i32>,
}

#[napi]
pub fn generate_function_and_call_it(env: &Env) -> Result<FunctionData> {
  let handle = env.create_function_from_closure("handle_function", |_ctx| Ok(1))?;
  Ok(FunctionData { handle })
}

#[napi]
pub fn get_null_byte_property(obj: JsObject) -> Result<Option<String>> {
  obj.get::<String>("\0virtual")
}

#[napi]
pub fn set_null_byte_property(mut obj: JsObject) -> Result<()> {
  obj.set("\0virtual", "test")
}
