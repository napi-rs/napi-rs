import { join, parse, resolve } from 'node:path'

import * as colors from 'colorette'

import {
  applyDefaultArtifactsOptions,
  ArtifactsOptions,
} from '../def/artifacts.js'
import {
  readNapiConfig,
  debugFactory,
  readFileAsync,
  writeFileAsync,
  UniArchsByPlatform,
  readdirAsync,
} from '../utils/index.js'

const debug = debugFactory('artifacts')

export async function collectArtifacts(userOptions: ArtifactsOptions) {
  const options = applyDefaultArtifactsOptions(userOptions)

  const packageJsonPath = resolve(options.cwd, options.packageJsonPath)
  const { targets, binaryName } = await readNapiConfig(packageJsonPath)

  const distDirs = targets.map((platform) =>
    resolve(options.cwd, options.npmDir, platform.platformArchABI),
  )

  const universalSourceBins = new Set(
    targets
      .filter((platform) => platform.arch === 'universal')
      .flatMap(
        (p) => UniArchsByPlatform[p.platform]?.map((a) => `${p.platform}-${a}`),
      )
      .filter(Boolean) as string[],
  )

  await collectNodeBinaries(resolve(options.cwd, options.outputDir)).then(
    (output) =>
      Promise.all(
        output.map(async (filePath) => {
          debug.info(`Read [${colors.yellowBright(filePath)}]`)
          const sourceContent = await readFileAsync(filePath)
          const parsedName = parse(filePath)
          const terms = parsedName.name.split('.')
          const platformArchABI = terms.pop()!
          const _binaryName = terms.join('.')

          if (_binaryName !== binaryName) {
            debug.warn(
              `[${_binaryName}] is not matched with [${binaryName}], skip`,
            )
            return
          }
          const dir = distDirs.find((dir) => dir.includes(platformArchABI))
          if (!dir && universalSourceBins.has(platformArchABI)) {
            debug.warn(
              `[${platformArchABI}] has no dist dir but it is source bin for universal arch, skip`,
            )
            return
          }
          if (!dir) {
            throw new Error(`No dist dir found for ${filePath}`)
          }

          const distFilePath = join(dir, parsedName.base)
          debug.info(
            `Write file content to [${colors.yellowBright(distFilePath)}]`,
          )
          await writeFileAsync(distFilePath, sourceContent)
          const distFilePathLocal = join(
            parse(packageJsonPath).dir,
            parsedName.base,
          )
          debug.info(
            `Write file content to [${colors.yellowBright(distFilePathLocal)}]`,
          )
          await writeFileAsync(distFilePathLocal, sourceContent)
        }),
      ),
  )
}

async function collectNodeBinaries(root: string) {
  const files = await readdirAsync(root, { withFileTypes: true })
  const nodeBinaries = files
    .filter((file) => file.isFile() && file.name.endsWith('.node'))
    .map((file) => join(root, file.name))

  const dirs = files.filter((file) => file.isDirectory())
  for (const dir of dirs) {
    if (dir.name !== 'node_modules') {
      nodeBinaries.push(...(await collectNodeBinaries(join(root, dir.name))))
    }
  }
  return nodeBinaries
}
