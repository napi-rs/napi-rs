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

## Symbol-keyed class members

Use `symbol_for` on a class method, getter, setter, or public field to expose it
under `Symbol.for(name)` instead of a string property name:

```rust
#[napi]
impl Chunk {
  #[napi(getter, symbol_for = "_runtime")]
  pub fn runtime(&self) -> ChunkRuntime {
    // ...
  }
}
```

JavaScript can read it as `chunk[Symbol.for('_runtime')]`. Use the same
`symbol_for` on a getter and setter to define a single accessor; they share one
descriptor only when they are in the same `#[napi]` impl block. Static methods
and factories are also supported. Names are used verbatim, without case conversion.
`symbol_for` cannot be combined with `js_name` or a named `getter`/`setter`.
Constructors, top-level exports, and fields of `object`, `array`, or `transparent`
structs and structured enums do not support `symbol_for`.

These members are omitted from generated TypeScript declarations, including when
`ts_return_type` is supplied. Positional arguments of a generated constructor are
retained. Internal TypeScript callers can declare their own symbol-keyed types.

Symbol properties are skipped by string-key enumeration (`Object.keys`, `for...in`,
`Object.getOwnPropertyNames`) and JSON serialization. They are not private:
`Object.getOwnPropertySymbols` and `Reflect.ownKeys` reveal them, and anyone knowing
the registry key can access them with `Symbol.for`. Property attributes such as
`enumerable`, `writable`, `configurable`, and `readonly` retain their usual meaning.
For class members, inspect the class prototype (or constructor for static methods).

`symbol_for` requires enabling the `napi9` feature (or a higher Node-API feature)
on the `napi` dependency. With a lower Node-API configuration it fails to compile
with "`symbol_for` requires the `napi9` feature of the `napi` crate". Symbols are
resolved with `node_api_symbol_for` in each Node environment during class
registration; there is no JavaScript fallback.

## Well-known symbol class members

Use `well_known_symbol` to key a class method, getter, setter, or public field by
one of JavaScript's well-known symbols. The value is the bare name, without the
`Symbol.` prefix:

```rust
#[napi]
impl Chunk {
  #[napi(getter, well_known_symbol = "toStringTag")]
  pub fn tag(&self) -> String {
    "Chunk".to_owned()
  }

  #[napi(well_known_symbol = "toPrimitive")]
  pub fn to_primitive(&self, hint: String) -> String {
    // ...
  }

  #[napi(well_known_symbol = "dispose")]
  pub fn dispose(&mut self) {
    // ...
  }
}
```

The accepted names are `asyncDispose`, `asyncIterator`, `dispose`, `hasInstance`,
`isConcatSpreadable`, `iterator`, `match`, `matchAll`, `replace`, `search`,
`species`, `split`, `toPrimitive`, `toStringTag`, and `unscopables`; any other
value fails to compile. The placement rules are the same as for `symbol_for`:
a getter and setter with the same name share one accessor when they are in the
same `#[napi]` impl block, static methods and factories are supported, and
`well_known_symbol` cannot be combined with `js_name`, `symbol_for`, or a named
`getter`/`setter`, nor used on constructors, top-level exports, or fields of
`object`, `array`, or `transparent` structs and structured enums.

Unlike `symbol_for`, these members are declared in the generated TypeScript with
computed keys, for example `get [globalThis.Symbol.toStringTag](): string` and
`static [globalThis.Symbol.toPrimitive](hint: string): string`. The keys go
through `globalThis`, so an export named `Symbol` does not shadow them. The
consuming project needs a TypeScript `lib` that declares the symbol (for example
`esnext.disposable` for `dispose` and `asyncDispose`).

No Node-API feature is required. The symbol is read from `globalThis.Symbol` in
each environment during class registration. If it is not a symbol there, the
registration fails with "Symbol.dispose is not available in this runtime" (for
`dispose`) rather than defining the member under another key, so the addon fails
to load.

`hasInstance` is not accepted on static methods and factories. A static
`Symbol.hasInstance` replaces `instanceof` for the class, and napi-rs uses
`instanceof` itself for `strict` argument validation, `Either` dispatch, and
`instance_of`.
Do not use `well_known_symbol = "iterator"` on a class with `#[napi(iterator)]`,
or `"asyncIterator"` on one with `#[napi(async_iterator)]`: those features set
the same symbol as an own property of every instance, which shadows the class
member.
