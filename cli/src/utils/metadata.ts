import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { dirname, resolve } from 'node:path'

import { debugFactory } from './log.js'

const debug = debugFactory('metadata')

export type CrateTargetKind =
  | 'bin'
  | 'example'
  | 'test'
  | 'bench'
  | 'lib'
  | 'rlib'
  | 'cdylib'
  | 'custom-build'

export interface CrateTarget {
  name: string
  kind: CrateTargetKind[]
  crate_types: CrateTargetKind[]
}

export interface Crate {
  id: string
  name: string
  src_path: string
  version: string
  edition: string
  targets: CrateTarget[]
  features: Record<string, string[]>
  manifest_path: string
  dependencies: Array<{
    name: string
    source: string | null
    req: string
    kind: string | null
    rename: string | null
    optional: boolean
    uses_default_features: boolean
    features: string[]
    target: string | null
    registry: string | null
  }>
}

export interface CargoResolveNode {
  id: string
  dependencies: string[]
  deps: Array<{
    name: string
    pkg: string
    dep_kinds: Array<{
      kind: string | null
      target: string | null
    }>
  }>
  features: string[]
}

export interface CargoWorkspaceMetadata {
  version: number
  packages: Crate[]
  workspace_members: string[]
  target_directory: string
  workspace_root: string
  resolve: {
    root: string | null
    nodes: CargoResolveNode[]
  } | null
}

// Crates that will actually compile `napi-derive` with its `type-def` feature in
// this build, and are therefore expected to emit a type-def intermediate file.
// Prefer the resolved dependency graph: a crate whose `napi-derive` dependency is
// optional and stays disabled, dev/build-only, or lacks `type-def` never emits a
// type-def file, so force-building it would invalidate cargo's fingerprint on
// every build without ever satisfying the type-def check. When `rootPackageId` is
// given, restrict to crates reachable from it via normal dependency edges so
// unrelated workspace members are ignored. Fall back to declared dependencies
// when the resolve graph is unavailable.
export function collectRequestedFeatures(
  features?: string[],
  cargoOptions?: string[],
): string[] {
  const collected = (features ?? []).flatMap((feature) =>
    feature.split(/[,\s]+/).filter(Boolean),
  )
  const options = cargoOptions ?? []
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index]
    if (option === '--') {
      break
    }
    if (option === '--features' || option === '-F') {
      const value = options[index + 1]
      if (value !== undefined) {
        collected.push(...value.split(/[,\s]+/).filter(Boolean))
        index += 1
      }
    } else if (option.startsWith('--features=') || option.startsWith('-F=')) {
      collected.push(
        ...option
          .slice(option.indexOf('=') + 1)
          .split(/[,\s]+/)
          .filter(Boolean),
      )
    } else if (option.startsWith('-F') && option.length > 2) {
      collected.push(
        ...option
          .slice(2)
          .split(/[,\s]+/)
          .filter(Boolean),
      )
    }
  }
  return [...new Set(collected)]
}

