use std::cell::RefCell;

use napi::{
  bindgen_prelude::{BigInt, Function, JsObjectValue, Null, Object, Unknown},
  Env, Error, Property, Result, Status,
};

thread_local! {
  static STASHED_SINGLE: RefCell<Option<Property>> = const { RefCell::new(None) };
  static STASHED_LIST: RefCell<Vec<Property>> = const { RefCell::new(Vec::new()) };
  static STASHED_UNTIL_EXIT: RefCell<Vec<Property>> = const { RefCell::new(Vec::new()) };
}

fn churn_handle_slots(env: &Env) -> Result<()> {
  for i in 0..64 {
    let _ = env.create_string(&format!("overwrite-{i}"))?;
  }
  Ok(())
}

/// Exact #3697 repro: stashes a `Property` built with `with_value` across
/// HandleScope boundaries.
#[napi]
pub fn stash_property_value(secret: Unknown<'_>) -> Result<()> {
  let prop = Property::new()
    .with_utf8_name("secret")?
    .with_value(&secret);
  STASHED_SINGLE.with(|cell| {
    *cell.borrow_mut() = Some(prop);
  });
  Ok(())
}

/// Applies the stashed single `Property` after allocating 64 fresh strings in
/// this callback to overwrite reused V8 handle slots.
#[napi]
pub fn apply_stashed_property_value(env: &Env, mut target: Object<'_>) -> Result<()> {
  churn_handle_slots(env)?;
  let prop = STASHED_SINGLE.with(|cell| cell.borrow().clone());
  let Some(prop) = prop else {
    return Err(Error::new(
      Status::GenericFailure,
      "No stashed property available",
    ));
  };
  target.define_properties(&[prop])
}

/// Clones the stashed single `Property` and reuses it across two objects
/// (`define_properties`) and two classes (`Env::define_class`).
#[napi(
  ts_return_type = "[Record<string, unknown>, Record<string, unknown>, new () => Record<string, unknown>, new () => Record<string, unknown>]"
)]
pub fn reuse_stashed_property_on_objects_and_classes<'env>(
  env: &'env Env,
) -> Result<(Object<'env>, Object<'env>, Function<'env>, Function<'env>)> {
  churn_handle_slots(env)?;
  let prop = STASHED_SINGLE.with(|cell| cell.borrow().clone());
  let Some(prop) = prop else {
    return Err(Error::new(
      Status::GenericFailure,
      "No stashed property available",
    ));
  };
  let cloned = prop.clone();

  let mut obj1 = Object::new(env)?;
  obj1.define_properties(&[prop])?;
  let mut obj2 = Object::new(env)?;
  obj2.define_properties(&[cloned.clone()])?;

  let class1 = env.define_class(
    "StashedPropClassA",
    property_retention_ctor_c_callback,
    &[cloned.clone()],
  )?;
  let class2 = env.define_class(
    "StashedPropClassB",
    property_retention_ctor_c_callback,
    &[cloned],
  )?;

  Ok((obj1, obj2, class1, class2))
}

/// Stashes `Property` descriptors built with `with_napi_value` covering all
/// primitive types as well as objects, functions, and symbols.
#[napi]
pub fn stash_properties_with_napi_values(
  env: &Env,
  obj: Unknown<'_>,
  func: Unknown<'_>,
  sym: Unknown<'_>,
) -> Result<()> {
  let props = vec![
    Property::new()
      .with_utf8_name("str")?
      .with_napi_value(env, "retained string".to_owned())?,
    Property::new()
      .with_utf8_name("num")?
      .with_napi_value(env, 42.5_f64)?,
    Property::new()
      .with_utf8_name("bool")?
      .with_napi_value(env, true)?,
    Property::new()
      .with_utf8_name("nil")?
      .with_napi_value(env, Null)?,
    Property::new()
      .with_utf8_name("undef")?
      .with_napi_value(env, ())?,
    Property::new()
      .with_utf8_name("bigint")?
      .with_napi_value(env, BigInt::from(9007199254740993_i64))?,
    Property::new()
      .with_utf8_name("obj")?
      .with_napi_value(env, obj)?,
    Property::new()
      .with_utf8_name("func")?
      .with_napi_value(env, func)?,
    Property::new()
      .with_utf8_name("sym")?
      .with_napi_value(env, sym)?,
  ];
  STASHED_LIST.with(|cell| {
    *cell.borrow_mut() = props;
  });
  Ok(())
}

