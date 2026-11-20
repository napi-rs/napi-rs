import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

import {
  type CargoWorkspaceMetadata,
  collectRequestedFeatures,
  createCargoMetadataInvocation,
  getNapiDeriveDependentCrates,
  parseMetadata,
} from '../metadata.js'

const FIXTURE_WORKSPACE = join(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
  'optional-napi-derive',
)

test('should surface child process startup errors', async (t) => {
  const manifestPath = join(
    tmpdir(),
    `napi-rs-metadata-${process.pid}-${Date.now()}.toml`,
  )
  const originalPath = process.env.PATH

  await writeFile(manifestPath, '[package]\nname = "test"\nversion = "0.0.0"\n')
  process.env.PATH = ''

  try {
    const error = await t.throwsAsync(() => parseMetadata(manifestPath))
    t.truthy(error)
    t.is(error?.message, 'cargo metadata failed to run')
    t.is((error?.cause as NodeJS.ErrnoException | undefined)?.code, 'ENOENT')
  } finally {
    process.env.PATH = originalPath
    await unlink(manifestPath)
  }
})

test('should exclude crates whose optional napi-derive dependency is disabled', async (t) => {
  const metadata = await parseMetadata(
    join(FIXTURE_WORKSPACE, 'main-crate', 'Cargo.toml'),
  )
  const dependentCrates = getNapiDeriveDependentCrates(metadata).map(
    (crate) => crate.name,
  )
  t.deepEqual(dependentCrates, ['main-crate'])
})

test('should include crates whose optional napi-derive dependency is enabled via build features', async (t) => {
  const metadata = await parseMetadata(
    join(FIXTURE_WORKSPACE, 'with-optional-derive', 'Cargo.toml'),
    {
      features: ['node'],
    },
  )
  const dependentCrates = getNapiDeriveDependentCrates(metadata).map(
    (crate) => crate.name,
  )
  t.true(dependentCrates.includes('with-optional-derive'))
})

test('should include dependency crate enabled via explicit dep/feature on root build', async (t) => {
  const metadata = await parseMetadata(
    join(FIXTURE_WORKSPACE, 'main-crate', 'Cargo.toml'),
    {
      features: ['with-optional-derive/node'],
    },
  )
  const mainCrate = metadata.packages.find((pkg) => pkg.name === 'main-crate')
  t.truthy(mainCrate)
  const dependentCrates = getNapiDeriveDependentCrates(
    metadata,
    mainCrate!.id,
    ['with-optional-derive/node'],
  )
    .map((crate) => crate.name)
    .sort()
  t.deepEqual(dependentCrates, ['main-crate', 'with-optional-derive'])
})

test('should fall back to declared dependencies when the resolve graph is unavailable', async (t) => {
  const metadata = await parseMetadata(
    join(FIXTURE_WORKSPACE, 'main-crate', 'Cargo.toml'),
  )
  metadata.resolve = null
  const dependentCrates = getNapiDeriveDependentCrates(metadata)
    .map((crate) => crate.name)
    .sort()
  t.deepEqual(dependentCrates, ['main-crate', 'with-optional-derive'])
})

