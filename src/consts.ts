import { join } from 'path'

export function getNapiConfig(packageJson = 'package.json') {
  const packageJsonPath = join(process.cwd(), packageJson)

  const pkgJson = require(packageJsonPath)
  const { version: packageVersion, os, napi, name } = pkgJson
  const muslPlatforms: string[] = (napi?.musl ?? []).map(
    (platform: string) => `${platform}-musl`,
  )
  const platforms = os
  const releaseVersion = process.env.RELEASE_VERSION
  const releaseVersionWithoutPrefix = releaseVersion?.startsWith('v')
    ? releaseVersion.substr(1)
    : releaseVersion
  const version = releaseVersionWithoutPrefix ?? packageVersion
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
