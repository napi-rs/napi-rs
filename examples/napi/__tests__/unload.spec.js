// use the commonjs syntax to prevent compiler from transpiling the module syntax

import { createRequire } from 'node:module'
import * as path from 'node:path'

import { platformArchTriples } from '@napi-rs/triples'
import { test } from 'node:test'
import assert from 'node:assert'

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
  binaryName = `example.${platforms.find(({ abi }) => abi === 'msvc').platformArchABI}.node`
} else {
  throw new Error('unsupported platform')
}

test('unload module', () => {
  if (process.env.WASI_TEST) {
    assert.ok(true)
    return
  }
  const { add } = require(`../${binaryName}`)
  assert.strictEqual(add(1, 2), 3)
  delete require.cache[require.resolve(`../${binaryName}`)]
  const { add: add2 } = require(`../${binaryName}`)
  assert.strictEqual(add2(1, 2), 3)
})

test('load module multi times', () => {
  if (process.env.WASI_TEST || process.platform === 'win32') {
    assert.ok(true)
    return
  }
  const { add } = require(`../${binaryName}`)
  assert.strictEqual(add(1, 2), 3)
  const { add: add2 } = require(
    path.toNamespacedPath(path.join(__dirname, `../${binaryName}`)),
  )
  assert.strictEqual(add2(1, 2), 3)
})
