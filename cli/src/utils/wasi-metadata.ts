import { readFileSync } from 'node:fs'

import { readFileAsync } from './misc.js'

export const WASI_ARTIFACT_METADATA_PREFIX = '// napi-rs-artifact-metadata:'

export interface WasiArtifactMetadata {
  version: 1 | 2
  rootEntry: string | null
  exports?: string[]
  managedRootEntries: string[]
}

export function parseWasiArtifactMetadata(
  content: string,
  source?: string,
): WasiArtifactMetadata | undefined {
  const firstLine = content.split(/\r?\n/, 1)[0]
  if (!firstLine.startsWith(WASI_ARTIFACT_METADATA_PREFIX)) {
    return undefined
  }
  const suffix = source ? ` in ${source}` : ''
  let metadata: unknown
  try {
    metadata = JSON.parse(firstLine.slice(WASI_ARTIFACT_METADATA_PREFIX.length))
  } catch (error) {
    throw new Error(`Invalid WASI artifact metadata${suffix}`, {
      cause: error,
    })
  }
  if (typeof metadata !== 'object' || metadata === null) {
    throw new Error(`Unsupported WASI artifact metadata${suffix}`)
  }
  const record = metadata as Record<string, unknown>
  if (
    (record.version !== 1 && record.version !== 2) ||
    (record.rootEntry !== null && typeof record.rootEntry !== 'string')
  ) {
    throw new Error(`Unsupported WASI artifact metadata${suffix}`)
  }
  const managedRootEntries =
    record.version === 1
      ? ['browser.js', ...(record.rootEntry ? [record.rootEntry] : [])]
      : record.managedRootEntries
  if (
    !Array.isArray(managedRootEntries) ||
    !managedRootEntries.every((entry) => typeof entry === 'string')
  ) {
    throw new Error(`Unsupported WASI artifact metadata${suffix}`)
  }
  const exports = record.exports
  if (
    exports !== undefined &&
    (!Array.isArray(exports) ||
      !exports.every((entry) => typeof entry === 'string'))
  ) {
    throw new Error(`Unsupported WASI artifact metadata${suffix}`)
  }
  return {
    version: record.version,
    rootEntry: record.rootEntry,
    ...(exports !== undefined ? { exports } : {}),
    managedRootEntries: [...new Set(managedRootEntries)],
  }
}

export async function readWasiArtifactMetadata(
  filePath: string,
): Promise<WasiArtifactMetadata | undefined> {
  return parseWasiArtifactMetadata(
    await readFileAsync(filePath, 'utf8'),
    filePath,
  )
}

export function readWasiArtifactMetadataSync(
  filePath: string,
): WasiArtifactMetadata | undefined {
  return parseWasiArtifactMetadata(readFileSync(filePath, 'utf8'), filePath)
}
