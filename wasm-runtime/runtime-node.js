import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import url from 'node:url'
import workerThreads from 'node:worker_threads'

import * as emnapiCoreNamespace from '@emnapi/core'
import * as emnapiRuntimeNamespace from '@emnapi/runtime'

import { createPairedRuntime } from './dist/emnapi-pairing.js'
import {
  emnapiAsyncWorkPlugin,
  emnapiTSFNPlugin,
} from './dist/emnapi-plugins.js'

function unwrapNamespace(ns, expectedExport) {
  if (typeof ns[expectedExport] === 'function') {
    return ns
  }
  const fallback = ns['default']
  return fallback && typeof fallback === 'object' ? fallback : ns
}

const ownCore = unwrapNamespace(
  emnapiCoreNamespace,
  'instantiateNapiModuleSync',
)
const ownRuntime = unwrapNamespace(emnapiRuntimeNamespace, 'createContext')

const ownRequire = createRequire(import.meta.url)
const nodeBuiltins = {
  createRequire,
  fs,
  path,
  url,
  workerThreads,
}

const {
  MessageHandler,
  createContext,
  getDefaultContext,
  instantiateNapiModule,
  instantiateNapiModuleSync,
} = createPairedRuntime({
  ownCore,
  ownRuntime,
  ownRequire,
  ownModule: undefined,
  getBuiltins: () => nodeBuiltins,
  emnapiAsyncWorkPlugin,
  emnapiTSFNPlugin,
})

export {
  MessageHandler,
  createContext,
  emnapiAsyncWorkPlugin,
  emnapiTSFNPlugin,
  getDefaultContext,
  instantiateNapiModule,
  instantiateNapiModuleSync,
}
export * from '@tybys/wasm-util'
export { createOnMessage, createFsProxy } from './fs-proxy.js'
