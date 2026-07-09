# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added the pluggable unsafe `AsyncRuntime` backend. Submission hooks return `AsyncRuntimeRejection<T>` with the unaccepted work and a backend-specific `Error`; synchronous `block_on` and `enter` hooks are fallible and preserve their backend diagnostics. After `shutdown()` returns, including an `Err` return, no backend-owned thread, task, waker, callback, destructor, function pointer, or vtable may execute addon code. During normal activation, native builds commit the winning backend's permanent image retention only after Node-API module registration succeeds. Explicit startup before Node-API module registration retains before calling the backend's `start` hook. A failed load is not retained solely because it registered a dormant backend, though other unload-safety mechanisms may still retain an image that published callbacks or handles before failing. The backend object is reused across environment reloads, its `Drop` is not guaranteed to run, and `shutdown()` is its resource-release hook.
- Added `try_create_custom_tokio_runtime` on targets where rejecting its consumed runtime can return without terminating the process, so duplicate registration can be reported without panicking. AIX, threaded WASI, `noop`, and builds without the `tokio_rt` executor keep only the infallible by-value compatibility wrapper; their fallible factory API rejects without invoking or consuming a runtime. The existing `create_custom_tokio_runtime` keeps its permanent first-registration-wins behavior and ignores duplicate configuration after safely retiring the rejected runtime. Its concrete runtime remains a one-shot compatibility registration. New `create_custom_tokio_runtime_factory` and `try_create_custom_tokio_runtime_factory` APIs retain a thread-safe factory and rebuild the configured runtime for every environment or explicit lifecycle generation. Factory invocation is serialized with shutdown without holding napi's runtime-state mutex, and a failed factory call can be retried by a later start. Public lifecycle contention returns `WouldDeadlock`, while internal environment activation and final cleanup wait for the in-progress generation transition. Threaded WASI and AIX reject custom runtimes because those hosts cannot safely pin addon code before environment cleanup ownership exists.
- Added hidden, versioned `napi::__private::async_runtime_v1` and
  `napi::__private::codegen_v1` contracts for current `napi-derive` output. Previously released
  derive code remains supported by compatibility exports. The coordinated major release must
  publish the runtime first: old derive plus new runtime is a transitional compatibility path
  without the new borrow/construction semantics, while new derive plus old runtime intentionally
  fails to compile. In a combined `async-runtime` + `tokio_rt` build, napi-derive 3.5.9
  synchronous `#[napi(async_runtime)]` guards retain their legacy Tokio compatibility routing;
  their generated async exports still use the selected custom backend. Use pure `async-runtime`
  or current derive v4 when synchronous custom-runtime entry is required.
- Added unsafe thread-safe function finalizer APIs. `register_finalizer`, `build_callback_with_finalizer`, and `build_with_finalizer` require the callback to quiesce every native thread or task that can use the thread-safe function or execute addon code before returning, including during unwinding, and must not wait for JavaScript callbacks or queued payloads. A finalizer that enables natural teardown of a worker retaining the thread-safe function requires a weak or explicitly unreferenced thread-safe function.

### Changed

