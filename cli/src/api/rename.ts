import { resolve } from 'node:path'

import { isNil, merge, omitBy, pick } from 'lodash-es'

import { applyDefaultRenameOptions, RenameOptions } from '../def/rename.js'
import { readFileAsync, writeFileAsync } from '../utils/index.js'

import { createNpmDirs } from './create-npm-dirs.js'

export async function renameProject(userOptions: RenameOptions) {
  const options = applyDefaultRenameOptions(userOptions)

  const packageJsonPath = resolve(options.cwd, options.packageJsonPath)
  const cargoTomlPath = resolve(options.cwd, options.manifestPath)

  const packageJsonContent = await readFileAsync(packageJsonPath, 'utf8')
  const packageJsonData = JSON.parse(packageJsonContent)

  merge(
    packageJsonData,
    omitBy(pick(options, ['name', 'description', 'author', 'license']), isNil),
    {
      napi: omitBy(
        {
          binaryName: options.binaryName,
          packageName: options.packageName,
        },
        isNil,
      ),
    },
  )

  if (options.configPath) {
    const configPath = resolve(options.cwd, options.configPath)
    const configContent = await readFileAsync(configPath, 'utf8')
    const configData = JSON.parse(configContent)
    configData.binaryName = options.binaryName
    configData.packageName = options.packageName
    await writeFileAsync(configPath, JSON.stringify(configData, null, 2))
  }

  await writeFileAsync(
    packageJsonPath,
    JSON.stringify(packageJsonData, null, 2),
  )

  let tomlContent = await readFileAsync(cargoTomlPath, 'utf8')
  tomlContent = tomlContent.replace(
    /name\s?=\s?"([\w+])"/,
    `name = "${options.binaryName}"`,
  )
  await writeFileAsync(cargoTomlPath, tomlContent)

  await createNpmDirs({
    cwd: options.cwd,
    packageJsonPath: options.packageJsonPath,
    npmDir: options.npmDir,
    dryRun: false,
  })
}
