import { mkdtempSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import test from 'ava'

import {
  collectRootPackagePathReferences,
  parseNpmPackFiles,
  resolveRootOptionalDependencies,
  validateRootFacadePacklist,
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

// `publishConfig.exports` wholesale-replaces `exports` in the published
// manifest (npm/pnpm/yarn), so the root facade validation must target the
// effective map: local-only conditions like `dev: ./src/*.ts` never reach the
// registry and must not fail the packlist check.
const EFFECTIVE_EXPORTS_MANIFEST = {
  name: PACKAGE_NAME,
  version: VERSION,
  main: './dist/index.cjs',
  types: './dist/index.d.ts',
  files: ['dist'],
  exports: {
    '.': {
      dev: './src/index.ts',
      types: './dist/index.d.ts',
      default: './dist/index.cjs',
    },
    './helper': {
      dev: './src/helper.ts',
      default: './dist/helper.cjs',
    },
  },
  publishConfig: {
    exports: {
      '.': {
        types: './dist/index.d.ts',
        default: './dist/index.cjs',
      },
      './helper': './dist/helper.cjs',
    },
  },
}

async function createStagedRoot(
  manifest: Record<string, unknown>,
  distFiles: string[],
) {
  const rootDir = mkdtempSync(join(tmpdir(), 'napi-pre-publish-spec-'))
  await mkdir(join(rootDir, 'dist'), { recursive: true })
  await writeFile(join(rootDir, 'package.json'), JSON.stringify(manifest))
  for (const file of distFiles) {
    await writeFile(join(rootDir, file), '// content\n')
  }
  return rootDir
}

test('collects export references from publishConfig.exports only', (t) => {
  t.deepEqual(
    collectRootPackagePathReferences(EFFECTIVE_EXPORTS_MANIFEST).sort(),
    ['dist/helper.cjs', 'dist/index.cjs', 'dist/index.d.ts'],
  )
})

test('falls back to raw exports without publishConfig.exports', (t) => {
  const manifest = {
    ...EFFECTIVE_EXPORTS_MANIFEST,
    publishConfig: { access: 'public' },
  }
  t.deepEqual(collectRootPackagePathReferences(manifest).sort(), [
    'dist/helper.cjs',
    'dist/index.cjs',
    'dist/index.d.ts',
    'src/helper.ts',
    'src/index.ts',
  ])
})

test('accepts dev-only export conditions replaced by publishConfig.exports', async (t) => {
  // The raw `exports` references src/*.ts files that are neither on disk nor
  // in the packlist; only the publish-effective references must survive pack.
  const rootDir = await createStagedRoot(EFFECTIVE_EXPORTS_MANIFEST, [
    'dist/index.cjs',
    'dist/index.d.ts',
    'dist/helper.cjs',
  ])
  t.teardown(() => rm(rootDir, { recursive: true, force: true }))

  t.notThrows(() =>
    validateRootFacadePacklist(
      rootDir,
      collectRootPackagePathReferences(EFFECTIVE_EXPORTS_MANIFEST),
    ),
  )
})

test('still rejects publishConfig.exports references omitted by npm pack', async (t) => {
  const manifest = {
    ...EFFECTIVE_EXPORTS_MANIFEST,
    // Restrict the packlist so dist/helper.cjs exists on disk but is not
    // packed: the effective exports validation must keep failing.
    files: ['dist/index.cjs', 'dist/index.d.ts'],
  }
  const rootDir = await createStagedRoot(manifest, [
    'dist/index.cjs',
    'dist/index.d.ts',
    'dist/helper.cjs',
  ])
  t.teardown(() => rm(rootDir, { recursive: true, force: true }))

  t.throws(
    () =>
      validateRootFacadePacklist(
        rootDir,
        collectRootPackagePathReferences(manifest),
      ),
    {
      message:
        'The threadless WASI root package references paths omitted by npm pack: dist/helper.cjs. Add them to package.json "files" or remove the matching .npmignore rules.',
    },
  )
})
