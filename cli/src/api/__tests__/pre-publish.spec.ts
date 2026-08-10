import { mkdtempSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import test from 'ava'

import {
  collectRootPackagePathReferences,
  parseNpmPackFiles,
  publisherRewritesPublishConfigExports,
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

// pnpm and yarn wholesale-replace `exports` with `publishConfig.exports` in
// the published manifest, so under those publishers the root facade validation
// must target the effective map: local-only conditions like `dev: ./src/*.ts`
// never reach the registry and must not fail the packlist check. npm keeps the
// raw `exports` untouched (publishConfig is publish-time configuration only),
// so under npm — or an unknown publisher — both maps must stay valid. The
// publisher is sniffed from `npm_config_user_agent`.
const PNPM_USER_AGENT = 'pnpm/11.9.0 npm/? node/v24.19.0 darwin arm64'
const YARN_USER_AGENT = 'yarn/4.6.0 npm/? node/v24.19.0 darwin arm64'
// Yarn Classic packs the raw manifest (no publishConfig.exports rewrite), so
// it must be treated like npm despite the matching `yarn/` prefix.
const YARN_CLASSIC_USER_AGENT = 'yarn/1.22.22 npm/? node/v24.19.0 darwin arm64'
const NPM_USER_AGENT = 'npm/11.6.2 node/v24.19.0 darwin arm64 workspaces/false'

function withNpmUserAgent<T>(agent: string | undefined, fn: () => T): T {
  const previous = process.env.npm_config_user_agent
  if (agent === undefined) {
    delete process.env.npm_config_user_agent
  } else {
    process.env.npm_config_user_agent = agent
  }
  try {
    return fn()
  } finally {
    if (previous === undefined) {
      delete process.env.npm_config_user_agent
    } else {
      process.env.npm_config_user_agent = previous
    }
  }
}

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
  stagedFiles: string[],
) {
  const rootDir = mkdtempSync(join(tmpdir(), 'napi-pre-publish-spec-'))
  await writeFile(join(rootDir, 'package.json'), JSON.stringify(manifest))
  for (const file of stagedFiles) {
    await mkdir(join(rootDir, dirname(file)), { recursive: true })
    await writeFile(join(rootDir, file), '// content\n')
  }
  return rootDir
}

test('detects manifest-rewriting publishers from the user agent', (t) => {
  t.true(publisherRewritesPublishConfigExports(PNPM_USER_AGENT))
  t.true(publisherRewritesPublishConfigExports(YARN_USER_AGENT))
  t.true(
    publisherRewritesPublishConfigExports('yarn/2.4.3 npm/? node/v24.19.0'),
  )
  t.false(publisherRewritesPublishConfigExports(YARN_CLASSIC_USER_AGENT))
  t.false(publisherRewritesPublishConfigExports('yarn/ npm/? node/v24.19.0'))
  t.false(publisherRewritesPublishConfigExports(NPM_USER_AGENT))
  t.false(publisherRewritesPublishConfigExports('bun/1.2.0 node/v24.19.0'))
  // An explicit `undefined` argument falls back to the ambient environment,
  // so pin the environment to "absent" for the no-agent case.
  withNpmUserAgent(undefined, () => {
    t.false(publisherRewritesPublishConfigExports())
  })
})

test('collects publishConfig.exports only under a rewriting publisher', (t) => {
  const effectiveOnly = ['dist/helper.cjs', 'dist/index.cjs', 'dist/index.d.ts']
  for (const agent of [PNPM_USER_AGENT, YARN_USER_AGENT]) {
    withNpmUserAgent(agent, () => {
      t.deepEqual(
        collectRootPackagePathReferences(EFFECTIVE_EXPORTS_MANIFEST).sort(),
        effectiveOnly,
      )
    })
  }
})

test('collects the union of exports and publishConfig.exports under npm or an unknown publisher', (t) => {
  const union = [
    'dist/helper.cjs',
    'dist/index.cjs',
    'dist/index.d.ts',
    'src/helper.ts',
    'src/index.ts',
  ]
  for (const agent of [NPM_USER_AGENT, YARN_CLASSIC_USER_AGENT, undefined]) {
    withNpmUserAgent(agent, () => {
      t.deepEqual(
        collectRootPackagePathReferences(EFFECTIVE_EXPORTS_MANIFEST).sort(),
        union,
      )
    })
  }
})

test('falls back to raw exports without publishConfig.exports', (t) => {
  const manifest = {
    ...EFFECTIVE_EXPORTS_MANIFEST,
    publishConfig: { access: 'public' },
  }
  const rawRefs = [
    'dist/helper.cjs',
    'dist/index.cjs',
    'dist/index.d.ts',
    'src/helper.ts',
    'src/index.ts',
  ]
  for (const agent of [PNPM_USER_AGENT, NPM_USER_AGENT, undefined]) {
    withNpmUserAgent(agent, () => {
      t.deepEqual(collectRootPackagePathReferences(manifest).sort(), rawRefs)
    })
  }
})

test('accepts dev-only export conditions replaced by publishConfig.exports under pnpm', async (t) => {
  // The raw `exports` references src/*.ts files that are neither on disk nor
  // in the packlist; under a rewriting publisher only the publish-effective
  // references must survive pack.
  const rootDir = await createStagedRoot(EFFECTIVE_EXPORTS_MANIFEST, [
    'dist/index.cjs',
    'dist/index.d.ts',
    'dist/helper.cjs',
  ])
  t.teardown(() => rm(rootDir, { recursive: true, force: true }))

  t.notThrows(() =>
    withNpmUserAgent(PNPM_USER_AGENT, () =>
      validateRootFacadePacklist(
        rootDir,
        collectRootPackagePathReferences(EFFECTIVE_EXPORTS_MANIFEST),
      ),
    ),
  )
})

test('rejects dev-only raw export references under npm', async (t) => {
  // npm publishes the raw `exports` untouched, so the same manifest must keep
  // failing when the publisher does not rewrite it: the dev sources exist on
  // disk but `files: ['dist']` keeps them out of the packlist.
  const rootDir = await createStagedRoot(EFFECTIVE_EXPORTS_MANIFEST, [
    'dist/index.cjs',
    'dist/index.d.ts',
    'dist/helper.cjs',
    'src/index.ts',
    'src/helper.ts',
  ])
  t.teardown(() => rm(rootDir, { recursive: true, force: true }))

  t.throws(
    () =>
      withNpmUserAgent(NPM_USER_AGENT, () =>
        validateRootFacadePacklist(
          rootDir,
          collectRootPackagePathReferences(EFFECTIVE_EXPORTS_MANIFEST),
        ),
      ),
    {
      message:
        'The threadless WASI root package references paths omitted by npm pack: src/index.ts, src/helper.ts. Add them to package.json "files" or remove the matching .npmignore rules.',
    },
  )
})

test('still rejects publishConfig.exports references omitted by npm pack', async (t) => {
  const manifest = {
    ...EFFECTIVE_EXPORTS_MANIFEST,
    // Restrict the packlist so dist/helper.cjs exists on disk but is not
    // packed: the effective exports validation must keep failing under both
    // publisher kinds.
    files: ['dist/index.cjs', 'dist/index.d.ts'],
  }
  const rootDir = await createStagedRoot(manifest, [
    'dist/index.cjs',
    'dist/index.d.ts',
    'dist/helper.cjs',
    'src/index.ts',
    'src/helper.ts',
  ])
  t.teardown(() => rm(rootDir, { recursive: true, force: true }))

  t.throws(
    () =>
      withNpmUserAgent(PNPM_USER_AGENT, () =>
        validateRootFacadePacklist(
          rootDir,
          collectRootPackagePathReferences(manifest),
        ),
      ),
    {
      message:
        'The threadless WASI root package references paths omitted by npm pack: dist/helper.cjs. Add them to package.json "files" or remove the matching .npmignore rules.',
    },
  )
  for (const agent of [NPM_USER_AGENT, YARN_CLASSIC_USER_AGENT]) {
    t.throws(
      () =>
        withNpmUserAgent(agent, () =>
          validateRootFacadePacklist(
            rootDir,
            collectRootPackagePathReferences(manifest),
          ),
        ),
      {
        message:
          'The threadless WASI root package references paths omitted by npm pack: src/index.ts, src/helper.ts, dist/helper.cjs. Add them to package.json "files" or remove the matching .npmignore rules.',
      },
    )
  }
})
