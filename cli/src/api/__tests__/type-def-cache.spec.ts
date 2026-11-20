import { existsSync } from 'node:fs'
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

import test from 'ava'

import {
  type CargoWorkspaceMetadata,
  parseMetadata,
} from '../../utils/metadata.js'
import { withFileSystemReconciliation } from '../../utils/misc.js'
import { getSystemDefaultTarget } from '../../utils/target.js'
import {
  buildProject,
  compareCodeUnits,
  generateTypeDef,
  getArtifactLockDir,
  getCargoDependencyGraphFingerprint,
  getTypeDefCacheFolder,
  normalizeWorkspacePackageId,
  resolveCargoTargetDir,
  restoreTypeDefFolder,
  snapshotTypeDefFolder,
  stripWindowsVerbatimPrefix,
  toWorkspaceRelativePath,
} from '../build.js'

const registryManifest = join(
  '/home/dev/.cargo/registry/src/index.crates.io-0000/serde-1.0.0',
  'Cargo.toml',
)
const registryId =
  'registry+https://github.com/rust-lang/crates.io-index#serde@1.0.0'

// Two checkouts of the same workspace, e.g. git worktrees.
function checkout(root: string, legacyIds = false) {
  const rootUrl = pathToFileURL(root).href
  const pathId = (dir: string, name: string) =>
    legacyIds
      ? `${name} 0.1.0 (path+${rootUrl}/${dir})`
      : `path+${rootUrl}/${dir}#${name}@0.1.0`
  const addonId = pathId('crates/addon', 'addon')
  const coreId = pathId('crates/core', 'core')
  const dep = (name: string, pkg: string) => ({
    name,
    pkg,
    dep_kinds: [{ kind: null, target: null }],
  })
  const pkg = (id: string, name: string, manifest_path: string) =>
    ({
      id,
      name,
      manifest_path,
      dependencies: [],
      features: {},
    }) as unknown as CargoWorkspaceMetadata['packages'][number]
  const metadata = {
    version: 1,
    workspace_root: root,
    target_directory: '/shared/target',
    workspace_members: [addonId, coreId],
    packages: [
      pkg(addonId, 'addon', join(root, 'crates/addon/Cargo.toml')),
      pkg(coreId, 'core', join(root, 'crates/core/Cargo.toml')),
      pkg(registryId, 'serde', registryManifest),
    ],
    resolve: {
      root: null,
      nodes: [
        {
          id: addonId,
          deps: [dep('core', coreId), dep('serde', registryId)],
          features: [],
        },
        { id: coreId, deps: [dep('serde', registryId)], features: [] },
        { id: registryId, deps: [], features: ['std'] },
      ],
    },
  } as unknown as CargoWorkspaceMetadata
  return { root, metadata, addonId }
}

function cacheFolder(
  { root, metadata, addonId }: ReturnType<typeof checkout>,
  crateDir = 'crates/addon',
  workspaceRelative = true,
) {
  return getTypeDefCacheFolder({
    targetDir: '/shared/target',
    crateName: 'addon',
    manifestPath: join(root, crateDir, 'Cargo.toml'),
    workspaceRoot: workspaceRelative ? root : undefined,
    targetTriple: 'aarch64-apple-darwin',
    profile: 'dev',
    cargoConfig: [
      [join(root, '.cargo/config.toml'), 'workspace-config-hash'],
      ['/home/dev/.cargo/config.toml', 'home-config-hash'],
    ],
    cargoDependencyGraph: getCargoDependencyGraphFingerprint(metadata, addonId),
  })
}

test('checkouts of the same workspace share a type-def cache folder', (t) => {
  t.is(
    cacheFolder(checkout('/src/project')),
    cacheFolder(checkout('/worktrees/feature-branch')),
  )
})

test('legacy package ids are normalized too', (t) => {
  t.is(
    cacheFolder(checkout('/src/project', true)),
    cacheFolder(checkout('/worktrees/feature-branch', true)),
  )
})

test('different crates in one workspace keep distinct folders', (t) => {
  const project = checkout('/src/project')
  t.not(cacheFolder(project), cacheFolder(project, 'crates/other'))
})

test('dependency graphs still differ by workspace layout', (t) => {
  const project = checkout('/src/project')
  const moved = checkout('/src/project')
  moved.metadata.packages[1].manifest_path = join(
    '/src/project',
    'moved/core/Cargo.toml',
  )
  t.not(
    getCargoDependencyGraphFingerprint(project.metadata, project.addonId),
    getCargoDependencyGraphFingerprint(moved.metadata, moved.addonId),
  )
})

test('toWorkspaceRelativePath only rewrites paths inside the workspace', (t) => {
  const root = '/src/project'
  t.is(
    toWorkspaceRelativePath(join(root, 'a/Cargo.toml'), root),
    'a/Cargo.toml',
  )
  t.is(toWorkspaceRelativePath(root, root), '.')
  t.is(toWorkspaceRelativePath(registryManifest, root), registryManifest)
  t.is(
    toWorkspaceRelativePath('/src/project-other/Cargo.toml', root),
    '/src/project-other/Cargo.toml',
  )
  t.is(toWorkspaceRelativePath('/x/Cargo.toml', undefined), '/x/Cargo.toml')
})

test('without a workspace root (watch mode), checkouts keep separate folders', (t) => {
  const project = checkout('/src/project')
  const worktree = checkout('/worktrees/feature-branch')
  t.not(
    cacheFolder(project, 'crates/addon', false),
    cacheFolder(worktree, 'crates/addon', false),
  )
})

test('workspace-root crates and special-character workspace paths normalize consistently', (t) => {
  const rootCheckout = (root: string, legacyIds = false) => {
    const rootUrl = pathToFileURL(root).href
    const addonId = legacyIds
      ? `addon 0.1.0 (path+${rootUrl})`
      : `path+${rootUrl}#addon@0.1.0`
    const metadata = {
      version: 1,
      workspace_root: root,
      target_directory: '/shared/target',
      workspace_members: [addonId],
      packages: [
        {
          id: addonId,
          name: 'addon',
          manifest_path: join(root, 'Cargo.toml'),
          dependencies: [],
          features: {},
        },
      ],
      resolve: {
        root: null,
        nodes: [{ id: addonId, deps: [], features: [] }],
      },
    } as unknown as CargoWorkspaceMetadata
    return getTypeDefCacheFolder({
      targetDir: '/shared/target',
      crateName: 'addon',
      manifestPath: join(root, 'Cargo.toml'),
      workspaceRoot: root,
      targetTriple: 'aarch64-apple-darwin',
      profile: 'dev',
      cargoDependencyGraph: getCargoDependencyGraphFingerprint(
        metadata,
        addonId,
      ),
    })
  }

  t.is(
    rootCheckout('/src/my project (1)'),
    rootCheckout('/worktrees/feature branch'),
  )
  t.is(
    rootCheckout('/src/my project (1)', true),
    rootCheckout('/worktrees/feature branch', true),
  )
})

