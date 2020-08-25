use napi::{CallContext, JsObject, JsUndefined, JsUnknown, Module, Result};

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
  let value = AnObjectTwo {
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
  };
  value
});

const NUMBER_BYTES: &'static [u8] = &[255u8, 254, 253];

make_test!(make_buff, { serde_bytes::Bytes::new(NUMBER_BYTES) });

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

pub fn register_serde_func(m: &mut Module) -> Result<()> {
  m.create_named_method("make_num_77", make_num_77)?;
  m.create_named_method("make_num_32", make_num_32)?;
  m.create_named_method("make_str_hello", make_str_hello)?;
  m.create_named_method("make_num_array", make_num_array)?;
  m.create_named_method("make_buff", make_buff)?;
  m.create_named_method("make_obj", make_obj)?;
  m.create_named_method("make_object", make_object)?;
  m.create_named_method("make_map", make_map)?;

  m.create_named_method("expect_hello_world", expect_hello_world)?;
  m.create_named_method("expect_obj", expect_obj)?;
  m.create_named_method("expect_num_array", expect_num_array)?;
  m.create_named_method("expect_buffer", expect_buffer)?;

  m.create_named_method("roundtrip_object", roundtrip_object)?;
  Ok(())
}
