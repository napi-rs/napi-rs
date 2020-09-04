import { join } from 'path'

import chalk from 'chalk'
import { Command } from 'clipanion'

import { getNapiConfig } from './consts'
import { debugFactory } from './debug'
import { spawn } from './spawn'
import { updatePackageJson } from './update-package'

const debug = debugFactory('version')

export class VersionCommand extends Command {
  @Command.String(`-p,--prefix`)
  prefix = 'npm'

  @Command.String('-c,--config')
  configFileName?: string

  @Command.Path('version')
  async execute() {
    const { muslPlatforms, version, platforms } = getNapiConfig(
      this.configFileName,
    )
    for (const name of [...platforms, ...muslPlatforms]) {
      const pkgDir = join(process.cwd(), this.prefix, name)
      debug(
        `Update version to ${chalk.greenBright(
          version,
        )} in [${chalk.yellowBright(pkgDir)}]`,
      )
      await updatePackageJson(join(pkgDir, 'package.json'), {
        version,
      })
    }
    await spawn('git add .')
  }
}
