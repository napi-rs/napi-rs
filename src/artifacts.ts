import { join, parse } from 'path'

import chalk from 'chalk'
import { Command } from 'clipanion'
import { fdir } from 'fdir'

import { debugFactory } from './debug'
import { readFileAsync, writeFileAsync } from './utils'

const debug = debugFactory('artifacts')

export class ArtifactsCommand extends Command {
  @Command.String('-d,--dir')
  sourceDir = 'artifacts'

  @Command.String('-t,--target')
  targetDir = '.'

  @Command.Path('artifacts')
  async execute() {
    const api = new fdir()
      .withFullPaths()
      .exclude((dirPath) => dirPath.includes('node_modules'))
      .filter((filePath) => filePath.endsWith('package.json'))
      .crawl(join(process.cwd(), this.targetDir))
    const sourceApi = new fdir()
      .withFullPaths()
      .crawl(join(process.cwd(), this.sourceDir))
    const distDirs = await api.withPromise().then(
      (output) =>
        (output as string[])
          .map((packageJsonPath) => {
            const { dir } = parse(packageJsonPath)
            const { napi } = require(packageJsonPath)
            if (!napi) {
              return null
            }
            const napiName: string = napi?.name ?? 'index'
            debug(
              `Scan dir: [${chalk.yellowBright(
                dir,
              )}], napi name: ${chalk.greenBright(napiName)}`,
            )
            return {
              dir,
              name: napiName,
            }
          })
          .filter(Boolean) as {
          name: string
          dir: string
        }[],
    )

    await sourceApi.withPromise().then((output) =>
      Promise.all(
        (output as string[]).map(async (filePath) => {
          debug(`Read [${chalk.yellowBright(filePath)}]`)
          const sourceContent = await readFileAsync(filePath)
          const parsedName = parse(filePath)
          const [fileName] = parsedName.name.split('.')
          const { dir } = distDirs.find(({ name }) => name === fileName) ?? {}
          if (!dir) {
            throw new TypeError(`No dist dir found for ${filePath}`)
          }
          const distFilePath = join(dir, parsedName.base)
          debug(`Write file content to [${chalk.yellowBright(distFilePath)}]`)
          await writeFileAsync(distFilePath, sourceContent)
        }),
      ),
    )
  }
}