export function getNapiDeriveDependentCrates(
  metadata: CargoWorkspaceMetadata,
  rootPackageId?: string,
  requestedFeatures?: string[],
): Crate[] {
  const resolveNodes = metadata.resolve?.nodes
  if (!resolveNodes) {
    let candidatePackages = metadata.packages
    if (rootPackageId) {
      const packagesById = new Map(metadata.packages.map((p) => [p.id, p]))
      const packagesByName = new Map<string, Crate[]>()
      for (const pkg of metadata.packages) {
        const list = packagesByName.get(pkg.name) ?? []
        list.push(pkg)
        packagesByName.set(pkg.name, list)
      }
      const reachable = new Set<string>()
      const pending = [rootPackageId]
      while (pending.length > 0) {
        const id = pending.pop()!
        if (reachable.has(id)) {
          continue
        }
        const pkg = packagesById.get(id)
        if (!pkg) {
          continue
        }
        reachable.add(id)
        for (const dep of pkg.dependencies) {
          if (dep.kind === null || dep.kind === undefined) {
            for (const depPkg of packagesByName.get(dep.name) ?? []) {
              pending.push(depPkg.id)
            }
          }
        }
      }
      candidatePackages = metadata.packages.filter((crate) =>
        reachable.has(crate.id),
      )
    }
    return candidatePackages.filter((crate) =>
      crate.dependencies.some(
        (d) =>
          d.name === 'napi-derive' &&
          (d.kind === null || d.kind === undefined) &&
          (d.uses_default_features || d.features.includes('type-def')),
      ),
    )
  }

  const isNormalDependency = (dep: CargoResolveNode['deps'][number]) =>
    !dep.dep_kinds?.length || dep.dep_kinds.some((k) => k.kind === null)

  const packagesById = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]))
  const nodesById = new Map(resolveNodes.map((node) => [node.id, node]))

  if (!rootPackageId) {
    const napiDerivePackageIds = new Set<string>()
    for (const pkg of metadata.packages) {
      if (pkg.name !== 'napi-derive') {
        continue
      }
      const node = nodesById.get(pkg.id)
      if (!node) {
        continue
      }
      const typeDefEnabled =
        pkg.features && 'type-def' in pkg.features
          ? node.features.includes('type-def') &&
            !node.features.includes('noop')
          : true
      if (typeDefEnabled) {
        napiDerivePackageIds.add(pkg.id)
      }
    }

    const dependentPackageIds = new Set(
      resolveNodes
        .filter((node) =>
          node.deps.some(
            (dep) =>
              isNormalDependency(dep) && napiDerivePackageIds.has(dep.pkg),
          ),
        )
        .map((node) => node.id),
    )
    return metadata.packages.filter((crate) =>
      dependentPackageIds.has(crate.id),
    )
  }

  // `cargo metadata` unifies features across the entire workspace, so
  // `metadata.resolve` can report `napi-derive/type-def` (or an optional
  // dependency on a shared helper crate) enabled solely because an unrelated
  // workspace member requested it. Propagate normal dependencies and features
  // strictly from `rootPackageId` so addons that opt out (e.g.
  // `default-features = false, features = ["compat-mode"]`) are not falsely
  // treated as emitting type-defs.
  const rootNode = nodesById.get(rootPackageId)
  if (!rootNode) {
    return []
  }

  const activatedFeatures = new Map<string, Set<string>>([
    [rootPackageId, new Set(rootNode.features)],
  ])
  const activeNormalDepsByPkg = new Map<string, Set<string>>()

  // Explicit CLI `--features dep/feat` (or `dep?/feat` or `<workspace-member>/<feat>`)
  // requests activate features on a dependency directly without adding an entry
  // to `rootNode.features`.
  const explicitDepFeatures: Array<{
    targetKey: string
    feat: string
    weak: boolean
  }> = []
  for (const spec of requestedFeatures ?? []) {
    const slash = spec.indexOf('/')
    if (slash <= 0 || slash === spec.length - 1) {
      continue
    }
    const rawTarget = spec.slice(0, slash)
    const feat = spec.slice(slash + 1)
    const weak = rawTarget.endsWith('?')
    const targetKey = weak ? rawTarget.slice(0, -1) : rawTarget
    if (targetKey.length > 0 && feat.length > 0) {
      explicitDepFeatures.push({ targetKey, feat, weak })
    }
  }

  const isOptionalDepActivated = (
    pkg: Crate,
    features: Set<string>,
    depKey: string,
  ): boolean => {
    if (features.has(depKey)) {
      return true
    }
    if (
      pkg.id === rootPackageId &&
      explicitDepFeatures.some(
        (entry) => !entry.weak && entry.targetKey === depKey,
      )
    ) {
      return true
    }
    const explicitDep = `dep:${depKey}`
    const depFeaturePrefix = `${depKey}/`
    for (const feature of features) {
      for (const spec of pkg.features?.[feature] ?? []) {
        if (spec === explicitDep || spec.startsWith(depFeaturePrefix)) {
          return true
        }
      }
    }
    return false
  }

  let changed = true
  while (changed) {
    changed = false
    for (const [pkgId, features] of activatedFeatures.entries()) {
      const pkg = packagesById.get(pkgId)
      const node = nodesById.get(pkgId)
      if (!pkg || !node) {
        continue
      }

      // Expand internal feature implications within `pkg`.
      if (pkg.features) {
        for (const feature of features) {
          for (const spec of pkg.features[feature] ?? []) {
            if (
              !spec.includes('/') &&
              !spec.startsWith('dep:') &&
              spec in pkg.features &&
              !features.has(spec)
            ) {
              features.add(spec)
              changed = true
            }
          }
        }
      }

      let activeDeps = activeNormalDepsByPkg.get(pkgId)
      if (!activeDeps) {
        activeDeps = new Set<string>()
        activeNormalDepsByPkg.set(pkgId, activeDeps)
      }

      for (const resolveDep of node.deps) {
        if (!isNormalDependency(resolveDep)) {
          continue
        }
        const targetPkg = packagesById.get(resolveDep.pkg)
        if (!targetPkg) {
          continue
        }
        const activeTargets = new Set(
          (resolveDep.dep_kinds ?? [])
            .filter((k) => k.kind === null)
            .map((k) => k.target),
        )
        const matchingDecls = (pkg.dependencies ?? []).filter(
          (d) =>
            d.name === targetPkg.name &&
            (d.kind === null || d.kind === undefined) &&
            (activeTargets.size === 0 || activeTargets.has(d.target)) &&
            (!resolveDep.name ||
              (d.rename ?? d.name).replace(/-/g, '_') === resolveDep.name),
        )

        // Synthetic unit-test fixtures may omit `dependencies` entries while
        // still populating `resolve.nodes`; treat such edges as active.
        const activeDecls =
          matchingDecls.length === 0
            ? null
            : matchingDecls.filter(
                (d) =>
                  !d.optional ||
                  isOptionalDepActivated(pkg, features, d.rename ?? d.name),
              )
        if (activeDecls !== null && activeDecls.length === 0) {
          continue
        }

        if (!activeDeps.has(resolveDep.pkg)) {
          activeDeps.add(resolveDep.pkg)
          changed = true
        }

        let targetFeatures = activatedFeatures.get(resolveDep.pkg)
        if (!targetFeatures) {
          targetFeatures = new Set<string>()
          activatedFeatures.set(resolveDep.pkg, targetFeatures)
          changed = true
        }

        const addTargetFeature = (feature: string) => {
          if (
            targetPkg.features &&
            feature in targetPkg.features &&
            !targetFeatures.has(feature)
          ) {
            targetFeatures.add(feature)
            changed = true
          }
        }

        if (activeDecls === null) {
          for (const feature of nodesById.get(resolveDep.pkg)?.features ?? []) {
            addTargetFeature(feature)
          }
          continue
        }

        for (const decl of activeDecls) {
          if (decl.uses_default_features) {
            addTargetFeature('default')
          }
          for (const feature of decl.features ?? []) {
            addTargetFeature(feature)
          }
          const depKey = decl.rename ?? decl.name
          const strongPrefix = `${depKey}/`
          const weakPrefix = `${depKey}?/`
          for (const feature of features) {
            for (const spec of pkg.features?.[feature] ?? []) {
              if (spec.startsWith(strongPrefix)) {
                addTargetFeature(spec.slice(strongPrefix.length))
              } else if (spec.startsWith(weakPrefix)) {
                addTargetFeature(spec.slice(weakPrefix.length))
              }
            }
          }
          if (pkgId === rootPackageId) {
            for (const entry of explicitDepFeatures) {
              if (entry.targetKey === depKey) {
                addTargetFeature(entry.feat)
              }
            }
          }
        }
        const resolvedTargetNode = nodesById.get(resolveDep.pkg)
        if (resolvedTargetNode && explicitDepFeatures.length > 0) {
          for (const entry of explicitDepFeatures) {
            if (
              entry.targetKey === targetPkg.name &&
              resolvedTargetNode.features.includes(entry.feat)
            ) {
              addTargetFeature(entry.feat)
            }
          }
        }
      }
    }
  }

  const napiDerivePackageIds = new Set<string>()
  for (const pkgId of activatedFeatures.keys()) {
    const pkg = packagesById.get(pkgId)
    const node = nodesById.get(pkgId)
    if (!pkg || !node || pkg.name !== 'napi-derive') {
      continue
    }
    const features = activatedFeatures.get(pkgId)!
    const typeDefEnabled =
      pkg.features && 'type-def' in pkg.features
        ? node.features.includes('type-def') &&
          features.has('type-def') &&
          !features.has('noop')
        : true
    if (typeDefEnabled) {
      napiDerivePackageIds.add(pkg.id)
    }
  }

  const dependentPackageIds = new Set<string>()
  for (const [pkgId, activeDeps] of activeNormalDepsByPkg) {
    for (const depPkgId of activeDeps) {
      if (napiDerivePackageIds.has(depPkgId)) {
        dependentPackageIds.add(pkgId)
        break
      }
    }
  }

  return metadata.packages.filter((crate) => dependentPackageIds.has(crate.id))
}

