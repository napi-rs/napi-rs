import { mkdirSync } from 'fs'
import { join } from 'path'

import chalk from 'chalk'
import { Command, Option } from 'clipanion'

import { getNapiConfig } from './consts'
import { debugFactory } from './debug'
import { PlatformDetail } from './parse-triple'
import { writeFileAsync, pick } from './utils'

const debug = debugFactory('create-npm-dir')

export class CreateNpmDirCommand extends Command {
  static usage = Command.Usage({
    description: 'Create npm packages dir for platforms',
  })

  static paths = [['create-npm-dir']]

  static create = async (
    config: string,
    targetDirPath: string,
    cwd: string,
  ) => {
    const pkgJsonDir = config
    debug(`Read content from [${chalk.yellowBright(pkgJsonDir)}]`)
    const { platforms, packageName, version, binaryName, content } =
      getNapiConfig(pkgJsonDir, cwd)

    for (const platformDetail of platforms) {
      const targetDir = join(
        targetDirPath,
        'npm',
        `${platformDetail.platformArchABI}`,
      )
      mkdirSync(targetDir, {
        recursive: true,
      })
      const binaryFileName = `${binaryName}.${platformDetail.platformArchABI}.node`
      const targetPackageJson = join(targetDir, 'package.json')
      debug(`Write file [${chalk.yellowBright(targetPackageJson)}]`)
      const packageJson: {
        name: string
        libc?: string[]
      } = {
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
          'authors',
          'homepage',
          'license',
          'engines',
          'publishConfig',
          'repository',
          'bugs',
        ),
      }
      // Only works with yarn 3.1+
      // https://github.com/yarnpkg/berry/pull/3981
      if (platformDetail.abi === 'gnu') {
        packageJson.libc = ['glibc']
      } else if (platformDetail.abi === 'musl') {
        packageJson.libc = ['musl']
      }
      await writeFileAsync(
        targetPackageJson,
        JSON.stringify(packageJson, null, 2),
      )
      const targetReadme = join(targetDir, 'README.md')
      debug(`Write target README.md [${chalk.yellowBright(targetReadme)}]`)
      await writeFileAsync(targetReadme, readme(packageName, platformDetail))
    }
  }

  targetDir: string = Option.String('-t,--target')!

  config = Option.String('-c,--config', 'package.json')

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
