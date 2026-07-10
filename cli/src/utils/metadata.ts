import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { dirname, resolve } from 'node:path'

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
  const features = [
    ...new Set(
      (options.features ?? []).flatMap((feature) =>
        feature.split(/[,\s]+/).filter(Boolean),
      ),
    ),
  ]
  let allFeatures = options.allFeatures === true
  let noDefaultFeatures = options.noDefaultFeatures === true
  const cargoOptions = options.cargoOptions ?? []
  for (let index = 0; index < cargoOptions.length; index += 1) {
    const option = cargoOptions[index]
    if (option === '--config' || option === '-Z') {
      const value = cargoOptions[index + 1]
      if (value !== undefined) {
        globalArgs.push(option, value)
        index += 1
      }
    } else if (option.startsWith('--config=') || option.startsWith('-Z')) {
      globalArgs.push(option)
    } else if (option === '--features' || option === '-F') {
      const value = cargoOptions[index + 1]
      if (value !== undefined) {
        features.push(...value.split(/[,\s]+/).filter(Boolean))
        index += 1
      }
    } else if (option.startsWith('--features=') || option.startsWith('-F=')) {
      features.push(
        ...option
          .slice(option.indexOf('=') + 1)
          .split(/[,\s]+/)
          .filter(Boolean),
      )
    } else if (option.startsWith('-F') && option.length > 2) {
      features.push(
        ...option
          .slice(2)
          .split(/[,\s]+/)
          .filter(Boolean),
      )
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
    command: process.env.CARGO ?? 'cargo',
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
