import { join } from 'path'

import { DefaultPlatforms, PlatformDetail, parseTriple } from './parse-triple'

export function getNapiConfig(packageJson = 'package.json') {
  const packageJsonPath = join(process.cwd(), packageJson)

  const pkgJson = require(packageJsonPath)
  const { version: packageVersion, napi, name } = pkgJson
  const additionPlatforms: PlatformDetail[] = (
    napi?.triples?.additional ?? []
  ).map(parseTriple)
  const defaultPlatforms =
    napi?.triples?.defaults === false ? [] : [...DefaultPlatforms]
  const platforms = [...defaultPlatforms, ...additionPlatforms]
  const releaseVersion = process.env.RELEASE_VERSION
  const releaseVersionWithoutPrefix = releaseVersion?.startsWith('v')
    ? releaseVersion.substr(1)
    : releaseVersion
  const version = releaseVersionWithoutPrefix ?? packageVersion
  const packageName = name

  const binaryName: string = napi?.name ?? 'index'

  return {
    platforms,
    version,
    packageName,
    binaryName,
    packageJsonPath,
    content: pkgJson,
  }
}
