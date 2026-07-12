import {
  instantiateNapiModuleSync,
  MessageHandler,
  WASI,
  createFsProxy,
  emnapiAsyncWorkPlugin,
  emnapiTSFNPlugin,
} from '@napi-rs/wasm-runtime'
import { memfsExported as __memfsExported } from '@napi-rs/wasm-runtime/fs'

const fs = createFsProxy(__memfsExported)

const TSFN_TEST_COUNTER_COUNT = 35
const TSFN_SCENARIO_INDEX = 0
const TSFN_DEFERRED_ABORT_SCENARIO = 1
const TSFN_POST_NATIVE_ABORT_SCENARIO = 2
const TSFN_HOST_CALL_ARMED_INDEX = 4
const TSFN_NATIVE_QUEUE_CONFIRMED_INDEX = 5
const TSFN_NATIVE_WAIT_ENTERED_INDEX = 6
const TSFN_NATIVE_WAIT_RETURNED_INDEX = 7
const TSFN_AFTER_NATIVE_ENTERED_INDEX = 8
const TSFN_AFTER_NATIVE_RELEASED_INDEX = 9
const TSFN_BLOCKING_RETURNED_INDEX = 10
const TSFN_LIFECYCLE_GATE_ARMED_INDEX = 12
const TSFN_LIFECYCLE_GATE_ENTERED_INDEX = 13
const TSFN_LIFECYCLE_GATE_RELEASED_INDEX = 14
const TSFN_NATIVE_ABORT_CALLED_INDEX = 17
const TSFN_SLOT_RELEASE_CONFIRMED_INDEX = 27
const TSFN_NATIVE_WAIT_ADDRESS_CONFIRMED_INDEX = 28
const TSFN_UNEXPECTED_INDEX = 29
const TSFN_COND_OFFSET = 56
const TSFN_QUEUE_SIZE_OFFSET = 60
const TSFN_STATE_OFFSET = 140
const TSFN_MAX_QUEUE_SIZE_OFFSET = 152

