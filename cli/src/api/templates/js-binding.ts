/* eslint-disable @typescript-eslint/switch-exhaustiveness-check */

function loadNapiModule(binaryName: string, packageName: string) {
  const { existsSync, readFileSync } = require('fs')
  const { join } = require('path')
  const { platform, arch } = process

  const candidates: string[] = []

  function isMusl() {
    // For Node 10
    if (!process.report || typeof process.report.getReport !== 'function') {
      try {
        const lddPath = require('child_process')
          .execSync('which ldd')
          .toString()
          .trim()
        return readFileSync(lddPath, 'utf8').includes('musl')
      } catch (e) {
        return true
      }
    } else {
      // @ts-expect-error
      const { glibcVersionRuntime } = process.report.getReport().header
      return !glibcVersionRuntime
    }
  }

  switch (platform) {
    case 'android':
      switch (arch) {
        case 'arm64':
          candidates.push('android-arm64')
          break
        case 'arm':
          candidates.push('android-arm-eabi')
          break
      }
      break
    case 'win32':
      switch (arch) {
        case 'x64':
          candidates.push('win32-x64-msvc')
          break
        case 'ia32':
          candidates.push('win32-ia32-msvc')
          break
        case 'arm64':
          candidates.push('win32-arm64-msvc')
          break
      }
      break
    case 'darwin':
      candidates.push('darwin-universal')
      switch (arch) {
        case 'x64':
          candidates.push('darwin-x64')
          break
        case 'arm64':
          candidates.push('darwin-arm64')
          break
      }
      break
    case 'freebsd':
      if (arch === 'x64') {
        candidates.push('freebsd-x64')
      }
      break
    case 'linux':
      switch (arch) {
        case 'x64':
          if (isMusl()) {
            candidates.push('linux-x64-musl')
          } else {
            candidates.push('linux-x64-gnu')
          }
          break
        case 'arm64':
          if (isMusl()) {
            candidates.push('linux-arm64-musl')
          } else {
            candidates.push('linux-arm64-gnu')
          }
          break
        case 'arm':
          candidates.push('linux-arm-gnueabihf')
          break
      }
      break
  }

  let nativeBinding: any
  let loadError: any

  for (const suffix of candidates) {
    const localPath = join(__dirname, `${binaryName}.${suffix}.node`)
    const pkgPath = `${packageName}-${suffix}`

    try {
      if (existsSync(localPath)) {
        nativeBinding = require(localPath)
      } else {
        nativeBinding = require(pkgPath)
      }
    } catch (e) {
      loadError = e
      continue
    }

    loadError = null
    break
  }

  if (!nativeBinding) {
    if (loadError) {
      throw loadError
    }

    throw new Error(`Unsupported OS: ${platform}, architecture: ${arch}`)
  }

  return nativeBinding
}

export function createJsBinding(localName: string, pkgName: string): string {
  return `${loadNapiModule.toString()}

module.exports = loadNapiModule('${localName}', '${pkgName}')
`
}
