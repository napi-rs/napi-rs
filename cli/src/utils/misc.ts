import {
  readFile,
  writeFile,
  copyFile,
  mkdir,
  unlink,
  stat,
  readdir,
} from 'node:fs'
import { promisify } from 'node:util'

import pkgJson from '../../package.json' with { type: 'json' }
import { debug } from './log.js'

export const readFileAsync = promisify(readFile)
export const writeFileAsync = promisify(writeFile)
export const unlinkAsync = promisify(unlink)
export const copyFileAsync = promisify(copyFile)
export const mkdirAsync = promisify(mkdir)
export const statAsync = promisify(stat)
export const readdirAsync = promisify(readdir)

export async function fileExists(path: string) {
  const exists = await statAsync(path)
    .then(() => true)
    .catch(() => false)
  return exists
}

export async function dirExistsAsync(path: string) {
  try {
    const stats = await statAsync(path)
    return stats.isDirectory()
  } catch {
    return false
  }
}

export function pick<O, K extends keyof O>(o: O, ...keys: K[]): Pick<O, K> {
  return keys.reduce((acc, key) => {
    acc[key] = o[key]
    return acc
  }, {} as O)
}

export async function updatePackageJson(
  path: string,
  partial: Record<string, any>,
) {
  const exists = await fileExists(path)
  if (!exists) {
    debug(`File not exists ${path}`)
    return
  }
  const old = JSON.parse(await readFileAsync(path, 'utf8'))
  await writeFileAsync(path, JSON.stringify({ ...old, ...partial }, null, 2))
}

export const CLI_VERSION = pkgJson.version
