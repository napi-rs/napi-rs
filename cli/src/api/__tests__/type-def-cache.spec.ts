import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import test from 'ava'

import type { CargoWorkspaceMetadata } from '../../utils/metadata.js'
import {
  getCargoDependencyGraphFingerprint,
  getTypeDefCacheFolder,
  normalizeWorkspacePackageId,
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
