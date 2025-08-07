# Fix: Allow USER_DEFINED_RT to be reused after shutdown

## Summary

This PR fixes issue #2833 where `USER_DEFINED_RT` could only be used once. After calling `shutdown_async_runtime()`, it was impossible to create a new custom runtime because `OnceLock` only allows one-time initialization.

## Problem

The issue occurs because:
1. `USER_DEFINED_RT` was defined as `OnceLock<RwLock<Option<Runtime>>>`
2. When `create_runtime()` is called, it takes the runtime out using `take()`, leaving `None` 
3. `OnceLock::get_or_init()` only initializes once, so subsequent calls to `create_custom_tokio_runtime()` have no effect
4. This makes it impossible to restart the runtime after shutdown

## Solution

Changed `USER_DEFINED_RT` from `OnceLock` to `LazyLock`:
- `LazyLock` allows the value to be modified after initialization
- `create_custom_tokio_runtime()` now directly writes to the `RwLock` instead of using `get_or_init()`
- This allows the custom runtime to be set multiple times

## Changes

1. **crates/napi/src/tokio_runtime.rs**:
   - Changed `USER_DEFINED_RT` from `OnceLock<RwLock<Option<Runtime>>>` to `LazyLock<RwLock<Option<Runtime>>>`
   - Updated `create_runtime()` to work with `LazyLock`
   - Updated `create_custom_tokio_runtime()` to directly write to the `RwLock`
   - Removed unused `OnceLock` import

2. **examples/napi/src/lib.rs**:
   - Added `test_runtime_reuse()` function to demonstrate the fix works

3. **examples/napi/__tests__/tokio-runtime-reuse.spec.ts**:
   - Added test case to verify runtime can be reused after shutdown

## Testing

The fix includes a test that:
1. Shuts down the current runtime
2. Creates a new custom runtime
3. Starts the runtime again
4. Verifies this succeeds without errors

## Breaking Changes

None. This change maintains backward compatibility while fixing the limitation.

Fixes #2833