import { debugFactory } from './debug'
import { writeFileAsync, fileExists } from './utils'

const debug = debugFactory('update-package')

export async function updatePackageJson(
  path: string,
  partial: Record<string, any>,
) {
  const exists = await fileExists(path)
  if (!exists) {
    debug(`File not exists ${path}`)
    return
  }
  const old = require(path)
  await writeFileAsync(path, JSON.stringify({ ...old, ...partial }, null, 2))
}
