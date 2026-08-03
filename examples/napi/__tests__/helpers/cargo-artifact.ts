import { execFileSync } from 'node:child_process'

// Shared by the cargo-only addon fixtures (`napi-duplicate-registration`,
// `napi-broken-hierarchy`, `napi-no-napi8`): resolves the built cdylib's
// absolute path by parsing `cargo build`'s own JSON artifact messages, instead
// of assuming `target/debug/<lib name>`. Cargo's message already carries the
// real output path, so this honors `CARGO_TARGET_DIR`, `CARGO_BUILD_TARGET_DIR`,
// a non-debug profile, and cross-compilation target triples for free — no need
// to re-derive cargo's own target-directory resolution rules by hand.

export interface CargoArtifactResult {
  /** Absolute path to the built cdylib, when the build succeeded. */
  path?: string
  /** True only when the `cargo` binary itself could not be spawned (ENOENT). */
  cargoUnavailable: boolean
  /** The build/lookup failure, when `cargoUnavailable` is false and no `path` was found. */
  error?: unknown
}

function sharedLibraryExtension(): string {
  switch (process.platform) {
    case 'win32':
      return '.dll'
    case 'darwin':
      return '.dylib'
    default:
      return '.so'
  }
}

export function buildCargoCdylibArtifact(
  cwd: string,
  packageName: string,
): CargoArtifactResult {
  let stdout: string
  try {
    stdout = execFileSync(
      'cargo',
      ['build', '-p', packageName, '--message-format=json'],
      {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        // A cold build emits one JSON message per compiled unit (plus
        // diagnostics) across every transitive dependency — comfortably over
        // `execFileSync`'s 1 MB default `maxBuffer`, which would otherwise
        // throw and be mistaken for a real build failure below.
        maxBuffer: 64 * 1024 * 1024,
      },
    )
  } catch (error) {
    // `ENOENT` means the `cargo` executable itself could not be found/spawned
    // (the environment has no Rust toolchain) — the one case callers should
    // skip gracefully. Any other failure (non-zero exit from a real compile
    // error, for instance) must propagate so a broken build fails the test.
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { cargoUnavailable: true }
    }
    return { cargoUnavailable: false, error }
  }

  const extension = sharedLibraryExtension()
  for (const line of stdout.split('\n')) {
    if (!line.trim()) {
      continue
    }
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    const artifact = message as {
      reason?: string
      target?: { kind?: string[] }
      filenames?: string[]
    }
    if (
      artifact.reason === 'compiler-artifact' &&
      artifact.target?.kind?.includes('cdylib') &&
      Array.isArray(artifact.filenames)
    ) {
      const found = artifact.filenames.find((file) => file.endsWith(extension))
      if (found) {
        return { cargoUnavailable: false, path: found }
      }
    }
  }

  return {
    cargoUnavailable: false,
    error: new Error(
      `cargo build -p ${packageName} produced no ${extension} cdylib artifact in its JSON output`,
    ),
  }
}
