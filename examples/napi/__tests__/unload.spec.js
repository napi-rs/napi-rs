// use the commonjs syntax to prevent compiler from transpiling the module syntax

import { createRequire } from 'node:module'
import * as path from 'node:path'

import { platformArchTriples } from '@napi-rs/triples'
import test from 'ava'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(new URL(import.meta.url).pathname)

const platforms = platformArchTriples[process.platform][process.arch]

let binaryName

if (platforms.length === 1) {
  binaryName = `example.${platforms[0].platformArchABI}.node`
} else if (process.platform === 'linux') {
  if (process.report?.getReport?.()?.header.glibcVersionRuntime) {
    if (process.arch === 'arm') {
      binaryName = `example.linux-arm-gnueabihf.node`
    } else {
      binaryName = `example.${platforms.find(({ abi }) => abi === 'gnu').platformArchABI}.node`
    }
  } else {
    binaryName = `example.${platforms.find(({ abi }) => abi === 'musl').platformArchABI}.node`
  }
} else if (process.platform === 'win32') {
  if (process.config?.variables?.shlib_suffix === 'dll.a' || process.config?.variables?.node_target_type === 'shared_library') {
    const msystem = process.env.MSYSTEM;
    switch (msystem) {
      // expected fall-through
      case "CLANG64":
      case "CLANGARM64":
        binaryName = `example.${platforms.find(({ abi }) => abi === 'gnullvm').platformArchABI}.node`
        break;
      // expected fall-through
      case "UCRT64":
      case "MINGW64":
        binaryName = `example.${platforms.find(({ abi }) => abi === 'gnu').platformArchABI}.node`
        break;
      default:
        throw new Error('unsupported platform')
    }
  } else {
    binaryName = `example.${platforms.find(({ abi }) => abi === 'msvc').platformArchABI}.node`
  }
} else {
  throw new Error('unsupported platform')
}

test('unload module', (t) => {
  if (process.env.WASI_TEST) {
    t.pass()
    return
  }
  const { add } = require(`../${binaryName}`)
  t.is(add(1, 2), 3)
  delete require.cache[require.resolve(`../${binaryName}`)]
  const { add: add2 } = require(`../${binaryName}`)
  t.is(add2(1, 2), 3)
})

test('load module multi times', (t) => {
  if (process.env.WASI_TEST || process.platform === 'win32') {
    t.pass()
    return
  }
  const { add } = require(`../${binaryName}`)
  t.is(add(1, 2), 3)
  const { add: add2 } = require(
    path.toNamespacedPath(path.join(__dirname, `../${binaryName}`)),
  )
  t.is(add2(1, 2), 3)
})
