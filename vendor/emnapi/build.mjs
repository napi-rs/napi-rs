// TEMPORARY (remove together with vendor/emnapi, see vendor/emnapi/README.md).
//
// Rebuilds the emnapi v2 static archives that `emnapi@2.0.0-alpha.2` should
// ship for napi-rs but currently does not:
//
//   - `lib/wasm32-wasip1/libemnapi.a` is missing from the published package
//     entirely (the non-threaded WASI target).
//   - `lib/wasm32-wasip1-threads/libemnapi-napi-rs-mt.a` references
//     `napi_add_env_cleanup_hook` / `napi_remove_env_cleanup_hook` through the
//     `env` wasm import module, while `crates/napi/src/lib.rs` imports them
//     through the `napi` module. Linking both produces duplicate
//     `env.napi_*_env_cleanup_hook` + `napi.napi_*_env_cleanup_hook` imports
//     in the final wasm, which `examples/napi/wasi-cleanup-hook-link`
//     rejects.
//
// The archives are compiled from the C sources that the published npm package
// itself ships (`node_modules/emnapi/src`), with the source list of the
// `emnapi` target in `node_modules/emnapi/emnapi.gyp`, using these
// conventions:
//
//   - `-DNAPI_EXTERN=` (empty): plain `napi_*` references resolve through the
//     default `env` import module, matching the plain `extern "C"` blocks in
//     `crates/sys/src/lib.rs`.
//   - `napi_add_env_cleanup_hook` / `napi_remove_env_cleanup_hook` are
//     re-declared with `__attribute__((__import_module__("napi")))` after
//     including `node_api.h` (the last declaration wins in clang), matching
//     the `#[link(wasm_import_module = "napi")]` block in
//     `crates/napi/src/lib.rs`.
//
// Usage: WASI_SDK_PATH=/opt/wasi-sdk node vendor/emnapi/build.mjs
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  collectSourceHashes,
  hashFile,
  listArchiveMembers,
} from './integrity.mjs'

const require = createRequire(import.meta.url)
const vendorDir = dirname(fileURLToPath(import.meta.url))

const EXPECTED_EMNAPI_VERSION = '2.0.0-alpha.2'

const emnapiPackageJsonPath = require.resolve('emnapi/package.json')
const emnapiVersion = require('emnapi/package.json').version
if (emnapiVersion !== EXPECTED_EMNAPI_VERSION) {
  throw new Error(
    `vendor/emnapi was generated from emnapi@${EXPECTED_EMNAPI_VERSION} but emnapi@${emnapiVersion} is installed. ` +
      'Check whether the newer emnapi already ships the archives (then delete vendor/emnapi), ' +
      'or update EXPECTED_EMNAPI_VERSION here and in vendor/emnapi/install.mjs and regenerate.',
  )
}
const emnapiRoot = dirname(emnapiPackageJsonPath)

const wasiSdkPath = process.env.WASI_SDK_PATH
if (!wasiSdkPath) {
  throw new Error('WASI_SDK_PATH must point to a wasi-sdk installation')
}
const clang = join(wasiSdkPath, 'bin', 'clang')
const llvmAr = join(wasiSdkPath, 'bin', 'llvm-ar')

// Source list of the `emnapi` target in `node_modules/emnapi/emnapi.gyp`,
// which is also the member list of the published
// `lib/wasm32-wasip1-threads/libemnapi-napi-rs-mt.a`.
const sources = [
  'src/js_native_api.c',
  'src/node_api.c',
  'src/async_cleanup_hook.c',
  'src/async_context.c',
  'src/wasi_wait.c',
  'src/async_work.c',
  'src/threadsafe_function.c',
  'src/uv/uv-common.c',
  'src/uv/threadpool.c',
  'src/uv/unix/loop.c',
  'src/uv/unix/posix-hrtime.c',
  'src/uv/unix/thread.c',
  'src/uv/unix/async.c',
  'src/uv/unix/core.c',
]

