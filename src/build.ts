import os from 'os'
import { join, parse, sep } from 'path'

import chalk from 'chalk'
import { Command } from 'clipanion'
import toml from 'toml'

import { getNapiConfig } from './consts'
import { debugFactory } from './debug'
import { existsAsync, readFileAsync, writeFileAsync } from './utils'

const debug = debugFactory('build')

export class BuildCommand extends Command {
  static usage = Command.Usage({
    description: 'Copy native module into specified dir',
  })

  @Command.Boolean(`--platform`)
  appendPlatformToFilename!: boolean

  @Command.Boolean(`--release`)
  isRelease = false

  @Command.Boolean('--musl')
  isMusl = false

  @Command.String('--config,-c')
  configFileName?: string

  @Command.String('--cargo-name')
  cargoName?: string

  @Command.String('--target-triple')
  targetTripleDir = ''

  @Command.String({
    required: false,
  })
  target = '.'

  @Command.Path('build')
  async execute() {
    const { binaryName } = getNapiConfig(this.configFileName)
    let dylibName = this.cargoName
    if (!dylibName) {
      let tomlContentString: string
      let tomlContent: any
      try {
        debug('Start read toml')
        tomlContentString = await readFileAsync(
          join(process.cwd(), 'Cargo.toml'),
          'utf-8',
        )
      } catch {
        throw new TypeError(`Could not find Cargo.toml in ${process.cwd()}`)
      }

      try {
        debug('Start parse toml')
        tomlContent = toml.parse(tomlContentString)
      } catch {
        throw new TypeError('Could not parse the Cargo.toml')
      }

      if (tomlContent.package?.name) {
        dylibName = tomlContent.package.name.replace(/-/g, '_')
      } else {
        throw new TypeError('No package.name field in Cargo.toml')
      }
    }

    debug(`Dylib name: ${chalk.greenBright(dylibName)}`)

    const platform = os.platform()
    let libExt

    debug(`Platform: ${chalk.greenBright(platform)}`)

    // Platform based massaging for build commands
    switch (platform) {
      case 'darwin':
        libExt = '.dylib'
        dylibName = `lib${dylibName}`
        break
      case 'win32':
        libExt = '.dll'
        break
      case 'linux':
      case 'freebsd':
        dylibName = `lib${dylibName}`
        libExt = '.so'
        break
      default:
        throw new TypeError(
          'Operating system not currently supported or recognized by the build script',
        )
    }

    const targetDir = join(
      this.targetTripleDir,
      this.isRelease ? 'release' : 'debug',
    )

    if (this.isMusl && !this.appendPlatformToFilename) {
      throw new TypeError(`Musl flag must be used with platform flag`)
    }

    const platformName = this.appendPlatformToFilename
      ? !this.isMusl
        ? `.${platform}`
        : `.${platform}-musl`
      : ''

    debug(
      `Platform name: ${
        platformName || chalk.green('[Empty]')
      }, musl: ${chalk.greenBright(this.isMusl)}`,
    )

    let distModulePath = this.target
      ? join(this.target, `${binaryName}${platformName}.node`)
      : join('target', targetDir, `${binaryName}${platformName}.node`)
    const parsedDist = parse(distModulePath)

    if (!parsedDist.ext) {
      distModulePath = `${distModulePath}${platformName}.node`
    }

    const dir = await findUp()

    if (!dir) {
      throw new TypeError('No target dir found')
    }

    const sourcePath = join(dir, 'target', targetDir, `${dylibName}${libExt}`)
    debug(`Read [${chalk.yellowBright(sourcePath)}] content`)

    const dylibContent = await readFileAsync(sourcePath)

    debug(`Write binary content to [${chalk.yellowBright(distModulePath)}]`)

    await writeFileAsync(distModulePath, dylibContent)
  }
}

async function findUp(dir = process.cwd()): Promise<string | null> {
  const dist = join(dir, 'target')
  if (await existsAsync(dist)) {
    return dir
  }
  const dirs = dir.split(sep)
  if (dirs.length < 2) {
    return null
  }
  dirs.pop()
  return findUp(dirs.join(sep))
}
