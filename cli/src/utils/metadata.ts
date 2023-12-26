import { execSync } from 'node:child_process'
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
}

export interface CargoWorkspaceMetadata {
  version: number
  packages: Crate[]
  workspace_members: string[]
  target_directory: string
  workspace_root: string
}

export function parseMetadata(manifestPath: string) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No crate found in manifest: ${manifestPath}`)
  }

  const cmd = `cargo metadata --manifest-path ${manifestPath} --format-version 1 --no-deps`

  try {
    const output = execSync(cmd, {
      encoding: 'utf-8',
    })
    return JSON.parse(output) as CargoWorkspaceMetadata
  } catch (e) {
    throw new Error(
      `Failed to parse cargo metadata output by command: ${cmd}`,
      {
        cause: e,
      },
    )
  }
}