function makeSyntheticMetadata(options: {
  napiDeriveFeatures?: Record<string, string[]>
  resolvedNapiDeriveFeatures?: string[]
  includeResolve?: boolean
}): CargoWorkspaceMetadata {
  const deriveId = 'registry+https://crates.io#napi-derive@3.0.0'
  const addonId = 'path+file:///ws/addon#addon@0.1.0'
  const helperId = 'path+file:///ws/helper#helper@0.1.0'
  const otherAddonId = 'path+file:///ws/other#other@0.1.0'
  const devOnlyId = 'path+file:///ws/dev-only#dev-only@0.1.0'
  const buildOnlyId = 'path+file:///ws/build-only#build-only@0.1.0'
  const transitiveParentId = 'path+file:///ws/parent#parent@0.1.0'
  const devParentId = 'path+file:///ws/dev-parent#dev-parent@0.1.0'
  const noTypeDefId = 'path+file:///ws/no-type-def#no-type-def@0.1.0'

  const depDecl = (
    name: string,
    overrides: Partial<
      CargoWorkspaceMetadata['packages'][number]['dependencies'][number]
    > = {},
  ) => ({
    name,
    source: null,
    req: '*',
    kind: null,
    rename: null,
    optional: false,
    uses_default_features: true,
    features: [],
    target: null,
    registry: null,
    ...overrides,
  })

  const pkg = (
    id: string,
    name: string,
    dependencies: CargoWorkspaceMetadata['packages'][number]['dependencies'] = [],
    features: Record<string, string[]> = {},
  ): CargoWorkspaceMetadata['packages'][number] => ({
    id,
    name,
    src_path: `/ws/${name}/src/lib.rs`,
    version: '0.1.0',
    edition: '2021',
    targets: [{ name, kind: ['lib'], crate_types: ['lib'] }],
    features,
    manifest_path: `/ws/${name}/Cargo.toml`,
    dependencies,
  })

  return {
    version: 1,
    workspace_root: '/ws',
    target_directory: '/ws/target',
    workspace_members: [
      addonId,
      helperId,
      otherAddonId,
      devOnlyId,
      buildOnlyId,
      transitiveParentId,
      devParentId,
      noTypeDefId,
    ],
    packages: [
      pkg(
        deriveId,
        'napi-derive',
        [],
        options.napiDeriveFeatures ?? {
          default: ['type-def'],
          'type-def': [],
        },
      ),
      pkg(addonId, 'addon', [depDecl('napi-derive')]),
      pkg(helperId, 'helper', [depDecl('napi-derive')]),
      pkg(otherAddonId, 'other', [depDecl('napi-derive')]),
      pkg(devOnlyId, 'dev-only', [depDecl('napi-derive', { kind: 'dev' })]),
      pkg(buildOnlyId, 'build-only', [
        depDecl('napi-derive', { kind: 'build' }),
      ]),
      pkg(transitiveParentId, 'parent', [depDecl('helper')]),
      pkg(devParentId, 'dev-parent', [depDecl('helper', { kind: 'dev' })]),
      pkg(noTypeDefId, 'no-type-def', [
        depDecl('napi-derive', { uses_default_features: false, features: [] }),
      ]),
    ],
    resolve:
      options.includeResolve === false
        ? null
        : {
            root: null,
            nodes: [
              {
                id: deriveId,
                dependencies: [],
                deps: [],
                features: options.resolvedNapiDeriveFeatures ?? [
                  'default',
                  'type-def',
                ],
              },
              {
                id: addonId,
                dependencies: [deriveId],
                deps: [
                  {
                    name: 'napi_derive',
                    pkg: deriveId,
                    dep_kinds: [{ kind: null, target: null }],
                  },
                ],
                features: [],
              },
              {
                id: helperId,
                dependencies: [deriveId],
                deps: [
                  {
                    name: 'napi_derive',
                    pkg: deriveId,
                    dep_kinds: [{ kind: null, target: null }],
                  },
                ],
                features: [],
              },
              {
                id: otherAddonId,
                dependencies: [deriveId],
                deps: [
                  {
                    name: 'napi_derive',
                    pkg: deriveId,
                    dep_kinds: [{ kind: null, target: null }],
                  },
                ],
                features: [],
              },
              {
                id: devOnlyId,
                dependencies: [deriveId],
                deps: [
                  {
                    name: 'napi_derive',
                    pkg: deriveId,
                    dep_kinds: [{ kind: 'dev', target: null }],
                  },
                ],
                features: [],
              },
              {
                id: buildOnlyId,
                dependencies: [deriveId],
                deps: [
                  {
                    name: 'napi_derive',
                    pkg: deriveId,
                    dep_kinds: [{ kind: 'build', target: null }],
                  },
                ],
                features: [],
              },
              {
                id: transitiveParentId,
                dependencies: [helperId],
                deps: [
                  {
                    name: 'helper',
                    pkg: helperId,
                    dep_kinds: [{ kind: null, target: null }],
                  },
                ],
                features: [],
              },
              {
                id: devParentId,
                dependencies: [helperId],
                deps: [
                  {
                    name: 'helper',
                    pkg: helperId,
                    dep_kinds: [{ kind: 'dev', target: null }],
                  },
                ],
                features: [],
              },
              {
                id: noTypeDefId,
                dependencies: [deriveId],
                deps: [
                  {
                    name: 'napi_derive',
                    pkg: deriveId,
                    dep_kinds: [{ kind: null, target: null }],
                  },
                ],
                features: [],
              },
            ],
          },
  }
}

