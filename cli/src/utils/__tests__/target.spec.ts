import os from 'os'

import test from 'ava'

import {
  parseTriple,
  getSystemDefaultTarget,
  getWasiTarget,
  AVAILABLE_TARGETS,
  wasiTargetHasThreads,
} from '../target.js'

test('should parse triple correctly', (t) => {
  t.snapshot(AVAILABLE_TARGETS.map(parseTriple))
})

test('should get system default target correctly', (t) => {
  const target = getSystemDefaultTarget()

  t.is(target.platform, os.platform())
})

test('legacy WASI aliases retain threaded semantics and canonical identity', (t) => {
  for (const alias of [
    'wasm32-wasi',
    'wasm32-wasi-preview1-threads',
    'wasm32-wasip1-threads',
  ]) {
    t.deepEqual(getWasiTarget(alias), {
      canonicalTriple: 'wasm32-wasip1-threads',
      flavor: 'threads',
      platformArchABI: 'wasm32-wasi',
    })
    t.true(wasiTargetHasThreads(alias))
    t.deepEqual(parseTriple(alias), {
      triple: 'wasm32-wasip1-threads',
      platformArchABI: 'wasm32-wasi',
      platform: 'wasi',
      arch: 'wasm32',
      abi: 'wasi',
    })
  }
})

test('threadless WASI has a distinct canonical artifact identity', (t) => {
  t.deepEqual(getWasiTarget('wasm32-wasip1'), {
    canonicalTriple: 'wasm32-wasip1',
    flavor: 'single',
    platformArchABI: 'wasm32-wasip1',
  })
  t.false(wasiTargetHasThreads('wasm32-wasip1'))
})

test('unsupported WASI previews fail instead of using preview1 loaders', (t) => {
  for (const target of [
    'wasm32-wasip2',
    'wasm32-wasip1-component',
    'wasm32-wasi-preview2',
  ]) {
    t.is(getWasiTarget(target), undefined)
    t.throws(() => parseTriple(target), {
      instanceOf: TypeError,
      message: new RegExp(`Unsupported WASI target ${target}`),
    })
  }

  t.deepEqual(parseTriple('wasm32-wasix'), {
    triple: 'wasm32-wasix',
    platformArchABI: 'wasix-wasm32',
    platform: 'wasix',
    arch: 'wasm32',
    abi: null,
  })
})
