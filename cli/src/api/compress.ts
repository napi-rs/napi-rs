import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { rename } from 'node:fs/promises'

const execFileAsync = promisify(execFile)

const LEVEL_RANGE = { max: 22, min: 1 }

export interface CompressedArtifact {
  // The compressed addon, written back over the original `.node` path — the
  // single self-loading file (the stub image carrying a SMOL/__NAPI_PAYLOAD section),
  // same filename.
  path: string
  rawSize: number
  // Size of the zstd payload inside the injected __NAPI_PAYLOAD section.
  compSize: number
  // Total on-disk size of the produced, ad-hoc-signed `.node`.
  totalSize: number
  contentHash: bigint
  level: number
}

export interface CompressOptions {
  // zstd level. Omit to use level 16 for small addons and 22 for addons >= 8 MiB.
  // Clamped to 1..22 when provided.
  level?: number
  // Path to the prebuilt stub cdylib for THIS artifact's target, shipped in
  // `@napi-rs/cli`. The caller (build.ts) resolves it from the target triple.
  stubPath: string
  // Path to the host `napi-compress` producer binary, shipped in `@napi-rs/cli`.
  // It compresses the addon and injects + ad-hoc-signs the signable __NAPI_PAYLOAD
  // section. The caller (build.ts) resolves it from the host triple.
  napiCompressPath: string
}

// The producer's one-line JSON receipt (crates/napi-compress/src/main.rs).
interface ProducerReceipt {
  rawSize: number
  compSize: number
  totalSize: number
  contentHash: string
  level: number
}

function clampLevel(level: number): number {
  if (Number.isNaN(level)) {
    return 16
  }
  return Math.max(LEVEL_RANGE.min, Math.min(LEVEL_RANGE.max, Math.trunc(level)))
}

// The Rust producer writes a signed self-loading addon beside the original.
// The stub loads from a cache or, on Btrfs, replaces the carrier in place.
// Producer failures abort the build.
export async function compressNodeArtifact(
  nodePath: string,
  options: CompressOptions,
): Promise<CompressedArtifact> {
  const level =
    options.level === undefined ? undefined : clampLevel(options.level)
  const outPath = `${nodePath}.compressed`
  let stdout: string
  try {
    ;({ stdout } = await execFileAsync(options.napiCompressPath, [
      options.stubPath,
      nodePath,
      outPath,
      ...(level === undefined ? [] : ['--level', String(level)]),
    ]))
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    throw new Error(
      'napi-rs --compress: the napi-compress producer failed.\n' +
        `  Where:    ${options.napiCompressPath}\n` +
        `  Saw:      ${detail}\n` +
        '  Fix:      reinstall @napi-rs/cli, or rebuild the producer with\n' +
        '            cli/build/producer.mjs for this host.',
    )
  }
  const receipt = JSON.parse(stdout) as ProducerReceipt
  // The producer wrote a fresh, signed file beside the addon; move it over the
  // original so the compressed `.node` keeps its name.
  await rename(outPath, nodePath)
  return {
    compSize: receipt.compSize,
    contentHash: BigInt(`0x${receipt.contentHash}`),
    level: receipt.level,
    path: nodePath,
    rawSize: receipt.rawSize,
    totalSize: receipt.totalSize,
  }
}