test('package id normalization ignores sibling paths and non-path sources', (t) => {
  const withExternalDep = (
    root: string,
    depId: string,
    depManifest: string,
  ) => {
    const rootUrl = pathToFileURL(root).href
    const addonId = `path+${rootUrl}/crates/addon#addon@0.1.0`
    const metadata = {
      version: 1,
      workspace_root: root,
      target_directory: '/shared/target',
      workspace_members: [addonId],
      packages: [
        {
          id: addonId,
          name: 'addon',
          manifest_path: join(root, 'crates/addon/Cargo.toml'),
          dependencies: [],
          features: {},
        },
        {
          id: depId,
          name: 'ext',
          manifest_path: depManifest,
          dependencies: [],
          features: {},
        },
      ],
      resolve: {
        root: null,
        nodes: [
          {
            id: addonId,
            deps: [
              {
                name: 'ext',
                pkg: depId,
                dep_kinds: [{ kind: null, target: null }],
              },
            ],
            features: [],
          },
          { id: depId, deps: [], features: [] },
        ],
      },
    } as unknown as CargoWorkspaceMetadata
    return getCargoDependencyGraphFingerprint(metadata, addonId)
  }

  // A sibling directory whose name starts with `root + ")"` must not match the
  // legacy `)` delimiter.
  const siblingA = pathToFileURL('/src/project)other/ext').href
  const siblingB = pathToFileURL('/worktrees/branch)other/ext').href
  t.not(
    withExternalDep(
      '/src/project',
      `path+${siblingA}#ext@0.1.0`,
      '/src/project)other/ext/Cargo.toml',
    ),
    withExternalDep(
      '/worktrees/branch',
      `path+${siblingB}#ext@0.1.0`,
      '/worktrees/branch)other/ext/Cargo.toml',
    ),
  )

  // Non-path sources (e.g. git+file://) are left untouched even when they
  // point under the workspace root.
  const gitA = `git+${pathToFileURL('/src/project/vendor/ext').href}#ext@0.1.0`
  const gitB = `git+${pathToFileURL('/worktrees/branch/vendor/ext').href}#ext@0.1.0`
  t.not(
    withExternalDep('/src/project', gitA, registryManifest),
    withExternalDep('/worktrees/branch', gitB, registryManifest),
  )
})

test('normalizeWorkspacePackageId strictly parses current and legacy path package ids', (t) => {
  const root = '/src/my project (1)'
  const rootUrl = pathToFileURL(root).href

  // Current format (subdir & workspace root)
  t.is(
    normalizeWorkspacePackageId(
      `path+${rootUrl}/crates/my%20addon#addon@0.1.0`,
      root,
    ),
    'path+file://$WORKSPACE_ROOT/crates/my%20addon#addon@0.1.0',
  )
  t.is(
    normalizeWorkspacePackageId(`path+${rootUrl}#addon@0.1.0`, root),
    'path+file://$WORKSPACE_ROOT#addon@0.1.0',
  )

  // Legacy format (subdir, workspace root, prerelease/build semver)
  t.is(
    normalizeWorkspacePackageId(
      `addon 0.1.0 (path+${rootUrl}/crates/addon)`,
      root,
    ),
    'addon 0.1.0 (path+file://$WORKSPACE_ROOT/crates/addon)',
  )
  t.is(
    normalizeWorkspacePackageId(
      `addon 0.1.0-alpha.1+build.2 (path+${rootUrl})`,
      root,
    ),
    'addon 0.1.0-alpha.1+build.2 (path+file://$WORKSPACE_ROOT)',
  )

  // Unrelated / malformed / non-path / outside-workspace IDs are left untouched
  const unchanged = [
    registryId,
    `serde 1.0.0 (registry+https://github.com/rust-lang/crates.io-index)`,
    `git+${rootUrl}/vendor/ext#ext@0.1.0`,
    `path+${pathToFileURL('/src/my project (1)-other/ext').href}#ext@0.1.0`,
    `addon 0.1.0 (path+${rootUrl}) (extra)`,
    `addon 0.1.0 (path+not a url)`,
    `path+https://example.com/crates/addon#addon@0.1.0`,
  ]
  for (const id of unchanged) {
    t.is(normalizeWorkspacePackageId(id, root), id)
  }
  t.is(
    normalizeWorkspacePackageId(
      `path+${rootUrl}/crates/addon#addon@0.1.0`,
      undefined,
    ),
    `path+${rootUrl}/crates/addon#addon@0.1.0`,
  )
})

test('CLI-KEY-1: single-crate workspace root implicit #ver matches explicit #name@ver across worktrees', (t) => {
  const mainRoot = '/src/my-addon'
  const worktreeRoot = '/worktrees/feat'
  const mainId = `path+${pathToFileURL(mainRoot).href}#0.1.0`
  const worktreeId = `path+${pathToFileURL(worktreeRoot).href}#my-addon@0.1.0`

  t.is(
    normalizeWorkspacePackageId(mainId, mainRoot),
    'path+file://$WORKSPACE_ROOT#my-addon@0.1.0',
  )
  t.is(
    normalizeWorkspacePackageId(mainId, mainRoot),
    normalizeWorkspacePackageId(worktreeId, worktreeRoot),
  )

  const makeMeta = (root: string, id: string) =>
    ({
      version: 1,
      workspace_root: root,
      target_directory: '/shared/target',
      workspace_members: [id],
      packages: [
        {
          id,
          name: 'my-addon',
          manifest_path: join(root, 'Cargo.toml'),
          dependencies: [],
          features: {},
        },
      ],
      resolve: {
        root: null,
        nodes: [{ id, deps: [], features: [] }],
      },
    }) as unknown as CargoWorkspaceMetadata

  const mainFolder = getTypeDefCacheFolder({
    targetDir: '/shared/target',
    crateName: 'my-addon',
    manifestPath: join(mainRoot, 'Cargo.toml'),
    workspaceRoot: mainRoot,
    targetTriple: 'aarch64-apple-darwin',
    profile: 'dev',
    cargoDependencyGraph: getCargoDependencyGraphFingerprint(
      makeMeta(mainRoot, mainId),
      mainId,
    ),
  })
  const worktreeFolder = getTypeDefCacheFolder({
    targetDir: '/shared/target',
    crateName: 'my-addon',
    manifestPath: join(worktreeRoot, 'Cargo.toml'),
    workspaceRoot: worktreeRoot,
    targetTriple: 'aarch64-apple-darwin',
    profile: 'dev',
    cargoDependencyGraph: getCargoDependencyGraphFingerprint(
      makeMeta(worktreeRoot, worktreeId),
      worktreeId,
    ),
  })
  t.is(mainFolder, worktreeFolder)
})

test('CLI-KEY-2: stripWindowsVerbatimPrefix strips drive and UNC verbatim prefixes only', (t) => {
  t.is(
    stripWindowsVerbatimPrefix('\\\\?\\C:\\src\\project\\Cargo.toml'),
    'C:\\src\\project\\Cargo.toml',
  )
  t.is(stripWindowsVerbatimPrefix('\\\\?\\d:\\work'), 'd:\\work')
  t.is(
    stripWindowsVerbatimPrefix('\\\\?\\UNC\\server\\share\\repo'),
    '\\\\server\\share\\repo',
  )
  t.is(
    stripWindowsVerbatimPrefix('\\\\?\\unc\\server\\share\\repo'),
    '\\\\server\\share\\repo',
  )
  t.is(
    stripWindowsVerbatimPrefix('\\\\?\\Volume{01234567}\\repo'),
    '\\\\?\\Volume{01234567}\\repo',
  )
  t.is(stripWindowsVerbatimPrefix('/src/project'), '/src/project')
})