// In a build without threads the C implementations of async work and
// thread-safe functions are unconditional `napi_generic_failure` stubs (see
// `#if EMNAPI_HAVE_THREADS` in the sources). They must stay out of the
// archive so that the wasm imports the JavaScript implementations from
// `@emnapi/core/plugins` (`asyncWork`, `tsfn`) instead — the emnapi v1
// `libemnapi-basic.a` model.
const threadOnlySources = new Set([
  'src/async_work.c',
  'src/threadsafe_function.c',
])

// Sources that reference the env cleanup hooks and therefore need the
// `napi` import module re-declarations.
const needsNapiCleanupHooks = new Set([
  'src/async_cleanup_hook.c',
  'src/threadsafe_function.c',
])

const napiCleanupHookRedeclarations = `
__attribute__((__import_module__("napi")))
napi_status napi_add_env_cleanup_hook(node_api_basic_env env,
                                      napi_cleanup_hook fun,
                                      void* arg);
__attribute__((__import_module__("napi")))
napi_status napi_remove_env_cleanup_hook(node_api_basic_env env,
                                         napi_cleanup_hook fun,
                                         void* arg);
`

function buildArchive({ target, threads, archiveName }) {
  const workDir = mkdtempSync(join(tmpdir(), 'emnapi-vendor-'))
  const objects = []
  try {
    for (const source of sources) {
      if (!threads && threadOnlySources.has(source)) {
        continue
      }
      const objectName = `${source.split('/').pop()}.obj`
      const objectPath = join(workDir, objectName)
      let inputPath = join(emnapiRoot, source)
      if (needsNapiCleanupHooks.has(source)) {
        // The last declaration wins in clang, so re-declaring the hooks with
        // `__import_module__("napi")` after `node_api.h` (included by the
        // source itself, second include is a no-op thanks to the guard)
        // rebinds only these two symbols to the `napi` import module.
        inputPath = join(workDir, `${source.split('/').pop()}.wrapper.c`)
        writeFileSync(
          inputPath,
          `#include <node_api.h>\n${napiCleanupHookRedeclarations}\n#include "${join(
            emnapiRoot,
            source,
          )}"\n`,
        )
      }
      execFileSync(
        clang,
        [
          `--target=${target}`,
          ...(threads ? ['-pthread'] : []),
          '-O2',
          '-fvisibility=hidden',
          '-DNAPI_EXTERN=',
          '-Wno-ignored-attributes',
          `-I${join(emnapiRoot, 'include', 'node')}`,
          `-I${join(emnapiRoot, 'src')}`,
          '-c',
          inputPath,
          '-o',
          objectPath,
        ],
        { stdio: 'inherit' },
      )
      objects.push(objectPath)
    }
    const outDir = join(vendorDir, target)
    mkdirSync(outDir, { recursive: true })
    const archivePath = join(outDir, archiveName)
    rmSync(archivePath, { force: true })
    execFileSync(llvmAr, ['rcs', archivePath, ...objects], {
      stdio: 'inherit',
    })
    console.info(`Built ${archivePath}`)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

buildArchive({
  target: 'wasm32-wasip1',
  threads: false,
  archiveName: 'libemnapi.a',
})
buildArchive({
  target: 'wasm32-wasip1-threads',
  threads: true,
  archiveName: 'libemnapi-napi-rs-mt.a',
})

// Record the provenance manifest: hashes of every npm-shipped file that can
// influence the archives, plus hashes and member lists of the archives
// themselves. `install.mjs` re-verifies all of it before every use.
const wasiSdkVersionFile = join(wasiSdkPath, 'VERSION')
const manifest = {
  emnapiVersion,
  wasiSdk: existsSync(wasiSdkVersionFile)
    ? readFileSync(wasiSdkVersionFile, 'utf8').trim().split('\n')
    : 'unknown',
  sources: collectSourceHashes(emnapiRoot),
  archives: Object.fromEntries(
    [
      ['wasm32-wasip1/libemnapi.a', null],
      ['wasm32-wasip1-threads/libemnapi-napi-rs-mt.a', null],
    ].map(([archive]) => {
      const path = join(vendorDir, archive)
      return [
        archive,
        { integrity: hashFile(path), members: listArchiveMembers(path) },
      ]
    }),
  ),
}
writeFileSync(
  join(vendorDir, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
)
console.info(`Wrote ${join(vendorDir, 'manifest.json')}`)