- Made `async-runtime` additive: addons without a registered backend can still load, combined `async-runtime` + `tokio_rt` builds default generated async work to built-in Tokio, and registration from `#[module_init]` selects the custom backend before first-environment activation. The registration window closes when napi begins activating the first environment or an earlier runtime-backed operation commits a backend choice; a missing-backend error before any environment is activated leaves later registration available.
- Kept the public `execute_tokio_future` function and deprecated `Env::execute_tokio_future` method Tokio-backed in combined builds. Generated async exports, `Env::spawn_future`, and `AsyncBlockBuilder` follow the selected async backend instead.
- Custom-runtime join handles now report missing, stopped, or transitioning runtime states as runtime errors, preserve backend-provided immediate rejection errors, and report work dropped after acceptance as cancellation. Dropping a polled handle detaches it by releasing only its stored consumer waker; accepted work continues independently.
- **Breaking:** `ObjectFinalize::finalize` now takes `&mut self` instead of consuming `self`. This lets napi-rs contain a custom finalizer panic separately from a panic in the finalized value's `Drop` implementation, while the runtime still drops the value immediately after reference cleanup.
- **Breaking:** `ThreadsafeFunctionHandle` and the public `ThreadsafeFunction::handle` field are now private, and `ThreadsafeFunction::raw()` was removed, because exposing an unleased Node-API pointer allowed release and finalization races. `ThreadsafeFunction::abort` now takes `&self` and is shared and idempotent, so borrowed or `Arc`-wrapped callbacks can call `callback.abort()` directly without cloning merely to consume the handle. No raw-pointer replacement is provided.
- **Breaking:** Thread-safe function calls now require queued payloads and callee-handled error statuses to be `Send`, return-value callbacks to be `Send + 'static`, async return values to be `Send`, and error-status types to be `'static`. These bounds prevent values queued from native threads or retained past the initiating stack frame from crossing threads or outliving borrowed data unsafely.
- **Breaking:** `ExternalRef`, `Reference`, and `SharedReference` no longer expose `DerefMut` or implement `Sync`, and `WeakReference::get` / `get_mut` were removed. Cloned wrappers can point to the same native allocation, so those APIs allowed safe Rust to create aliased references or race access across threads. Use `WeakReference::with` for scoped immutable access, or `WeakReference::upgrade(env)` followed by `Reference::with` / `with_mut`. The lifetime-extending `Reference::share_with` and `SharedReference::share_with` constructors are now unsafe and document their exclusivity and non-escape requirements.
- **Breaking:** `JsExternal::get_value` now returns `&T`, `External<T>` no longer implements `FromNapiMutRef`, and mutable legacy external access requires the explicitly unsafe `JsExternal::get_value_mut`. `ExternalRef` provides owned immutable access when ownership must outlive the current callback; it deliberately has no mutable accessor because multiple references can alias the same allocation. Wrap the external value in an interior-mutability type when shared mutation is required.
- **Breaking:** `PromiseRaw::new`, `ArrayBuffer::detach`, and `Ref::get_value_mut` are now unsafe, in addition to `Reference::share_with` and `SharedReference::share_with`. Callers must audit and document the raw Promise handle lifetime, ArrayBuffer alias invalidation, mutable reference exclusivity, or owner-tied borrow invariants before adding the required `unsafe` block.
- **Breaking:** Generated native class references now reject overlapping mutable borrows, including public field accessors and reentrant conversion callbacks. Compatibility accessors such as `CallContext::get::<&T>()` reject bare class references at public callback boundaries, and `Array::get_ref` was removed; use owned `Reference<T>` values with `Reference::with` / `Reference::with_mut` for scoped access. `ClassInstance<T>` is no longer `Copy` or `Clone`, now owns a strong JavaScript reference, resolves a fresh Node-API handle for every JavaScript conversion, and exposes `clone_reference` / `into_reference` instead of its former public cached `value` field. Its `as_object` method now takes the current `Env` and returns `Result<Object>`.
- **Breaking:** Generated iterator and async-iterator callbacks now reject reentrant mutable access
  to the same native class value instead of constructing overlapping `&mut T` references.
- **Breaking:** `Generator::Return` now requires `ToNapiValue`, `AsyncGenerator::Return` now
  requires `ToNapiValue + Send + 'static`, and both `complete` hooks return
  `Option<Self::Return>` instead of `Option<Self::Yield>`. Existing implementations should update
  their output types; the default implementation returns the supplied value. Upgrade
  `@napi-rs/cli` with the runtime so generated declarations use the matching direct-value
  `return()` contract and include `undefined` for natural completion. Runtime callbacks and
  generated `next()` signatures distinguish omitted arguments from explicit `undefined`.
- **Breaking:** Builds targeting N-API 1-3 no longer implement `Send` or `Sync` for `Error`, `Buffer`, or `FunctionRef`, because those versions have no thread-safe primitive for releasing their JavaScript references. Enable `napi4` for cross-thread ownership, or keep these values on their creating JavaScript thread.
- **Breaking:** `CleanupEnvHook` no longer implements `Copy` or `Clone`, and `Env::remove_env_cleanup_hook` consumes it. A successful removal reclaims the callback allocation, so the right to remove a hook must have one owner.

### Fixed

