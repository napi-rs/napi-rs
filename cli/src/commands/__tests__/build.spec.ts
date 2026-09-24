import test from 'ava'

import { createBuildCommand } from '../../index.js'

test('build supports explicit format and compatibility aliases', (t) => {
  const explicit = createBuildCommand([
    '--format',
    'esm',
    '--js-binding',
    'index.mjs',
  ])

  t.is(explicit.format, 'esm')
  t.is(explicit.jsBinding, 'index.mjs')

  t.true(createBuildCommand(['--esm']).esm)
  t.true(createBuildCommand(['--commonjs']).commonjs)
})

test('build rejects unsupported formats', (t) => {
  t.throws(() => createBuildCommand(['--format', 'umd']), {
    message: /Invalid value for --format/,
  })
})

test('build supports explicit binding loader', (t) => {
  t.is(
    createBuildCommand(['--binding-loader', 'direct']).bindingLoader,
    'direct',
  )
  t.is(createBuildCommand(['--binding-loader', 'node']).bindingLoader, 'node')
  // The `node` default is applied by `resolveBindingLoader`, not by parsing,
  // mirroring `--format`.
  t.is(createBuildCommand([]).bindingLoader, undefined)
})

test('build rejects unsupported binding loaders', (t) => {
  t.throws(() => createBuildCommand(['--binding-loader', 'unknown']), {
    message: /Invalid value for --binding-loader/,
  })
})

test('build self-signs OpenHarmony artifacts unless --no-ohos-sign', (t) => {
  t.true(createBuildCommand([]).ohosSign)
  t.true(createBuildCommand(['--ohos-sign']).ohosSign)
  t.false(createBuildCommand(['--no-ohos-sign']).ohosSign)
})
