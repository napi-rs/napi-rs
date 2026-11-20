import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function cliPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir)
    if (parent === dir) return dir
    dir = parent
  }
  return dir
}

export function compressionAssetPaths(
  hostTriple: string,
  targetTriple: string,
) {
  const packageRoot = cliPackageRoot()
  const executable = hostTriple.includes('windows') ? '.exe' : ''
  return {
    producer: join(
      packageRoot,
      'bin',
      `napi-compress-${hostTriple}${executable}`,
    ),
    stub: join(packageRoot, 'stubs', `${targetTriple}.node`),
  }
}
