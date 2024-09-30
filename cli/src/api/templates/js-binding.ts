export function createCjsBinding(
  localName: string,
  pkgName: string,
  idents: string[],
): string {
  return `${bindingHeader}
${createCommonBinding(localName, pkgName)}
${idents
  .map((ident) => `module.exports.${ident} = nativeBinding.${ident};`)
  .join('\n')}
`
}

export function createEsmBinding(
  localName: string,
  pkgName: string,
  idents: string[],
): string {
  return `${bindingHeader}
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const __dirname = new URL('.', import.meta.url).pathname;

${createCommonBinding(localName, pkgName)}
const { ${idents.join(', ')} } = nativeBinding;
${idents.map((ident) => `export { ${ident} };`).join('\n')}
`
}

const bindingHeader = `// prettier-ignore
/* eslint-disable */
// @ts-nocheck
/* auto-generated by NAPI-RS */
`

function createCommonBinding(localName: string, pkgName: string): string {
  function requireTuple(tuple: string) {
    return `try {
        return require('./${localName}.${tuple}.node')
      } catch (e) {
        loadErrors.push(e)
      }
      try {
        return require('${pkgName}-${tuple}')
      } catch (e) {
        loadErrors.push(e)
      }
`
  }

  return `const { readFileSync } = require('fs')

let nativeBinding = null
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
  const report = typeof process.report.getReport === 'function' ? process.report.getReport() : null
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
  if (process.platform === 'android') {
    if (process.arch === 'arm64') {
      ${requireTuple('android-arm64')}
    } else if (process.arch === 'arm') {
      ${requireTuple('android-arm-eabi')}
    } else {
      loadErrors.push(new Error(\`Unsupported architecture on Android \${process.arch}\`))
    }
  } else if (process.platform === 'win32') {
    if (process.arch === 'x64') {
      ${requireTuple('win32-x64-msvc')}
    } else if (process.arch === 'ia32') {
      ${requireTuple('win32-ia32-msvc')}
    } else if (process.arch === 'arm64') {
      ${requireTuple('win32-arm64-msvc')}
    } else {
      loadErrors.push(new Error(\`Unsupported architecture on Windows: \${process.arch}\`))
    }
  } else if (process.platform === 'darwin') {
    ${requireTuple('darwin-universal')}
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
        ${requireTuple('linux-x64-musl')}
      } else {
        ${requireTuple('linux-x64-gnu')}
      }
    } else if (process.arch === 'arm64') {
      if (isMusl()) {
        ${requireTuple('linux-arm64-musl')}
      } else {
        ${requireTuple('linux-arm64-gnu')}
      }
    } else if (process.arch === 'arm') {
      if (isMusl()) {
        ${requireTuple('linux-arm-musleabihf')}
      } else {
        ${requireTuple('linux-arm-gnueabihf')}
      }
    } else if (process.arch === 'riscv64') {
      if (isMusl()) {
        ${requireTuple('linux-riscv64-musl')}
      } else {
        ${requireTuple('linux-riscv64-gnu')}
      }
    } else if (process.arch === 'ppc64') {
      ${requireTuple('linux-ppc64-gnu')}
    } else if (process.arch === 's390x') {
      ${requireTuple('linux-s390x-gnu')}
    } else {
      loadErrors.push(new Error(\`Unsupported architecture on Linux: \${process.arch}\`))
    }
  } else {
    loadErrors.push(new Error(\`Unsupported OS: \${process.platform}, architecture: \${process.arch}\`))
  }
}

nativeBinding = requireNative()

if (!nativeBinding || process.env.NAPI_RS_FORCE_WASI) {
  try {
    nativeBinding = require('./${localName}.wasi.cjs')
  } catch (err) {
    if (process.env.NAPI_RS_FORCE_WASI) {
      loadErrors.push(err)
    }
  }
  if (!nativeBinding) {
    try {
      nativeBinding = require('${pkgName}-wasm32-wasi')
    } catch (err) {
      if (process.env.NAPI_RS_FORCE_WASI) {
        loadErrors.push(err)
      }
    }
  }
}

if (!nativeBinding) {
  if (loadErrors.length > 0) {
    // TODO Link to documentation with potential fixes
    //  - The package owner could build/publish bindings for this arch
    //  - The user may need to bundle the correct files
    //  - The user may need to re-install node_modules to get new packages
    throw new Error('Failed to load native binding', { cause: loadErrors })
  }
  throw new Error(\`Failed to load native binding\`)
}
`
}
