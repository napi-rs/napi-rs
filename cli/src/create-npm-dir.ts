import { join } from 'path'

import chalk from 'chalk'
import { Command } from 'clipanion'
import { pick } from 'lodash'

import { getNapiConfig } from './consts'
import { debugFactory } from './debug'
import { PlatformDetail } from './parse-triple'
import { spawn } from './spawn'
import { writeFileAsync } from './utils'

const debug = debugFactory('create-npm-dir')

export class CreateNpmDirCommand extends Command {
  static usage = Command.Usage({
    description: 'Create npm packages dir for platforms',
  })

  static create = async (
    config: string,
    targetDirPath: string,
    cwd: string,
  ) => {
    const pkgJsonDir = config
    debug(`Read content from [${chalk.yellowBright(pkgJsonDir)}]`)
    const {
      platforms,
      packageName,
      version,
      binaryName,
      content,
    } = getNapiConfig(pkgJsonDir, cwd)

    for (const platformDetail of platforms) {
      const targetDir = join(
        targetDirPath,
        'npm',
        `${platformDetail.platformArchABI}`,
      )
      await spawn(`mkdir -p ${targetDir}`)
      const binaryFileName = `${binaryName}.${platformDetail.platformArchABI}.node`
      const targetPackageJson = join(targetDir, 'package.json')
      debug(`Write file [${chalk.yellowBright(targetPackageJson)}]`)
      await writeFileAsync(
        targetPackageJson,
        JSON.stringify(
          {
            name: `${packageName}-${platformDetail.platformArchABI}`,
            version,
            os: [platformDetail.platform],
            cpu: [platformDetail.arch],
            main: binaryFileName,
            files: [binaryFileName],
            ...pick(
              content,
              'description',
              'keywords',
              'author',
              'homepage',
              'license',
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
      await writeFileAsync(targetReadme, readme(packageName, platformDetail))
    }
  }

  @Command.String('-t,--target')
  targetDir!: string

  @Command.String('-c,--config')
  config = 'package.json'

  @Command.Path('create-npm-dir')
  async execute() {
    await CreateNpmDirCommand.create(
      this.config,
      join(process.cwd(), this.targetDir),
      process.cwd(),
    )
  }
}

function readme(packageName: string, platformDetail: PlatformDetail) {
  return `# \`${packageName}-${platformDetail.platformArchABI}\`

This is the **${platformDetail.raw}** binary for \`${packageName}\`
`
}
