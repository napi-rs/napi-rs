import { writeFileAsync } from './utils'

export async function updatePackageJson(
  path: string,
  partial: Record<string, any>,
) {
  const old = require(path)
  await writeFileAsync(path, JSON.stringify({ ...old, ...partial }, null, 2))
}
