import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

import {
  applyDefaultUniversalizeOptions,
  type UniversalizeOptions,
} from '../def/universalize.js'
import { readNapiConfig } from '../utils/config.js'
import { debugFactory } from '../utils/log.js'
import { fileExists } from '../utils/misc.js'
import { UniArchsByPlatform } from '../utils/target.js'

const debug = debugFactory('universalize')

const universalizers: Partial<
  Record<NodeJS.Platform, (inputs: string[], output: string) => void>
> = {
  darwin: (inputs, output) => {
    spawnSync('lipo', ['-create', '-output', output, ...inputs], {
      stdio: 'inherit',
    })
  },
}

export async function universalizeBinaries(userOptions: UniversalizeOptions) {
  const options = applyDefaultUniversalizeOptions(userOptions)

  const packageJsonPath = join(options.cwd, options.packageJsonPath)

  const config = await readNapiConfig(
    packageJsonPath,
    options.configPath ? resolve(options.cwd, options.configPath) : undefined,
  )

  const target = config.targets.find(
    (t) => t.platform === process.platform && t.arch === 'universal',
  )

  if (!target) {
    throw new Error(
      `'universal' arch for platform '${process.platform}' not found in config!`,
    )
  }

  const srcFiles = UniArchsByPlatform[process.platform]?.map((arch) =>
    resolve(
      options.cwd,
      options.outputDir,
      `${config.binaryName}.${process.platform}-${arch}.node`,
    ),
  )

  if (!srcFiles || !universalizers[process.platform]) {
    throw new Error(
      `'universal' arch for platform '${process.platform}' not supported.`,
    )
  }

  debug(`Looking up source binaries to combine: `)
  debug('  %O', srcFiles)

  const srcFileLookup = await Promise.all(srcFiles.map((f) => fileExists(f)))

  const notFoundFiles = srcFiles.filter((_, i) => !srcFileLookup[i])

  if (notFoundFiles.length) {
    throw new Error(
      `Some binary files were not found: ${JSON.stringify(notFoundFiles)}`,
    )
  }

  const output = resolve(
    options.cwd,
    options.outputDir,
    `${config.binaryName}.${process.platform}-universal.node`,
  )

  universalizers[process.platform]?.(srcFiles, output)

  debug(`Produced universal binary: ${output}`)
}
