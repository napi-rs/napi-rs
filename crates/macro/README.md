# napi-derive

<a href="https://docs.rs/crate/napi-derive"><img src="https://docs.rs/napi-derive/badge.svg"></img></a>
<a href="https://crates.io/crates/napi-derive"><img src="https://img.shields.io/crates/v/napi-derive.svg"></img></a>
<a href="https://discord.gg/SpWzYHsKHs">
<img src="https://img.shields.io/discord/874290842444111882.svg?logo=discord&style=flat-square"
    alt="chat" />
</a>

Checkout more examples in [examples](../../examples) folder

```rust
#[macro_use]
extern crate napi_derive;
use napi::bindgen_prelude::*;

#[napi]
fn fibonacci(n: u32) -> u32 {
  match n {
    1 | 2 => 1,
    _ => fibonacci_native(n - 1) + fibonacci_native(n - 2),
  }
}

#[napi]
fn get_cwd<T: Fn(String) -> Result<()>>(callback: T) {
  callback(env::current_dir().unwrap().to_string_lossy().to_string()).unwrap();
}
```

## Symbol-named class members

Use `symbol_name` on a class method, getter, setter, or public field to expose it
under `Symbol.for(name)` instead of a string property name:

```rust
#[napi]
impl Chunk {
  #[napi(getter, symbol_name = "_runtime")]
  pub fn runtime(&self) -> ChunkRuntime {
    // ...
  }
}
```

JavaScript can read it as `chunk[Symbol.for('_runtime')]`. Use the same
`symbol_name` on a getter and setter to define a single accessor; they share one
descriptor only when they are in the same `#[napi]` impl block. Static methods
and factories are also supported. Names are used verbatim, without case conversion.
`symbol_name` cannot be combined with `js_name` or a named `getter`/`setter`.
Constructors, top-level exports, and fields of `object`, `array`, or `transparent`
structs and structured enums do not support `symbol_name`.

These members are omitted from generated TypeScript declarations, including when
`ts_return_type` is supplied. Positional arguments of a generated constructor are
retained. Internal TypeScript callers can declare their own symbol-keyed types.

Symbol properties are skipped by string-key enumeration (`Object.keys`, `for...in`,
`Object.getOwnPropertyNames`) and JSON serialization. They are not private:
`Object.getOwnPropertySymbols` and `Reflect.ownKeys` reveal them, and anyone knowing
the registry key can access them with `Symbol.for`. Property attributes such as
`enumerable`, `writable`, `configurable`, and `readonly` retain their usual meaning.
For class members, inspect the class prototype (or constructor for static methods).

`symbol_name` requires enabling the `napi9` feature (or a higher Node-API feature)
on the `napi` dependency. With a lower Node-API configuration it fails to compile
with "`symbol_name` requires the `napi9` feature of the `napi` crate". Symbols are
resolved with `node_api_symbol_for` in each Node environment during class
registration; there is no JavaScript fallback.