- Custom Tokio runtime registration no longer accepts and retains an unused replacement after the
  first configured runtime has been consumed by startup.
- Deferred custom Tokio registration failures retain their original `Error` status and cause chain.
  In combined builds they reject only built-in Tokio selection or compatibility-helper use, rather
  than permanently preventing a separately selected custom `AsyncRuntime` from restarting.
- Promise and async-iterator rejections backed by JavaScript `Error` values now retain an owned
  message fallback when they must be rebuilt in a different Node-API environment.
- Iterator installation failures now propagate through generated class conversions, detached sync
  iterator methods retain and validate their exact owner, sync generator completion state is no
  longer writable from JavaScript, and rejected async `return()` arguments leave the iterator open.
- Unresolved or cancelled `JsDeferred` values now release their deferred stack-trace reference
  instead of retaining it until environment teardown.
- Class constructor lookup is now scoped by environment, Rust type, and JavaScript namespace, so
  classes with the same JavaScript name in different namespaces retain the correct prototype.
- Restored the infallible `ClassInstance::new` signature expected by previously released generated
  code, while exposing hidden fallible construction as `ClassInstance::try_new` for current codegen.
- Failed WASI module registration keeps the custom-GC cleanup drain installed so later off-thread
  reference drops are released during environment teardown.
- Restored the hidden `within_custom_runtime_if_available` entry point as a forwarding
  compatibility layer for previously released `napi-derive` code.
- Repeated native addon initialization through `process.dlopen` no longer rejects valid same-thread
  loads as recursive module registration.
- WASI ArrayBuffer and TypedArray fallbacks now synchronize bytes copied from WebAssembly memory
  into emnapi backing stores and still invoke caller finalizers when synchronization fails.

## [3.10.3](https://github.com/napi-rs/napi-rs/compare/napi-v3.10.2...napi-v3.10.3) - 2026-07-04

### Fixed

