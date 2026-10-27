;; A small Node-API addon exercising the real JS implementations. No Rust/C
;; toolchain is needed. The test supplies either shared or unshared memory.
(module
  (import "env" "memory" (memory 1 4 MEMORY_SHARED))
  (import "test" "event" (func $event (param i32 i32 i32)))
  (import "test" "workerMode" (func $workerMode (result i32)))
  (import "napi" "napi_create_string_utf8" (func $string (param i32 i32 i32 i32) (result i32)))
  (import "napi" "napi_create_async_work" (func $createWork (param i32 i32 i32 i32 i32 i32 i32) (result i32)))
  (import "napi" "napi_queue_async_work" (func $queueWork (param i32 i32) (result i32)))
  (import "napi" "napi_delete_async_work" (func $deleteWork (param i32 i32) (result i32)))
  (import "napi" "napi_create_threadsafe_function" (func $createTSFN (param i32 i32 i32 i32 i32 i32 i32 i32 i32 i32 i32) (result i32)))
  (import "napi" "napi_call_threadsafe_function" (func $callTSFN (param i32 i32 i32) (result i32)))
  (import "napi" "napi_release_threadsafe_function" (func $releaseTSFN (param i32 i32) (result i32)))
  (export "memory" (memory 0))
  (table (export "__indirect_function_table") 6 funcref)
  (elem (i32.const 1) $execute $complete $callJS $finalize $workerStart)
  (data (i32.const 64) "plugin-test")

  ;; Slots: resource name = 128, work = 132, TSFN = 136, heap cursor = 192,
  ;; v2 env = 256. Main and worker allocations are sequenced by messages.
  ;; A shared bump cursor is sufficient for this bounded fixture. Record frees
  ;; so the tests can check TSFN cleanup actually ran.
  (func (export "malloc") (param $size i32) (result i32) (local $p i32)
    (local.set $p (i32.load (i32.const 192)))
    (i32.store (i32.const 192) (i32.and (i32.add (i32.add (local.get $p) (local.get $size)) (i32.const 7)) (i32.const -8)))
    (local.get $p))
  (func (export "free") (param $p i32)
    (call $event (i32.const 5) (local.get $p) (i32.const 0)))
  ;; v2 stores its env bookkeeping here; v1 manages it in JS instead.
  (func (export "emnapi_create_env") (result i32) (i32.const 256))
  (func (export "emnapi_delete_env") (param i32)
    (call $event (i32.const 6) (i32.const 0) (i32.const 0)))
  (func (export "emnapi_async_worker_init") (param $arg i32)
    (call $event (i32.const 7) (local.get $arg) (i32.const 0)))
  (func $workerStart (param $arg i32)
    (call $event (i32.const 8) (local.get $arg) (i32.const 0)))

  (func $check (param $status i32)
    (if (local.get $status) (then unreachable)))
  (func $execute (param i32) (param $data i32)
    (call $event (i32.const 1) (local.get $data) (i32.const 0)))
  (func $complete (param $env i32) (param $status i32) (param $data i32)
    local.get $env i32.const 132 i32.load call $deleteWork call $check
    i32.const 2 local.get $data local.get $status call $event)
  (func $callJS (param i32 i32) (param $context i32) (param $data i32)
    i32.const 3 local.get $data local.get $context call $event)
  (func $finalize (param i32) (param $data i32) (param $context i32)
    i32.const 4 local.get $data local.get $context call $event)
  (func (export "callTSFN") (param $tsfn i32) (param $data i32)
    local.get $tsfn local.get $data i32.const 0 call $callTSFN call $check)
  (func (export "releaseTSFN")
    i32.const 136 i32.load i32.const 0 call $releaseTSFN call $check)
  (func (export "napi_register_wasm_v1") (param $env i32) (param $exports i32) (result i32)
    i32.const 192 i32.const 1024 i32.store
    local.get $env i32.const 64 i32.const 11 i32.const 128 call $string call $check
    local.get $env i32.const 0 i32.const 128 i32.load
    i32.const 1 i32.const 2 i32.const 42 i32.const 132 call $createWork call $check
    local.get $env i32.const 132 i32.load call $queueWork call $check
    local.get $env i32.const 0 i32.const 0 i32.const 128 i32.load
    i32.const 0 i32.const 1 i32.const 99 i32.const 4 i32.const 123 i32.const 3 i32.const 136
    call $createTSFN call $check
    call $workerMode i32.eqz
    if
      i32.const 136 i32.load i32.const 43 i32.const 0 call $callTSFN call $check
      i32.const 136 i32.load i32.const 0 call $releaseTSFN call $check
    end
    local.get $exports)
)
