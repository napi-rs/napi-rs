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

const handler = new MessageHandler({
  onLoad({ wasmModule, wasmMemory }) {
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
        importObject.env = {
          ...importObject.env,
          ...importObject.napi,
          ...importObject.emnapi,
          memory: wasmMemory,
        }
      },
    })
  },
})

// When this wasm thread dies, write the shared crash report, raise the
// loader's crash flag, and then raise the addon's crash flag before emnapi
// reports the error. The loader thread may be inside wasm, in a cleanup call
// that waits on this thread; the addon's flag is what those waits check
// between short slices, and once it is up they trap instead of waiting for
// good. Browser Workers have no `workerData`, so the loader posts the shared
// crash flag, shared crash report, and addon crash flag view via control
// messages.
let __crashFlag
let __crashReport
let __addonCrashFlag
const __beforeReportError = handler.beforeReportError
handler.beforeReportError = function (...args) {
  if (!__raiseWasiThreadCrashFlags(args[0])) {
    try {
      const __napiThreadCrashed = this.instance?.exports?.napi_wasm_thread_crashed
      if (typeof __napiThreadCrashed === 'function') {
        __napiThreadCrashed()
      }
    } catch {}
  }
  return __beforeReportError.apply(this, args)
}

function __raiseWasiThreadCrashFlags(error) {
  try {
    __writeCrashReport(__crashReport, error)
  } catch {}
  if (__crashFlag !== undefined) {
    try {
      Atomics.store(__crashFlag, 0, 1)
    } catch {}
  }
  if (__addonCrashFlag === undefined) {
    return false
  }
  try {
    Atomics.store(__addonCrashFlag, 0, 1)
    return true
  } catch {
    return false
  }
}

function __writeCrashReport(report, error) {
  if (!(report instanceof SharedArrayBuffer) || report.byteLength <= 12) {
    return
  }
  const header = new Int32Array(report, 0, 3)
  if (Atomics.load(header, 0) === 2) {
    return
  }
  const body = new Uint8Array(report, 12)
  let bytes
  try {
    const isObject =
      error !== null && (typeof error === 'object' || typeof error === 'function')
    const rawName = isObject ? error.name : undefined
    const name = typeof rawName === 'string' ? rawName : 'Error'
    const rawMessage = isObject ? error.message : undefined
    const message = typeof rawMessage === 'string' ? rawMessage : String(error)
    const rawStack = isObject ? error.stack : undefined
    const stack = typeof rawStack === 'string' ? rawStack : undefined
    const encoder = new TextEncoder()
    bytes = encoder.encode(JSON.stringify({ name, message, stack }))
    if (bytes.length > body.length) {
      bytes = encoder.encode(
        JSON.stringify({
          name: name.slice(0, Math.min(128, body.length >> 5)),
          message: message.slice(0, body.length >> 3),
        }),
      )
    }
    if (bytes.length > body.length) {
      bytes = encoder.encode('{"name":"Error","message":"Worker crashed"}')
    }
  } catch {
    try {
      bytes = new TextEncoder().encode('{"name":"Error","message":"Worker crashed"}')
    } catch {}
  }
  const state = Atomics.compareExchange(header, 0, 0, 1)
  if (state !== 0) {
    if (state === 1) {
      try {
        Atomics.wait(header, 0, 1, 50)
      } catch {}
    }
    return
  }
  let length = 0
  try {
    if (bytes && bytes.length <= body.length) {
      body.set(bytes)
      length = bytes.length
    }
    Atomics.store(header, 2, 0)
  } finally {
    Atomics.store(header, 1, length)
    Atomics.store(header, 0, 2)
    try {
      Atomics.notify(header, 0)
    } catch {}
  }
}

globalThis.onmessage = function (e) {
  const data = e && e.data
  if (data && typeof data === 'object') {
    let handled = false
    if (data.__napiRsCrashFlag instanceof Int32Array) {
      __crashFlag = data.__napiRsCrashFlag
      handled = true
    }
    if (data.__napiRsCrashReport instanceof SharedArrayBuffer) {
      __crashReport = data.__napiRsCrashReport
      handled = true
    }
    if (data.__napiRsAddonCrashFlag instanceof Int32Array) {
      __addonCrashFlag = data.__napiRsAddonCrashFlag
      handled = true
    }
    if (handled) {
      return
    }
  }
  handler.handle(e)
}
