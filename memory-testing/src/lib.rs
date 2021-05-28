#[macro_use]
extern crate napi_derive;
#[macro_use]
extern crate serde_derive;

#[derive(Serialize, Deserialize)]
pub struct Welcome {
  id: String,
  name: String,
  forename: String,
  description: String,
  email: String,
  phone: String,
  #[serde(rename = "arrivalDate")]
  arrival_date: i64,
  #[serde(rename = "departureDate")]
  departure_date: i64,
  price: i64,
  advance: i64,
  #[serde(rename = "advanceDueDate")]
  advance_due_date: i64,
  kids: i64,
  adults: i64,
  status: String,
  nourishment: String,
  #[serde(rename = "createdAt")]
  created_at: String,
  room: Room,
}

#[derive(Serialize, Deserialize)]
pub struct Room {
  id: String,
  name: String,
}

#[js_function]
fn test_async(ctx: napi::CallContext) -> napi::Result<napi::JsObject> {
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

  ctx.env.execute_tokio_future(
    async move { Ok(serde_json::to_string(&data).unwrap()) },
    |env, response| {
      env.adjust_external_memory(response.len() as i64)?;
      env.create_string_from_std(response)
    },
  )
}

#[js_function(1)]
fn from_js(ctx: napi::CallContext) -> napi::Result<napi::JsString> {
  let input_object = ctx.get::<napi::JsObject>(0)?;
  let a: Welcome = ctx.env.from_js_value(&input_object)?;
  ctx.env.create_string_from_std(serde_json::to_string(&a)?)
}

#[module_exports]
fn init(mut exports: napi::JsObject) -> napi::Result<()> {
  exports.create_named_method("testAsync", test_async)?;
  exports.create_named_method("convertFromJS", from_js)?;
  Ok(())
}
