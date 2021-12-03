use napi::{CallContext, JsExternal, JsObject, JsString};

#[derive(Clone)]
pub struct QueryEngine {
  pub datamodel: String,
}

unsafe impl Sync for QueryEngine {}

impl QueryEngine {
  pub async fn query(&self) -> String {
    let data = serde_json::json!({
      "findFirstBooking": {
        "id": "ckovh15xa104945sj64rdk8oas",
        "name": "1883da9ff9152",
        "forename": "221c99bedc6a4",
        "description": "8bf86b62ce6a",
        "email": "9d57a869661cc",
        "phone": "7e0c58d147215",
        "arrivalDate": -92229669,
        "departureDate": 202138795,
        "price": -1592700387,
        "advance": -369294193,
        "advanceDueDate": 925000428,
        "kids": 520124290,
        "adults": 1160258464,
        "status": "NO_PAYMENT",
        "nourishment": "BB",
        "createdAt": "2021-05-19T12:58:37.246Z",
        "room": { "id": "ckovh15xa104955sj6r2tqaw1c", "name": "38683b87f2664" }
      }
    });

    serde_json::to_string(&data).unwrap()
  }
}

#[js_function(1)]
fn new_engine(ctx: CallContext) -> napi::Result<napi::JsExternal> {
  let a = ctx.get::<JsString>(0)?.into_utf8()?;
  let model = a.into_owned()?;
  let model_len = model.len();
  let qe = QueryEngine { datamodel: model };
  ctx.env.create_external(qe, Some(model_len as i64))
}

#[js_function(1)]
fn query(ctx: CallContext) -> napi::Result<JsObject> {
  let ext = ctx.get::<JsExternal>(0)?;
  let qe = ctx.env.get_value_external::<QueryEngine>(&ext)?;
  let qe = qe.clone();
  ctx
    .env
    .execute_tokio_future(async move { Ok(qe.query().await) }, |env, v| {
      env.create_string_from_std(v)
    })
}

pub fn register_js(exports: &mut JsObject) -> napi::Result<()> {
  exports.create_named_method("engine", new_engine)?;
  exports.create_named_method("query", query)?;
  Ok(())
}
