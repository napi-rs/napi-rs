import { execSync } from 'child_process'

export type Platform = NodeJS.Platform | 'wasm' | 'wasi'

export const AVAILABLE_TARGETS = [
  'aarch64-apple-darwin',
  'aarch64-linux-android',
  'aarch64-unknown-linux-gnu',
  'aarch64-unknown-linux-musl',
  'aarch64-pc-windows-msvc',
  'x86_64-apple-darwin',
  'x86_64-pc-windows-msvc',
  'x86_64-unknown-linux-gnu',
  'x86_64-unknown-linux-musl',
  'x86_64-unknown-freebsd',
  'i686-pc-windows-msvc',
  'armv7-unknown-linux-gnueabihf',
  'armv7-linux-androideabi',
  'universal-apple-darwin',
  'riscv64gc-unknown-linux-gnu',
] as const

export type TargetTriple = (typeof AVAILABLE_TARGETS)[number]

export const DEFAULT_TARGETS = [
  'x86_64-apple-darwin',
  'x86_64-pc-windows-msvc',
  'x86_64-unknown-linux-gnu',
] as const

export const TARGET_LINKER: Record<string, string> = {
  'aarch64-unknown-linux-musl': 'aarch64-linux-musl-gcc',
  'riscv64gc-unknown-linux-gnu': 'riscv64-linux-gnu-gcc',
}

// https://nodejs.org/api/process.html#process_process_arch
type NodeJSArch =
  | 'arm'
  | 'arm64'
  | 'ia32'
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

const CpuToNodeArch: Record<string, NodeJSArch> = {
  x86_64: 'x64',
  aarch64: 'arm64',
  i686: 'ia32',
  armv7: 'arm',
  riscv64gc: 'riscv64',
}

export const NodeArchToCpu: Record<string, string> = {
  x64: 'x86_64',
  arm64: 'aarch64',
  ia32: 'i686',
  arm: 'armv7',
  riscv64: 'riscv64gc',
}

const SysToNodePlatform: Record<string, Platform> = {
  linux: 'linux',
  freebsd: 'freebsd',
  darwin: 'darwin',
  windows: 'win32',
}

export const UniArchsByPlatform: Partial<Record<Platform, NodeJSArch[]>> = {
  darwin: ['x64', 'arm64'],
}

export interface Target {
  triple: string
  platformArchABI: string
  platform: Platform
  arch: NodeJSArch | 'wasm32'
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
    // ^ cpu           ^ sys ^ abi
    // aarch64-apple-darwin
    // ^ cpu         ^ sys  (abi is None)
    ;[cpu, , sys, abi = null] = triples
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
