import { load, dump } from 'js-yaml'

import {
  NodeArchToCpu,
  type SupportedPackageManager,
  UniArchsByPlatform,
  parseTriple,
} from '../../utils/index.js'

import { YAML } from './ci-template.js'

const BUILD_FREEBSD = 'build-freebsd'
const TEST_MACOS_WINDOWS = 'test-macOS-windows-binding'
const TEST_LINUX_X64_GNU = 'test-linux-x64-gnu-binding'
const TEST_LINUX_X64_MUSL = 'test-linux-x64-musl-binding'
const TEST_LINUX_AARCH64_GNU = 'test-linux-aarch64-gnu-binding'
const TEST_LINUX_AARCH64_MUSL = 'test-linux-aarch64-musl-binding'
const TEST_LINUX_ARM_GNUEABIHF = 'test-linux-arm-gnueabihf-binding'
const TEST_WASI = 'test-wasi-nodejs'
const UNIVERSAL_MACOS = 'universal-macOS'

export const createGithubActionsCIYml = (
  targets: string[],
  packageManager: SupportedPackageManager,
) => {
  const allTargets = new Set(
    targets.flatMap((t) => {
      const platform = parseTriple(t)
      if (platform.arch === 'universal') {
        const srcTriples = UniArchsByPlatform[platform.platform]?.map((arch) =>
          t.replace('universal', NodeArchToCpu[arch]),
        )
        return [t, ...(srcTriples ?? [])]
      }
      return [t]
    }),
  )

  const fullTemplate = load(YAML(packageManager)) as any

  const requiredSteps = []
  const enableWindowsX86 = allTargets.has('x86_64-pc-windows-msvc')
  const enableMacOSX86 = allTargets.has('x86_64-apple-darwin')
  const enableLinuxX86Gnu = allTargets.has('x86_64-unknown-linux-gnu')
  const enableLinuxX86Musl = allTargets.has('x86_64-unknown-linux-musl')
  const enableLinuxArm8Gnu = allTargets.has('aarch64-unknown-linux-gnu')
  const enableLinuxArm8Musl = allTargets.has('aarch64-unknown-linux-musl')
  const enableLinuxArm7 = allTargets.has('armv7-unknown-linux-gnueabihf')
  const enableFreeBSD = allTargets.has('x86_64-unknown-freebsd')
  const enableMacOSUni = allTargets.has('universal-apple-darwin')
  const enableWasi = allTargets.has('wasm32-wasi-preview1-threads')
  fullTemplate.jobs.build.strategy.matrix.settings =
    fullTemplate.jobs.build.strategy.matrix.settings.filter(
      ({ target }: { target: string }) => allTargets.has(target),
    )
  if (!fullTemplate.jobs.build.strategy.matrix.settings.length) {
    delete fullTemplate.jobs.build.strategy.matrix
  }

  if (!enableFreeBSD) {
    delete fullTemplate.jobs[BUILD_FREEBSD]
  } else {
    requiredSteps.push(BUILD_FREEBSD)
  }

  if (!enableWindowsX86 && !enableMacOSX86) {
    delete fullTemplate.jobs[TEST_MACOS_WINDOWS]
  } else {
    const filterTargets = new Set<string>()
    if (enableWindowsX86) {
      filterTargets.add('windows-latest')
    }
    if (enableMacOSUni || enableMacOSX86) {
      filterTargets.add('macos-latest')
    }
    fullTemplate.jobs[TEST_MACOS_WINDOWS].strategy.matrix.settings =
      fullTemplate.jobs[TEST_MACOS_WINDOWS].strategy.matrix.settings.filter(
        ({ host }: { host: string; target: string }) => filterTargets.has(host),
      )

    requiredSteps.push(TEST_MACOS_WINDOWS)
  }

  if (!enableLinuxX86Gnu) {
    delete fullTemplate.jobs[TEST_LINUX_X64_GNU]
  } else {
    requiredSteps.push(TEST_LINUX_X64_GNU)
  }

  if (!enableLinuxX86Musl) {
    delete fullTemplate.jobs[TEST_LINUX_X64_MUSL]
  } else {
    requiredSteps.push(TEST_LINUX_X64_MUSL)
  }

  if (!enableLinuxArm8Gnu) {
    delete fullTemplate.jobs[TEST_LINUX_AARCH64_GNU]
  } else {
    requiredSteps.push(TEST_LINUX_AARCH64_GNU)
  }

  if (!enableLinuxArm8Musl) {
    delete fullTemplate.jobs[TEST_LINUX_AARCH64_MUSL]
  } else {
    requiredSteps.push(TEST_LINUX_AARCH64_MUSL)
  }

  if (!enableLinuxArm7) {
    delete fullTemplate.jobs[TEST_LINUX_ARM_GNUEABIHF]
  } else {
    requiredSteps.push(TEST_LINUX_ARM_GNUEABIHF)
  }

  if (!enableMacOSUni) {
    delete fullTemplate.jobs[UNIVERSAL_MACOS]
  } else {
    requiredSteps.push(UNIVERSAL_MACOS)
  }

  if (!enableWasi) {
    delete fullTemplate.jobs[TEST_WASI]
  } else {
    requiredSteps.push(TEST_WASI)
  }

  fullTemplate.jobs.publish.needs = requiredSteps

  return dump(fullTemplate, {
    lineWidth: 1000,
  })
}
