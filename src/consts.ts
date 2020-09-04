import { join } from 'path'

export function getNapiConfig(packageJson = 'package.json') {
  const packageJsonPath = join(process.cwd(), packageJson)

  const pkgJson = require(packageJsonPath)
  const { version: packageVersion, os, napi, name } = pkgJson
  const muslPlatforms: string[] = (napi?.musl ?? []).map(
    (platform: string) => `${platform}-musl`,
  )
  const platforms = os
  const version = packageVersion
  const packageName = name

  const binaryName = napi?.name ?? 'index'

  return {
    muslPlatforms,
    platforms,
    version,
    packageName,
    binaryName,
    packageJsonPath,
    content: pkgJson,
  }
}
