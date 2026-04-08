# napi-typegen example

Minimal crate demonstrating `napi typegen` — generating TypeScript definitions from `#[napi]`-annotated Rust source files without running `cargo build`.

## Run

```bash
yarn workspace @examples/napi-typegen typegen
```

This walks all `.rs` files under `src/` and writes `index.d.ts` in the current directory.

## What it covers

- Functions (`greet`, `add`, `describe_person`)
- Object structs (`Person`)
- Enums (`Status`)
- Classes with constructor, method, and getter (`Counter`)
