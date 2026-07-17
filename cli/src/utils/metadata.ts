import { spawn } from 'node:child_process'
import fs from 'node:fs'

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
    source: string
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

export interface CrateResolveNode {
  id: string
  deps: Array<{
    name: string
    pkg: string
  }>
  features: string[]
}

export interface CargoWorkspaceMetadata {
  version: number
  packages: Crate[]
  workspace_members: string[]
  target_directory: string
  workspace_root: string
  resolve?: {
    nodes: CrateResolveNode[]
    root: string | null
  } | null
}

export interface CargoFeatureOptions {
  features?: string[]
  allFeatures?: boolean
  noDefaultFeatures?: boolean
}

// Crates that will actually compile `napi-derive` in this build, and are therefore
// expected to emit a type-def intermediate file. Prefer the resolved dependency graph:
// a crate whose `napi-derive` dependency is optional and stays disabled never emits a
// type-def file, so force-building it would invalidate cargo's fingerprint on every
// build without ever satisfying the type-def check. Fall back to declared dependencies
// when the resolve graph is unavailable.
export function getNapiDeriveDependentCrates(
  metadata: CargoWorkspaceMetadata,
): Crate[] {
  const resolveNodes = metadata.resolve?.nodes
  if (!resolveNodes) {
    return metadata.packages.filter((crate) =>
      crate.dependencies.some((d) => d.name === 'napi-derive'),
    )
  }
  const napiDerivePackageIds = new Set(
    metadata.packages.filter((p) => p.name === 'napi-derive').map((p) => p.id),
  )
  const dependentPackageIds = new Set(
    resolveNodes
      .filter((node) =>
        node.deps.some((dep) => napiDerivePackageIds.has(dep.pkg)),
      )
      .map((node) => node.id),
  )
  return metadata.packages.filter((crate) => dependentPackageIds.has(crate.id))
}

export async function parseMetadata(
  manifestPath: string,
  featureOptions?: CargoFeatureOptions,
) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No crate found in manifest: ${manifestPath}`)
  }

  const featureArgs: string[] = []
  if (featureOptions?.allFeatures) {
    featureArgs.push('--all-features')
  }
  if (featureOptions?.noDefaultFeatures) {
    featureArgs.push('--no-default-features')
  }
  if (featureOptions?.features?.length) {
    featureArgs.push('--features', featureOptions.features.join(','))
  }

  // Resolving with the build's feature flags keeps `metadata.resolve` in sync with what
  // `cargo build` will actually compile. Feature flags are rejected in some setups
  // (e.g. a virtual workspace root manifest), so fall back to a plain invocation.
  if (featureArgs.length) {
    try {
      return await execCargoMetadata(manifestPath, featureArgs)
    } catch (e) {
      debug.warn(
        `cargo metadata failed with feature flags, retrying without them: ${e}`,
      )
    }
  }

  return execCargoMetadata(manifestPath, [])
}

async function execCargoMetadata(manifestPath: string, extraArgs: string[]) {
  const childProcess = spawn(
    'cargo',
    [
      'metadata',
      '--manifest-path',
      manifestPath,
      '--format-version',
      '1',
      ...extraArgs,
    ],
    {
      stdio: 'pipe',
    },
  )

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
