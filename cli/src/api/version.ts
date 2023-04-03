import { join, resolve } from 'path'

import { applyDefaultVersionOptions, VersionOptions } from '../def/version.js'
import {
  readNapiConfig,
  debugFactory,
  updatePackageJson,
} from '../utils/index.js'

const debug = debugFactory('version')

export async function version(userOptions: VersionOptions) {
  const options = applyDefaultVersionOptions(userOptions)
  const packageJsonPath = resolve(options.cwd, options.packageJsonPath)

  const config = await readNapiConfig(packageJsonPath)

  for (const target of config.targets) {
    const pkgDir = resolve(options.cwd, options.npmDir, target.platformArchABI)

    debug(`Update version to %i in [%i]`, config.packageJson.version, pkgDir)
    await updatePackageJson(join(pkgDir, 'package.json'), {
      version: config.packageJson.version,
    })
  }
}
