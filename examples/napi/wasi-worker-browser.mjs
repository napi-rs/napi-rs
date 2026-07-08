import {
  instantiateNapiModuleSync,
  MessageHandler,
  WASI,
  createFsProxy,
} from '@napi-rs/wasm-runtime'
import { memfsExported as __memfsExported } from '@napi-rs/wasm-runtime/fs'

const fs = createFsProxy(__memfsExported)

const TSFN_TEST_COUNTER_COUNT = 35
const TSFN_HOST_CALL_ARMED_INDEX = 4
const TSFN_NATIVE_QUEUE_CONFIRMED_INDEX = 5
const TSFN_NATIVE_WAIT_ENTERED_INDEX = 6
const TSFN_NATIVE_WAIT_RETURNED_INDEX = 7
const TSFN_AFTER_NATIVE_ENTERED_INDEX = 8
const TSFN_AFTER_NATIVE_RELEASED_INDEX = 9
const TSFN_BLOCKING_RETURNED_INDEX = 10
const TSFN_SLOT_RELEASE_CONFIRMED_INDEX = 27
const TSFN_NATIVE_WAIT_ADDRESS_CONFIRMED_INDEX = 28
const TSFN_UNEXPECTED_INDEX = 29
const TSFN_COND_OFFSET = 56
const TSFN_QUEUE_SIZE_OFFSET = 60
const TSFN_STATE_OFFSET = 140
const TSFN_MAX_QUEUE_SIZE_OFFSET = 152

const handler = new MessageHandler({
  onLoad({ wasmModule, wasmMemory }) {
    let tsfnTestStatePointerSlot
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
      overwriteImports(importObject) {
        let blockingCallFunction = 0
        const callThreadsafeFunction =
          importObject.napi.napi_call_threadsafe_function
        const releaseThreadsafeFunction =
          importObject.napi.napi_release_threadsafe_function
        importObject.napi.napi_release_threadsafe_function = function (
          func,
          mode,
        ) {
          const statePointer = tsfnTestStatePointerSlot
            ? Atomics.load(
                new Uint32Array(wasmMemory.buffer, tsfnTestStatePointerSlot, 1),
                0,
              )
            : 0
          if (statePointer && mode === 0 && blockingCallFunction !== 0) {
            const state = new Int32Array(
              wasmMemory.buffer,
              statePointer,
              TSFN_TEST_COUNTER_COUNT,
            )
            if (
              Atomics.load(state, TSFN_AFTER_NATIVE_ENTERED_INDEX) === 1 &&
              Atomics.load(state, TSFN_AFTER_NATIVE_RELEASED_INDEX) === 1 &&
              Atomics.load(state, TSFN_BLOCKING_RETURNED_INDEX) === 0
            ) {
              if (func !== blockingCallFunction) {
                Atomics.compareExchange(state, TSFN_UNEXPECTED_INDEX, 0, 51)
                return 1
              }
              Atomics.store(state, TSFN_SLOT_RELEASE_CONFIRMED_INDEX, 1)
              blockingCallFunction = 0
            }
          }
          return releaseThreadsafeFunction(func, mode)
        }
        importObject.napi.napi_call_threadsafe_function = function (
          func,
          data,
          mode,
        ) {
          const statePointer = tsfnTestStatePointerSlot
            ? Atomics.load(
                new Uint32Array(wasmMemory.buffer, tsfnTestStatePointerSlot, 1),
                0,
              )
            : 0
          if (!statePointer || mode !== 1) {
            return callThreadsafeFunction(func, data, mode)
          }
          const state = new Int32Array(
            wasmMemory.buffer,
            statePointer,
            TSFN_TEST_COUNTER_COUNT,
          )
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
            Atomics.compareExchange(state, TSFN_UNEXPECTED_INDEX, 0, 50)
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
            return callThreadsafeFunction(func, data, mode)
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
        tsfnTestStatePointerSlot =
          instance.exports.__napi_rs_test_tsfn_state_ptr()
      },
    })
  },
})

globalThis.onmessage = function (e) {
  handler.handle(e)
}
