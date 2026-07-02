export const createWasiBrowserBinding = (
  wasiFilename: string,
  initialMemory = 4000,
  maximumMemory = 65536,
  fs = false,
  asyncInit = false,
  buffer = false,
  errorEvent = false,
  threads = true,
) => {
  const fsImport = fs
    ? buffer
      ? `import { memfs, Buffer } from '@napi-rs/wasm-runtime/fs'`
      : `import { memfs } from '@napi-rs/wasm-runtime/fs'`
    : ''
  const bufferImport = buffer && !fs ? `import { Buffer } from 'buffer'` : ''
  const wasiCreation = fs
    ? `
export const { fs: __fs, vol: __volume } = memfs()

const __wasi = new __WASI({
  version: 'preview1',
  fs: __fs,
  preopens: {
    '/': '/',
  },
})`
    : `
const __wasi = new __WASI({
  version: 'preview1',
})`

  const workerFsHandler = fs
    ? `    worker.addEventListener('message', __wasmCreateOnMessageForFsProxy(__fs))\n`
    : ''

  const workerErrorHandler = errorEvent
    ? `    worker.addEventListener('message', (event) => {
      if (event.data && typeof event.data === 'object' && event.data.type === 'error') {
        window.dispatchEvent(new CustomEvent('napi-rs-worker-error', { detail: event.data }))
      }
    })
`
    : ''

  const emnapiInjectBuffer = buffer
    ? '__emnapiContext.feature.Buffer = Buffer'
    : ''
  const emnapiInstantiateImport = asyncInit
    ? `instantiateNapiModule as __emnapiInstantiateNapiModule`
    : `instantiateNapiModuleSync as __emnapiInstantiateNapiModuleSync`
  const emnapiInstantiateCall = asyncInit
    ? `await __emnapiInstantiateNapiModule`
    : `__emnapiInstantiateNapiModuleSync`
  const workerRuntimeImport = threads
    ? `  createOnMessage as __wasmCreateOnMessageForFsProxy,\n`
    : ''
  const memoryName = threads ? '__sharedMemory' : '__wasmMemory'
  const asyncWorkPoolOption = `  asyncWorkPoolSize: ${threads ? 4 : 0},
`
  const workerOption = threads
    ? `  onCreateWorker() {
    const worker = new Worker(new URL('./wasi-worker-browser.mjs', import.meta.url), {
      type: 'module',
    })
${workerFsHandler}
${workerErrorHandler}
    return worker
  },
`
    : ''

  return `import {
${workerRuntimeImport}\
  getDefaultContext as __emnapiGetDefaultContext,
  ${emnapiInstantiateImport},
  WASI as __WASI,
} from '@napi-rs/wasm-runtime'
${fsImport}
${bufferImport}
${wasiCreation}

const __wasmUrl = new URL('./${wasiFilename}.wasm', import.meta.url).href
const __emnapiContext = __emnapiGetDefaultContext()
${emnapiInjectBuffer}

const ${memoryName} = new WebAssembly.Memory({
  initial: ${initialMemory},
  maximum: ${maximumMemory},
${threads ? '  shared: true,\n' : ''}\
})

const __wasmFile = await fetch(__wasmUrl).then((res) => res.arrayBuffer())

const {
  instance: __napiInstance,
  module: __wasiModule,
  napiModule: __napiModule,
} = ${emnapiInstantiateCall}(__wasmFile, {
  context: __emnapiContext,
${asyncWorkPoolOption}\
  wasi: __wasi,
${workerOption}\
  overwriteImports(importObject) {
    importObject.env = {
      ...importObject.env,
      ...importObject.napi,
      ...importObject.emnapi,
      memory: ${memoryName},
    }
    return importObject
  },
  beforeInit({ instance }) {
    for (const name of Object.keys(instance.exports)) {
      if (name.startsWith('__napi_register__')) {
        instance.exports[name]()
      }
    }
  },
})
`
}

export const createWasiDeferredBrowserBinding = (
  wasiFilename: string,
  initialMemory = 4000,
  maximumMemory = 65536,
) => {
  return `import {
  getDefaultContext as __emnapiGetDefaultContext,
  instantiateNapiModule as __emnapiInstantiateNapiModule,
  WASI as __WASI,
} from '@napi-rs/wasm-runtime'

/**
 * Deferred, workerd-safe instantiation: no top-level I/O, no compile-from-bytes.
 * Accepts ONLY a precompiled WebAssembly.Module, or a Promise resolving to one
 * (e.g. \`import mod from './${wasiFilename}.wasm'\` under a CompiledWasm
 * module rule / wrangler module import). Byte buffers, URLs and Response
 * objects are rejected: they require dynamic Wasm compilation, which
 * Cloudflare Workers disallows.
 */
export async function instantiate(__wasmInput) {
  const __module = await __wasmInput
  // Brand check, not \`instanceof\`: \`WebAssembly.Module.imports\` throws unless
  // its argument is a genuine WebAssembly.Module, so prototype-spoofed byte
  // buffers are rejected while cross-realm Module instances are accepted.
  try {
    WebAssembly.Module.imports(__module)
  } catch {
    throw new TypeError(
      "instantiate() expects a precompiled WebAssembly.Module (or a Promise resolving to one), " +
        "e.g. import mod from './${wasiFilename}.wasm' under a CompiledWasm module rule / wrangler module import. " +
        "Byte buffers, URLs and Response objects require dynamic Wasm compilation, which Cloudflare Workers disallows.",
    )
  }
  const __wasi = new __WASI({
    version: 'preview1',
  })
  const __emnapiContext = __emnapiGetDefaultContext()
  // The wasm module is linked with \`--import-memory\`, so a Memory must be
  // provided. It is allocated here in function scope (workerd bans global
  // scope allocation) and is not shared (no threads, no SharedArrayBuffer).
  const __wasmMemory = new WebAssembly.Memory({
    initial: ${initialMemory},
    maximum: ${maximumMemory},
  })
  const { napiModule: __napiModule } = await __emnapiInstantiateNapiModule(__module, {
    context: __emnapiContext,
    asyncWorkPoolSize: 0,
    wasi: __wasi,
    overwriteImports(importObject) {
      importObject.env = {
        ...importObject.env,
        ...importObject.napi,
        ...importObject.emnapi,
        memory: __wasmMemory,
      }
      return importObject
    },
    beforeInit({ instance }) {
      for (const name of Object.keys(instance.exports)) {
        if (name.startsWith('__napi_register__')) {
          instance.exports[name]()
        }
      }
    },
  })
  return __napiModule.exports
}
`
}

