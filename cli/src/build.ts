import { execSync } from 'child_process'
import { join, parse, sep } from 'path'

import chalk from 'chalk'
import { Command, Option } from 'clipanion'
import toml from 'toml'

import { getNapiConfig } from './consts'
import { debugFactory } from './debug'
import { getDefaultTargetTriple, parseTriple } from './parse-triple'
import {
  copyFileAsync,
  existsAsync,
  mkdirAsync,
  readFileAsync,
  unlinkAsync,
} from './utils'

const debug = debugFactory('build')

export class BuildCommand extends Command {
  static usage = Command.Usage({
    description: 'Build and copy native module into specified dir',
  })

  static paths = [['build']]

  appendPlatformToFilename = Option.Boolean(`--platform`, false)

  isRelease = Option.Boolean(`--release`, false)

  configFileName?: string = Option.String('--config,-c')

  cargoName?: string = Option.String('--cargo-name')

  targetTripleDir = Option.String('--target', process.env.RUST_TARGET ?? '')

  features?: string = Option.String('--features')

  cargoFlags = Option.String('--cargo-flags', '')

  cargoCwd?: string = Option.String('--cargo-cwd')

  destDir = Option.String({
    required: false,
  })

  async execute() {
    const cwd = this.cargoCwd
      ? join(process.cwd(), this.cargoCwd)
      : process.cwd()
    const releaseFlag = this.isRelease ? `--release` : ''
    const targetFLag = this.targetTripleDir
      ? `--target ${this.targetTripleDir}`
      : ''
    const featuresFlag = this.features ? `--features ${this.features}` : ''
    const triple = this.targetTripleDir
      ? parseTriple(this.targetTripleDir)
      : getDefaultTargetTriple(
          execSync('rustup show active-toolchain', {
            env: process.env,
          }).toString('utf8'),
        )
    debug(`Current triple is: ${chalk.green(triple.raw)}`)
    const externalFlags = [
      releaseFlag,
      targetFLag,
      featuresFlag,
      this.cargoFlags,
    ]
      .filter((flag) => Boolean(flag))
      .join(' ')
    const cargoCommand = `cargo build ${externalFlags}`
    debug(`Run ${chalk.green(cargoCommand)}`)
    execSync(cargoCommand, {
      env: process.env,
      stdio: 'inherit',
      cwd,
    })
    const { binaryName } = getNapiConfig(this.configFileName)
    let dylibName = this.cargoName
    if (!dylibName) {
      let tomlContentString: string
      let tomlContent: any
      try {
        debug('Start read toml')
        tomlContentString = await readFileAsync(
          join(cwd, 'Cargo.toml'),
          'utf-8',
        )
      } catch {
        throw new TypeError(`Could not find Cargo.toml in ${cwd}`)
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

      if (!tomlContent.lib?.['crate-type']?.includes?.('cdylib')) {
        throw new TypeError(
          `Missing ${chalk.green('create-type = ["cdylib"]')} in ${chalk.green(
            '[lib]',
          )}`,
        )
      }
    }

    debug(`Dylib name: ${chalk.greenBright(dylibName)}`)

    const platform = triple.platform
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
      case 'openbsd':
      case 'android':
      case 'sunos':
        dylibName = `lib${dylibName}`
        libExt = '.so'
        break
      default:
        throw new TypeError(
          'Operating system not currently supported or recognized by the build script',
        )
    }

    const targetRootDir = await findUp(cwd)

    if (!targetRootDir) {
      throw new TypeError('No target dir found')
    }

    const targetDir = join(
      this.targetTripleDir,
      this.isRelease ? 'release' : 'debug',
    )

    const platformName = this.appendPlatformToFilename
      ? `.${triple.platformArchABI}`
      : ''

    debug(`Platform name: ${platformName || chalk.green('[Empty]')}`)
    const distFileName = `${binaryName}${platformName}.node`

    const distModulePath = join(this.destDir ?? '.', distFileName)

    const parsedDist = parse(distModulePath)

    if (parsedDist.dir && !(await existsAsync(parsedDist.dir))) {
      await mkdirAsync(parsedDist.dir, { recursive: true }).catch((e) => {
        console.warn(
          chalk.bgYellowBright(
            `Create dir [${parsedDist.dir}] failed, reason: ${e.message}`,
          ),
        )
      })
    }

    const sourcePath = join(
      targetRootDir,
      'target',
      targetDir,
      `${dylibName}${libExt}`,
    )

    if (await existsAsync(distModulePath)) {
      debug(`remove old binary [${chalk.yellowBright(distModulePath)}]`)
      await unlinkAsync(distModulePath)
    }

    debug(`Write binary content to [${chalk.yellowBright(distModulePath)}]`)
    await copyFileAsync(sourcePath, distModulePath)
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
