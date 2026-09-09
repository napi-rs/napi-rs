import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type Platform = NodeJS.Platform | 'wasm' | 'wasi' | 'openharmony'

export const UNIVERSAL_TARGETS = {
  'universal-apple-darwin': ['aarch64-apple-darwin', 'x86_64-apple-darwin'],
} as const

const SUB_SYSTEMS = new Set(['android', 'ohos'])

export const AVAILABLE_TARGETS = [
  'aarch64-apple-darwin',
  'aarch64-linux-android',
  'aarch64-unknown-linux-gnu',
  'aarch64-unknown-linux-musl',
  'aarch64-unknown-linux-ohos',
  'aarch64-pc-windows-msvc',
  'x86_64-apple-darwin',
  'x86_64-pc-windows-msvc',
  'x86_64-pc-windows-gnu',
  'x86_64-unknown-linux-gnu',
  'x86_64-unknown-linux-musl',
  'x86_64-unknown-linux-ohos',
  'x86_64-unknown-freebsd',
  'i686-pc-windows-msvc',
  'armv7-unknown-linux-gnueabihf',
  'armv7-unknown-linux-musleabihf',
  'armv7-linux-androideabi',
  'universal-apple-darwin',
  'loongarch64-unknown-linux-gnu',
  'riscv64gc-unknown-linux-gnu',
  'powerpc64le-unknown-linux-gnu',
  's390x-unknown-linux-gnu',
  'wasm32-wasip1',
  'wasm32-wasip1-threads',
] as const

export type TargetTriple = (typeof AVAILABLE_TARGETS)[number]

export const DEFAULT_TARGETS = [
  'x86_64-apple-darwin',
  'aarch64-apple-darwin',
  'x86_64-pc-windows-msvc',
  'x86_64-unknown-linux-gnu',
] as const

export const TARGET_LINKER: Record<string, string> = {
  'aarch64-unknown-linux-musl': 'aarch64-linux-musl-gcc',
  // TODO: Switch to loongarch64-linux-gnu-gcc when available
  'loongarch64-unknown-linux-gnu': 'loongarch64-linux-gnu-gcc-13',
  'riscv64gc-unknown-linux-gnu': 'riscv64-linux-gnu-gcc',
  'powerpc64le-unknown-linux-gnu': 'powerpc64le-linux-gnu-gcc',
  's390x-unknown-linux-gnu': 's390x-linux-gnu-gcc',
}

// https://nodejs.org/api/process.html#process_process_arch
type NodeJSArch =
  | 'arm'
  | 'arm64'
  | 'ia32'
  | 'loong64'
  | 'mips'
  | 'mipsel'
  | 'ppc'
  | 'ppc64'
  | 'riscv64'
  | 's390'
  | 's390x'
  | 'x32'
  | 'x64'
  | 'universal'
  | 'wasm32'

const CpuToNodeArch: Record<string, NodeJSArch> = {
  x86_64: 'x64',
  aarch64: 'arm64',
  i686: 'ia32',
  armv7: 'arm',
  loongarch64: 'loong64',
  riscv64gc: 'riscv64',
  powerpc64le: 'ppc64',
}

export const NodeArchToCpu: Record<string, string> = {
  x64: 'x86_64',
  arm64: 'aarch64',
  ia32: 'i686',
  arm: 'armv7',
  loong64: 'loongarch64',
  riscv64: 'riscv64gc',
  ppc64: 'powerpc64le',
}

const SysToNodePlatform: Record<string, Platform> = {
  linux: 'linux',
  freebsd: 'freebsd',
  darwin: 'darwin',
  windows: 'win32',
  ohos: 'openharmony',
}

export const UniArchsByPlatform: Partial<Record<Platform, NodeJSArch[]>> = {
  darwin: ['x64', 'arm64'],
}

export interface Target {
  triple: string
  platformArchABI: string
  platform: Platform
  arch: NodeJSArch
  abi: string | null
}

export type WasiFlavor = 'single' | 'threads'

export interface WasiTarget {
  canonicalTriple: string
  flavor: WasiFlavor
  platformArchABI: string
}

/**
 * Resolve historical WASI spellings to one build target and one artifact
 * identity. `wasm32-wasi` historically produced the threaded package, so it
 * must never be inferred as threadless merely because its name lacks the
 * `-threads` suffix.
 */
