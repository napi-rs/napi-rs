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
