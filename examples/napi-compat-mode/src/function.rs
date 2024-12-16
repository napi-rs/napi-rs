use napi::{
  bindgen_prelude::{FnArgs, Function},
  CallContext, JsError, JsNull, JsObject, JsString, JsUnknown, Result,
};

#[js_function(1)]
pub fn call_function(ctx: CallContext) -> Result<JsNull> {
  let js_func = ctx.get::<Function<FnArgs<(JsUnknown, JsUnknown)>>>(0)?;
  let js_string_hello = ctx.env.create_string("hello".as_ref())?.into_unknown();
  let js_string_world = ctx.env.create_string("world".as_ref())?.into_unknown();

  js_func.call((js_string_hello, js_string_world).into())?;

  ctx.env.get_null()
}

#[js_function(1)]
pub fn call_function_with_ref_arguments(ctx: CallContext) -> Result<JsNull> {
  let js_func = ctx.get::<Function<FnArgs<(JsString, JsString)>>>(0)?;
  let js_string_hello = ctx.env.create_string("hello".as_ref())?;
  let js_string_world = ctx.env.create_string("world".as_ref())?;

  js_func.call((js_string_hello, js_string_world).into())?;

  ctx.env.get_null()
}

#[js_function(1)]
pub fn call_function_with_this(ctx: CallContext) -> Result<JsNull> {
  let js_this: JsObject = ctx.this_unchecked();
  let js_func = ctx.get::<Function<()>>(0)?;

  js_func.apply(js_this, ())?;

  ctx.env.get_null()
}

#[js_function(2)]
pub fn call_function_error(ctx: CallContext) -> Result<JsUnknown> {
  let js_func = ctx.get::<Function<()>>(0)?;
  let error_func = ctx.get::<Function>(1)?;

  match js_func.call(()) {
    Ok(v) => Ok(v),
    Err(e) => error_func.call(JsError::from(e).into_unknown(*ctx.env)),
  }
}

#[js_function(0)]
pub fn test_create_function_from_closure(ctx: CallContext) -> Result<Function<u32, String>> {
  ctx
    .env
    .create_function_from_closure("functionFromClosure", move |ctx| {
      if ctx.length() != 0 {
        let args = ctx.arguments::<u32>()?;
        let max = args.last().unwrap();
        assert_eq!(*max, ctx.length() as u32 - 1);
      }
      Ok(format!("arguments length: {}", ctx.length()))
    })
}

#[js_function(0)]
pub fn test_nest_create_function_from_closure(ctx: CallContext) -> Result<Function<(), ()>> {
  ctx
    .env
    .create_function_from_closure("functionFromClosure", move |ctx| {
      let obj = ctx.first_arg::<JsObject>()?;
      let nest_func: Function<'_, (), ()> =
        ctx
          .env
          .create_function_from_closure("nestFunctionFromClosure", move |_ctx| {
            println!("nest function");
            Ok(())
          })?;

      let on_handle =
        obj.get_named_property::<Function<FnArgs<(String, Function<(), ()>)>, ()>>("on")?;
      let handle_name = String::from("on");
      on_handle.call((handle_name, nest_func).into())?;
      Ok(())
    })
}

pub fn register_js(exports: &mut JsObject) -> Result<()> {
  exports.create_named_method("testCallFunction", call_function)?;
  exports.create_named_method(
    "testCallFunctionWithRefArguments",
    call_function_with_ref_arguments,
  )?;
  exports.create_named_method("testCallFunctionWithThis", call_function_with_this)?;
  exports.create_named_method("testCallFunctionError", call_function_error)?;
  exports.create_named_method(
    "testCreateFunctionFromClosure",
    test_create_function_from_closure,
  )?;
  exports.create_named_method(
    "testNestCreateFunctionFromClosure",
    test_nest_create_function_from_closure,
  )?;
  Ok(())
}
