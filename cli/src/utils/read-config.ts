import { resolve } from 'node:path'

import { readNapiConfig } from './config.js'

interface MinimalNapiOptions {
  cwd: string
  configPath?: string
  packageJsonPath?: string
}

export async function readConfig(options: MinimalNapiOptions) {
  const resolvePath = (...paths: string[]) => resolve(options.cwd, ...paths)
  const config = await readNapiConfig(
    resolvePath(options.packageJsonPath ?? 'package.json'),
    options.configPath ? resolvePath(options.configPath) : undefined,
  )
  return config
}
