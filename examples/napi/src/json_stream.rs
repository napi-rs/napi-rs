use serde_json::{Value, Deserializer as JsonDeserializer, Map};
use serde::de::{self, DeserializeSeed, Visitor, MapAccess, SeqAccess, IgnoredAny, Deserializer as SerdeDeserializer};
use crate::dynamic_schema::{CompiledField, CompiledSchema, FieldType};

fn validate_value(val: &Value, field: &CompiledField) -> Result<(), String> {
  let ok = match (&field.type_, val) {
    (FieldType::String, Value::String(_)) => true,
    (FieldType::I64, Value::Number(n)) => n.as_i64().is_some(),
    (FieldType::F64, Value::Number(_)) => true,
    (FieldType::Bool, Value::Bool(_)) => true,
    (FieldType::Json, _) => true,
    (FieldType::ArrayString, Value::Array(arr)) => arr.iter().all(|v| v.is_string()),
    (FieldType::ArrayI64, Value::Array(arr)) => arr.iter().all(|v| v.as_i64().is_some()),
    (FieldType::ArrayF64, Value::Array(arr)) => arr.iter().all(|v| v.is_number()),
    _ => false,
  };
  if ok || (field.optional && val.is_null()) {
    Ok(())
  } else {
    Err(format!("field '{}' type mismatch", field.name))
  }
}

struct SchemaSeed<'a> {
  schema: &'a CompiledSchema,
}

impl<'de> DeserializeSeed<'de> for SchemaSeed<'_> {
  type Value = Map<String, Value>;

  fn deserialize<D>(self, d: D) -> Result<Self::Value, D::Error>
  where D: de::Deserializer<'de> {
    d.deserialize_map(SchemaVisitor { schema: self.schema })
  }
}

struct SchemaVisitor<'a> {
  schema: &'a CompiledSchema,
}

impl<'de> Visitor<'de> for SchemaVisitor<'_> {
  type Value = Map<String, Value>;

  fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
    f.write_str("a JSON object matching the schema")
  }

  fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
  where A: MapAccess<'de> {
    let n = self.schema.fields.len();
    let mut out = Map::with_capacity(n);
    let mut present: u64 = 0;

    while let Some(key) = map.next_key::<String>()? {
      if let Some(&idx) = self.schema.indices.get(&key) {
        let field = &self.schema.fields[idx];
        let val: Value = map.next_value()?;
        validate_value(&val, field).map_err(de::Error::custom)?;
        out.insert(key, val);
        present |= 1u64 << idx;
      } else {
        let _: IgnoredAny = map.next_value()?;
      }
    }

    for (idx, field) in self.schema.fields.iter().enumerate() {
      if (present & (1u64 << idx)) == 0 {
        if field.optional {
          out.insert(field.name.clone(), Value::Null);
        } else {
          return Err(de::Error::custom(format!("missing required field '{}'", field.name)));
        }
      }
    }
    Ok(out)
  }
}

struct ArrayVisitor<'a> {
  schema: &'a CompiledSchema,
}

impl<'de> Visitor<'de> for ArrayVisitor<'_> {
  type Value = Vec<Value>;

  fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
    f.write_str("a JSON array")
  }

  fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
  where A: SeqAccess<'de> {
    let mut results = Vec::new();
    while let Some(map) = seq.next_element_seed(SchemaSeed { schema: self.schema })? {
      results.push(Value::Object(map));
    }
    Ok(results)
  }
}

pub fn stream_parse_array(input: &[u8], schema: &CompiledSchema) -> Result<Vec<Value>, String> {
  let mut de = JsonDeserializer::from_slice(input);
  let results = SerdeDeserializer::deserialize_seq(&mut de, ArrayVisitor { schema })
    .map_err(|e| e.to_string())?;
  Ok(results)
}

pub fn stream_parse_one(input: &[u8], schema: &CompiledSchema) -> Result<Value, String> {
  let mut de = JsonDeserializer::from_slice(input);
  let map = SerdeDeserializer::deserialize_map(&mut de, SchemaVisitor { schema })
    .map_err(|e| e.to_string())?;
  Ok(Value::Object(map))
}