/// Stashes `Property` descriptors using `with_name` for string and symbol keys,
/// plus runtime key replacement (`with_name` -> `with_utf8_name` and vice versa).
#[napi]
pub fn stash_properties_with_names(
  env: &Env,
  str_key: Unknown<'_>,
  sym_key: Unknown<'_>,
  str_val: Unknown<'_>,
  sym_val: Unknown<'_>,
) -> Result<()> {
  let props = vec![
    Property::new()
      .with_name(env, str_key)?
      .with_value(&str_val),
    Property::new()
      .with_name(env, sym_key)?
      .with_value(&sym_val),
    Property::new()
      .with_name(env, "discardedName")?
      .with_utf8_name("replacedUtf8")?
      .with_napi_value(env, "fromUtf8".to_owned())?,
    Property::new()
      .with_utf8_name("discardedUtf8")?
      .with_name(env, "replacedName")?
      .with_napi_value(env, "fromName".to_owned())?,
  ];
  STASHED_LIST.with(|cell| {
    *cell.borrow_mut() = props;
  });
  Ok(())
}

/// Applies the stashed property list to `target` after churning handle slots.
#[napi]
pub fn apply_stashed_properties(env: &Env, mut target: Object<'_>) -> Result<()> {
  churn_handle_slots(env)?;
  let props = STASHED_LIST.with(|cell| cell.borrow().clone());
  target.define_properties(&props)
}

/// Clears the stashed properties on the current thread so their retained
/// `napi_ref`s are released while the environment is live.
#[napi]
pub fn clear_stashed_properties() {
  STASHED_SINGLE.with(|cell| {
    *cell.borrow_mut() = None;
  });
  STASHED_LIST.with(|cell| {
    cell.borrow_mut().clear();
  });
}

/// Stashes properties (primitive value, object value, string key, symbol key)
/// in a `thread_local!` that is intentionally left populated until worker or
/// process exit to verify teardown safety.
#[napi]
pub fn stash_properties_until_exit(env: &Env, obj: Unknown<'_>, sym: Unknown<'_>) -> Result<()> {
  let props = vec![
    Property::new()
      .with_utf8_name("prim")?
      .with_napi_value(env, "kept until exit".to_owned())?,
    Property::new().with_utf8_name("obj")?.with_value(&obj),
    Property::new()
      .with_name(env, "stringKey")?
      .with_napi_value(env, 123_u32)?,
    Property::new()
      .with_name(env, sym)?
      .with_napi_value(env, "symbolValue".to_owned())?,
  ];
  STASHED_UNTIL_EXIT.with(|cell| {
    cell.borrow_mut().extend(props);
  });
  Ok(())
}

/// Triggers a pending JS exception before `with_value`, stashes the resulting
/// `Property`, and returns `Err(PendingException)` so JS catches the exception.
/// Later applying the stashed `Property` must not replay a stale
/// `PendingException` status after the exception has been cleared.
#[napi]
pub fn stash_property_value_during_pending_exception(env: &Env, secret: Unknown<'_>) -> Result<()> {
  env.throw_error("pending before with_value", None)?;
  let prop = Property::new()
    .with_utf8_name("secret")?
    .with_value(&secret);
  STASHED_SINGLE.with(|cell| {
    *cell.borrow_mut() = Some(prop);
  });
  Err(Error::new(
    Status::PendingException,
    "pending exception triggered",
  ))
}

#[napi(no_export)]
fn property_retention_ctor() {}