test('getNapiDeriveDependentCrates scopes to rootPackageId and includes transitive helper crates', (t) => {
  const metadata = makeSyntheticMetadata({})
  const addonId = 'path+file:///ws/addon#addon@0.1.0'
  const parentId = 'path+file:///ws/parent#parent@0.1.0'
  const devParentId = 'path+file:///ws/dev-parent#dev-parent@0.1.0'

  t.deepEqual(
    getNapiDeriveDependentCrates(metadata, addonId).map((c) => c.name),
    ['addon'],
  )
  t.deepEqual(
    getNapiDeriveDependentCrates(metadata, parentId).map((c) => c.name),
    ['helper'],
  )
  t.deepEqual(
    getNapiDeriveDependentCrates(metadata, devParentId).map((c) => c.name),
    [],
  )
})

test('getNapiDeriveDependentCrates excludes dev-only and build-only dependencies', (t) => {
  const metadata = makeSyntheticMetadata({})
  const names = getNapiDeriveDependentCrates(metadata)
    .map((c) => c.name)
    .sort()
  t.false(names.includes('dev-only'))
  t.false(names.includes('build-only'))
  t.true(names.includes('addon'))
  t.true(names.includes('helper'))

  const fallbackMetadata = makeSyntheticMetadata({ includeResolve: false })
  const fallbackNames = getNapiDeriveDependentCrates(fallbackMetadata)
    .map((c) => c.name)
    .sort()
  t.deepEqual(fallbackNames, ['addon', 'helper', 'other'])
  t.false(fallbackNames.includes('dev-only'))
  t.false(fallbackNames.includes('build-only'))
  t.false(fallbackNames.includes('no-type-def'))
})

test('getNapiDeriveDependentCrates excludes crates when napi-derive type-def feature is disabled', (t) => {
  const disabled = makeSyntheticMetadata({
    resolvedNapiDeriveFeatures: [],
  })
  t.deepEqual(getNapiDeriveDependentCrates(disabled), [])
  t.deepEqual(
    getNapiDeriveDependentCrates(disabled, 'path+file:///ws/addon#addon@0.1.0'),
    [],
  )

  // Mixed-feature workspace: sibling `other` enables `type-def` in workspace
  // resolve, but `no-type-def` opts out (`default-features = false, features = []`).
  const mixed = makeSyntheticMetadata({})
  t.deepEqual(
    getNapiDeriveDependentCrates(
      mixed,
      'path+file:///ws/no-type-def#no-type-def@0.1.0',
    ),
    [],
  )

  // `noop` feature on napi-derive also disables type-def emission
  const noop = makeSyntheticMetadata({
    napiDeriveFeatures: {
      default: ['type-def'],
      'type-def': [],
      noop: [],
    },
    resolvedNapiDeriveFeatures: ['default', 'type-def', 'noop'],
  })
  t.deepEqual(getNapiDeriveDependentCrates(noop), [])

  // Minimal stub napi-derive without a `type-def` feature table still passes
  const stub = makeSyntheticMetadata({
    napiDeriveFeatures: {},
    resolvedNapiDeriveFeatures: [],
  })
  t.deepEqual(
    getNapiDeriveDependentCrates(stub, 'path+file:///ws/addon#addon@0.1.0').map(
      (c) => c.name,
    ),
    ['addon'],
  )
})

test('getNapiDeriveDependentCrates ignores workspace-unified features on memory-testing', async (t) => {
  const repoRoot = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    '..',
  )
  const metadata = await parseMetadata(
    join(repoRoot, 'memory-testing', 'Cargo.toml'),
  )
  const memoryTesting = metadata.packages.find(
    (pkg) => pkg.name === 'memory-testing',
  )
  t.truthy(memoryTesting)
  // `memory-testing` disables `napi-derive` default features (`compat-mode` only),
  // even though workspace siblings unify `type-def` onto `napi-derive` in `resolve`.
  t.deepEqual(getNapiDeriveDependentCrates(metadata, memoryTesting!.id), [])
})