- _(napi)_ preserve the JS error object when cloning an Error off-thread ([#3375](https://github.com/napi-rs/napi-rs/pull/3375))

## [3.10.2](https://github.com/napi-rs/napi-rs/compare/napi-v3.10.1...napi-v3.10.2) - 2026-07-03

### Fixed

- _(napi)_ keep message and cause when cloning a JS-exception Error off-thread ([#3373](https://github.com/napi-rs/napi-rs/pull/3373))

## [3.10.1](https://github.com/napi-rs/napi-rs/compare/napi-v3.10.0...napi-v3.10.1) - 2026-07-03

### Fixed

- _(napi)_ release Error's exception reference via the custom GC when dropped off-thread. ([#3370](https://github.com/napi-rs/napi-rs/pull/3370))
- _(napi)_ stop ref exception object in ThreadsafeFunction sync-throw path on wasm targets ([#3369](https://github.com/napi-rs/napi-rs/pull/3369))

### Other

- _(napi)_ share class accessor trampolines ([#3364](https://github.com/napi-rs/napi-rs/pull/3364))
- optimize object field raw property access ([#3365](https://github.com/napi-rs/napi-rs/pull/3365))

## [3.10.0](https://github.com/napi-rs/napi-rs/compare/napi-v3.9.4...napi-v3.10.0) - 2026-07-01

### Added

- _(napi)_ implement `To`/`FromNapiValue` for `OsString`, `OsStr`, `Path` and `PathBuf` ([#3339](https://github.com/napi-rs/napi-rs/pull/3339))

### Fixed

- _(napi)_ route custom-GC Buffer/TypedArray cross-thread drops through the owning isolate ([#3357](https://github.com/napi-rs/napi-rs/pull/3357)) ([#3360](https://github.com/napi-rs/napi-rs/pull/3360))

## [3.9.4](https://github.com/napi-rs/napi-rs/compare/napi-v3.9.3...napi-v3.9.4) - 2026-06-24

### Other

- _(napi-derive)_ outline #[napi(object)] field-error decoration ([#3338](https://github.com/napi-rs/napi-rs/pull/3338))

## [3.9.3](https://github.com/napi-rs/napi-rs/compare/napi-v3.9.2...napi-v3.9.3) - 2026-06-18

### Fixed

- _(napi)_ sync referred flag when creating a weak ThreadsafeFunction ([#3337](https://github.com/napi-rs/napi-rs/pull/3337))

### Other

- _(napi)_ outline non-generic core of ThreadsafeFunction::create ([#3334](https://github.com/napi-rs/napi-rs/pull/3334))

## [3.9.2](https://github.com/napi-rs/napi-rs/compare/napi-v3.9.1...napi-v3.9.2) - 2026-06-14

### Fixed

- _(napi)_ ReadableStream Reader loses chunks and aborts on errored streams ([#3328](https://github.com/napi-rs/napi-rs/pull/3328))

## [3.9.1](https://github.com/napi-rs/napi-rs/compare/napi-v3.9.0...napi-v3.9.1) - 2026-06-10

### Fixed

- _(napi)_ unify Reference finalize callbacks on Arc (Rc/Arc type confusion) ([#3313](https://github.com/napi-rs/napi-rs/pull/3313))
- _(napi)_ zero-copy external strings, fix WASI double-free ([#3308](https://github.com/napi-rs/napi-rs/pull/3308))
- _(napi)_ experimental node_api_create_object_with_properties ([#3304](https://github.com/napi-rs/napi-rs/pull/3304))

## [3.9.0](https://github.com/napi-rs/napi-rs/compare/napi-v3.8.6...napi-v3.9.0) - 2026-05-13

### Added

- _(napi)_ add `ThreadsafeFunction::call_async_catch` to handle errors in callback functions ([#3291](https://github.com/napi-rs/napi-rs/pull/3291))

### Fixed

- _(deps)_ update rust crate ctor to v1 ([#3276](https://github.com/napi-rs/napi-rs/pull/3276))
- _(deps)_ update rust crate ctor to 0.13.0 ([#3275](https://github.com/napi-rs/napi-rs/pull/3275))
- _(deps)_ update rust crate ctor to 0.12.0 ([#3271](https://github.com/napi-rs/napi-rs/pull/3271))

## [3.8.6](https://github.com/napi-rs/napi-rs/compare/napi-v3.8.5...napi-v3.8.6) - 2026-04-28

### Fixed

- _(deps)_ update rust crate ctor to 0.11.0 ([#3270](https://github.com/napi-rs/napi-rs/pull/3270))
- _(napi)_ Convert #[ctor] calls to declarative form to remove all features ([#3257](https://github.com/napi-rs/napi-rs/pull/3257))

### Other

- _(napi)_ skip duplicate validation ([#3268](https://github.com/napi-rs/napi-rs/pull/3268))
- _(napi)_ clarify unsafe function invariants ([#3267](https://github.com/napi-rs/napi-rs/pull/3267))

## [3.8.5](https://github.com/napi-rs/napi-rs/compare/napi-v3.8.4...napi-v3.8.5) - 2026-04-15

### Fixed

- _(napi)_ preserve generator class methods ([#3231](https://github.com/napi-rs/napi-rs/pull/3231))
- _(deps)_ update rust crate ctor to v0.10.0 ([#3224](https://github.com/napi-rs/napi-rs/pull/3224))
- _(deps)_ disable ctor priority feature ([#3209](https://github.com/napi-rs/napi-rs/pull/3209))
- _(deps)_ update rust crate ctor to v0.9.1 ([#3204](https://github.com/napi-rs/napi-rs/pull/3204))
- _(napi)_ handle ThreadsafeFunction callback errors gracefully during shutdown ([#3188](https://github.com/napi-rs/napi-rs/pull/3188))
- _(napi)_ populate Error::cause from ThreadsafeFunction callee-handled callbacks ([#3162](https://github.com/napi-rs/napi-rs/pull/3162))
- correct typo in Either error message ("non" → "none") ([#3183](https://github.com/napi-rs/napi-rs/pull/3183))

## [3.8.4](https://github.com/napi-rs/napi-rs/compare/napi-v3.8.3...napi-v3.8.4) - 2026-03-28

### Fixed

- _(deps)_ update rust crate ctor to v0.8.0 ([#3170](https://github.com/napi-rs/napi-rs/pull/3170))
- _(deps)_ update rust crate ctor to v0.7.0 ([#3169](https://github.com/napi-rs/napi-rs/pull/3169))
- _(napi)_ check for null error_message in ExtendedErrorInfo::try_from ([#3158](https://github.com/napi-rs/napi-rs/pull/3158))
- _(napi)_ skip nullish error causes when converting from Unknown ([#3143](https://github.com/napi-rs/napi-rs/pull/3143))

## [3.8.3](https://github.com/napi-rs/napi-rs/compare/napi-v3.8.2...napi-v3.8.3) - 2026-02-14

### Fixed

- _(napi)_ prevent async iterator use-after-free during GC ([#3120](https://github.com/napi-rs/napi-rs/pull/3120))

### Other

- replace `BufferRef` mention with `BufferSlice` ([#3112](https://github.com/napi-rs/napi-rs/pull/3112))

## [3.8.2](https://github.com/napi-rs/napi-rs/compare/napi-v3.8.1...napi-v3.8.2) - 2026-01-08

### Fixed

- _(napi)_ memory leak in async fn ([#3089](https://github.com/napi-rs/napi-rs/pull/3089))
- _(napi)_ implement TypeName for ArrayBuffer ([#3087](https://github.com/napi-rs/napi-rs/pull/3087))

## [3.8.1](https://github.com/napi-rs/napi-rs/compare/napi-v3.8.0...napi-v3.8.1) - 2025-12-30

### Fixed

- _(napi)_ wasi debug compile error ([#3081](https://github.com/napi-rs/napi-rs/pull/3081))

## [3.8.0](https://github.com/napi-rs/napi-rs/compare/napi-v3.7.1...napi-v3.8.0) - 2025-12-30

### Added

- _(napi)_ support any object types in Stream([#2854](https://github.com/napi-rs/napi-rs/pull/2854))
- _(napi-derive)_ add #[napi(async_iterator)] macro attribute ([#3072](https://github.com/napi-rs/napi-rs/pull/3072))

### Fixed

- _(napi)_ validate status before copying data in env arraybuffer fallback ([#3077](https://github.com/napi-rs/napi-rs/pull/3077))
- _(napi)_ validate status before copying in remaining TypedArray fallback paths ([#3076](https://github.com/napi-rs/napi-rs/pull/3076))
- _(napi)_ validate status before copying in TypedArray owned ToNapiValue fallback ([#3080](https://github.com/napi-rs/napi-rs/pull/3080))
- _(napi)_ validate status before copying in ArrayBuffer ToNapiValue fallback ([#3079](https://github.com/napi-rs/napi-rs/pull/3079))
- _(napi)_ skip debug buffer tracking on wasm targets ([#3078](https://github.com/napi-rs/napi-rs/pull/3078))

## [3.7.1](https://github.com/napi-rs/napi-rs/compare/napi-v3.7.0...napi-v3.7.1) - 2025-12-19

### Other

- clippy fix for Rust 1.92.0 ([#3058](https://github.com/napi-rs/napi-rs/pull/3058))

## [3.7.0](https://github.com/napi-rs/napi-rs/compare/napi-v3.6.1...napi-v3.7.0) - 2025-12-09

### Added

- _(napi)_ provide unsafe as_mut on ArrayBuffer ([#3055](https://github.com/napi-rs/napi-rs/pull/3055))
- _(napi)_ support Promise.resolve/reject ([#3053](https://github.com/napi-rs/napi-rs/pull/3053))

## [3.6.1](https://github.com/napi-rs/napi-rs/compare/napi-v3.6.0...napi-v3.6.1) - 2025-12-02

### Other

- updated the following local packages: napi-sys

## [3.6.0](https://github.com/napi-rs/napi-rs/compare/napi-v3.5.2...napi-v3.6.0) - 2025-12-02

### Added

- _(napi-derive)_ add tracing feature for debug logging NAPI function calls ([#3041](https://github.com/napi-rs/napi-rs/pull/3041))
- _(napi)_ add node_api_create_object_with_properties support for enum creation ([#2990](https://github.com/napi-rs/napi-rs/pull/2990))

### Fixed

- _(napi)_ bigInt comparison ([#3039](https://github.com/napi-rs/napi-rs/pull/3039))
- _(napi)_ shutdown runtime at env cleanup on windows ([#3026](https://github.com/napi-rs/napi-rs/pull/3026))

### Other

- _(napi)_ add back pub NODE_VERSION_* ([#3046](https://github.com/napi-rs/napi-rs/pull/3046))
- _(sys)_ add back non dyn-symbols behavior ([#3045](https://github.com/napi-rs/napi-rs/pull/3045))
- _(napi)_ add Eq and PartialEq trait to BigInt ([#3033](https://github.com/napi-rs/napi-rs/pull/3033))
- update MSRV in README.md ([#3023](https://github.com/napi-rs/napi-rs/pull/3023))

## [3.5.2](https://github.com/napi-rs/napi-rs/compare/napi-v3.5.1...napi-v3.5.2) - 2025-11-10

### Other

- updated the following local packages: napi-build

## [3.5.1](https://github.com/napi-rs/napi-rs/compare/napi-v3.5.0...napi-v3.5.1) - 2025-11-07

### Fixed

- _(napi)_ TypedArraySlice creation ([#3004](https://github.com/napi-rs/napi-rs/pull/3004))

### Other

- _(napi)_ Promise and ThreadsafeFunction::call_async don't require tokio ([#2998](https://github.com/napi-rs/napi-rs/pull/2998))

## [3.5.0](https://github.com/napi-rs/napi-rs/compare/napi-v3.4.0...napi-v3.5.0) - 2025-11-06

### Added

- _(sys)_ use libloading to load napi symbols at runtime on all platform ([#2996](https://github.com/napi-rs/napi-rs/pull/2996))

### Fixed

- _(napi)_ memory leak in PromiseRaw cleanup callback ([#2995](https://github.com/napi-rs/napi-rs/pull/2995))

### Other

- _(napi)_ mark tsfn data as pub and split SendableResolver to indent file ([#2992](https://github.com/napi-rs/napi-rs/pull/2992))
- _(napi)_ mark SendableResolver and PromiseRaw as pub ([#2981](https://github.com/napi-rs/napi-rs/pull/2981))
- add sponsors

## [3.4.0](https://github.com/napi-rs/napi-rs/compare/napi-v3.3.0...napi-v3.4.0) - 2025-10-24

### Added

- _(napi)_ add on_abort for AbortSignal ([#2942](https://github.com/napi-rs/napi-rs/pull/2942))
- _(cli)_ add support for loongarch64-unknown-linux-gnu ([#2887](https://github.com/napi-rs/napi-rs/pull/2887))

### Fixed

- _(napi)_ stop ref error object in wasm targets ([#2975](https://github.com/napi-rs/napi-rs/pull/2975))
- _(deps)_ update rust crate ctor to v0.6.0 ([#2951](https://github.com/napi-rs/napi-rs/pull/2951))
- _(napi)_ cleanup memory issues ([#2949](https://github.com/napi-rs/napi-rs/pull/2949))
- _(napi)_ node_api_create_external_string_utf16 on wasm ([#2912](https://github.com/napi-rs/napi-rs/pull/2912))

### Other

- _(napi)_ bump rust-version ([#2966](https://github.com/napi-rs/napi-rs/pull/2966))

## [3.3.0](https://github.com/napi-rs/napi-rs/compare/napi-v3.2.4...napi-v3.3.0) - 2025-09-08

### Added

- _(napi)_ implement from_static on JsStringLatin1 and JsStringUtf16 ([#2908](https://github.com/napi-rs/napi-rs/pull/2908))
- _(napi)_ support external JsStringLatin1 and JsStringUtf16 ([#2898](https://github.com/napi-rs/napi-rs/pull/2898))

### Fixed

- _(napi)_ JsStringUtf8 memory leak ([#2911](https://github.com/napi-rs/napi-rs/pull/2911))

### Other

- _(cli)_ show NAPI options on new command ([#2892](https://github.com/napi-rs/napi-rs/pull/2892))

## [3.2.4](https://github.com/napi-rs/napi-rs/compare/napi-v3.2.3...napi-v3.2.4) - 2025-08-16

### Other

- _(napi)_ extends the Set types interoperability ([#2875](https://github.com/napi-rs/napi-rs/pull/2875))

## [3.2.3](https://github.com/napi-rs/napi-rs/compare/napi-v3.2.2...napi-v3.2.3) - 2025-08-13

### Fixed

- _(napi)_ link issue on cargo test --features noop ([#2872](https://github.com/napi-rs/napi-rs/pull/2872))
- _(deps)_ update rust crate ctor to v0.5.0 ([#2865](https://github.com/napi-rs/napi-rs/pull/2865))

## [3.2.2](https://github.com/napi-rs/napi-rs/compare/napi-v3.2.1...napi-v3.2.2) - 2025-08-08

### Fixed

- _(napi)_ no need to cleanup thread_local stuff ([#2851](https://github.com/napi-rs/napi-rs/pull/2851))

## [3.2.1](https://github.com/napi-rs/napi-rs/compare/napi-v3.2.0...napi-v3.2.1) - 2025-08-08

### Fixed

- _(napi)_ ensure tokio runtime is initialized for dlopen ([#2850](https://github.com/napi-rs/napi-rs/pull/2850))
- _(napi)_ handle the return_if_invalid for Array param ([#2846](https://github.com/napi-rs/napi-rs/pull/2846))

## [3.2.0](https://github.com/napi-rs/napi-rs/compare/napi-v3.1.6...napi-v3.2.0) - 2025-08-07

### Added

- _(napi)_ add ScopeGenerator trait ([#2831](https://github.com/napi-rs/napi-rs/pull/2831))
- make generator an iterator ([#2784](https://github.com/napi-rs/napi-rs/pull/2784))
- _(napi)_ add `Error.cause` support to `napi::Error` ([#2829](https://github.com/napi-rs/napi-rs/pull/2829))

### Fixed

- _(napi)_ user_defined_rt can only be used once ([#2841](https://github.com/napi-rs/napi-rs/pull/2841))

## [3.1.6](https://github.com/napi-rs/napi-rs/compare/napi-v3.1.5...napi-v3.1.6) - 2025-08-01

### Fixed

- _(napi)_ async task finally is not called ([#2824](https://github.com/napi-rs/napi-rs/pull/2824))

## [3.1.5](https://github.com/napi-rs/napi-rs/compare/napi-v3.1.4...napi-v3.1.5) - 2025-07-31

### Fixed

- _(napi)_ relax the lifetime restriction in PromiseRaw callbacks ([#2819](https://github.com/napi-rs/napi-rs/pull/2819))

## [3.1.4](https://github.com/napi-rs/napi-rs/compare/napi-v3.1.3...napi-v3.1.4) - 2025-07-30

### Fixed

- _(napi)_ the generic trait rectiction of Env::spawn should be ScopedTask ([#2817](https://github.com/napi-rs/napi-rs/pull/2817))

## [3.1.3](https://github.com/napi-rs/napi-rs/compare/napi-v3.1.2...napi-v3.1.3) - 2025-07-24

### Other

- _(napi)_ optimize HashMap allocation in FromNapiValue implementation for HashMap ([#2796](https://github.com/napi-rs/napi-rs/pull/2796))

## [3.1.2](https://github.com/napi-rs/napi-rs/compare/napi-v3.1.1...napi-v3.1.2) - 2025-07-22

### Other

- _(napi)_ use Vec with_capacity in FromNapiValue ([#2793](https://github.com/napi-rs/napi-rs/pull/2793))

## [3.1.1](https://github.com/napi-rs/napi-rs/compare/napi-v3.1.0...napi-v3.1.1) - 2025-07-21

### Other

- Revert "fix(napi): callback should be Fn rather than FnOnce" ([#2791](https://github.com/napi-rs/napi-rs/pull/2791))

## [3.1.0](https://github.com/napi-rs/napi-rs/compare/napi-v3.0.0...napi-v3.1.0) - 2025-07-21

### Added

- _(napi)_ provide ScopedTask to resolve JsValue with lifetime ([#2786](https://github.com/napi-rs/napi-rs/pull/2786))

### Other

- _(napi)_ add UnwindSafe and RefUnwindSafe back to AbortSignal and AsyncWorkPromise ([#2789](https://github.com/napi-rs/napi-rs/pull/2789))
- pin release-plz action
