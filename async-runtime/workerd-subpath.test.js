// `@napi-rs/async-runtime/workerd` is the entry the generated deferred
// (`./workerd`) WASI loader imports. It must expose exactly the barrel's two
// per-instance registrars — same function identities, so a host installed
// through one entry is the host disposed through the other — and it must stay
// loadable in an isolate that has no `node:` builtins and no `process`.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)

const WORKERD_HOST_EXPORTS = [
  'registerWorkerdCurrentThreadTaskHost',
  'registerWorkerdTimerHost',
]

test('the workerd subpath re-exports the barrel hosts', async () => {
  const barrel = require('./index.cjs')
  const cjs = require('./workerd.cjs')
  const esm = await import('./workerd.js')
  for (const name of WORKERD_HOST_EXPORTS) {
    assert.equal(typeof barrel[name], 'function')
    assert.equal(cjs[name], barrel[name])
    assert.equal(esm[name], barrel[name])
  }
})

test('the workerd subpath exposes nothing else', () => {
  assert.deepEqual(
    Object.keys(require('./workerd.cjs')).sort(),
    [...WORKERD_HOST_EXPORTS].sort(),
  )
})

test('the workerd entry does not reach the Node-lane relay', () => {
  // The barrel requires `current-thread-hosts.cjs` (the realm-global
  // deduplication registry and the Node timer-handle bookkeeping). A CJS
  // barrel is not tree-shakeable, so the subpath is the only way a worker
  // bundle avoids it.
  const source = readFileSync(new URL('workerd.cjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /current-thread-hosts/)
})

test('the workerd host files use no Node builtin and no process', () => {
  for (const file of [
    'workerd.cjs',
    'workerd.js',
    'workerd-task-host.cjs',
    'workerd-timer-host.cjs',
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.doesNotMatch(
      source,
      /(?:require|from)\(?\s*['"]node:/,
      `${file} must not import a node: builtin`,
    )
    // Property access or indexing, so the word can still appear in prose.
    assert.doesNotMatch(
      source,
      /(?<![.\w$])process\s*(?:\.|\[)/,
      `${file} must not touch the process global`,
    )
  }
})

test('the package exports map points the subpath at those files', () => {
  const manifest = require('./package.json')
  assert.deepEqual(manifest.exports['./workerd'], {
    types: './workerd.d.ts',
    import: './workerd.js',
    require: './workerd.cjs',
  })
  for (const file of ['workerd.cjs', 'workerd.d.ts', 'workerd.js']) {
    assert.ok(
      manifest.files.includes(file),
      `${file} must be published with the package`,
    )
  }
  // The generated loader resolves the subpath by specifier, so the map has to
  // survive a real resolution, not just look right.
  assert.equal(
    require.resolve('@napi-rs/async-runtime/workerd'),
    require.resolve('./workerd.cjs'),
  )
})