export function getWasiTarget(
  target: string | Pick<Target, 'triple'>,
): WasiTarget | undefined {
  const triple = typeof target === 'string' ? target : target.triple

  switch (triple) {
    case 'wasm32-wasi':
    case 'wasm32-wasi-preview1-threads':
    case 'wasm32-wasip1-threads':
      return {
        canonicalTriple: 'wasm32-wasip1-threads',
        flavor: 'threads',
        platformArchABI: 'wasm32-wasi',
      }
    case 'wasm32-wasip1':
      return {
        canonicalTriple: 'wasm32-wasip1',
        flavor: 'single',
        platformArchABI: 'wasm32-wasip1',
      }
    default:
      return
  }
}

export function wasiTargetHasThreads(
  target: string | Pick<Target, 'triple'>,
): boolean {
  return getWasiTarget(target)?.flavor === 'threads'
}

function readTextFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * Detect the major version of a wasi-sdk installation.
 *
 * wasi-libc dropped the unused `int op` parameter from
 * `__wasilibc_futex_wait_atomic_wait` and `__wasilibc_futex_wait_maybe_busy`,
 * and wasi-sdk 34 is the first release that ships the 3-argument signature.
 * Static archives compiled against the two signatures cannot be mixed, so the
 * emnapi archives have to be picked by wasi-sdk version, not by target triple
 * alone.
 *
 * `<wasiSdkPath>/VERSION` is the primary signal: every release ships it and
 * its first line is the version (`27.0`, `33.0+m`, `34.0`, ...). The
 * `wasi/version.h` header carrying `__wasi_sdk_major__` only appears from
 * wasi-sdk 30 onwards, so it stays a fallback for trees without a `VERSION`.
 *
 * Returns `null` when neither signal is readable or parseable. Detection must
 * never throw: an unknown wasi-sdk degrades to the legacy archives instead of
 * failing the build.
 */
export function wasiSdkMajorVersion(wasiSdkPath: string): number | null {
  const version = readTextFileOrNull(join(wasiSdkPath, 'VERSION'))
  if (version) {
    // `33.0+m` and friends carry a build suffix, so only the leading integer
    // of the first line is meaningful.
    const major = /^\s*(\d+)/.exec(version.split('\n', 1)[0])
    if (major) {
      return Number(major[1])
    }
  }
  const versionHeader = readTextFileOrNull(
    join(
      wasiSdkPath,
      'share',
      'wasi-sysroot',
      'include',
      'wasm32-wasip1-threads',
      'wasi',
      'version.h',
    ),
  )
  if (versionHeader) {
    const major = /^\s*#\s*define\s+__wasi_sdk_major__\s+(\d+)/m.exec(
      versionHeader,
    )
    if (major) {
      return Number(major[1])
    }
  }
  return null
}

/**
 * Archive member that only exists in a wasi-libc carrying the 3-argument
 * futex ABI.
 *
 * wasi-libc moved the wasi-threads futex helpers out of `__wait.c` and into a
 * new `futex.c` in the same change that dropped the unused `int op` parameter
 * (WebAssembly/wasi-libc#846). `__wait.c` still exists afterwards for other
 * symbols, so the presence of `futex.c` — not the absence of `__wait.c` — is
 * what separates the two ABIs.
 */
const NEW_FUTEX_ABI_ARCHIVE_MEMBER = 'futex.c.obj'

/**
 * Path to the wasi-libc that cargo links when no wasi-sdk is configured.
 *
 * Without `WASI_SDK_PATH` the target links through `rust-lld` against the
 * wasi-libc bundled with the Rust standard library, so that copy — not a
 * wasi-sdk — decides the futex ABI.
 *
 * Returns `null` when `rustc` cannot be queried or the target is not
 * installed. Never throws: an undetectable sysroot degrades to the legacy
 * archives.
 */
