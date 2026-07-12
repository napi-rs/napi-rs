// TEMPORARY (remove together with vendor/emnapi, see vendor/emnapi/README.md).
//
// Copies the vendored emnapi v2 archives over the installed
// `node_modules/emnapi/lib` tree:
//
//   - adds the missing `lib/wasm32-wasip1/libemnapi.a`,
//   - replaces `lib/wasm32-wasip1-threads/libemnapi-napi-rs-mt.a` with a
//     build whose `napi_*_env_cleanup_hook` references use the `napi` wasm
//     import module.
//
// Runs from the repository `postinstall` hook and from the CI steps that
// build WASI targets (CI installs with `--mode=skip-build`, which skips
// `postinstall`).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const vendorDir = dirname(fileURLToPath(import.meta.url))

const EXPECTED_EMNAPI_VERSION = '2.0.0-alpha.2'

let emnapiPackageJsonPath
try {
  emnapiPackageJsonPath = require.resolve('emnapi/package.json')
} catch {
  // Not installed (e.g. a partial install); nothing to patch.
  process.exit(0)
}

const emnapiVersion = require('emnapi/package.json').version
if (emnapiVersion !== EXPECTED_EMNAPI_VERSION) {
  throw new Error(
    `vendor/emnapi was built from emnapi@${EXPECTED_EMNAPI_VERSION} but emnapi@${emnapiVersion} is installed. ` +
      'If the newer emnapi ships lib/wasm32-wasip1/libemnapi.a and a lib/wasm32-wasip1-threads/libemnapi-napi-rs-mt.a ' +
      'whose napi_*_env_cleanup_hook references use the `napi` import module, delete vendor/emnapi and its callers; ' +
      'otherwise regenerate the archives with vendor/emnapi/build.mjs.',
  )
}

const emnapiLib = join(dirname(emnapiPackageJsonPath), 'lib')

for (const [target, archive] of [
  ['wasm32-wasip1', 'libemnapi.a'],
  ['wasm32-wasip1-threads', 'libemnapi-napi-rs-mt.a'],
]) {
  const source = join(vendorDir, target, archive)
  if (!existsSync(source)) {
    throw new Error(`vendored archive is missing: ${source}`)
  }
  const targetDir = join(emnapiLib, target)
  mkdirSync(targetDir, { recursive: true })
  copyFileSync(source, join(targetDir, archive))
  console.info(`vendor/emnapi: installed ${target}/${archive}`)
}
