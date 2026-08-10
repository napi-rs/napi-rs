import { mkdtempSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import test from 'ava'

import {
  collectRootPackagePathReferences,
  parseNpmPackFiles,
  resolveRootOptionalDependencies,
  resolveRootPublisher,
  rootPublisherRewritesRootExports,
  sniffRewritingPublisherFromUserAgent,
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

// pnpm and yarn berry wholesale-replace `exports` with `publishConfig.exports`
// in the published manifest, so under those publishers the root facade
// validation must target the effective map: local-only conditions like
// `dev: ./src/*.ts` never reach the registry and must not fail the packlist
// check. npm and Yarn Classic keep the raw `exports` untouched (publishConfig
// is publish-time configuration only), so both maps must stay valid there.
//
// `prePublish` does not publish the root package, so the publisher is declared
// explicitly (`--root-publisher` / `napi.rootPublisher`). `npm_config_user_agent`
// names the process that invoked this command, which may differ from the root
// publisher, so it never selects a branch — it only enriches the failure.
const PNPM_USER_AGENT = 'pnpm/11.9.0 npm/? node/v24.19.0 darwin arm64'
const YARN_USER_AGENT = 'yarn/4.6.0 npm/? node/v24.19.0 darwin arm64'
const YARN_CLASSIC_USER_AGENT = 'yarn/1.22.22 npm/? node/v24.19.0 darwin arm64'
const NPM_USER_AGENT = 'npm/11.6.2 node/v24.19.0 darwin arm64 workspaces/false'
// A truncated version token must not be read as a major version: an agent we
// cannot parse names no package manager at all.
const MALFORMED_YARN_USER_AGENT = 'yarn/2garbage npm/? node/v24.19.0'
const MALFORMED_PNPM_USER_AGENT = 'pnpm/2garbage npm/? node/v24.19.0'
const PNPM_HINT =
  ' This ran under pnpm, which replaces "exports" with "publishConfig.exports" when it packs: if pnpm also publishes the root package, set napi.rootPublisher to "pnpm" (or pass --root-publisher pnpm) to validate the publish-effective export map instead.'

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

test('only declared pnpm and yarn publishers rewrite the root exports', (t) => {
  t.true(rootPublisherRewritesRootExports('pnpm'))
  t.true(rootPublisherRewritesRootExports('yarn'))
  t.false(rootPublisherRewritesRootExports('npm'))
  t.false(rootPublisherRewritesRootExports('yarn-classic'))
  t.false(rootPublisherRewritesRootExports(undefined))
})

test('resolves the root publisher from the CLI option over the config field', (t) => {
  t.is(resolveRootPublisher(undefined, undefined), undefined)
  t.is(resolveRootPublisher(undefined, 'pnpm'), 'pnpm')
  t.is(resolveRootPublisher('npm', 'pnpm'), 'npm')
  t.is(resolveRootPublisher('yarn-classic', undefined), 'yarn-classic')
  t.throws(() => resolveRootPublisher('pnpm@10', undefined), {
    message:
      'Unknown --root-publisher value "pnpm@10". Expected one of: npm, pnpm, yarn, yarn-classic.',
  })
  t.throws(() => resolveRootPublisher(undefined, 'berry'), {
    message:
      'Unknown napi.rootPublisher value "berry". Expected one of: npm, pnpm, yarn, yarn-classic.',
  })
})

test('sniffs rewriting package managers from the user agent', (t) => {
  t.is(sniffRewritingPublisherFromUserAgent(PNPM_USER_AGENT), 'pnpm')
  t.is(sniffRewritingPublisherFromUserAgent(YARN_USER_AGENT), 'yarn')
  t.is(
    sniffRewritingPublisherFromUserAgent('yarn/2.4.3 npm/? node/v24.19.0'),
    'yarn',
  )
  t.is(sniffRewritingPublisherFromUserAgent(YARN_CLASSIC_USER_AGENT), undefined)
  t.is(
    sniffRewritingPublisherFromUserAgent('yarn/ npm/? node/v24.19.0'),
    undefined,
  )
  t.is(sniffRewritingPublisherFromUserAgent(NPM_USER_AGENT), undefined)
  t.is(
    sniffRewritingPublisherFromUserAgent('bun/1.2.0 node/v24.19.0'),
    undefined,
  )
  // An explicit `undefined` argument falls back to the ambient environment,
  // so pin the environment to "absent" for the no-agent case.
  withNpmUserAgent(undefined, () => {
    t.is(sniffRewritingPublisherFromUserAgent(), undefined)
  })
})

test('requires a complete version token to sniff a rewriting publisher', (t) => {
  // `yarn/2garbage` is not yarn 2 and `pnpm/x` is not pnpm: matching only the
  // numeric prefix (or the bare name) would name the wrong manager in the hint.
  t.is(
    sniffRewritingPublisherFromUserAgent(MALFORMED_YARN_USER_AGENT),
    undefined,
  )
  t.is(sniffRewritingPublisherFromUserAgent('yarn/2garbage'), undefined)
  t.is(sniffRewritingPublisherFromUserAgent('yarn/4.6.0.1 npm/?'), undefined)
  t.is(
    sniffRewritingPublisherFromUserAgent(MALFORMED_PNPM_USER_AGENT),
    undefined,
  )
  t.is(
    sniffRewritingPublisherFromUserAgent('pnpm/x npm/? node/v24.19.0'),
    undefined,
  )
  t.is(sniffRewritingPublisherFromUserAgent('pnpm/'), undefined)
  // Well-formed prerelease and build metadata tails still parse.
  t.is(
    sniffRewritingPublisherFromUserAgent('yarn/4.10.0-git.20250101 npm/?'),
    'yarn',
  )
  t.is(
    sniffRewritingPublisherFromUserAgent('pnpm/10.15.1+sha512.ab npm/?'),
    'pnpm',
  )
})

test('collects publishConfig.exports only for a declared rewriting publisher', (t) => {
  const effectiveOnly = ['dist/helper.cjs', 'dist/index.cjs', 'dist/index.d.ts']
  for (const rootPublisher of ['pnpm', 'yarn'] as const) {
    t.deepEqual(
      collectRootPackagePathReferences(
        EFFECTIVE_EXPORTS_MANIFEST,
        rootPublisher,
      ).sort(),
      effectiveOnly,
    )
  }
})

test('collects the union of exports and publishConfig.exports for every other publisher', (t) => {
  const union = [
    'dist/helper.cjs',
    'dist/index.cjs',
    'dist/index.d.ts',
    'src/helper.ts',
    'src/index.ts',
  ]
  for (const rootPublisher of ['npm', 'yarn-classic', undefined] as const) {
    t.deepEqual(
      collectRootPackagePathReferences(
        EFFECTIVE_EXPORTS_MANIFEST,
        rootPublisher,
      ).sort(),
      union,
    )
  }
})

test('never lets the ambient user agent widen or narrow the validated map', (t) => {
  const union = [
    'dist/helper.cjs',
    'dist/index.cjs',
    'dist/index.d.ts',
    'src/helper.ts',
    'src/index.ts',
  ]
  const effectiveOnly = ['dist/helper.cjs', 'dist/index.cjs', 'dist/index.d.ts']
  for (const agent of [
    PNPM_USER_AGENT,
    YARN_USER_AGENT,
    NPM_USER_AGENT,
    YARN_CLASSIC_USER_AGENT,
    MALFORMED_YARN_USER_AGENT,
    MALFORMED_PNPM_USER_AGENT,
    undefined,
  ]) {
    withNpmUserAgent(agent, () => {
      // No declared publisher: always the conservative union, even under pnpm.
      t.deepEqual(
        collectRootPackagePathReferences(EFFECTIVE_EXPORTS_MANIFEST).sort(),
        union,
      )
      // A declared publisher wins over whatever the agent claims.
      t.deepEqual(
        collectRootPackagePathReferences(
          EFFECTIVE_EXPORTS_MANIFEST,
          'npm',
        ).sort(),
        union,
      )
      t.deepEqual(
        collectRootPackagePathReferences(
          EFFECTIVE_EXPORTS_MANIFEST,
          'pnpm',
        ).sort(),
        effectiveOnly,
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
  for (const rootPublisher of ['pnpm', 'npm', undefined] as const) {
    t.deepEqual(
      collectRootPackagePathReferences(manifest, rootPublisher).sort(),
      rawRefs,
    )
  }
})

test('accepts dev-only export conditions replaced by publishConfig.exports under a declared pnpm publisher', async (t) => {
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
    validateRootFacadePacklist(
      rootDir,
      collectRootPackagePathReferences(EFFECTIVE_EXPORTS_MANIFEST, 'pnpm'),
      'pnpm',
    ),
  )
})

test('rejects dev-only raw export references when no root publisher is declared', async (t) => {
  // Nobody declared a rewriting publisher, so the raw `exports` may ship: the
  // dev sources exist on disk but `files: ['dist']` keeps them out of the
  // packlist. Running under npm adds no hint.
  const rootDir = await createStagedRoot(EFFECTIVE_EXPORTS_MANIFEST, [
    'dist/index.cjs',
    'dist/index.d.ts',
    'dist/helper.cjs',
    'src/index.ts',
    'src/helper.ts',
  ])
  t.teardown(() => rm(rootDir, { recursive: true, force: true }))

  for (const agent of [NPM_USER_AGENT, YARN_CLASSIC_USER_AGENT, undefined]) {
    t.throws(
      () =>
        withNpmUserAgent(agent, () =>
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
  }
  // Declaring npm explicitly keeps the same failure, still without a hint.
  t.throws(
    () =>
      withNpmUserAgent(PNPM_USER_AGENT, () =>
        validateRootFacadePacklist(
          rootDir,
          collectRootPackagePathReferences(EFFECTIVE_EXPORTS_MANIFEST, 'npm'),
          'npm',
        ),
      ),
    {
      message:
        'The threadless WASI root package references paths omitted by npm pack: src/index.ts, src/helper.ts. Add them to package.json "files" or remove the matching .npmignore rules.',
    },
  )
})

test('points an undeclared publisher at the option when a rewriting manager is running', async (t) => {
  // The union branch failed while pnpm invoked us: pnpm may well be the root
  // publisher, so name the option instead of leaving the user to guess.
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
      withNpmUserAgent(PNPM_USER_AGENT, () =>
        validateRootFacadePacklist(
          rootDir,
          collectRootPackagePathReferences(EFFECTIVE_EXPORTS_MANIFEST),
        ),
      ),
    {
      message: `The threadless WASI root package references paths omitted by npm pack: src/index.ts, src/helper.ts. Add them to package.json "files" or remove the matching .npmignore rules.${PNPM_HINT}`,
    },
  )
  // Yarn berry gets its own name; a malformed agent gets no hint at all.
  const yarnError = t.throws(() =>
    withNpmUserAgent(YARN_USER_AGENT, () =>
      validateRootFacadePacklist(
        rootDir,
        collectRootPackagePathReferences(EFFECTIVE_EXPORTS_MANIFEST),
      ),
    ),
  )
  t.true(yarnError!.message.includes('set napi.rootPublisher to "yarn"'))
  const malformedError = t.throws(() =>
    withNpmUserAgent(MALFORMED_PNPM_USER_AGENT, () =>
      validateRootFacadePacklist(
        rootDir,
        collectRootPackagePathReferences(EFFECTIVE_EXPORTS_MANIFEST),
      ),
    ),
  )
  t.false(malformedError!.message.includes('napi.rootPublisher'))
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
          collectRootPackagePathReferences(manifest, 'pnpm'),
          'pnpm',
        ),
      ),
    {
      message:
        'The threadless WASI root package references paths omitted by npm pack: dist/helper.cjs. Add them to package.json "files" or remove the matching .npmignore rules.',
    },
  )
  for (const rootPublisher of ['npm', 'yarn-classic'] as const) {
    t.throws(
      () =>
        validateRootFacadePacklist(
          rootDir,
          collectRootPackagePathReferences(manifest, rootPublisher),
          rootPublisher,
        ),
      {
        message:
          'The threadless WASI root package references paths omitted by npm pack: src/index.ts, src/helper.ts, dist/helper.cjs. Add them to package.json "files" or remove the matching .npmignore rules.',
      },
    )
  }
})
