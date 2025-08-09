# NAPI-RS Project Guide

## Project Structure

**Core Architecture:**

- `/crates/` - Rust implementation
  - `napi/` - Main runtime library (Node-API bindings)
  - `napi-sys/` - Low-level FFI bindings
  - `macro/` - Procedural macros (`#[napi]` attributes)
  - `backend/` - Code generation and TypeScript definitions
  - `build/` - Build utilities
- `/cli/` - Command-line tool (@napi-rs/cli)
- `/examples/napi/` - Comprehensive test suite and examples
- Monorepo using Cargo workspaces (Rust) + Yarn workspaces (JS)

**Key Files:**

- Root `Cargo.toml` - Workspace configuration
- `/crates/backend/src/typegen.rs` - TypeScript generation logic
- `/cli/src/utils/typegen.ts` - CLI TypeScript processing

## Testing, Building, and Running Tests

### Building

```bash
# Build all tests
yarn build:tests

# Build specific example (most common for testing changes)
yarn workspace @examples/napi build
```

### Testing

```bash
# Run all tests in the example project
yarn workspace @examples/napi test

# Update test snapshots after changes
yarn workspace @examples/napi test -u

# Run specific test file
yarn workspace @examples/napi test __tests__/values.spec.ts

# Run Rust unit tests
cargo test

# Run linting
yarn lint
```

### Common Development Workflow

1. Make changes to Rust code
2. Build: `yarn workspace @examples/napi build`
3. Test: `yarn workspace @examples/napi test`
4. Update snapshots if needed: `yarn workspace @examples/napi test -u`

## Important Notes

- JSDoc comments (`///`) in Rust become TypeScript documentation
- Use `#[napi(object)]` for plain objects (interfaces)
- Use `#[napi]` on impl blocks for classes
- The `#[napi(js_name = "...")]` attribute renames in JS/TS
- Build output: `.node` files in project root
- TypeScript definitions: `index.d.cts`

## Other notes

- **Type generation**: Rebuild with `yarn workspace @examples/napi build` after changes
- **Test snapshots**: Update with `-u` flag when output changes intentionally