interface ParseMetadataOptions {
  allFeatures?: boolean
  cargoOptions?: string[]
  cwd?: string
  featurePackage?: string
  features?: string[]
  filterPlatform?: string
  noDefaultFeatures?: boolean
}

export function createCargoMetadataInvocation(
  manifestPath: string,
  options: ParseMetadataOptions = {},
) {
  const globalArgs: string[] = []
  const metadataArgs = [
    'metadata',
    '--manifest-path',
    manifestPath,
    '--format-version',
    '1',
  ]
  const features = collectRequestedFeatures(
    options.features,
    options.cargoOptions,
  )
  let allFeatures = options.allFeatures === true
  let noDefaultFeatures = options.noDefaultFeatures === true
  const cargoOptions = options.cargoOptions ?? []
  for (let index = 0; index < cargoOptions.length; index += 1) {
    const option = cargoOptions[index]
    if (option === '--') {
      break
    }
    if (option === '--config' || option === '-Z') {
      const value = cargoOptions[index + 1]
      if (value !== undefined) {
        globalArgs.push(option, value)
        index += 1
      }
    } else if (option.startsWith('--config=') || option.startsWith('-Z')) {
      globalArgs.push(option)
    } else if (option === '--features' || option === '-F') {
      if (cargoOptions[index + 1] !== undefined) {
        index += 1
      }
    } else if (option === '--all-features') {
      allFeatures = true
    } else if (option === '--no-default-features') {
      noDefaultFeatures = true
    } else if (
      option === '--locked' ||
      option === '--offline' ||
      option === '--frozen'
    ) {
      metadataArgs.push(option)
    }
  }
  const selectedFeatures = [
    ...new Set(
      features.map((feature) =>
        options.featurePackage && !feature.includes('/')
          ? `${options.featurePackage}/${feature}`
          : feature,
      ),
    ),
  ].sort()
  if (selectedFeatures.length > 0) {
    metadataArgs.push('--features', selectedFeatures.join(','))
  }
  if (allFeatures) {
    metadataArgs.push('--all-features')
  }
  if (noDefaultFeatures) {
    metadataArgs.push('--no-default-features')
  }
  if (options.filterPlatform) {
    metadataArgs.push('--filter-platform', options.filterPlatform)
  }

  return {
    // Deliberately NOT `process.env.CARGO ?? 'cargo'`: `$CARGO` only overrides
    // the cargo/cross binary spawned for the actual build (see the Builder in
    // api/build.ts) — tests poison `$CARGO` with a nonexistent path to assert
    // no real build is spawned, and `cross metadata` is not a thing either.
    // Metadata always comes from the host `cargo`.
    command: 'cargo',
    args: [...globalArgs, ...metadataArgs],
    cwd: resolve(options.cwd ?? dirname(manifestPath)),
  }
}

