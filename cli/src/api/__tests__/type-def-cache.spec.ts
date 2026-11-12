import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import test from 'ava'

import type { CargoWorkspaceMetadata } from '../../utils/metadata.js'
import {
  getCargoDependencyGraphFingerprint,
  getTypeDefCacheFolder,
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
) {
  return getTypeDefCacheFolder({
    targetDir: '/shared/target',
    crateName: 'addon',
    manifestPath: join(root, crateDir, 'Cargo.toml'),
    workspaceRoot: root,
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
