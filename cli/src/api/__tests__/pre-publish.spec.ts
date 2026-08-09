import test from 'ava'

import {
  parseNpmPackFiles,
  resolveRootOptionalDependencies,
} from '../pre-publish.js'
import { parseTriple } from '../../utils/index.js'

const PACKAGE_NAME = '@scope/pkg'
const VERSION = '1.2.3'

const NATIVE_TARGETS = ['aarch64-apple-darwin', 'x86_64-unknown-linux-gnu'].map(
  parseTriple,
)
const WASI_TARGET = parseTriple('wasm32-wasip1-threads')
const THREADLESS_WASI_TARGET = parseTriple('wasm32-wasip1')

const NATIVE_ENTRIES = {
  [`${PACKAGE_NAME}-darwin-arm64`]: VERSION,
  [`${PACKAGE_NAME}-linux-x64-gnu`]: VERSION,
}

function resolve(
  targets: Parameters<typeof resolveRootOptionalDependencies>[0]['targets'],
  overrides: Partial<
    Parameters<typeof resolveRootOptionalDependencies>[0]
  > = {},
) {
  return resolveRootOptionalDependencies({
    existing: undefined,
    managedPackageNames: [PACKAGE_NAME],
    packageName: PACKAGE_NAME,
    targets,
    version: VERSION,
    ...overrides,
  })
}

test('omits the WASI package when native targets are configured', (t) => {
  // The WASI binary is a require-time fallback, not something npm should
  // install on hosts that already resolved a native package.
  t.deepEqual(resolve([...NATIVE_TARGETS, WASI_TARGET]), NATIVE_ENTRIES)
})

test('omits the threadless WASI package too', (t) => {
  t.deepEqual(
    resolve([...NATIVE_TARGETS, THREADLESS_WASI_TARGET]),
    NATIVE_ENTRIES,
  )
})

test('declares the WASI package when it is the only target', (t) => {
  // With no native package to fall back from, WASI is the primary artifact.
  t.deepEqual(resolve([WASI_TARGET]), {
    [`${PACKAGE_NAME}-wasm32-wasi`]: VERSION,
  })
})

test('declares every WASI flavor when only WASI targets are configured', (t) => {
  t.deepEqual(resolve([WASI_TARGET, THREADLESS_WASI_TARGET]), {
    [`${PACKAGE_NAME}-wasm32-wasi`]: VERSION,
    [`${PACKAGE_NAME}-wasm32-wasip1`]: VERSION,
  })
})

test('wasm.optionalDependency=true opts back into declaring WASI', (t) => {
  t.deepEqual(
    resolve([...NATIVE_TARGETS, WASI_TARGET], {
      wasm: { optionalDependency: true },
    }),
    {
      ...NATIVE_ENTRIES,
      [`${PACKAGE_NAME}-wasm32-wasi`]: VERSION,
    },
  )
})

test('wasm.optionalDependency=false opts out even for WASI-only builds', (t) => {
  t.deepEqual(
    resolve([WASI_TARGET], { wasm: { optionalDependency: false } }),
    {},
  )
})

test('drops a stale WASI entry left over from a previous release', (t) => {
  // Consumers upgrading from a release that did declare the WASI package must
  // not keep the entry, otherwise the regression survives the fix.
  t.deepEqual(
    resolve([...NATIVE_TARGETS, WASI_TARGET], {
      existing: {
        ...NATIVE_ENTRIES,
        [`${PACKAGE_NAME}-wasm32-wasi`]: '1.2.2',
      },
    }),
    NATIVE_ENTRIES,
  )
})

test('preserves unmanaged optionalDependencies', (t) => {
  t.deepEqual(
    resolve([...NATIVE_TARGETS, WASI_TARGET], {
      existing: { 'unrelated-package': '^1.0.0' },
    }),
    {
      'unrelated-package': '^1.0.0',
      ...NATIVE_ENTRIES,
    },
  )
})

const NPM_PACK_FILES = [
  { path: './package.json' },
  { path: 'dist\\index.js' },
  { path: 42 },
]

test('parses npm 11 pack JSON output', (t) => {
  t.deepEqual(
    [...parseNpmPackFiles(JSON.stringify([{ files: NPM_PACK_FILES }]))],
    ['package.json', 'dist/index.js'],
  )
})

test('parses npm 12 pack JSON output', (t) => {
  t.deepEqual(
    [
      ...parseNpmPackFiles(
        JSON.stringify({
          [PACKAGE_NAME]: { files: NPM_PACK_FILES },
        }),
      ),
    ],
    ['package.json', 'dist/index.js'],
  )
})

test('rejects an unexpected npm pack JSON result', (t) => {
  t.throws(() => parseNpmPackFiles(JSON.stringify({ files: [] })), {
    message: 'npm pack returned an unexpected JSON result',
  })
})
