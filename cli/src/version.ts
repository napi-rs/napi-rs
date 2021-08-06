import { join } from 'path'

import chalk from 'chalk'
import { Command, Option } from 'clipanion'

import { getNapiConfig } from './consts'
import { debugFactory } from './debug'
import { spawn } from './spawn'
import { updatePackageJson } from './update-package'

const debug = debugFactory('version')

export class VersionCommand extends Command {
  static usage = Command.Usage({
    description: 'Update versions in created npm dir',
  })

  static paths = [['version']]

  static async updatePackageJson(prefix: string, configFileName?: string) {
    const { version, platforms } = getNapiConfig(configFileName)
    for (const platformDetail of platforms) {
      const pkgDir = join(process.cwd(), prefix, platformDetail.platformArchABI)
      debug(
        `Update version to ${chalk.greenBright(
          version,
        )} in [${chalk.yellowBright(pkgDir)}]`,
      )
      await updatePackageJson(join(pkgDir, 'package.json'), {
        version,
      })
    }
  }

  prefix = Option.String(`-p,--prefix`, 'npm')

  configFileName?: string = Option.String('-c,--config')

  async execute() {
    await VersionCommand.updatePackageJson(this.prefix, this.configFileName)
    await spawn('git add .')
  }
}