test('getNapiDeriveDependentCrates ignores optional transitive napi-derive enabled only by another workspace member', (t) => {
  const deriveId = 'registry+https://crates.io#napi-derive@3.0.0'
  const sharedHelperId = 'path+file:///ws/shared#shared@0.1.0'
  const plainAddonId = 'path+file:///ws/plain#plain@0.1.0'
  const typedAddonId = 'path+file:///ws/typed#typed@0.1.0'

  const dep = (
    name: string,
    overrides: Partial<
      CargoWorkspaceMetadata['packages'][number]['dependencies'][number]
    > = {},
  ) => ({
    name,
    source: null,
    req: '*',
    kind: null,
    rename: null,
    optional: false,
    uses_default_features: true,
    features: [],
    target: null,
    registry: null,
    ...overrides,
  })

  const metadata: CargoWorkspaceMetadata = {
    version: 1,
    workspace_root: '/ws',
    target_directory: '/ws/target',
    workspace_members: [sharedHelperId, plainAddonId, typedAddonId],
    packages: [
      {
        id: deriveId,
        name: 'napi-derive',
        src_path: '/cargo/napi-derive/src/lib.rs',
        version: '3.0.0',
        edition: '2021',
        targets: [{ name: 'napi_derive', kind: ['lib'], crate_types: ['lib'] }],
        features: { default: ['type-def'], 'type-def': [] },
        manifest_path: '/cargo/napi-derive/Cargo.toml',
        dependencies: [],
      },
      {
        id: sharedHelperId,
        name: 'shared',
        src_path: '/ws/shared/src/lib.rs',
        version: '0.1.0',
        edition: '2021',
        targets: [{ name: 'shared', kind: ['lib'], crate_types: ['lib'] }],
        features: { napi: ['dep:napi-derive'] },
        manifest_path: '/ws/shared/Cargo.toml',
        dependencies: [dep('napi-derive', { optional: true })],
      },
      {
        id: plainAddonId,
        name: 'plain',
        src_path: '/ws/plain/src/lib.rs',
        version: '0.1.0',
        edition: '2021',
        targets: [{ name: 'plain', kind: ['cdylib'], crate_types: ['cdylib'] }],
        features: {},
        manifest_path: '/ws/plain/Cargo.toml',
        dependencies: [dep('shared', { uses_default_features: false })],
      },
      {
        id: typedAddonId,
        name: 'typed',
        src_path: '/ws/typed/src/lib.rs',
        version: '0.1.0',
        edition: '2021',
        targets: [{ name: 'typed', kind: ['cdylib'], crate_types: ['cdylib'] }],
        features: {},
        manifest_path: '/ws/typed/Cargo.toml',
        dependencies: [dep('shared', { features: ['napi'] })],
      },
    ],
    resolve: {
      root: null,
      nodes: [
        {
          id: deriveId,
          dependencies: [],
          deps: [],
          features: ['default', 'type-def'],
        },
        {
          id: sharedHelperId,
          dependencies: [deriveId],
          deps: [
            {
              name: 'napi_derive',
              pkg: deriveId,
              dep_kinds: [{ kind: null, target: null }],
            },
          ],
          features: ['napi'],
        },
        {
          id: plainAddonId,
          dependencies: [sharedHelperId],
          deps: [
            {
              name: 'shared',
              pkg: sharedHelperId,
              dep_kinds: [{ kind: null, target: null }],
            },
          ],
          features: [],
        },
        {
          id: typedAddonId,
          dependencies: [sharedHelperId],
          deps: [
            {
              name: 'shared',
              pkg: sharedHelperId,
              dep_kinds: [{ kind: null, target: null }],
            },
          ],
          features: [],
        },
      ],
    },
  }

  t.deepEqual(getNapiDeriveDependentCrates(metadata, plainAddonId), [])
  t.deepEqual(
    getNapiDeriveDependentCrates(metadata, plainAddonId, ['shared/napi']).map(
      (c) => c.name,
    ),
    ['shared'],
  )
  t.deepEqual(
    getNapiDeriveDependentCrates(metadata, typedAddonId).map((c) => c.name),
    ['shared'],
  )
})

