// use the commonjs syntax to prevent compiler from transpiling the module syntax

import { createRequire } from 'node:module'
import * as path from 'node:path'

import { platformArchTriples } from '@napi-rs/triples'
import test from 'ava'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(new URL(import.meta.url).pathname)

const platforms = platformArchTriples[process.platform][process.arch]

let binaryName

if (platforms.length() === 1) {
  binaryName = `example.${platforms[0].platformArchABI}.node`
} else if (process.platform === 'linux') {
  if (process.report?.getReport?.()?.header.glibcVersionRuntime) {
    binaryName = `example.${platforms.find(({ abi }) => abi === 'gnu').platformArchABI}.node`
  } else {
    binaryName = `example.${platforms.find(({ abi }) => abi === 'musl').platformArchABI}.node`
  }
} else {
  throw new Error('unsupported platform')
}

test('unload module', (t) => {
  const { add } = require(`../${binaryName}`)
  t.is(add(1, 2), 3)
  delete require.cache[require.resolve(`../${binaryName}`)]
  const { add: add2 } = require(`../${binaryName}`)
  t.is(add2(1, 2), 3)
})

test('load module multi times', (t) => {
  const { add } = require(`../${binaryName}`)
  t.is(add(1, 2), 3)
  const { add: add2 } = require(
    path.toNamespacedPath(path.join(__dirname, `../${binaryName}`)),
  )
  t.is(add2(1, 2), 3)
})
