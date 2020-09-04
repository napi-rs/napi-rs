import { join } from 'path'

import chalk from 'chalk'
import { Command } from 'clipanion'
import { pick } from 'lodash'

import { getNapiConfig } from './consts'
import { debugFactory } from './debug'
import { spawn } from './spawn'
import { writeFileAsync } from './utils'

const debug = debugFactory('create-npm-dir')

export class CreateNpmDirCommand extends Command {
  @Command.String('-t,--target')
  targetDir!: string

  @Command.Path('create-npm-dir')
  async execute() {
    const pkgJsonDir = join(this.targetDir, 'package.json')
    debug(`Read content from [${chalk.yellowBright(pkgJsonDir)}]`)
    const {
      platforms,
      muslPlatforms,
      packageName,
      version,
      binaryName,
      content,
    } = getNapiConfig(pkgJsonDir)

    for (const platform of [...platforms, ...muslPlatforms]) {
      const targetDir = join(process.cwd(), this.targetDir, 'npm', platform)
      await spawn(`mkdir -p ${targetDir}`)
      const binaryFileName = `${binaryName}.${platform}.node`
      const targetPackageJson = join(targetDir, 'package.json')
      debug(`Write file [${chalk.yellowBright(targetPackageJson)}]`)
      await writeFileAsync(
        targetPackageJson,
        JSON.stringify(
          {
            name: `${packageName}-${platform}`,
            version,
            os: [platform],
            main: binaryFileName,
            files: [binaryFileName],
            ...pick(
              content,
              'description',
              'keywords',
              'author',
              'homepage',
              'license',
              'cpu',
              'engines',
              'publishConfig',
              'repository',
              'bugs',
            ),
          },
          null,
          2,
        ),
      )
      const targetReadme = join(targetDir, 'README.md')
      debug(`Write target README.md [${chalk.yellowBright(targetReadme)}]`)
      await writeFileAsync(targetReadme, readme(packageName, platform))
    }
  }
}

function readme(packageName: string, platform: string) {
  return `\`#${packageName}-${platform}\`

this is the **${platform}** 64-bit binary for \`${packageName}\`
`
}
