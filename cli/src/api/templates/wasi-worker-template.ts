export const WASI_WORKER_TEMPLATE = `import fs from "node:fs";
import { createRequire } from "node:module";
import { WASI } from "node:wasi";
import { parentPort, Worker } from "node:worker_threads";

const require = createRequire(import.meta.url);

const { instantiateNapiModuleSync, MessageHandler, getDefaultContext } = require("@napi-rs/wasm-runtime");

if (parentPort) {
  parentPort.on("message", (data) => {
    globalThis.onmessage({ data });
  });
}

Object.assign(globalThis, {
  self: globalThis,
  require,
  Worker,
  importScripts: function (f) {
    ;(0, eval)(fs.readFileSync(f, "utf8") + "//# sourceURL=" + f);
  },
  postMessage: function (msg) {
    if (parentPort) {
      parentPort.postMessage(msg);
    }
  },
});

const emnapiContext = getDefaultContext()

const handler = new MessageHandler({
  onLoad({ wasmModule, wasmMemory }) {
    const wasi = new WASI({
      version: 'preview1',
      env: process.env,
      preopens: {
        '/': '/',
      },
    });

    return instantiateNapiModuleSync(wasmModule, {
      childThread: true,
      wasi,
      context: emnapiContext,
      overwriteImports(importObject) {
        importObject.env = {
          ...importObject.env,
          ...importObject.napi,
          ...importObject.emnapi,
          memory: wasmMemory
        };
      },
    });
  },
});

globalThis.onmessage = function (e) {
  handler.handle(e);
};
`

export const createWasiBrowserWorkerBinding = (fs: boolean) => {
  const fsImport = fs
    ? `import { Volume, createFsFromVolume } from '@napi-rs/wasm-runtime/fs'

const fs = createFsFromVolume(
  Volume.fromJSON({
    '/': null,
  }),
)`
    : '\nconst fs = null'
  return `import { instantiateNapiModuleSync, MessageHandler, WASI } from '@napi-rs/wasm-runtime'
${fsImport}

const handler = new MessageHandler({
  onLoad({ wasmModule, wasmMemory }) {
    const wasi = new WASI({
      fs,
      print: function () {
        // eslint-disable-next-line no-console
        console.log.apply(console, arguments)
      },
      printErr: function() {
        // eslint-disable-next-line no-console
        console.error.apply(console, arguments)
      },
    })
    return instantiateNapiModuleSync(wasmModule, {
      childThread: true,
      wasi,
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

globalThis.onmessage = function (e) {
  handler.handle(e)
}
`
}