export const createWasiBinding = (
  wasmFileName: string,
  packageName: string,
  initialMemory = 4000,
  maximumMemory = 65536,
  threads = true,
) => {
  const workerImports = threads
    ? `const { Worker } = require('node:worker_threads')

`
    : ''
  const workerRuntimeImport = threads
    ? `  createOnMessage: __wasmCreateOnMessageForFsProxy,\n`
    : ''
  const memoryName = threads ? '__sharedMemory' : '__wasmMemory'
  const asyncWorkOptions = threads
    ? `  asyncWorkPoolSize: (function() {
    const threadsSizeFromEnv = Number(process.env.NAPI_RS_ASYNC_WORK_POOL_SIZE ?? process.env.UV_THREADPOOL_SIZE)
    // NaN > 0 is false
    if (threadsSizeFromEnv > 0) {
      return threadsSizeFromEnv
    } else {
      return 4
    }
  })(),
  reuseWorker: true,
`
    : `  asyncWorkPoolSize: 0,
`
  const workerOption = threads
    ? `  onCreateWorker() {
    const worker = new Worker(__nodePath.join(__dirname, 'wasi-worker.mjs'), {
      env: process.env,
    })
    worker.onmessage = ({ data }) => {
      __wasmCreateOnMessageForFsProxy(__nodeFs)(data)
    }

    // The main thread of Node.js waits for all the active handles before exiting.
    // But Rust threads are never waited without \`thread::join\`.
    // So here we hack the code of Node.js to prevent the workers from being referenced (active).
    // According to https://github.com/nodejs/node/blob/19e0d472728c79d418b74bddff588bea70a403d0/lib/internal/worker.js#L415,
    // a worker is consist of two handles: kPublicPort and kHandle.
    {
      const kPublicPort = Object.getOwnPropertySymbols(worker).find(s =>
        s.toString().includes("kPublicPort")
      );
      if (kPublicPort) {
        worker[kPublicPort].ref = () => {};
      }

      const kHandle = Object.getOwnPropertySymbols(worker).find(s =>
        s.toString().includes("kHandle")
      );
      if (kHandle) {
        worker[kHandle].ref = () => {};
      }

      worker.unref();
    }
    return worker
  },
`
    : ''

  return `/* eslint-disable */
/* prettier-ignore */

/* auto-generated by NAPI-RS */

const __nodeFs = require('node:fs')
const __nodePath = require('node:path')
const { WASI: __nodeWASI } = require('node:wasi')
${workerImports}\

const {
${workerRuntimeImport}\
  getDefaultContext: __emnapiGetDefaultContext,
  instantiateNapiModuleSync: __emnapiInstantiateNapiModuleSync,
} = require('@napi-rs/wasm-runtime')

const __rootDir = __nodePath.parse(process.cwd()).root

const __wasi = new __nodeWASI({
  version: 'preview1',
  env: process.env,
  preopens: {
    [__rootDir]: __rootDir,
  }
})

const __emnapiContext = __emnapiGetDefaultContext()

const ${memoryName} = new WebAssembly.Memory({
  initial: ${initialMemory},
  maximum: ${maximumMemory},
${threads ? '  shared: true,\n' : ''}\
})

let __wasmFilePath = __nodePath.join(__dirname, '${wasmFileName}.wasm')
const __wasmDebugFilePath = __nodePath.join(__dirname, '${wasmFileName}.debug.wasm')

if (__nodeFs.existsSync(__wasmDebugFilePath)) {
  __wasmFilePath = __wasmDebugFilePath
} else if (!__nodeFs.existsSync(__wasmFilePath)) {
  try {
    __wasmFilePath = require.resolve('${packageName}-wasm32-wasi/${wasmFileName}.wasm')
  } catch {
    throw new Error('Cannot find ${wasmFileName}.wasm file, and ${packageName}-wasm32-wasi package is not installed.')
  }
}

const { instance: __napiInstance, module: __wasiModule, napiModule: __napiModule } = __emnapiInstantiateNapiModuleSync(__nodeFs.readFileSync(__wasmFilePath), {
  context: __emnapiContext,
${asyncWorkOptions}\
  wasi: __wasi,
${workerOption}\
  overwriteImports(importObject) {
    importObject.env = {
      ...importObject.env,
      ...importObject.napi,
      ...importObject.emnapi,
      memory: ${memoryName},
    }
    return importObject
  },
  beforeInit({ instance }) {
    for (const name of Object.keys(instance.exports)) {
      if (name.startsWith('__napi_register__')) {
        instance.exports[name]()
      }
    }
  },
})
`
}