test('collectRequestedFeatures collects features from options and cargoOptions before --', (t) => {
  t.deepEqual(
    collectRequestedFeatures(
      ['alpha,beta'],
      [
        '--features',
        'helper/node',
        '-Fextra',
        '--features=gamma delta',
        '--',
        '--features',
        'ignored/feat',
      ],
    ),
    ['alpha', 'beta', 'helper/node', 'extra', 'gamma', 'delta'],
  )
})

test('getNapiDeriveDependentCrates seeds root features from selected build, ignoring sibling workspace unification', (t) => {
  const deriveId = 'registry+https://crates.io#napi-derive@3.0.0'
  const addonId = 'path+file:///ws/addon#addon@0.1.0'
  const docToolId = 'path+file:///ws/doc-tool#doc-tool@0.1.0'

  // `doc-tool` depends on `addon` with `features = ["docs"]`, which enables
  // `napi-derive/noop`. Workspace-wide `cargo metadata` therefore reports
  // `docs` in `addon`'s resolve node even when building `addon` alone.
  const metadata: CargoWorkspaceMetadata = {
    packages: [
      {
        id: deriveId,
        name: 'napi-derive',
        version: '3.0.0',
        manifest_path: '/cargo/napi-derive/Cargo.toml',
        targets: [],
        dependencies: [],
        features: {
          default: ['type-def'],
          'type-def': [],
          noop: [],
        },
      },
      {
        id: addonId,
        name: 'addon',
        version: '0.1.0',
        manifest_path: '/ws/addon/Cargo.toml',
        targets: [],
        dependencies: [
          {
            name: 'napi-derive',
            req: '^3.0.0',
            kind: null,
            rename: null,
            optional: false,
            uses_default_features: true,
            features: [],
            target: null,
          },
        ],
        features: {
          default: [],
          docs: ['napi-derive/noop'],
        },
      },
      {
        id: docToolId,
        name: 'doc-tool',
        version: '0.1.0',
        manifest_path: '/ws/doc-tool/Cargo.toml',
        targets: [],
        dependencies: [
          {
            name: 'addon',
            req: '^0.1.0',
            kind: null,
            rename: null,
            optional: false,
            uses_default_features: true,
            features: ['docs'],
            target: null,
          },
        ],
        features: {},
      },
    ],
    workspace_members: [addonId, docToolId],
    workspace_root: '/ws',
    target_directory: '/ws/target',
    metadata: null,
    version: 1,
    resolve: {
      nodes: [
        {
          id: deriveId,
          dependencies: [],
          deps: [],
          features: ['default', 'type-def', 'noop'],
        },
        {
          id: addonId,
          dependencies: [deriveId],
          deps: [
            {
              name: 'napi_derive',
              pkg: deriveId,
              dep_kinds: [{ kind: null, target: null }],
            },
          ],
          features: ['default', 'docs'],
        },
        {
          id: docToolId,
          dependencies: [addonId],
          deps: [
            {
              name: 'addon',
              pkg: addonId,
              dep_kinds: [{ kind: null, target: null }],
            },
          ],
          features: [],
        },
      ],
    },
  }

  // Building `addon` with default features only must NOT inherit `docs` from `doc-tool`.
  t.deepEqual(
    getNapiDeriveDependentCrates(metadata, addonId, {
      features: [],
      allFeatures: false,
      noDefaultFeatures: false,
    }).map((c) => c.name),
    ['addon'],
  )

  // Explicitly enabling `docs` (or `--all-features`) activates `noop` and disables typedefs.
  t.deepEqual(
    getNapiDeriveDependentCrates(metadata, addonId, {
      features: ['docs'],
      allFeatures: false,
      noDefaultFeatures: false,
    }),
    [],
  )
  t.deepEqual(
    getNapiDeriveDependentCrates(metadata, addonId, {
      features: [],
      allFeatures: true,
      noDefaultFeatures: false,
    }),
    [],
  )
})

