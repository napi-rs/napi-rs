#!/usr/bin/env node
// Build and stage the self-loading stub for each target supported by --compress.
//
// Usage:
//   node cli/build/stubs.mjs                 # all targets
//   node cli/build/stubs.mjs <triple>...     # only the given targets
//   BUILD_STD=1 node cli/build/stubs.mjs     # rebuild std for smaller stubs
//   ZIGBUILD=1 node cli/build/stubs.mjs      # cross-compile via cargo-zigbuild
//
// BUILD_STD uses the pinned nightly. ZIGBUILD supplies the C cross-compiler needed
// for libzstd. Without ZIGBUILD, the target toolchain must provide one.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cliRoot = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(cliRoot, '..')
const stubsDir = join(cliRoot, 'stubs')

// Build a stub for every supported target. Non-Btrfs filesystems use the cache.
const DEFAULT_TARGETS = [
  'aarch64-apple-darwin',
  'aarch64-pc-windows-msvc',
  'aarch64-unknown-linux-gnu',
  'aarch64-unknown-linux-musl',
  'x86_64-apple-darwin',
  'x86_64-pc-windows-msvc',
  'x86_64-unknown-linux-gnu',
  'x86_64-unknown-linux-musl',
]

const PROFILE = 'addon-min'

// BUILD_STD uses two nightly-only cargo features for the smallest stub:
// `-Z build-std` and `-Cpanic=immediate-abort`. Pin a known-good nightly so
// shipped stubs are reproducible. When BUILD_STD is set and the caller hasn't
// overridden CARGO, the build runs through `rustup run <pin>`.
//
// CHECK ON EACH RUST RELEASE: once build-std and -Cpanic=immediate-abort
// stabilize, drop this pin + the nightly requirement and build on stable.
//   build-std: https://doc.rust-lang.org/cargo/reference/unstable.html#build-std
const NIGHTLY_PIN = 'nightly-2026-03-28'

const buildStd = process.env.BUILD_STD === '1'
const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : DEFAULT_TARGETS

function cdylibName(triple) {
  if (triple.includes('apple-darwin')) {
    return 'libnapi_native_addon_stub.dylib'
  }
  if (triple.includes('windows')) {
    return 'napi_native_addon_stub.dll'
  }
  return 'libnapi_native_addon_stub.so'
}

function cargoTargetDir() {
  const metadata = execFileSync(
    process.env.CARGO || 'cargo',
    ['metadata', '--no-deps', '--format-version', '1'],
    { cwd: repoRoot, env: process.env },
  )
  return JSON.parse(metadata).target_directory
}

const targetDir = cargoTargetDir()

function buildOne(triple) {
  const subcommand = process.env.ZIGBUILD === '1' ? 'zigbuild' : 'build'
  const args = [
    subcommand,
    '-p',
    'napi-native-addon-stub',
    '--profile',
    PROFILE,
  ]
  const env = { ...process.env }
  if (buildStd) {
    // Rebuild std for this target with immediate-abort to omit unwind support.
    args.push('-Z', 'build-std=std,panic_abort')
    env.RUSTFLAGS =
      `${process.env.RUSTFLAGS ?? ''} -Zunstable-options -Cpanic=immediate-abort`.trim()
  }
  if (triple.includes('apple-darwin')) {
    // Reserve Mach-O header padding so the producer can write the __NAPI_PAYLOAD
    // LC_SEGMENT_64 load command into header slack — no section relocation, only a
    // __LINKEDIT shift. The padding exceeds the new load command size.
    // See crates/napi-native-addon/src/section.rs for the reader side.
    env.RUSTFLAGS =
      `${env.RUSTFLAGS ?? ''} -C link-arg=-Wl,-headerpad,0x1000`.trim()
  }
  if (
    triple.includes('musl') &&
    !env.RUSTFLAGS?.includes('target-feature=-crt-static')
  ) {
    // Node loads the stub as a cdylib, so it needs the dynamic C runtime.
    env.RUSTFLAGS =
      `${env.RUSTFLAGS ?? ''} -C target-feature=-crt-static`.trim()
  }
  args.push('--target', triple)
  // CARGO overrides the toolchain explicitly (matches build.ts). Otherwise, a
  // build-std build runs through the pinned nightly via `rustup run`; a plain
  // build uses whatever `cargo` is on PATH.
  let cmd = process.env.CARGO || 'cargo'
  let cmdArgs = args
  if (buildStd && !process.env.CARGO) {
    cmd = 'rustup'
    cmdArgs = ['run', NIGHTLY_PIN, 'cargo', ...args]
  }
  execFileSync(cmd, cmdArgs, { cwd: repoRoot, stdio: 'inherit', env })

  const built = join(targetDir, triple, PROFILE, cdylibName(triple))
  const dest = join(stubsDir, `${triple}.node`)
  copyFileSync(built, dest)
  return dest
}

mkdirSync(stubsDir, { recursive: true })
for (const triple of targets) {
  const dest = buildOne(triple)
  console.error(`stub: ${triple} -> ${dest}`)
}
console.error(`\nbuilt ${targets.length} stub(s) into ${stubsDir}`)
