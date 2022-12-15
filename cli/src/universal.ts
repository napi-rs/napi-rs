import { spawnSync } from 'child_process'
import { join } from 'path'

import chalk from 'chalk'
import { Command, Option } from 'clipanion'

import { getNapiConfig } from './consts'
import { debugFactory } from './debug'
import { UniArchsByPlatform } from './parse-triple'
import { fileExists } from './utils'

const debug = debugFactory('universal')

export class UniversalCommand extends Command {
  static usage = Command.Usage({
    description: 'Combine built binaries to universal binaries',
  })

  static paths = [['universal']]

  sourceDir = Option.String('-d,--dir', 'artifacts')

  distDir = Option.String('--dist', '.')

  configFileName?: string = Option.String('-c,--config')

  buildUniversal: Record<
    keyof typeof UniArchsByPlatform,
    (binName: string, srcFiles: string[]) => string
  > = {
    darwin: (binName, srcFiles) => {
      const outPath = join(
        this.distDir,
        `${binName}.${process.platform}-universal.node`,
      )
      const srcPaths = srcFiles.map((f) => join(this.sourceDir, f))
      spawnSync('lipo', ['-create', '-output', outPath, ...srcPaths])
      return outPath
    },
  }

  async execute() {
    const { platforms, binaryName } = getNapiConfig(this.configFileName)

    const targetPlatform = platforms.find(
      (p) => p.platform === process.platform && p.arch === 'universal',
    )
    if (!targetPlatform) {
      throw new TypeError(
        `'universal' arch for platform '${process.platform}' not found in config!`,
      )
    }

    const srcFiles = UniArchsByPlatform[process.platform]?.map(
      (a) => `${binaryName}.${process.platform}-${a}.node`,
    )
    if (!srcFiles) {
      throw new TypeError(
        `'universal' arch for platform '${process.platform}' not supported.`,
      )
    }

    debug(
      `Looking up source binaries to combine: ${chalk.yellowBright(srcFiles)}`,
    )
    const srcFileLookup = await Promise.all(
      srcFiles.map((f) => fileExists(join(this.sourceDir, f))),
    )
    const notFoundFiles = srcFiles.filter((_f, i) => !srcFileLookup[i])
    if (notFoundFiles.length > 0) {
      throw new TypeError(
        `Some binary files were not found: ${JSON.stringify(notFoundFiles)}`,
      )
    }

    const outPath = this.buildUniversal[process.platform](binaryName, srcFiles)
    debug(`Produced universal binary: ${outPath}`)
  }
}