test('getNapiDeriveDependentCrates matches unrenamed dependencies by Cargo library target name', (t) => {
  const deriveId = 'registry+https://crates.io#napi-derive@3.0.0'
  const helperId = 'path+file:///ws/helper-package#helper-package@0.1.0'
  const addonId = 'path+file:///ws/addon#addon@0.1.0'
  const siblingId = 'path+file:///ws/sibling#sibling@0.1.0'

  // `helper-package` sets `[lib] name = "helper_impl"`, so Cargo reports
  // `resolveDep.name === "helper_impl"`. `sibling` enables `helper-package/noop`
  // which must NOT leak into `addon` when `addon` builds without it.
  const metadata: CargoWorkspaceMetadata = {
    packages: [
      {
        id: deriveId,
        name: 'napi-derive',
        version: '3.0.0',
        manifest_path: '/cargo/napi-derive/Cargo.toml',
        targets: [],
        dependencies: [],
        features: {
          default: ['type-def'],
          'type-def': [],
          noop: [],
        },
      },
      {
        id: helperId,
        name: 'helper-package',
        version: '0.1.0',
        manifest_path: '/ws/helper-package/Cargo.toml',
        targets: [
          {
            kind: ['lib'],
            crate_types: ['lib'],
            name: 'helper_impl',
            src_path: '/ws/helper-package/src/lib.rs',
            edition: '2021',
            doc: true,
            doctest: true,
            test: true,
          },
        ],
        dependencies: [
          {
            name: 'napi-derive',
            req: '^3.0.0',
            kind: null,
            rename: null,
            optional: false,
            uses_default_features: true,
            features: [],
            target: null,
          },
        ],
        features: {
          default: [],
          noop: ['napi-derive/noop'],
        },
      },
      {
        id: addonId,
        name: 'addon',
        version: '0.1.0',
        manifest_path: '/ws/addon/Cargo.toml',
        targets: [],
        dependencies: [
          {
            name: 'helper-package',
            req: '^0.1.0',
            kind: null,
            rename: null,
            optional: false,
            uses_default_features: true,
            features: [],
            target: null,
          },
        ],
        features: { default: [] },
      },
      {
        id: siblingId,
        name: 'sibling',
        version: '0.1.0',
        manifest_path: '/ws/sibling/Cargo.toml',
        targets: [],
        dependencies: [
          {
            name: 'helper-package',
            req: '^0.1.0',
            kind: null,
            rename: null,
            optional: false,
            uses_default_features: true,
            features: ['noop'],
            target: null,
          },
        ],
        features: {},
      },
    ],
    workspace_members: [helperId, addonId, siblingId],
    workspace_root: '/ws',
    target_directory: '/ws/target',
    metadata: null,
    version: 1,
    resolve: {
      nodes: [
        {
          id: deriveId,
          dependencies: [],
          deps: [],
          features: ['default', 'type-def', 'noop'],
        },
        {
          id: helperId,
          dependencies: [deriveId],
          deps: [
            {
              name: 'napi_derive',
              pkg: deriveId,
              dep_kinds: [{ kind: null, target: null }],
            },
          ],
          features: ['default', 'noop'],
        },
        {
          id: addonId,
          dependencies: [helperId],
          deps: [
            {
              name: 'helper_impl',
              pkg: helperId,
              dep_kinds: [{ kind: null, target: null }],
            },
          ],
          features: ['default'],
        },
        {
          id: siblingId,
          dependencies: [helperId],
          deps: [
            {
              name: 'helper_impl',
              pkg: helperId,
              dep_kinds: [{ kind: null, target: null }],
            },
          ],
          features: [],
        },
      ],
    },
  }

  t.deepEqual(
    getNapiDeriveDependentCrates(metadata, addonId, {
      features: [],
      allFeatures: false,
      noDefaultFeatures: false,
    }).map((c) => c.name),
    ['helper-package'],
  )
})

test('createCargoMetadataInvocation stops parsing cargoOptions at --', (t) => {
  const invocation = createCargoMetadataInvocation('/ws/Cargo.toml', {
    cargoOptions: [
      '--features',
      'alpha',
      '--',
      '--features',
      'beta',
      '--all-features',
      '--no-default-features',
      '--locked',
      '--config',
      'build.jobs=1',
    ],
  })
  t.true(invocation.args.includes('--features'))
  t.true(invocation.args.includes('alpha'))
  t.false(invocation.args.includes('beta'))
  t.false(invocation.args.includes('--all-features'))
  t.false(invocation.args.includes('--no-default-features'))
  t.false(invocation.args.includes('--locked'))
  t.false(invocation.args.includes('--config'))
})
