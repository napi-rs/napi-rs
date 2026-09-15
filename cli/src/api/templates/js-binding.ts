import { wasiLoaderSuffix } from '../../utils/index.js'

import {
  assertBindingTargetIdentFree,
  BINDING_TARGET_STAMP_HELPER,
  NAPI_BINDING_TARGET_EXPORT,
  NAPI_BINDING_TARGET_STAMP_FN,
} from './binding-target.js'

function resolveWasiFlavors(wasiFlavors?: string[]): string[] {
  return wasiFlavors && wasiFlavors.length > 0 ? wasiFlavors : ['wasm32-wasi']
}

/**
 * Generate the WASI fallback `require` chain for `binding.cjs`/`binding.js`.
 *
 * Local candidates are tried before installed package fallbacks. Within each
 * group, candidates retain the declared flavor order (threaded flavors are
 * expected first), and the chain stops at the FIRST successfully loaded
 * binding.
 */
function createWasiFallbackChain(
  localName: string,
  pkgName: string,
  flavors: string[],
  packageVersion?: string,
  localWasiName = `./${localName}`,
): string {
  const candidates = [
    ...flavors.map((flavor) => ({
      flavor,
      specifier: `${localWasiName}.${wasiLoaderSuffix(flavor)}.cjs`,
      isPackage: false,
      localArtifacts: [
        `${localWasiName}.${flavor}.debug.wasm`,
        `${localWasiName}.${flavor}.wasm`,
      ],
    })),
    ...flavors.map((flavor) => ({
      flavor,
      specifier: `${pkgName}-${flavor}`,
      isPackage: true,
      localArtifacts: undefined,
    })),
  ]
  const chain = candidates
    .map(
      ({
        flavor,
        specifier,
        isPackage,
        localArtifacts,
      }) => `  if (!wasiBindingLoaded && (!__napiWasiFlavorRequested || __napiWasiFlavor === '${flavor}')) {
    let candidateError = null
    let candidateFailed = false
    try {
      candidateError = __napiWasiResolveCandidate('${specifier}', ${isPackage}, ${localArtifacts ? `[${localArtifacts.map((artifact) => `'${artifact}'`).join(', ')}]` : 'undefined'})
      candidateFailed = candidateError !== null
      if (!candidateFailed) {${
        isPackage && packageVersion
          ? `
        if (process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== '0') {
          const bindingPackageVersion = require('${specifier}/package.json').version
          if (bindingPackageVersion !== '${packageVersion}') {
            throw new Error(\`WASI binding package version mismatch, expected ${packageVersion} but got \${bindingPackageVersion}. You can reinstall dependencies to fix this issue.\`)
          }
        }`
          : ''
      }
        wasiBinding = require('${specifier}')
        nativeBinding = wasiBinding
        __napiLoadedBindingTarget = '${flavor}'
        wasiBindingLoaded = true
      }
    } catch (err) {
      candidateError = err
      candidateFailed = true
    }
    if (candidateFailed) {
      wasiBindingErrors.push(candidateError)
      loadErrors.push(candidateError)
    }
  }`,
    )
    .join('\n')
  return `  const __napiWasiResolveCandidate = (specifier, isPackage, localArtifacts) => {
    try {
      require.resolve(specifier)
    } catch (resolveError) {
      if (!resolveError || resolveError.code !== 'MODULE_NOT_FOUND') {
        throw resolveError
      }
      if (isPackage) {
        try {
          require.resolve(specifier + '/package.json')
        } catch (packageError) {
          if (packageError && packageError.code === 'MODULE_NOT_FOUND') {
            return resolveError
          }
          // An exports restriction proves the package exists even when its
          // package.json is not public. Preserve the root resolution failure.
          throw resolveError
        }
        // The package exists but its main/export target is broken.
        throw resolveError
      }
      return resolveError
    }
    if (localArtifacts) {
      let artifactError = null
      for (let i = 0; i < localArtifacts.length; i++) {
        try {
          require.resolve(localArtifacts[i])
          return null
        } catch (resolveError) {
          if (!resolveError || resolveError.code !== 'MODULE_NOT_FOUND') {
            throw resolveError
          }
          artifactError = resolveError
        }
      }
      return artifactError
    }
    return null
  }
${chain}`
}

export function createCjsBinding(
  localName: string,
  pkgName: string,
  idents: string[],
  packageVersion?: string,
  wasiFlavors?: string[],
  localWasiName?: string,
): string {
  assertBindingTargetIdentFree(idents)
  return `${bindingHeader}
${createCommonBinding(
  localName,
  pkgName,
  packageVersion,
  wasiFlavors,
  localWasiName,
)}
${BINDING_TARGET_STAMP_HELPER}
// Stamp before the alias, not after. The guard only reads \`nativeBinding\`
// (\`hasOwnProperty\` plus a comparison), which is safe against any addon
// accessor; an assignment is not, because a \`#[napi(module_exports)]\` hook can
// expose a getter reporting this very value and a setter that throws. So the
// assignment lands on the loader's own \`module.exports\`, still the original
// object here, and the alias below replaces it.
//
// The assignment is what keeps the marker a statically visible CommonJS export:
// \`cjs-module-lexer\` is Node's CJS -> ESM named export detection, it cannot see
// a bare call, and the later \`module.exports = nativeBinding\` does not undo the
// detection. The assignment itself always succeeds — its target is this
// loader's own, still extensible \`module.exports\` — and the alias below then
// discards the value it wrote. What a consumer reads is whatever the guard put
// on \`nativeBinding\`, so on a frozen binding, where the guard skips, the
// linked import resolves to \`undefined\`.
module.exports.${NAPI_BINDING_TARGET_EXPORT} = ${NAPI_BINDING_TARGET_STAMP_FN}(nativeBinding, __napiLoadedBindingTarget)
module.exports = nativeBinding
${idents
  .map((ident) => `module.exports.${ident} = nativeBinding.${ident}`)
  .join('\n')}
`
}

export function createEsmBinding(
  localName: string,
  pkgName: string,
  idents: string[],
  packageVersion?: string,
  wasiFlavors?: string[],
  localWasiName?: string,
): string {
  assertBindingTargetIdentFree(idents)
  // Both branches must carry it, or a zero-ident package silently loses the
  // export.
  const bindingTargetExport = `export const ${NAPI_BINDING_TARGET_EXPORT} = __napiLoadedBindingTarget`
  const exportsCode =
    idents.length > 0
      ? `const { ${idents.join(', ')} } = nativeBinding
${idents.map((ident) => `export { ${ident} }`).join('\n')}
${bindingTargetExport}`
      : `export default nativeBinding
${bindingTargetExport}`
  return `${bindingHeader}
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

${createCommonBinding(
  localName,
  pkgName,
  packageVersion,
  wasiFlavors,
  localWasiName,
)}
${exportsCode}
`
}

const bindingHeader = `/* eslint-disable */
// @ts-nocheck
/* auto-generated by NAPI-RS */
`

function createCommonBinding(
  localName: string,
  pkgName: string,
  packageVersion?: string,
  wasiFlavors?: string[],
  localWasiName?: string,
): string {
  function requireTuple(tuple: string, identSize = 8) {
    const identLow = ' '.repeat(identSize - 2)
    const ident = ' '.repeat(identSize)
    const versionCheck = packageVersion
      ? `
${identLow}try {
${ident}const binding = require('${pkgName}-${tuple}')
${ident}const bindingPackageVersion = require('${pkgName}-${tuple}/package.json').version
${ident}if (bindingPackageVersion !== '${packageVersion}' && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== '0') {
${ident}  throw new Error(\`Native binding package version mismatch, expected ${packageVersion} but got \${bindingPackageVersion}. You can reinstall dependencies to fix this issue.\`)
${ident}}
${ident}return binding
${identLow}} catch (e) {
${ident}loadErrors.push(e)
${identLow}}`
      : `
${identLow}try {
${ident}return require('${pkgName}-${tuple}')
${identLow}} catch (e) {
${ident}loadErrors.push(e)
${identLow}}`
    return `try {
${ident}return require('./${localName}.${tuple}.node')
${identLow}} catch (e) {
${ident}loadErrors.push(e)
${identLow}}${versionCheck}`
  }

  const flavors = resolveWasiFlavors(wasiFlavors)

  return `const { readFileSync } = require('fs')
let nativeBinding = null
// Which artifact actually loaded. The WASI fallback chain overwrites it with
// the flavor it resolved; the late native retry below leaves it alone because
// it only runs while no WASI candidate has been loaded.
let __napiLoadedBindingTarget = 'native'
const loadErrors = []

const isMusl = () => {
  let musl = false
  if (process.platform === 'linux') {
    musl = isMuslFromFilesystem()
    if (musl === null) {
      musl = isMuslFromReport()
    }
    if (musl === null) {
      musl = isMuslFromChildProcess()
    }
  }
  return musl
}

const isFileMusl = (f) => f.includes('libc.musl-') || f.includes('ld-musl-')

const isMuslFromFilesystem = () => {
  try {
    return readFileSync('/usr/bin/ldd', 'utf-8').includes('musl')
  } catch {
    return null
  }
}

const isMuslFromReport = () => {
  let report = null
  if (process.report && typeof process.report.getReport === 'function') {
    process.report.excludeNetwork = true
    report = process.report.getReport()
  }
  if (!report) {
    return null
  }
  if (report.header && report.header.glibcVersionRuntime) {
    return false
  }
  if (Array.isArray(report.sharedObjects)) {
    if (report.sharedObjects.some(isFileMusl)) {
      return true
    }
  }
  return false
}

const isMuslFromChildProcess = () => {
  try {
    return require('child_process').execSync('ldd --version', { encoding: 'utf8' }).includes('musl')
  } catch (e) {
    // If we reach this case, we don't know if the system is musl or not, so is better to just fallback to false
    return false
  }
}

function requireNative() {
  if (process.env.NAPI_RS_NATIVE_LIBRARY_PATH) {
    try {
      const overrideBinding = require(process.env.NAPI_RS_NATIVE_LIBRARY_PATH)
      // The override may be a generated WASI loader, which already reports its
      // own flavor. Adopt it: \`module.exports\` aliases this object, so claiming
      // 'native' would both misreport the artifact and overwrite the loader's
      // marker through the alias.
      __napiLoadedBindingTarget =
        overrideBinding && typeof overrideBinding.${NAPI_BINDING_TARGET_EXPORT} === 'string'
          ? overrideBinding.${NAPI_BINDING_TARGET_EXPORT}
          : 'native'
      return overrideBinding
    } catch (err) {
      loadErrors.push(err)
    }
  } else if (process.platform === 'android') {
    if (process.arch === 'arm64') {
      ${requireTuple('android-arm64')}
    } else if (process.arch === 'arm') {
      ${requireTuple('android-arm-eabi')}
    } else {
      loadErrors.push(new Error(\`Unsupported architecture on Android \${process.arch}\`))
    }
  } else if (process.platform === 'win32') {
    if (process.arch === 'x64') {
      if ((process.config && process.config.variables && process.config.variables.shlib_suffix === 'dll.a') || (process.config && process.config.variables && process.config.variables.node_target_type === 'shared_library')) {
        ${requireTuple('win32-x64-gnu', 10)}
      } else {
        ${requireTuple('win32-x64-msvc', 10)}
      }
    } else if (process.arch === 'ia32') {
      ${requireTuple('win32-ia32-msvc')}
    } else if (process.arch === 'arm64') {
      ${requireTuple('win32-arm64-msvc')}
    } else {
      loadErrors.push(new Error(\`Unsupported architecture on Windows: \${process.arch}\`))
    }
  } else if (process.platform === 'darwin') {
    ${requireTuple('darwin-universal', 6)}
    if (process.arch === 'x64') {
      ${requireTuple('darwin-x64')}
    } else if (process.arch === 'arm64') {
      ${requireTuple('darwin-arm64')}
    } else {
      loadErrors.push(new Error(\`Unsupported architecture on macOS: \${process.arch}\`))
    }
  } else if (process.platform === 'freebsd') {
    if (process.arch === 'x64') {
      ${requireTuple('freebsd-x64')}
    } else if (process.arch === 'arm64') {
      ${requireTuple('freebsd-arm64')}
    } else {
      loadErrors.push(new Error(\`Unsupported architecture on FreeBSD: \${process.arch}\`))
    }
  } else if (process.platform === 'linux') {
    if (process.arch === 'x64') {
      if (isMusl()) {
        ${requireTuple('linux-x64-musl', 10)}
      } else {
        ${requireTuple('linux-x64-gnu', 10)}
      }
    } else if (process.arch === 'arm64') {
      if (isMusl()) {
        ${requireTuple('linux-arm64-musl', 10)}
      } else {
        ${requireTuple('linux-arm64-gnu', 10)}
      }
    } else if (process.arch === 'arm') {
      if (isMusl()) {
        ${requireTuple('linux-arm-musleabihf', 10)}
      } else {
        ${requireTuple('linux-arm-gnueabihf', 10)}
      }
    } else if (process.arch === 'loong64') {
      if (isMusl()) {
        ${requireTuple('linux-loong64-musl', 10)}
      } else {
        ${requireTuple('linux-loong64-gnu', 10)}
      }
    } else if (process.arch === 'riscv64') {
      if (isMusl()) {
        ${requireTuple('linux-riscv64-musl', 10)}
      } else {
        ${requireTuple('linux-riscv64-gnu', 10)}
      }
    } else if (process.arch === 'ppc64') {
      ${requireTuple('linux-ppc64-gnu')}
    } else if (process.arch === 's390x') {
      ${requireTuple('linux-s390x-gnu')}
    } else {
      loadErrors.push(new Error(\`Unsupported architecture on Linux: \${process.arch}\`))
    }
  } else if (process.platform === 'openharmony') {
    if (process.arch === 'arm64') {
      ${requireTuple('openharmony-arm64')}
    } else if (process.arch === 'x64') {
      ${requireTuple('openharmony-x64')}
    } else if (process.arch === 'arm') {
      ${requireTuple('openharmony-arm')}
    } else {
      loadErrors.push(new Error(\`Unsupported architecture on OpenHarmony: \${process.arch}\`))
    }
  } else {
    loadErrors.push(new Error(\`Unsupported OS: \${process.platform}, architecture: \${process.arch}\`))
  }
}

function createLoadErrorChain(errors) {
  return errors.reduce((previous, current) => {
    let message
    try {
      message =
        current && typeof current.message === 'string'
          ? current.message
          : String(current)
    } catch {
      message = 'Unknown error'
    }
    const error = new Error(message)
    error.cause = previous
    return error
  }, null)
}

// NAPI_RS_FORCE_WASI is a tri-state flag:
//   unset / any other value → native binding preferred, WASI is only a fallback
//   'true'                   → prefer WASI, but retain native as a lazy fallback
//   'error'                  → require WASI without initializing a native fallback
// Treating any non-empty string as truthy (the historical behavior) meant
// NAPI_RS_FORCE_WASI=false, NAPI_RS_FORCE_WASI=0, etc. inadvertently triggered
// the WASI path, causing ENOENT for packages shipped without a .wasi.cjs file.
//
// NAPI_RS_WASI_FLAVOR selects one exact generated flavor and implies strict
// WASI loading. It never crosses into another flavor or falls back to native.
const __napiWasiFlavors = [${flavors.map((flavor) => `'${flavor}'`).join(', ')}]
const __napiWasiFlavor = process.env.NAPI_RS_WASI_FLAVOR
const __napiWasiFlavorRequested =
  typeof __napiWasiFlavor === 'string' && __napiWasiFlavor.length > 0
if (
  __napiWasiFlavorRequested &&
  __napiWasiFlavors.indexOf(__napiWasiFlavor) === -1
) {
  throw new Error(
    'Unsupported WASI flavor "' +
      __napiWasiFlavor +
      '". Available flavors: ' +
      __napiWasiFlavors.join(', '),
  )
}
const forceWasiError = process.env.NAPI_RS_FORCE_WASI === 'error'
const forceWasi =
  process.env.NAPI_RS_FORCE_WASI === 'true' ||
  forceWasiError ||
  __napiWasiFlavorRequested

if (!forceWasi) {
  nativeBinding = requireNative()
}

if (!nativeBinding || forceWasi) {
  let wasiBinding = null
  let wasiBindingLoaded = false
  const wasiBindingErrors = []
${createWasiFallbackChain(
  localName,
  pkgName,
  flavors,
  packageVersion,
  localWasiName,
)}
  if (
    !wasiBindingLoaded &&
    forceWasi &&
    !forceWasiError &&
    !__napiWasiFlavorRequested
  ) {
    nativeBinding = requireNative()
  }
  if ((forceWasiError || __napiWasiFlavorRequested) && !wasiBindingLoaded) {
    const error = new Error(
      __napiWasiFlavorRequested
        ? 'WASI binding for flavor "' + __napiWasiFlavor + '" not found'
        : 'WASI binding not found and NAPI_RS_FORCE_WASI is set to error',
    )
    error.cause = createLoadErrorChain(wasiBindingErrors)
    throw error
  }
}

if (!nativeBinding) {
  if (loadErrors.length > 0) {
    const error = new Error(
      \`Cannot find native binding. \` +
        \`npm has a bug related to optional dependencies (https://github.com/npm/cli/issues/4828). \` +
        'Please try \`npm i\` again after removing both package-lock.json and node_modules directory.',
    )
    // assign instead of the \`new Error(message, { cause })\` options form,
    // which Node < 16.9 silently ignores
    error.cause = createLoadErrorChain(loadErrors)
    throw error
  }
  throw new Error(\`Failed to load native binding\`)
}
`
}
