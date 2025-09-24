import { execSync } from 'node:child_process'

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
  'wasm32-wasi-preview1-threads',
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
  if (
    rawTriple === 'wasm32-wasi' ||
    rawTriple === 'wasm32-wasi-preview1-threads' ||
    rawTriple.startsWith('wasm32-wasip')
  ) {
    return {
      triple: rawTriple,
      platformArchABI: 'wasm32-wasi',
      platform: 'wasi',
      arch: 'wasm32',
      abi: 'wasi',
    }
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

export function targetToEnvVar(target: string): string {
  return target.replace(/-/g, '_').toUpperCase()
}
