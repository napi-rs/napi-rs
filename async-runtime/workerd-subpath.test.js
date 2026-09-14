// `@napi-rs/async-runtime/workerd` is the entry the generated deferred
// (`./workerd`) WASI loader imports. It must expose exactly the barrel's two
// per-instance registrars — same function identities, so a host installed
// through one entry is the host disposed through the other — and it must stay
// loadable in an isolate that has no `node:` builtins and no `process`.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  // `types` is split per condition rather than hoisted: this package is
  // `type: module`, so the one declaration file would be an ESM declaration for
  // a `require()` consumer too, and TypeScript rejects that with TS1479.
  assert.deepEqual(manifest.exports['./workerd'], {
    import: {
      types: './workerd.d.ts',
      default: './workerd.js',
    },
    require: {
      types: './workerd.d.cts',
      default: './workerd.cjs',
    },
  })
  for (const file of [
    'workerd.cjs',
    'workerd.d.cts',
    'workerd.d.ts',
    'workerd.js',
  ]) {
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

const TSCONFIG = {
  compilerOptions: {
    module: 'node16',
    moduleResolution: 'node16',
    target: 'ES2024',
    strict: true,
    noEmit: true,
    skipLibCheck: false,
    types: [],
  },
  files: ['consumer.mts', 'consumer.cts'],
}

const CONSUMER = `import {
  registerWorkerdCurrentThreadTaskHost,
  registerWorkerdTimerHost,
  type AsyncRuntimeBinding,
} from '@napi-rs/async-runtime/workerd'

declare const binding: AsyncRuntimeBinding
export const disposeTaskHost: () => void =
  registerWorkerdCurrentThreadTaskHost(binding)
export const disposeTimerHost: () => void = registerWorkerdTimerHost(binding)
`

// Type-checks what `npm pack` would actually publish — `package.json` plus the
// `files` list, laid out under `node_modules` — so a declaration left out of
// `files` fails here rather than in a consumer's install.
test('both module flavors type-check against the published layout', () => {
  const project = mkdtempSync(join(tmpdir(), 'napi-workerd-types-'))
  try {
    const packageDir = join(
      project,
      'node_modules',
      '@napi-rs',
      'async-runtime',
    )
    mkdirSync(packageDir, { recursive: true })
    const manifest = require('./package.json')
    for (const file of ['package.json', ...manifest.files]) {
      cpSync(new URL(file, import.meta.url), join(packageDir, file))
    }
    writeFileSync(
      join(project, 'package.json'),
      JSON.stringify({ name: 'workerd-subpath-consumer', version: '0.0.0' }),
    )
    writeFileSync(join(project, 'tsconfig.json'), JSON.stringify(TSCONFIG))
    // `.mts` resolves the subpath through `import`, `.cts` through `require`.
    // Before the `require` condition had its own CommonJS declaration the
    // second one failed with TS1479.
    writeFileSync(join(project, 'consumer.mts'), CONSUMER)
    writeFileSync(join(project, 'consumer.cts'), CONSUMER)
    const result = execFileSync(
      process.execPath,
      [require.resolve('typescript/bin/tsc'), '--project', project],
      { cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    assert.equal(result.trim(), '')
  } finally {
    rmSync(project, { force: true, recursive: true })
  }
})
