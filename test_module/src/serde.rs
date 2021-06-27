use napi::{CallContext, JsObject, JsString, JsUndefined, JsUnknown, Result};

use serde_json::{from_str, to_string};

#[derive(Serialize, Debug, Deserialize)]
struct AnObject {
  a: u32,
  b: Vec<f64>,
  c: String,
}

#[derive(Serialize, Debug, Deserialize, Eq, PartialEq)]
struct Inner;

#[derive(Serialize, Debug, Deserialize, Eq, PartialEq)]
struct Inner2(i32, bool, String);

#[derive(Serialize, Debug, Deserialize, Eq, PartialEq)]
enum TypeEnum {
  Empty,
  Tuple(u32, String),
  Struct { a: u8, b: Vec<u8> },
  Value(Vec<char>),
}

#[derive(Serialize, Debug, Deserialize, PartialEq)]
struct AnObjectTwo {
  a: u32,
  b: Vec<i64>,
  c: String,
  d: Option<bool>,
  e: Option<bool>,
  f: Inner,
  g: Inner2,
  h: char,
  i: TypeEnum,
  j: TypeEnum,
  k: TypeEnum,
  l: String,
  m: Vec<u8>,
  o: TypeEnum,
  p: Vec<f64>,
  q: u128,
  r: i128,
}

#[derive(Serialize, Debug, Deserialize)]
struct BytesObject<'a> {
  #[serde(with = "serde_bytes")]
  code: &'a [u8],
  map: String,
}

macro_rules! make_test {
  ($name:ident, $val:expr) => {
    #[js_function]
    fn $name(ctx: CallContext) -> Result<JsUnknown> {
      let value = $val;
      ctx.env.to_js_value(&value)
    }
  };
}

make_test!(make_num_77, 77i32);
make_test!(make_num_32, 32u8);
make_test!(make_str_hello, "Hello World");
make_test!(make_num_array, vec![0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
make_test!(
  make_obj,
  AnObject {
    a: 1,
    b: vec![0.1f64, 1.1, 2.2, 3.3],
    c: "Hi".into(),
  }
);
make_test!(make_map, {
  use std::collections::HashMap;
  let mut map = HashMap::new();
  map.insert("a", 1);
  map.insert("b", 2);
  map.insert("c", 3);
  map
});

make_test!(make_object, {
  AnObjectTwo {
    a: 1,
    b: vec![1, 2],
    c: "abc".into(),
    d: Some(false),
    e: None,
    f: Inner,
    g: Inner2(9, false, "efg".into()),
    h: '🤷',
    i: TypeEnum::Empty,
    j: TypeEnum::Tuple(27, "hij".into()),
    k: TypeEnum::Struct {
      a: 128,
      b: vec![9, 8, 7],
    },
    l: "jkl".into(),
    m: vec![0, 1, 2, 3, 4],
    o: TypeEnum::Value(vec!['z', 'y', 'x']),
    p: vec![1., 2., 3.5],
    q: 9998881288248882845242411222333,
    r: -3332323888900001232323022221345,
  }
});

const NUMBER_BYTES: &[u8] = &[255u8, 254, 253];

make_test!(make_buff, { serde_bytes::Bytes::new(NUMBER_BYTES) });

make_test!(make_bytes_struct, {
  BytesObject {
    code: &[0, 1, 2, 3],
    map: "source map".to_owned(),
  }
});

make_test!(make_empty_enum, TypeEnum::Empty);
make_test!(make_tuple_enum, TypeEnum::Tuple(1, "2".to_owned()));
make_test!(
  make_struct_enum,
  TypeEnum::Struct {
    a: 127,
    b: vec![1, 2, 3]
  }
);
make_test!(make_value_enum, TypeEnum::Value(vec!['a', 'b', 'c']));

macro_rules! make_expect {
  ($name:ident, $val:expr, $val_type:ty) => {
    #[js_function(1)]
    fn $name(ctx: CallContext) -> Result<JsUndefined> {
      let value = $val;
      let arg0 = ctx.get::<JsUnknown>(0)?;

      let de_serialized: $val_type = ctx.env.from_js_value(arg0)?;
      assert_eq!(value, de_serialized);
      ctx.env.get_undefined()
    }
  };
}

make_expect!(expect_hello_world, "hello world", String);

make_expect!(
  expect_obj,
  AnObjectTwo {
    a: 1,
    b: vec![1, 2],
    c: "abc".into(),
    d: Some(false),
    e: None,
    f: Inner,
    g: Inner2(9, false, "efg".into()),
    h: '🤷',
    i: TypeEnum::Empty,
    j: TypeEnum::Tuple(27, "hij".into()),
    k: TypeEnum::Struct {
      a: 128,
      b: vec![9, 8, 7],
    },
    l: "jkl".into(),
    m: vec![0, 1, 2, 3, 4],
    o: TypeEnum::Value(vec!['z', 'y', 'x']),
    p: vec![1., 2., 3.5],
    q: 9998881288248882845242411222333,
    r: -3332323888900001232323022221345,
  },
  AnObjectTwo
);

make_expect!(expect_num_array, vec![0, 1, 2, 3], Vec<i32>);

make_expect!(
  expect_buffer,
  serde_bytes::ByteBuf::from(vec![252u8, 251, 250]),
  serde_bytes::ByteBuf
);

#[js_function(1)]
fn roundtrip_object(ctx: CallContext) -> Result<JsUnknown> {
  let arg0 = ctx.get::<JsObject>(0)?;

  let de_serialized: AnObjectTwo = ctx.env.from_js_value(arg0)?;
  ctx.env.to_js_value(&de_serialized)
}

#[js_function(1)]
fn from_json_string(ctx: CallContext) -> Result<JsUnknown> {
  let arg0 = ctx.get::<JsString>(0)?.into_utf8()?;

  let de_serialized: AnObject = from_str(arg0.as_str()?)?;
  ctx.env.to_js_value(&de_serialized)
}

#[js_function(1)]
fn json_to_string(ctx: CallContext) -> Result<JsString> {
  let arg0 = ctx.get::<JsObject>(0)?;

  let de_serialized: AnObject = ctx.env.from_js_value(arg0)?;
  let json_string = to_string(&de_serialized)?;
  ctx.env.create_string_from_std(json_string)
}

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("make_num_77", make_num_77)?;
  exports.create_named_method("make_num_32", make_num_32)?;
  exports.create_named_method("make_str_hello", make_str_hello)?;
  exports.create_named_method("make_num_array", make_num_array)?;
  exports.create_named_method("make_buff", make_buff)?;
  exports.create_named_method("make_obj", make_obj)?;
  exports.create_named_method("make_object", make_object)?;
  exports.create_named_method("make_map", make_map)?;
  exports.create_named_method("make_bytes_struct", make_bytes_struct)?;

  exports.create_named_method("make_empty_enum", make_empty_enum)?;
  exports.create_named_method("make_tuple_enum", make_tuple_enum)?;
  exports.create_named_method("make_struct_enum", make_struct_enum)?;
  exports.create_named_method("make_value_enum", make_value_enum)?;

  exports.create_named_method("expect_hello_world", expect_hello_world)?;
  exports.create_named_method("expect_obj", expect_obj)?;
  exports.create_named_method("expect_num_array", expect_num_array)?;
  exports.create_named_method("expect_buffer", expect_buffer)?;

  exports.create_named_method("roundtrip_object", roundtrip_object)?;
  exports.create_named_method("from_json_string", from_json_string)?;
  exports.create_named_method("json_to_string", json_to_string)?;
  Ok(())
}