test('CLI-KEY-2: toWorkspaceRelativePath and normalizeWorkspacePackageId handle symlinks', async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), 'napi-cache-symlink-'))
  try {
    const realRoot = join(tmp, 'real-ws')
    const linkRoot = join(tmp, 'link-ws')
    await mkdir(join(realRoot, 'crates', 'addon'), { recursive: true })
    await symlink(realRoot, linkRoot, 'dir')

    // Symlinked path vs canonical workspaceRoot (both existing and non-existing tail)
    t.is(
      toWorkspaceRelativePath(
        join(linkRoot, 'crates', 'addon', 'Cargo.toml'),
        realRoot,
      ),
      'crates/addon/Cargo.toml',
    )
    t.is(
      toWorkspaceRelativePath(
        join(realRoot, 'crates', 'addon', 'Cargo.toml'),
        linkRoot,
      ),
      'crates/addon/Cargo.toml',
    )
    t.is(
      toWorkspaceRelativePath(
        join(linkRoot, 'future', 'nested', 'Cargo.toml'),
        realRoot,
      ),
      'future/nested/Cargo.toml',
    )

    // Package ID via symlinked root normalizes identically to canonical root
    t.is(
      normalizeWorkspacePackageId(
        `path+${pathToFileURL(join(linkRoot, 'crates', 'addon')).href}#addon@0.1.0`,
        realRoot,
      ),
      'path+file://$WORKSPACE_ROOT/crates/addon#addon@0.1.0',
    )

    // External sibling still stays absolute
    const outside = join(tmp, 'other', 'Cargo.toml')
    t.is(toWorkspaceRelativePath(outside, realRoot), outside)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('CLI-KEY-4: compareCodeUnits sorts deterministically by UTF-16 code units', async (t) => {
  t.true(compareCodeUnits('Z', '_') < 0)
  t.true(compareCodeUnits('_', 'a') < 0)
  t.true(compareCodeUnits('B', 'a') < 0)
  t.is(compareCodeUnits('abc', 'abc'), 0)

  const dir = await mkdtemp(join(tmpdir(), 'napi-codeunit-sort-'))
  try {
    await writeFile(
      join(dir, 'a_crate'),
      `${JSON.stringify({ kind: 'fn', name: 'fromLower', def: 'function fromLower(): void' })}\n`,
    )
    await writeFile(
      join(dir, 'B_crate'),
      `${JSON.stringify({ kind: 'fn', name: 'fromUpper', def: 'function fromUpper(): void' })}\n`,
    )
    const { exports, dts } = await generateTypeDef({
      typeDefDir: dir,
      cwd: dir,
    })
    // Code-unit order puts 'B_crate' (0x42) before 'a_crate' (0x61), whereas
    // English localeCompare puts 'a_crate' before 'B_crate'.
    t.deepEqual(exports, ['fromUpper', 'fromLower'])
    t.true(dts.indexOf('fromUpper') < dts.indexOf('fromLower'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI-KEY-3: resolveCargoTargetDir resolves relative overrides, cargoOptions, and -- terminator', (t) => {
  const cwd = '/ws/pkg'
  const metaTarget = '/ws/target'

  t.is(
    resolveCargoTargetDir({
      cwd,
      metadataTargetDirectory: metaTarget,
    }),
    metaTarget,
  )
  t.is(
    resolveCargoTargetDir({
      targetDir: 'custom-target',
      cwd,
      metadataTargetDirectory: metaTarget,
    }),
    resolve(cwd, 'custom-target'),
  )
  t.is(
    resolveCargoTargetDir({
      targetDir: 'from-option',
      cargoOptions: ['--target-dir', 'first', '--target-dir=second'],
      cwd,
      metadataTargetDirectory: metaTarget,
    }),
    resolve(cwd, 'second'),
  )
  t.is(
    resolveCargoTargetDir({
      targetDir: 'from-option',
      cargoOptions: ['--target-dir=first', '--target-dir', 'last'],
      cwd,
      metadataTargetDirectory: metaTarget,
    }),
    resolve(cwd, 'last'),
  )
  t.is(
    resolveCargoTargetDir({
      targetDir: 'from-option',
      cargoOptions: ['--', '--target-dir', 'after-terminator'],
      cwd,
      metadataTargetDirectory: metaTarget,
    }),
    resolve(cwd, 'from-option'),
  )
  t.is(
    resolveCargoTargetDir({
      cargoOptions: ['--', '--target-dir=after-terminator'],
      cwd,
      metadataTargetDirectory: metaTarget,
    }),
    metaTarget,
  )
})

const FIXTURE_WORKSPACE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../utils/__tests__/__fixtures__/optional-napi-derive',
)

test.serial(
  'CLI-KEY-3: CARGO_TARGET_DIR takes precedence over CARGO_BUILD_TARGET_DIR via cargo metadata',
  async (t) => {
    const tmp = await mkdtemp(join(tmpdir(), 'napi-target-dir-prec-'))
    const cargoTargetDir = join(tmp, 'from-cargo-target-dir')
    const cargoBuildTargetDir = join(tmp, 'from-cargo-build-target-dir')
    const origTargetDir = process.env.CARGO_TARGET_DIR
    const origBuildTargetDir = process.env.CARGO_BUILD_TARGET_DIR
    try {
      process.env.CARGO_TARGET_DIR = cargoTargetDir
      process.env.CARGO_BUILD_TARGET_DIR = cargoBuildTargetDir
      const metadata = await parseMetadata(
        join(FIXTURE_WORKSPACE, 'main-crate', 'Cargo.toml'),
      )
      const resolved = resolveCargoTargetDir({
        cwd: join(FIXTURE_WORKSPACE, 'main-crate'),
        metadataTargetDirectory: metadata.target_directory,
      })
      t.is(resolved, cargoTargetDir)
    } finally {
      if (origTargetDir === undefined) {
        delete process.env.CARGO_TARGET_DIR
      } else {
        process.env.CARGO_TARGET_DIR = origTargetDir
      }
      if (origBuildTargetDir === undefined) {
        delete process.env.CARGO_BUILD_TARGET_DIR
      } else {
        process.env.CARGO_BUILD_TARGET_DIR = origBuildTargetDir
      }
      await rm(tmp, { recursive: true, force: true })
    }
  },
)

test('CLI-LOCK-1 + CLI-LOCK-4: generateTypeDef ignores dotfiles, subdirectories, and 0-byte markers', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'napi-typedef-filter-'))
  try {
    // Only dotfiles and subdirectories -> treated as empty
    await writeFile(join(dir, '.napi-force-build.json'), '{"a":"uuid"}\n')
    await writeFile(
      join(dir, '.napi-rs-filesystem-reconciliation.1234.swp'),
      'not-json-at-all',
    )
    await mkdir(join(dir, 'subdir'))

    const emptyNoTarget = await generateTypeDef({ typeDefDir: dir, cwd: dir })
    t.is(emptyNoTarget.dts, '')
    t.deepEqual(emptyNoTarget.exports, [])

    const emptyWithTarget = await generateTypeDef({
      typeDefDir: dir,
      cwd: dir,
      declareBindingTarget: true,
    })
    t.true(
      emptyWithTarget.dts.includes('export declare const __napiBindingTarget:'),
    )
    t.deepEqual(emptyWithTarget.exports, [])

    // Add a 0-byte marker file -> still treated as empty declarations
    await writeFile(join(dir, 'empty_crate'), '')
    const zeroByteNoTarget = await generateTypeDef({
      typeDefDir: dir,
      cwd: dir,
    })
    t.is(zeroByteNoTarget.dts, '')
    t.deepEqual(zeroByteNoTarget.exports, [])

    const zeroByteWithTarget = await generateTypeDef({
      typeDefDir: dir,
      cwd: dir,
      declareBindingTarget: true,
    })
    t.true(
      zeroByteWithTarget.dts.includes(
        'export declare const __napiBindingTarget:',
      ),
    )

    // Add a real typedef file alongside dotfiles, subdir, and 0-byte marker
    await writeFile(
      join(dir, 'real_crate'),
      `${JSON.stringify({ kind: 'fn', name: 'hello', def: 'function hello(): string' })}\n`,
    )
    const mixed = await generateTypeDef({ typeDefDir: dir, cwd: dir })
    t.deepEqual(mixed.exports, ['hello'])
    t.true(mixed.dts.includes('export declare function hello(): string'))
    t.false(mixed.dts.includes('\n\n\n'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// Fake-CARGO harness for deterministic end-to-end Builder / lock / rollback /
// token / cleanup tests without compiling Rust.
const posixSerial = process.platform === 'win32' ? test.skip : test.serial

async function setupFakeCargoHarness(options?: {
  crateName?: string
  binaryName?: string
  withBinTarget?: boolean
  transitiveHelper?: boolean
  alsoDirectDerive?: boolean
  optOutTypeDefWithTypedSibling?: boolean
  cargoConfigToml?: string
}) {
  const root = await mkdtemp(join(tmpdir(), 'napi-cache-harness-'))
  const wsDir = join(root, 'ws')
  const crateName = options?.crateName ?? 'fake_addon'
  const binaryName = options?.binaryName ?? 'fake-addon'
  const crateDir = join(wsDir, crateName)
  const deriveDir = join(wsDir, 'napi-derive')
  const helperDir = join(wsDir, 'helper_crate')
  const siblingDir = join(wsDir, 'typed_sibling')
  const binDir = join(root, 'bin')
  const logDir = join(root, 'logs')

  await mkdir(join(crateDir, 'src'), { recursive: true })
  await mkdir(join(deriveDir, 'src'), { recursive: true })
  await mkdir(binDir, { recursive: true })
  await mkdir(logDir, { recursive: true })

  const members = [crateName, 'napi-derive']
  if (options?.transitiveHelper) {
    members.push('helper_crate')
    await mkdir(join(helperDir, 'src'), { recursive: true })
    await writeFile(
      join(helperDir, 'Cargo.toml'),
      `[package]
name = "helper_crate"
version = "0.1.0"
edition = "2021"

[dependencies]
napi-derive = { path = "../napi-derive" }
`,
    )
    await writeFile(join(helperDir, 'src', 'lib.rs'), '')
  }
  if (options?.optOutTypeDefWithTypedSibling) {
    members.push('typed_sibling')
    await mkdir(join(siblingDir, 'src'), { recursive: true })
    await writeFile(
      join(siblingDir, 'Cargo.toml'),
      `[package]
name = "typed_sibling"
version = "0.1.0"
edition = "2021"

[dependencies]
napi-derive = { path = "../napi-derive" }
`,
    )
    await writeFile(join(siblingDir, 'src', 'lib.rs'), '')
  }

  await writeFile(
    join(wsDir, 'Cargo.toml'),
    `[workspace]
resolver = "2"
members = ${JSON.stringify(members)}
`,
  )
  await writeFile(
    join(deriveDir, 'Cargo.toml'),
    `[package]
name = "napi-derive"
version = "0.1.0"
edition = "2021"

[features]
default = ["type-def"]
type-def = []
compat-mode = []
`,
  )
  await writeFile(join(deriveDir, 'src', 'lib.rs'), '')

  const depsSection = options?.optOutTypeDefWithTypedSibling
    ? `napi-derive = { path = "../napi-derive", default-features = false, features = ["compat-mode"] }`
    : options?.transitiveHelper
      ? options?.alsoDirectDerive
        ? `helper_crate = { path = "../helper_crate" }\nnapi-derive = { path = "../napi-derive" }`
        : `helper_crate = { path = "../helper_crate" }`
      : `napi-derive = { path = "../napi-derive" }`
  const binSection = options?.withBinTarget
    ? `\n[[bin]]\nname = "cli-tool"\npath = "src/main.rs"\n`
    : ''
  await writeFile(
    join(crateDir, 'Cargo.toml'),
    `[package]
name = "${crateName}"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]
${binSection}
[dependencies]
${depsSection}
`,
  )
  await writeFile(join(crateDir, 'src', 'lib.rs'), '')
  if (options?.withBinTarget) {
    await writeFile(join(crateDir, 'src', 'main.rs'), 'fn main() {}\n')
  }
  await writeFile(
    join(crateDir, 'package.json'),
    JSON.stringify({
      name: binaryName,
      version: '0.1.0',
      napi: { binaryName },
    }),
  )
  if (options?.cargoConfigToml) {
    await mkdir(join(wsDir, '.cargo'), { recursive: true })
    await writeFile(
      join(wsDir, '.cargo', 'config.toml'),
      options.cargoConfigToml,
    )
  }

  const hostTarget = getSystemDefaultTarget()
  const libFileName =
    hostTarget.platform === 'darwin'
      ? `lib${crateName}.dylib`
      : hostTarget.platform === 'win32'
        ? `${crateName}.dll`
        : `lib${crateName}.so`

  const fakeCargoJs = join(binDir, 'fake-cargo.mjs')
  const fakeCargoSh = join(binDir, 'fake-cargo')
  await writeFile(
    fakeCargoJs,
    `import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const logDir = ${JSON.stringify(logDir)}
const modeFile = join(logDir, 'mode.json')
const mode = JSON.parse(readFileSync(modeFile, 'utf8'))
const callIdxFile = join(logDir, 'count')
let count = 0
try {
  count = Number(readFileSync(callIdxFile, 'utf8'))
} catch {}
count += 1
writeFileSync(callIdxFile, String(count))

const record = {
  args: process.argv.slice(2),
  cwd: process.cwd(),
  env: {
    NAPI_TYPE_DEF_TMP_FOLDER: process.env.NAPI_TYPE_DEF_TMP_FOLDER,
    NAPI_FORCE_BUILD_FAKE_ADDON: process.env.NAPI_FORCE_BUILD_FAKE_ADDON,
    NAPI_FORCE_BUILD_HELPER_CRATE: process.env.NAPI_FORCE_BUILD_HELPER_CRATE,
  },
}
writeFileSync(join(logDir, \`call-\${count}.json\`), JSON.stringify(record, null, 2))

const folder = process.env.NAPI_TYPE_DEF_TMP_FOLDER
if (mode.trapSigtermDelayMs) {
  if (mode.readyFile) {
    writeFileSync(mode.readyFile, 'ready')
  }
  process.on('SIGTERM', () => {
    setTimeout(() => {
      if (folder && mode.writeOnSigterm) {
        for (const [name, content] of Object.entries(mode.writeOnSigterm)) {
          writeFileSync(join(folder, name), content)
        }
      }
      if (mode.exitedFile) {
        writeFileSync(mode.exitedFile, 'exited')
      }
      process.exit(0)
    }, mode.trapSigtermDelayMs)
  })
  setInterval(() => {}, 1000)
} else {
  if (folder && mode.writeFiles) {
    for (const [name, content] of Object.entries(mode.writeFiles)) {
      writeFileSync(join(folder, name), content)
    }
  }
  if (mode.exitCode && mode.exitCode !== 0) {
    process.exit(mode.exitCode)
  }
  if (mode.artifactPath) {
    mkdirSync(join(mode.artifactPath, '..'), { recursive: true })
    writeFileSync(mode.artifactPath, mode.artifactContent ?? 'fake-binary')
  }
}
`,
  )
  await writeFile(
    fakeCargoSh,
    `#!/bin/sh\nexec "${process.execPath}" "${fakeCargoJs}" "$@"\n`,
  )
  await chmod(fakeCargoSh, 0o755)

  const artifactPath = join(
    wsDir,
    'target',
    hostTarget.triple,
    'debug',
    libFileName,
  )

  const setMode = async (mode: {
    writeFiles?: Record<string, string>
    exitCode?: number
    artifactPath?: string | null
    artifactContent?: string
    trapSigtermDelayMs?: number
    readyFile?: string
    exitedFile?: string
    writeOnSigterm?: Record<string, string>
  }) => {
    await writeFile(
      join(logDir, 'mode.json'),
      JSON.stringify({
        artifactPath:
          mode.artifactPath === undefined ? artifactPath : mode.artifactPath,
        ...mode,
      }),
    )
  }

  const readCalls = async () => {
    let count = 0
    try {
      count = Number(await readFile(join(logDir, 'count'), 'utf8'))
    } catch {
      return []
    }
    const calls = []
    for (let i = 1; i <= count; i += 1) {
      calls.push(
        JSON.parse(await readFile(join(logDir, `call-${i}.json`), 'utf8')) as {
          args: string[]
          cwd: string
          env: Record<string, string | undefined>
        },
      )
    }
    return calls
  }

  const origCargo = process.env.CARGO
  process.env.CARGO = fakeCargoSh

  const cleanup = async () => {
    if (origCargo === undefined) {
      delete process.env.CARGO
    } else {
      process.env.CARGO = origCargo
    }
    await rm(root, { recursive: true, force: true })
  }

  return {
    root,
    wsDir,
    crateDir,
    crateName,
    hostTarget,
    libFileName,
    artifactPath,
    binDir,
    logDir,
    setMode,
    readCalls,
    cleanup,
  }
}

posixSerial(
  'CLI-LOCK-2 + RUST-1: force-build token persists across builds (zero Build-2 transition) and respects user overrides & legacy caches',
  async (t) => {
    const h = await setupFakeCargoHarness()
    const origForce = process.env.NAPI_FORCE_BUILD_FAKE_ADDON
    delete process.env.NAPI_FORCE_BUILD_FAKE_ADDON
    try {
      const defLine = `${JSON.stringify({ kind: 'fn', name: 'sum', def: 'function sum(a: number): number' })}\n`

      // Build 1 (cold cache): generates UUID T1 and persists it
      await h.setMode({ writeFiles: { fake_addon: defLine } })
      await (
        await buildProject({ cwd: h.crateDir, outputDir: 'dist' })
      ).task

      let calls = await h.readCalls()
      t.is(calls.length, 1)
      const folder = calls[0].env.NAPI_TYPE_DEF_TMP_FOLDER!
      const token1 = calls[0].env.NAPI_FORCE_BUILD_FAKE_ADDON
      t.truthy(token1)
      const persisted1 = JSON.parse(
        await readFile(join(folder, '.napi-force-build.json'), 'utf8'),
      )
      t.deepEqual(persisted1, { fake_addon: token1 })

      // Build 2 (warm cache): replays EXACT same UUID T1 (no Some(T1) -> None transition)
      await h.setMode({})
      await (
        await buildProject({ cwd: h.crateDir, outputDir: 'dist' })
      ).task
      calls = await h.readCalls()
      t.is(calls.length, 2)
      t.is(calls[1].env.NAPI_FORCE_BUILD_FAKE_ADDON, token1)

      // Build 3 (warm cache + explicit user env): respects user value
      process.env.NAPI_FORCE_BUILD_FAKE_ADDON = 'user-custom-token'
      await (
        await buildProject({ cwd: h.crateDir, outputDir: 'dist' })
      ).task
      delete process.env.NAPI_FORCE_BUILD_FAKE_ADDON
      calls = await h.readCalls()
      t.is(calls[2].env.NAPI_FORCE_BUILD_FAKE_ADDON, 'user-custom-token')

      // Build 4 (cache file deleted): generates fresh UUID T2 !== T1 and persists T2
      await rm(join(folder, 'fake_addon'))
      await h.setMode({ writeFiles: { fake_addon: defLine } })
      await (
        await buildProject({ cwd: h.crateDir, outputDir: 'dist' })
      ).task
      calls = await h.readCalls()
      const token2 = calls[3].env.NAPI_FORCE_BUILD_FAKE_ADDON
      t.truthy(token2)
      t.not(token2, token1)
      const persisted2 = JSON.parse(
        await readFile(join(folder, '.napi-force-build.json'), 'utf8'),
      )
      t.deepEqual(persisted2, { fake_addon: token2 })

      // Build 5 (legacy warm cache: crate file exists, no .napi-force-build.json): leaves env unset
      await rm(join(folder, '.napi-force-build.json'))
      await h.setMode({})
      await (
        await buildProject({ cwd: h.crateDir, outputDir: 'dist' })
      ).task
      calls = await h.readCalls()
      t.is(calls[4].env.NAPI_FORCE_BUILD_FAKE_ADDON, undefined)
      t.false(existsSync(join(folder, '.napi-force-build.json')))
    } finally {
      if (origForce === undefined) {
        delete process.env.NAPI_FORCE_BUILD_FAKE_ADDON
      } else {
        process.env.NAPI_FORCE_BUILD_FAKE_ADDON = origForce
      }
      await h.cleanup()
    }
  },
)

posixSerial(
  'CLI-LOCK-5 + RUST-3: Cargo failure rolls back modified/new non-dotfile cache entries without persisting tokens',
  async (t) => {
    const h = await setupFakeCargoHarness()
    try {
      const originalDef = `${JSON.stringify({ kind: 'fn', name: 'good', def: 'function good(): void' })}\n`
      await h.setMode({ writeFiles: { fake_addon: originalDef } })
      await (
        await buildProject({ cwd: h.crateDir, outputDir: 'dist' })
      ).task

      const calls = await h.readCalls()
      const folder = calls[0].env.NAPI_TYPE_DEF_TMP_FOLDER!
      const originalTokens = await readFile(
        join(folder, '.napi-force-build.json'),
        'utf8',
      )

      // Simulate Cargo corrupting existing file and creating a new partial file before failing
      await h.setMode({
        writeFiles: {
          fake_addon: '{corrupt-partial',
          new_partial_crate: '{"kind":"fn"}\n',
        },
        exitCode: 101,
      })
      await t.throwsAsync(
        (await buildProject({ cwd: h.crateDir, outputDir: 'dist' })).task,
        { message: /Build failed with exit code 101/ },
      )

      t.is(await readFile(join(folder, 'fake_addon'), 'utf8'), originalDef)
      t.false(existsSync(join(folder, 'new_partial_crate')))
      t.is(
        await readFile(join(folder, '.napi-force-build.json'), 'utf8'),
        originalTokens,
      )
    } finally {
      await h.cleanup()
    }
  },
)

posixSerial(
  'CLI-LOCK-6 + RUST-3: 0-typedef crates get 0-byte cache markers, stale files are pruned, dotfiles preserved',
  async (t) => {
    const h = await setupFakeCargoHarness()
    try {
      // Build 1: Cargo succeeds without emitting any typedef file for fake_addon
      await h.setMode({ writeFiles: {} })
      await (
        await buildProject({ cwd: h.crateDir, outputDir: 'dist' })
      ).task

      let calls = await h.readCalls()
      const folder = calls[0].env.NAPI_TYPE_DEF_TMP_FOLDER!
      const token1 = calls[0].env.NAPI_FORCE_BUILD_FAKE_ADDON
      t.truthy(token1)

      // 0-byte marker created
      const markerStat = await stat(join(folder, 'fake_addon'))
      t.is(markerStat.size, 0)

      // Seed a stale non-dotfile and a dotfile before Build 2
      await writeFile(join(folder, 'stale_old_crate'), '{"kind":"fn"}\n')
      await writeFile(join(folder, '.custom-meta'), 'keep-me')

      // Build 2: replays exact same token1 (no infinite rebuild), prunes stale file, keeps dotfile
      await (
        await buildProject({ cwd: h.crateDir, outputDir: 'dist' })
      ).task
      calls = await h.readCalls()
      t.is(calls[1].env.NAPI_FORCE_BUILD_FAKE_ADDON, token1)
      t.false(existsSync(join(folder, 'stale_old_crate')))
      t.true(existsSync(join(folder, '.custom-meta')))
      t.is((await stat(join(folder, 'fake_addon'))).size, 0)
    } finally {
      await h.cleanup()
    }
  },
)

posixSerial(
  'CLI-LOCK-2: lock hierarchy serializes on artifactLockDir -> sharedTypeDefFolder and aborts cleanly',
  async (t) => {
    const h = await setupFakeCargoHarness()
    try {
      // Prime once to discover exact sharedTypeDefFolder
      await h.setMode({ writeFiles: {} })
      await (
        await buildProject({ cwd: h.crateDir, outputDir: 'dist' })
      ).task
      const callsAfterPrime = await h.readCalls()
      const sharedTypeDefFolder =
        callsAfterPrime[0].env.NAPI_TYPE_DEF_TMP_FOLDER!
      const artifactLockDir = getArtifactLockDir({
        targetDir: join(h.wsDir, 'target'),
        cargoTriple: h.hostTarget.triple,
        profile: 'debug',
        srcName: h.libFileName,
      })
      t.true(existsSync(artifactLockDir))

      // Case 1: Holding outer artifactLockDir blocks build; aborting rejects with 'Build aborted' without spawning Cargo
      let releaseOuter!: () => void
      let outerHeld!: () => void
      const waitOuterHeld = new Promise<void>((r) => {
        outerHeld = r
      })
      const outerHolder = withFileSystemReconciliation(
        artifactLockDir,
        async () => {
          outerHeld()
          await new Promise<void>((r) => {
            releaseOuter = r
          })
        },
        { lockAcquisitionTimeout: 10_000 },
      )
      await waitOuterHeld

      const build1 = await buildProject({ cwd: h.crateDir, outputDir: 'dist' })
      await delay(150)
      t.is((await h.readCalls()).length, 1)
      build1.abort()
      await t.throwsAsync(build1.task, { message: 'Build aborted' })
      t.is((await h.readCalls()).length, 1)
      releaseOuter()
      await outerHolder

      // Case 2: Holding inner sharedTypeDefFolder blocks build after outer lock; aborting rejects with 'Build aborted' and releases outer lock
      let releaseInner!: () => void
      let innerHeld!: () => void
      const waitInnerHeld = new Promise<void>((r) => {
        innerHeld = r
      })
      const innerHolder = withFileSystemReconciliation(
        sharedTypeDefFolder,
        async () => {
          innerHeld()
          await new Promise<void>((r) => {
            releaseInner = r
          })
        },
        { lockAcquisitionTimeout: 10_000 },
      )
      await waitInnerHeld

      const build2 = await buildProject({ cwd: h.crateDir, outputDir: 'dist' })
      await delay(150)
      t.is((await h.readCalls()).length, 1)
      build2.abort()
      await t.throwsAsync(build2.task, { message: 'Build aborted' })
      t.is((await h.readCalls()).length, 1)
      releaseInner()
      await innerHolder
    } finally {
      await h.cleanup()
    }
  },
)

posixSerial(
  'CLI-LOCK-3: ephemeral --no-dts-cache folder is cleaned up on success, Cargo failure, and setup failure',
  async (t) => {
    const h = await setupFakeCargoHarness()
    const origNdk = process.env.ANDROID_NDK_LATEST_HOME
    delete process.env.ANDROID_NDK_LATEST_HOME
    try {
      // 1. Success
      await h.setMode({ writeFiles: {} })
      await (
        await buildProject({
          cwd: h.crateDir,
          outputDir: 'dist',
          dtsCache: false,
        })
      ).task
      let calls = await h.readCalls()
      const ephemeralSuccessDir = calls[0].env.NAPI_TYPE_DEF_TMP_FOLDER!
      t.truthy(ephemeralSuccessDir)
      t.false(existsSync(ephemeralSuccessDir))

      // 2. Cargo failure
      await h.setMode({ writeFiles: {}, exitCode: 1 })
      await t.throwsAsync(
        (
          await buildProject({
            cwd: h.crateDir,
            outputDir: 'dist',
            dtsCache: false,
          })
        ).task,
        { message: /Build failed with exit code 1/ },
      )
      calls = await h.readCalls()
      const ephemeralFailDir = calls[1].env.NAPI_TYPE_DEF_TMP_FOLDER!
      t.truthy(ephemeralFailDir)
      t.not(ephemeralFailDir, ephemeralSuccessDir)
      t.false(existsSync(ephemeralFailDir))

      // 3. Setup failure in setEnvs() (setAndroidEnv throws after generateIntermediateTypeDefFolder created mkdtemp dir)
      const napiRsCacheDir = join(h.wsDir, 'target', 'napi-rs')
      const beforeEntries = existsSync(napiRsCacheDir)
        ? await readdir(napiRsCacheDir)
        : []
      await t.throwsAsync(
        () =>
          buildProject({
            cwd: h.crateDir,
            outputDir: 'dist',
            dtsCache: false,
            target: 'aarch64-linux-android',
          }),
        { message: /ANDROID_NDK_LATEST_HOME/ },
      )
      const afterEntries = existsSync(napiRsCacheDir)
        ? await readdir(napiRsCacheDir)
        : []
      t.deepEqual(afterEntries, beforeEntries)
    } finally {
      if (origNdk === undefined) {
        delete process.env.ANDROID_NDK_LATEST_HOME
      } else {
        process.env.ANDROID_NDK_LATEST_HOME = origNdk
      }
      await h.cleanup()
    }
  },
)

posixSerial(
  'CLI-KEY-2 + CLI-KEY-5: symlinked cwd shares cache folder, --bin skips typedefs, transitive helper enables typedefs',
  async (t) => {
    // 1. Symlinked workspace cwd canonicalizes `.cargo/config.toml` discovery
    //    and shares the exact same cache folder under a shared targetDir.
    const h1 = await setupFakeCargoHarness({
      cargoConfigToml: '[build]\njobs = 2\n',
    })
    try {
      const sharedTargetDir = join(h1.root, 'shared-target')
      const symlinkWs = join(h1.root, 'ws-link')
      await symlink(h1.wsDir, symlinkWs, 'dir')
      const sharedArtifactPath = join(
        sharedTargetDir,
        h1.hostTarget.triple,
        'debug',
        h1.libFileName,
      )
      await h1.setMode({ writeFiles: {}, artifactPath: sharedArtifactPath })
      await (
        await buildProject({
          cwd: h1.crateDir,
          package: h1.crateName,
          targetDir: sharedTargetDir,
          outputDir: 'dist',
        })
      ).task
      await (
        await buildProject({
          cwd: join(symlinkWs, h1.crateName),
          package: h1.crateName,
          targetDir: sharedTargetDir,
          outputDir: 'dist',
        })
      ).task
      const calls = await h1.readCalls()
      t.is(
        calls[0].env.NAPI_TYPE_DEF_TMP_FOLDER,
        calls[1].env.NAPI_TYPE_DEF_TMP_FOLDER,
      )
    } finally {
      await h1.cleanup()
    }

    // 2. --bin build disables enableTypeDef (does not set NAPI_TYPE_DEF_TMP_FOLDER)
    const h2 = await setupFakeCargoHarness({ withBinTarget: true })
    try {
      const binArtifactPath = join(
        h2.wsDir,
        'target',
        h2.hostTarget.triple,
        'debug',
        'cli-tool',
      )
      await h2.setMode({ artifactPath: binArtifactPath })
      await (
        await buildProject({
          cwd: h2.crateDir,
          outputDir: 'dist',
          bin: 'cli-tool',
        })
      ).task
      const calls = await h2.readCalls()
      t.is(calls[0].env.NAPI_TYPE_DEF_TMP_FOLDER, undefined)
      t.is(calls[0].env.NAPI_FORCE_BUILD_FAKE_ADDON, undefined)
    } finally {
      await h2.cleanup()
    }

    // 3. Transitive helper crate depending on napi-derive enables typeDef
    const h3 = await setupFakeCargoHarness({ transitiveHelper: true })
    try {
      await h3.setMode({
        writeFiles: {
          helper_crate: `${JSON.stringify({ kind: 'fn', name: 'fromHelper', def: 'function fromHelper(): void' })}\n`,
        },
      })
      await (
        await buildProject({ cwd: h3.crateDir, outputDir: 'dist' })
      ).task
      const calls = await h3.readCalls()
      t.truthy(calls[0].env.NAPI_TYPE_DEF_TMP_FOLDER)
      t.truthy(calls[0].env.NAPI_FORCE_BUILD_HELPER_CRATE)
      t.is(calls[0].env.NAPI_FORCE_BUILD_FAKE_ADDON, undefined)
      const dts = await readFile(
        join(h3.crateDir, 'dist', 'index.d.ts'),
        'utf8',
      )
      t.true(dts.includes('export declare function fromHelper(): void'))
    } finally {
      await h3.cleanup()
    }
  },
)

posixSerial(
  'CLI-KEY-6: buildProject resolves target once, passes --filter-platform unconditionally, and checks manifestPath before rustc',
  async (t) => {
    const tmp = await mkdtemp(join(tmpdir(), 'napi-key6-'))
    const origPath = process.env.PATH
    const origTarget = process.env.CARGO_BUILD_TARGET
    const origCargo = process.env.CARGO
    try {
      // 1. Missing manifestPath fails before invoking rustc -vV even when PATH is empty
      const emptyPath = join(tmp, 'empty-path')
      await mkdir(emptyPath)
      process.env.PATH = emptyPath
      delete process.env.CARGO_BUILD_TARGET
      await t.throwsAsync(() => buildProject({ cwd: tmp }), {
        message: /No crate found in manifest/,
      })

      // 2. Host build invokes rustc -vV at most once and passes --filter-platform to cargo metadata
      process.env.PATH = origPath
      const h = await setupFakeCargoHarness()
      try {
        const shimBinDir = join(h.root, 'shim-bin')
        await mkdir(shimBinDir, { recursive: true })
        const rustcCountFile = join(h.logDir, 'rustc-count')
        const metaArgsFile = join(h.logDir, 'meta-args.txt')

        // Wrap real rustc to count `-vV` calls
        const realRustc = 'rustc'
        const rustcShim = join(shimBinDir, 'rustc')
        await writeFile(
          rustcShim,
          `#!/bin/sh
echo x >> "${rustcCountFile}"
exec "${realRustc}" "$@"
`,
        )
        await chmod(rustcShim, 0o755)

        // Wrap real cargo on PATH to record metadata args and forward to real cargo
        const cargoShim = join(shimBinDir, 'cargo')
        await writeFile(
          cargoShim,
          `#!/bin/sh
if [ "$1" = "metadata" ]; then
  printf '%s\\n' "$@" > "${metaArgsFile}"
fi
PATH="${origPath}" exec cargo "$@"
`,
        )
        await chmod(cargoShim, 0o755)

        // Keep rustcShim finding real rustc via origPath
        await writeFile(
          rustcShim,
          `#!/bin/sh
echo x >> "${rustcCountFile}"
PATH="${origPath}" exec rustc "$@"
`,
        )
        await chmod(rustcShim, 0o755)

        process.env.PATH = `${shimBinDir}:${origPath}`
        delete process.env.CARGO_BUILD_TARGET
        await h.setMode({ writeFiles: {} })
        await (
          await buildProject({ cwd: h.crateDir, outputDir: 'dist' })
        ).task

        const rustcCalls = (await readFile(rustcCountFile, 'utf8'))
          .trim()
          .split('\n')
          .filter(Boolean).length
        t.is(rustcCalls, 1)
        const metaArgs = await readFile(metaArgsFile, 'utf8')
        t.regex(
          metaArgs,
          new RegExp(`--filter-platform\\n${h.hostTarget.triple}\\n`),
        )
      } finally {
        await h.cleanup()
      }
    } finally {
      if (origPath === undefined) {
        delete process.env.PATH
      } else {
        process.env.PATH = origPath
      }
      if (origTarget === undefined) {
        delete process.env.CARGO_BUILD_TARGET
      } else {
        process.env.CARGO_BUILD_TARGET = origTarget
      }
      if (origCargo === undefined) {
        delete process.env.CARGO
      } else {
        process.env.CARGO = origCargo
      }
      await rm(tmp, { recursive: true, force: true })
    }
  },
)

posixSerial(
  'CLI-KEY-5: addon opting out of type-def in a mixed-feature workspace preserves hand-written index.d.ts',
  async (t) => {
    const h = await setupFakeCargoHarness({
      optOutTypeDefWithTypedSibling: true,
    })
    try {
      const distDir = join(h.crateDir, 'dist')
      await mkdir(distDir, { recursive: true })
      const handWrittenDts = 'export declare function handWritten(): void\n'
      await writeFile(join(distDir, 'index.d.ts'), handWrittenDts)

      await h.setMode({})
      await (
        await buildProject({ cwd: h.crateDir, outputDir: 'dist' })
      ).task

      const calls = await h.readCalls()
      t.is(calls.length, 1)
      t.is(calls[0].env.NAPI_TYPE_DEF_TMP_FOLDER, undefined)
      t.is(await readFile(join(distDir, 'index.d.ts'), 'utf8'), handWrittenDts)
    } finally {
      await h.cleanup()
    }
  },
)

posixSerial(
  'CLI-LOCK-5: rollback invalidates modified dependency crate so retry rotates its force-build token instead of publishing stale declarations',
  async (t) => {
    const h = await setupFakeCargoHarness({
      transitiveHelper: true,
      alsoDirectDerive: true,
    })
    const origAddon = process.env.NAPI_FORCE_BUILD_FAKE_ADDON
    const origHelper = process.env.NAPI_FORCE_BUILD_HELPER_CRATE
    delete process.env.NAPI_FORCE_BUILD_FAKE_ADDON
    delete process.env.NAPI_FORCE_BUILD_HELPER_CRATE
    try {
      const helperV1 = `${JSON.stringify({ kind: 'fn', name: 'helperV1', def: 'function helperV1(): void' })}\n`
      const helperV2 = `${JSON.stringify({ kind: 'fn', name: 'helperV2', def: 'function helperV2(): void' })}\n`
      const addonDef = `${JSON.stringify({ kind: 'fn', name: 'addonFn', def: 'function addonFn(): void' })}\n`

      // Build 1 (initial success): helper emits v1, addon emits addonFn
      await h.setMode({
        writeFiles: { helper_crate: helperV1, fake_addon: addonDef },
      })
      await (
        await buildProject({ cwd: h.crateDir, outputDir: 'dist' })
      ).task
      let calls = await h.readCalls()
      const folder = calls[0].env.NAPI_TYPE_DEF_TMP_FOLDER!
      const helperToken1 = calls[0].env.NAPI_FORCE_BUILD_HELPER_CRATE
      const addonToken1 = calls[0].env.NAPI_FORCE_BUILD_FAKE_ADDON
      t.truthy(helperToken1)
      t.truthy(addonToken1)

      // Build 2 (partial failure): helper compiles cleanly and writes v2,
      // then addon fails to compile. Rollback restores helper_crate to v1 and
      // records helper_crate as invalidated.
      await h.setMode({
        writeFiles: { helper_crate: helperV2 },
        exitCode: 101,
      })
      await t.throwsAsync(
        (await buildProject({ cwd: h.crateDir, outputDir: 'dist' })).task,
        { message: /Build failed with exit code 101/ },
      )
      t.is(await readFile(join(folder, 'helper_crate'), 'utf8'), helperV1)
      t.is(await readFile(join(folder, 'fake_addon'), 'utf8'), addonDef)
      t.deepEqual(
        JSON.parse(
          await readFile(
            join(folder, '.napi-type-def-invalidated.json'),
            'utf8',
          ),
        ),
        ['helper_crate'],
      )

      // Build 3 (retry): helper_crate MUST get a rotated token (T2 !== T1) so
      // Cargo recompiles it and writes v2, while untouched fake_addon keeps T1.
      await h.setMode({
        writeFiles: { helper_crate: helperV2 },
      })
      await (
        await buildProject({ cwd: h.crateDir, outputDir: 'dist' })
      ).task
      calls = await h.readCalls()
      const helperToken2 = calls[2].env.NAPI_FORCE_BUILD_HELPER_CRATE
      t.truthy(helperToken2)
      t.not(helperToken2, helperToken1)
      t.is(calls[2].env.NAPI_FORCE_BUILD_FAKE_ADDON, addonToken1)
      t.false(existsSync(join(folder, '.napi-type-def-invalidated.json')))

      const dts = await readFile(join(h.crateDir, 'dist', 'index.d.ts'), 'utf8')
      t.true(dts.includes('export declare function helperV2(): void'))
      t.false(dts.includes('helperV1'))

      // Build 4 (subsequent warm cache): replays helperToken2 with no rebuild
      await h.setMode({})
      await (
        await buildProject({ cwd: h.crateDir, outputDir: 'dist' })
      ).task
      calls = await h.readCalls()
      t.is(calls[3].env.NAPI_FORCE_BUILD_HELPER_CRATE, helperToken2)
      t.is(calls[3].env.NAPI_FORCE_BUILD_FAKE_ADDON, addonToken1)
    } finally {
      if (origAddon === undefined) {
        delete process.env.NAPI_FORCE_BUILD_FAKE_ADDON
      } else {
        process.env.NAPI_FORCE_BUILD_FAKE_ADDON = origAddon
      }
      if (origHelper === undefined) {
        delete process.env.NAPI_FORCE_BUILD_HELPER_CRATE
      } else {
        process.env.NAPI_FORCE_BUILD_HELPER_CRATE = origHelper
      }
      await h.cleanup()
    }
  },
)

posixSerial(
  'CLI-LOCK-2: abort waits for async-exiting Cargo process before rolling back and releasing locks',
  async (t) => {
    const h = await setupFakeCargoHarness()
    try {
      const originalDef = `${JSON.stringify({ kind: 'fn', name: 'stable', def: 'function stable(): void' })}\n`
      await h.setMode({ writeFiles: { fake_addon: originalDef } })
      await (
        await buildProject({ cwd: h.crateDir, outputDir: 'dist' })
      ).task
      const folder = (await h.readCalls())[0].env.NAPI_TYPE_DEF_TMP_FOLDER!

      const readyFile = join(h.logDir, 'ready')
      const exitedFile = join(h.logDir, 'exited')
      await h.setMode({
        trapSigtermDelayMs: 180,
        readyFile,
        exitedFile,
        writeOnSigterm: {
          fake_addon: '{partial-write-during-shutdown',
        },
      })

      const abortedBuild = await buildProject({
        cwd: h.crateDir,
        outputDir: 'dist',
      })
      while (!existsSync(readyFile)) {
        await delay(10)
      }
      abortedBuild.abort()

      await t.throwsAsync(abortedBuild.task, {
        message: /Build failed with error/,
      })

      // Child must have finished exiting BEFORE task settled and released locks,
      // rollback must have reverted the late write emitted during SIGTERM shutdown,
      // and invalidation must be recorded so the next build rotates the token.
      t.true(existsSync(exitedFile))
      t.is(await readFile(join(folder, 'fake_addon'), 'utf8'), originalDef)
      t.deepEqual(
        JSON.parse(
          await readFile(
            join(folder, '.napi-type-def-invalidated.json'),
            'utf8',
          ),
        ),
        ['fake_addon'],
      )

      // Immediate retry succeeds cleanly without racing the old process
      await h.setMode({ writeFiles: { fake_addon: originalDef } })
      await (
        await buildProject({ cwd: h.crateDir, outputDir: 'dist' })
      ).task
      const dts = await readFile(join(h.crateDir, 'dist', 'index.d.ts'), 'utf8')
      t.true(dts.includes('export declare function stable(): void'))
    } finally {
      await h.cleanup()
    }
  },
)

test('rollback persists invalidation before restoring snapshot files (fault-injection)', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'napi-rollback-wal-'))
  try {
    const helperV1 = `${JSON.stringify({ kind: 'fn', name: 'helperV1', def: 'function helperV1(): void' })}\n`
    const helperV2 = `${JSON.stringify({ kind: 'fn', name: 'helperV2', def: 'function helperV2(): void' })}\n`
    const newDef = `${JSON.stringify({ kind: 'fn', name: 'newFn', def: 'function newFn(): void' })}\n`

    await writeFile(join(dir, 'helper_crate'), helperV1, 'utf8')
    const snapshot = await snapshotTypeDefFolder(dir)

    // Simulate Cargo updating helper_crate and emitting a brand-new crate file
    // before a downstream unit fails.
    await writeFile(join(dir, 'helper_crate'), helperV2, 'utf8')
    await writeFile(join(dir, 'new_crate'), newDef, 'utf8')

    // Inject a failure when persisting `.napi-type-def-invalidated.json`.
    await t.throwsAsync(
      restoreTypeDefFolder(dir, snapshot, [], async () => {
        throw new Error('simulated ENOSPC persisting invalidation')
      }),
      { message: 'simulated ENOSPC persisting invalidation' },
    )

    // Neither rollback write nor untracked unlink may have happened.
    t.is(await readFile(join(dir, 'helper_crate'), 'utf8'), helperV2)
    t.is(await readFile(join(dir, 'new_crate'), 'utf8'), newDef)
    t.false(existsSync(join(dir, '.napi-type-def-invalidated.json')))

    // When invalidation persistence succeeds, invalidation is written and files
    // are rolled back cleanly.
    const restored = await restoreTypeDefFolder(dir, snapshot)
    t.deepEqual(restored, ['helper_crate'])
    t.deepEqual(
      JSON.parse(
        await readFile(join(dir, '.napi-type-def-invalidated.json'), 'utf8'),
      ),
      ['helper_crate'],
    )
    t.is(await readFile(join(dir, 'helper_crate'), 'utf8'), helperV1)
    t.false(existsSync(join(dir, 'new_crate')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

posixSerial(
  'finalizeCachedTypeDefFolder preserves declarations freshly emitted by Cargo even if not predicted statically',
  async (t) => {
    const h = await setupFakeCargoHarness()
    try {
      const addonDef = `${JSON.stringify({ kind: 'fn', name: 'addonFn', def: 'function addonFn(): void' })}\n`
      const dynamicHelperDef = `${JSON.stringify({ kind: 'fn', name: 'helperExport', def: 'function helperExport(): void' })}\n`

      await h.setMode({
        writeFiles: {
          fake_addon: addonDef,
          dynamic_helper: dynamicHelperDef,
        },
      })
      await (
        await buildProject({
          cwd: h.crateDir,
          outputDir: 'dist',
          platform: true,
        })
      ).task

      const dts = await readFile(join(h.crateDir, 'dist', 'index.d.ts'), 'utf8')
      t.true(dts.includes('export declare function addonFn(): void'))
      t.true(dts.includes('export declare function helperExport(): void'))
      const loader = await readFile(
        join(h.crateDir, 'dist', 'index.js'),
        'utf8',
      )
      t.true(loader.includes('helperExport'))
    } finally {
      await h.cleanup()
    }
  },
)
