import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { dirname, join, resolve } from 'node:path'

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

interface ManifestFingerprint {
  hash: string
}

interface CachedMetadata {
  metadata: CargoWorkspaceMetadata
  manifestFingerprints: Map<string, ManifestFingerprint>
}

interface MetadataCacheEntry {
  value?: CachedMetadata
  promise?: Promise<CargoWorkspaceMetadata>
}

const metadataCache = new Map<string, MetadataCacheEntry>()

function getManifestFingerprint(manifestPath: string) {
  try {
    const hash = createHash('sha256')
      .update(fs.readFileSync(manifestPath))
      .digest('hex')

    return { hash }
  } catch {
    return null
  }
}

function isFingerprintEqual(
  left: ManifestFingerprint,
  right: ManifestFingerprint,
) {
  return left.hash === right.hash
}

function isWorkspaceManifest(content: string) {
  return /^\s*\[workspace\]\s*$/m.test(content)
}

function findWorkspaceRoot(
  manifestPath: string,
  metadata?: CargoWorkspaceMetadata,
) {
  if (metadata) {
    return resolve(metadata.workspace_root)
  }

  let currentDir = dirname(manifestPath)

  while (true) {
    const candidateManifestPath = join(currentDir, 'Cargo.toml')
    try {
      if (
        fs.existsSync(candidateManifestPath) &&
        isWorkspaceManifest(fs.readFileSync(candidateManifestPath, 'utf8'))
      ) {
        return currentDir
      }
    } catch {
      // Ignore unreadable manifests and continue walking up.
    }

    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) {
      return dirname(manifestPath)
    }
    currentDir = parentDir
  }
}

function collectWorkspaceManifestPaths(workspaceRoot: string) {
  const trackedManifestPaths = new Set<string>()
  const pendingDirs = [workspaceRoot]

  while (pendingDirs.length > 0) {
    const currentDir = pendingDirs.pop()
    if (!currentDir) {
      continue
    }

    let dirEntries: fs.Dirent[]
    try {
      dirEntries = fs.readdirSync(currentDir, { withFileTypes: true })
    } catch {
      continue
    }

    dirEntries.forEach((dirEntry) => {
      if (dirEntry.isDirectory()) {
        if (
          dirEntry.name === '.git' ||
          dirEntry.name === 'node_modules' ||
          dirEntry.name === 'target'
        ) {
          return
        }

        pendingDirs.push(join(currentDir, dirEntry.name))
        return
      }

      if (dirEntry.isFile() && dirEntry.name === 'Cargo.toml') {
        trackedManifestPaths.add(resolve(join(currentDir, dirEntry.name)))
      }
    })
  }

  return trackedManifestPaths
}

function collectManifestFingerprints(
  manifestPath: string,
  metadata?: CargoWorkspaceMetadata,
) {
  const workspaceRoot = findWorkspaceRoot(manifestPath, metadata)
  const trackedManifestPaths = collectWorkspaceManifestPaths(workspaceRoot)

  trackedManifestPaths.add(manifestPath)
  trackedManifestPaths.add(resolve(join(workspaceRoot, 'Cargo.toml')))

  if (metadata) {
    metadata.packages.forEach((pkg) => {
      trackedManifestPaths.add(resolve(pkg.manifest_path))
    })
  }

  const manifestFingerprints = new Map<string, ManifestFingerprint>()
  trackedManifestPaths.forEach((trackedManifestPath) => {
    const fingerprint = getManifestFingerprint(trackedManifestPath)
    if (fingerprint) {
      manifestFingerprints.set(trackedManifestPath, fingerprint)
    }
  })

  return manifestFingerprints
}

function isManifestFingerprintMapEqual(
  left: Map<string, ManifestFingerprint>,
  right: Map<string, ManifestFingerprint>,
) {
  if (left.size !== right.size) {
    return false
  }

  for (const [manifestPath, fingerprint] of left) {
    const rightFingerprint = right.get(manifestPath)
    if (
      !rightFingerprint ||
      !isFingerprintEqual(fingerprint, rightFingerprint)
    ) {
      return false
    }
  }

  return true
}

function isCacheValid(cachedMetadata: CachedMetadata) {
  if (cachedMetadata.manifestFingerprints.size === 0) {
    return false
  }

  for (const [
    manifestPath,
    fingerprint,
  ] of cachedMetadata.manifestFingerprints) {
    const currentFingerprint = getManifestFingerprint(manifestPath)

    if (
      !currentFingerprint ||
      !isFingerprintEqual(currentFingerprint, fingerprint)
    ) {
      return false
    }
  }

  return true
}

async function loadMetadata(manifestPath: string) {
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

export async function parseMetadata(manifestPath: string) {
  const resolvedManifestPath = resolve(manifestPath)
  const cachedEntry = metadataCache.get(resolvedManifestPath)

  if (cachedEntry?.value && isCacheValid(cachedEntry.value)) {
    return cachedEntry.value.metadata
  }

  if (cachedEntry?.promise) {
    return cachedEntry.promise
  }

  const preLoadFingerprints = collectManifestFingerprints(resolvedManifestPath)
  const promise = loadMetadata(resolvedManifestPath)
    .then((metadata) => {
      const postLoadFingerprints = collectManifestFingerprints(
        resolvedManifestPath,
        metadata,
      )

      if (
        isManifestFingerprintMapEqual(preLoadFingerprints, postLoadFingerprints)
      ) {
        metadataCache.set(resolvedManifestPath, {
          value: {
            metadata,
            manifestFingerprints: postLoadFingerprints,
          },
        })
      } else {
        metadataCache.delete(resolvedManifestPath)
      }

      return metadata
    })
    .catch((error) => {
      metadataCache.delete(resolvedManifestPath)
      throw error
    })

  metadataCache.set(resolvedManifestPath, { promise })

  return promise
}
