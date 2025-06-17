import { spawn } from 'node:child_process'
import fs from 'node:fs'

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

export interface CargoWorkspaceMetadata {
  version: number
  packages: Crate[]
  workspace_members: string[]
  target_directory: string
  workspace_root: string
}

export async function parseMetadata(manifestPath: string) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No crate found in manifest: ${manifestPath}`)
  }

  const childProcess = spawn(
    'cargo',
    ['metadata', '--manifest-path', manifestPath, '--format-version', '1'],
    { stdio: 'pipe' },
  )

  let stdout = ''
  let stderr = ''
  let status = 0
  let error = null

  childProcess.stdout.on('data', (data) => {
    stdout += data
  })

  childProcess.stderr.on('data', (data) => {
    stderr += data
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