const handler = new MessageHandler({
  onLoad({ wasmModule, wasmMemory }) {
    let tsfnTestStatePointer
    const wasi = new WASI({
      fs,
      preopens: {
        '/': '/',
      },
      print: function () {
        // eslint-disable-next-line no-console
        console.log.apply(console, arguments)
      },
      printErr: function () {
        // eslint-disable-next-line no-console
        console.error.apply(console, arguments)
      },
    })
    return instantiateNapiModuleSync(wasmModule, {
      childThread: true,
      wasi,
      // The wasm links a "basic" emnapi archive (no C async-work /
      // threadsafe-function implementations), so every thread that
      // instantiates it must provide the JavaScript implementations
      // through the emnapi plugins.
      plugins: [emnapiAsyncWorkPlugin, emnapiTSFNPlugin],
      overwriteImports(importObject) {
        let blockingCallFunction = 0
        const getTsfnTestState = () =>
          tsfnTestStatePointer
            ? new Int32Array(
                wasmMemory.buffer,
                tsfnTestStatePointer,
                TSFN_TEST_COUNTER_COUNT,
              )
            : undefined
        const failTsfnTest = (state, code) => {
          Atomics.compareExchange(state, TSFN_UNEXPECTED_INDEX, 0, code)
        }
        const waitForTsfnGate = (state, index) => {
          const deadline = Date.now() + 10_000
          while (Atomics.load(state, index) === 0) {
            const remaining = deadline - Date.now()
            if (remaining <= 0) {
              return false
            }
            Atomics.wait(state, index, 0, Math.min(remaining, 10))
          }
          return true
        }
        const callThreadsafeFunction =
          importObject.napi.napi_call_threadsafe_function
        const releaseThreadsafeFunction =
          importObject.napi.napi_release_threadsafe_function
        importObject.napi.napi_release_threadsafe_function = function (
          func,
          mode,
        ) {
          const status = releaseThreadsafeFunction(func, mode)
          const state = getTsfnTestState()
          if (state && Atomics.load(state, TSFN_SCENARIO_INDEX) !== 0) {
            if (mode === 1) {
              if (
                status !== 0 ||
                Atomics.compareExchange(
                  state,
                  TSFN_NATIVE_ABORT_CALLED_INDEX,
                  0,
                  1,
                ) !== 0
              ) {
                failTsfnTest(state, 40)
              }
            }
            if (
              mode === 0 &&
              blockingCallFunction !== 0 &&
              Atomics.load(state, TSFN_AFTER_NATIVE_ENTERED_INDEX) === 1 &&
              Atomics.load(state, TSFN_AFTER_NATIVE_RELEASED_INDEX) === 1 &&
              Atomics.load(state, TSFN_BLOCKING_RETURNED_INDEX) === 0
            ) {
              if (status !== 0 || func !== blockingCallFunction) {
                failTsfnTest(state, 41)
              } else {
                Atomics.store(state, TSFN_SLOT_RELEASE_CONFIRMED_INDEX, 1)
              }
              blockingCallFunction = 0
            }
          }
          return status
        }
        importObject.napi.napi_call_threadsafe_function = function (
          func,
          data,
          mode,
        ) {
          const state = getTsfnTestState()
          if (!state || Atomics.load(state, TSFN_SCENARIO_INDEX) === 0) {
            return callThreadsafeFunction(func, data, mode)
          }

          if (
            mode === 0 &&
            Atomics.load(state, TSFN_SCENARIO_INDEX) ===
              TSFN_DEFERRED_ABORT_SCENARIO &&
            Atomics.compareExchange(
              state,
              TSFN_LIFECYCLE_GATE_ARMED_INDEX,
              1,
              2,
            ) === 1
          ) {
            Atomics.store(state, TSFN_LIFECYCLE_GATE_ENTERED_INDEX, 1)
            if (!waitForTsfnGate(state, TSFN_LIFECYCLE_GATE_RELEASED_INDEX)) {
              failTsfnTest(state, 42)
            }
          }

          if (mode !== 1) {
            return callThreadsafeFunction(func, data, mode)
          }
          if (
            Atomics.compareExchange(state, TSFN_HOST_CALL_ARMED_INDEX, 1, 0) !==
            1
          ) {
            return callThreadsafeFunction(func, data, mode)
          }
          blockingCallFunction = func

          const loadTsfnWord = (offset) =>
            Atomics.load(new Int32Array(wasmMemory.buffer, func + offset, 1), 0)
          if (
            loadTsfnWord(TSFN_QUEUE_SIZE_OFFSET) !== 1 ||
            loadTsfnWord(TSFN_STATE_OFFSET) !== 0 ||
            loadTsfnWord(TSFN_MAX_QUEUE_SIZE_OFFSET) !== 1
          ) {
            failTsfnTest(state, 43)
            throw new Error(
              'Bounded TSFN call did not enter native N-API with a full open queue',
            )
          }
          Atomics.store(state, TSFN_NATIVE_QUEUE_CONFIRMED_INDEX, 1)

          const atomicWait = Atomics.wait
          Atomics.wait = function (array, index, value, timeout) {
            const waitAddress =
              array.byteOffset + index * Int32Array.BYTES_PER_ELEMENT
            if (
              array.buffer !== wasmMemory.buffer ||
              waitAddress !== func + TSFN_COND_OFFSET
            ) {
              return atomicWait(array, index, value, timeout)
            }
            Atomics.store(state, TSFN_NATIVE_WAIT_ADDRESS_CONFIRMED_INDEX, 1)
            Atomics.store(state, TSFN_NATIVE_WAIT_ENTERED_INDEX, 1)
            try {
              return atomicWait(array, index, value, timeout)
            } finally {
              Atomics.store(state, TSFN_NATIVE_WAIT_RETURNED_INDEX, 1)
            }
          }
          try {
            const status = callThreadsafeFunction(func, data, mode)
            if (
              Atomics.load(state, TSFN_SCENARIO_INDEX) ===
              TSFN_POST_NATIVE_ABORT_SCENARIO
            ) {
              Atomics.store(state, TSFN_AFTER_NATIVE_ENTERED_INDEX, 1)
              if (!waitForTsfnGate(state, TSFN_AFTER_NATIVE_RELEASED_INDEX)) {
                failTsfnTest(state, 44)
              }
            }
            return status
          } finally {
            Atomics.wait = atomicWait
          }
        }
        importObject.env = {
          ...importObject.env,
          ...importObject.napi,
          ...importObject.emnapi,
          memory: wasmMemory,
        }
      },
      beforeInit({ instance }) {
        tsfnTestStatePointer = instance.exports.__napi_rs_test_tsfn_state_ptr()
      },
    })
  },
})

globalThis.onmessage = function (e) {
  handler.handle(e)
}
