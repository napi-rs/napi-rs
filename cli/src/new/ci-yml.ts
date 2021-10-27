import { load, dump } from 'js-yaml'

import { YAML } from './ci-template'

const BUILD_FREEBSD = 'build-freebsd'
const TEST_MACOS_WINDOWS = 'test-macOS-windows-binding'
const TEST_LINUX_X64_GNU = 'test-linux-x64-gnu-binding'
const TEST_LINUX_X64_MUSL = 'test-linux-x64-musl-binding'
const TEST_LINUX_AARCH64_GNU = 'test-linux-aarch64-gnu-binding'
const TEST_LINUX_AARCH64_MUSL = 'test-linux-aarch64-musl-binding'
const TEST_LINUX_ARM_GNUEABIHF = 'test-linux-arm-gnueabihf-binding'

export const createGithubActionsCIYml = (
  binaryName: string,
  targets: string[],
) => {
  const fullTemplate = load(YAML(binaryName)) as any
  const requiredSteps = []
  const enableWindowsX86 = targets.includes('x86_64-pc-windows-msvc')
  const enableMacOSX86 = targets.includes('x86_64-apple-darwin')
  const enableLinuxX86Gnu = targets.includes('x86_64-unknown-linux-gnu')
  const enableLinuxX86Musl = targets.includes('x86_64-unknown-linux-musl')
  const enableLinuxArm8Gnu = targets.includes('aarch64-unknown-linux-gnu')
  const enableLinuxArm8Musl = targets.includes('aarch64-unknown-linux-musl')
  const enableLinuxArm7 = targets.includes('armv7-unknown-linux-gnueabihf')
  const enableFreeBSD = targets.includes('x86_64-unknown-freebsd')
  fullTemplate.env.APP_NAME = binaryName
  fullTemplate.jobs.build.strategy.matrix.settings =
    fullTemplate.jobs.build.strategy.matrix.settings.filter(
      ({ target }: { target: string }) => targets.includes(target),
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
    const filterTarget = enableWindowsX86 ? 'macos-latest' : 'windows-latest'
    fullTemplate.jobs[TEST_MACOS_WINDOWS].strategy.matrix.settings =
      fullTemplate.jobs[TEST_MACOS_WINDOWS].strategy.matrix.settings.filter(
        ({ host }: { host: string; target: string }) => host !== filterTarget,
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

  fullTemplate.jobs.publish.needs = requiredSteps

  return dump(fullTemplate, {
    lineWidth: 1000,
  })
}
