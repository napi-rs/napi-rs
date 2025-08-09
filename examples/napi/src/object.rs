use napi::{bindgen_prelude::*, threadsafe_function::ThreadsafeFunction, JsGlobal, Result};

#[napi]
fn list_obj_keys(obj: Object) -> Vec<String> {
  Object::keys(&obj).unwrap()
}

#[napi]
fn create_obj(env: &Env) -> Object<'_> {
  let mut obj = Object::new(env).unwrap();
  obj.set("test", 1).unwrap();

  obj
}

#[napi]
fn get_global(env: &Env) -> Result<JsGlobal<'_>> {
  env.get_global()
}

#[napi]
fn get_undefined() -> Result<()> {
  Ok(())
}

#[napi]
fn get_null() -> Null {
  Null
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
pub fn get_str_from_object(env: &Env) {
  let mut obj = Object::new(env).unwrap();
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
pub fn create_obj_with_property(env: &Env) -> Result<Object<'_>> {
  let mut obj = Object::new(env)?;
  let arraybuffer = ArrayBuffer::from_data(env, vec![0; 10])?;
  obj.define_properties(&[
    Property::new()
      .with_utf8_name("value")?
      .with_value(&arraybuffer),
    Property::new()
      .with_utf8_name("getter")?
      .with_getter(getter_from_obj_c_callback),
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
pub struct TupleObject(#[napi(js_name = "customField")] pub u32, pub u32);

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
pub fn generate_function_and_call_it(env: &Env) -> Result<FunctionData<'_>> {
  let handle = env.create_function_from_closure("handle_function", |_ctx| Ok(1))?;
  Ok(FunctionData { handle })
}

#[napi]
pub fn get_null_byte_property(obj: Object) -> Result<Option<String>> {
  obj.get::<String>("\0virtual")
}

#[napi]
pub fn set_null_byte_property(mut obj: Object) -> Result<()> {
  obj.set("\0virtual", "test")
}

#[napi(object, object_to_js = false)]
pub struct ViteImportGlobMeta {
  pub is_sub_imports_pattern: Option<bool>,
}

#[napi(object, object_to_js = false)]
pub struct BindingVitePluginMeta {
  #[napi(js_name = "vite:import-glob")]
  pub vite_import_glob: ViteImportGlobMeta,
}

#[napi]
pub fn receive_binding_vite_plugin_meta(meta: BindingVitePluginMeta) {
  assert_eq!(meta.vite_import_glob.is_sub_imports_pattern, Some(true));
}

#[napi]
pub fn create_object_ref(env: &Env) -> Result<ObjectRef> {
  let mut obj = Object::new(env)?;
  obj.set("test", 1)?;
  obj.create_ref()
}

#[napi]
pub fn object_with_c_apis(env: &Env) -> Result<Object<'_>> {
  let mut obj = Object::new(env)?;
  obj.set_c_named_property(c"test", 1)?;
  assert_eq!(obj.get_c_named_property::<u32>(c"test")?, 1);
  assert!(obj.has_c_named_property(c"test")?);
  assert!(obj.delete_c_named_property(c"test")?);
  assert!(!obj.has_c_own_property(c"test")?);
  obj.create_c_named_method(c"test", test_method_c_callback)?;
  Ok(obj)
}

#[napi(no_export)]
fn test_method() -> u32 {
  42
}

#[napi(object)]
#[derive(Default, Debug)]
pub struct CompilerAssumptions {
  pub ignore_function_length: Option<bool>,
  pub no_document_all: Option<bool>,
  pub object_rest_no_symbols: Option<bool>,
  pub pure_getters: Option<bool>,
  /// When using public class fields, assume that they don't shadow any getter in the current class,
  /// in its subclasses or in its superclass. Thus, it's safe to assign them rather than using
  /// `Object.defineProperty`.
  ///
  /// For example:
  ///
  /// Input:
  /// ```js
  /// class Test {
  ///   field = 2;
  ///
  ///   static staticField = 3;
  /// }
  /// ```
  ///
  /// When `set_public_class_fields` is `true`, the output will be:
  /// ```js
  /// class Test {
  ///   constructor() {
  ///     this.field = 2;
  ///   }
  /// }
  /// Test.staticField = 3;
  /// ```
  ///
  /// Otherwise, the output will be:
  /// ```js
  /// import _defineProperty from "@oxc-project/runtime/helpers/defineProperty";
  /// class Test {
  ///   constructor() {
  ///     _defineProperty(this, "field", 2);
  ///   }
  /// }
  /// _defineProperty(Test, "staticField", 3);
  /// ```
  ///
  /// NOTE: For TypeScript, if you wanted behavior is equivalent to `useDefineForClassFields: false`, you should
  /// set both `set_public_class_fields` and [`crate::TypeScriptOptions::remove_class_fields_without_initializer`]
  /// to `true`.
  pub set_public_class_fields: Option<bool>,
}