export async function parseMetadata(
  manifestPath: string,
  options: ParseMetadataOptions = {},
) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No crate found in manifest: ${manifestPath}`)
  }

  const invocation = createCargoMetadataInvocation(manifestPath, options)
  // Resolving with the build's feature flags keeps `metadata.resolve` in sync
  // with what `cargo build` will actually compile. Feature flags are rejected
  // in some setups (e.g. a virtual workspace root manifest), so fall back to a
  // plain invocation without them.
  const featurelessArgs = stripFeatureArgs(invocation.args)
  if (featurelessArgs.length !== invocation.args.length) {
    try {
      return await execCargoMetadata(invocation)
    } catch (e) {
      debug.warn(
        `cargo metadata failed with feature flags, retrying without them: ${e}`,
      )
    }
    return execCargoMetadata({ ...invocation, args: featurelessArgs })
  }
  return execCargoMetadata(invocation)
}

function stripFeatureArgs(args: string[]): string[] {
  const stripped: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--features') {
      // also skip the flag's value
      index += 1
    } else if (arg !== '--all-features' && arg !== '--no-default-features') {
      stripped.push(arg)
    }
  }
  return stripped
}

async function execCargoMetadata(invocation: {
  command: string
  args: string[]
  cwd: string
}) {
  const childProcess = spawn(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    stdio: 'pipe',
  })

  let stdout = ''
  let stderr = ''
  let status = 0
  let error: Error | null = null

  childProcess.stdout.on('data', (data) => {
    stdout += data
  })

  childProcess.stderr.on('data', (data) => {
    stderr += data
  })

  childProcess.on('error', (err) => {
    error = err
  })

  await new Promise<void>((resolve) => {
    childProcess.on('close', (code) => {
      status = code ?? 0
      resolve()
    })
  })

  if (error) {
    throw new Error('cargo metadata failed to run', { cause: error })
  }
  if (status !== 0) {
    const simpleMessage = `cargo metadata exited with code ${status}`
    throw new Error(`${simpleMessage} and error message:\n\n${stderr}`, {
      cause: new Error(simpleMessage),
    })
  }

  try {
    return JSON.parse(stdout) as CargoWorkspaceMetadata
  } catch (e) {
    throw new Error('Failed to parse cargo metadata JSON', { cause: e })
  }
}