export function rustBundledWasiLibc(wasiTarget: string): string | null {
  let sysroot: string
  try {
    sysroot = execSync('rustc --print sysroot', {
      env: process.env,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString('utf8')
      .trim()
  } catch {
    return null
  }
  if (!sysroot) {
    return null
  }
  return join(
    sysroot,
    'lib',
    'rustlib',
    wasiTarget,
    'lib',
    'self-contained',
    'libc.a',
  )
}

/**
 * Whether a wasi-libc archive carries the 3-argument futex ABI.
 *
 * Returns `null` when the archive cannot be read, so callers can tell
 * "definitely the legacy ABI" apart from "could not tell".
 */
export function wasiLibcHasNewFutexAbi(
  libcArchivePath: string | null,
): boolean | null {
  if (!libcArchivePath) {
    return null
  }
  let archive: Buffer
  try {
    archive = readFileSync(libcArchivePath)
  } catch {
    return null
  }
  return archive.includes(NEW_FUTEX_ABI_ARCHIVE_MEMBER, 0, 'latin1')
}

/**
 * A triple is a specific format for specifying a target architecture.
 * Triples may be referred to as a target triple which is the architecture for the artifact produced, and the host triple which is the architecture that the compiler is running on.
 * The general format of the triple is `<arch><sub>-<vendor>-<sys>-<abi>` where:
 *   - `arch` = The base CPU architecture, for example `x86_64`, `i686`, `arm`, `thumb`, `mips`, etc.
 *   - `sub` = The CPU sub-architecture, for example `arm` has `v7`, `v7s`, `v5te`, etc.
 *   - `vendor` = The vendor, for example `unknown`, `apple`, `pc`, `nvidia`, etc.
 *   - `sys` = The system name, for example `linux`, `windows`, `darwin`, etc. none is typically used for bare-metal without an OS.
 *   - `abi` = The ABI, for example `gnu`, `android`, `eabi`, etc.
 */
export function parseTriple(rawTriple: string): Target {
  const wasiTarget = getWasiTarget(rawTriple)
  if (wasiTarget) {
    return {
      triple: wasiTarget.canonicalTriple,
      platformArchABI: wasiTarget.platformArchABI,
      platform: 'wasi',
      arch: 'wasm32',
      abi: 'wasi',
    }
  }
  if (/^wasm32-(?:wasip|wasi(?:-|$))/.test(rawTriple)) {
    throw new TypeError(
      `Unsupported WASI target ${rawTriple}. Supported targets are wasm32-wasip1, wasm32-wasip1-threads, wasm32-wasi, and wasm32-wasi-preview1-threads.`,
    )
  }
  const triple = rawTriple.endsWith('eabi')
    ? `${rawTriple.slice(0, -4)}-eabi`
    : rawTriple
  const triples = triple.split('-')
  let cpu: string
  let sys: string
  let abi: string | null = null
  if (triples.length === 2) {
    // aarch64-fuchsia
    // ^ cpu   ^ sys
    ;[cpu, sys] = triples
  } else {
    // aarch64-unknown-linux-musl
    // ^ cpu   ^vendor ^ sys ^ abi
    // aarch64-apple-darwin
    // ^ cpu         ^ sys  (abi is None)
    ;[cpu, , sys, abi = null] = triples
  }

  if (abi && SUB_SYSTEMS.has(abi)) {
    sys = abi
    abi = null
  }
  const platform = SysToNodePlatform[sys] ?? (sys as Platform)
  const arch = CpuToNodeArch[cpu] ?? (cpu as NodeJSArch)

  return {
    triple: rawTriple,
    platformArchABI: abi ? `${platform}-${arch}-${abi}` : `${platform}-${arch}`,
    platform,
    arch,
    abi,
  }
}

export function getSystemDefaultTarget(): Target {
  const host = execSync(`rustc -vV`, {
    env: process.env,
  })
    .toString('utf8')
    .split('\n')
    .find((line) => line.startsWith('host: '))
  const triple = host?.slice('host: '.length)
  if (!triple) {
    throw new TypeError(`Can not parse target triple from host`)
  }
  return parseTriple(triple)
}

export function getTargetLinker(target: string): string | undefined {
  return TARGET_LINKER[target]
}

/**
 * Loader-file suffix for a WASI flavor, derived from its `platformArchABI`:
 * the legacy threaded flavor keeps the historical `wasi` stem
 * (`<binaryName>.wasi.cjs`, `<binaryName>.wasi-browser.js`), while each
 * distinctly named non-threaded flavor derives its own
 * (`<binaryName>.wasip1.cjs`, `<binaryName>.wasip1-browser.js`, ...).
 */
export function wasiLoaderSuffix(platformArchABI: string): string {
  return platformArchABI.replace(/^wasm32-/, '')
}

export function targetToEnvVar(target: string): string {
  return target.replace(/-/g, '_').toUpperCase()
}
