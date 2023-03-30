import { readFile, writeFile, copyFile, mkdir, unlink, stat, readdir } from 'fs'
import { createRequire } from 'module'
import { promisify } from 'util'

import { debug } from './log.js'

const require = createRequire(import.meta.url)
const pkgJson = require('../../package.json')

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
  const old = require(path)
  await writeFileAsync(path, JSON.stringify({ ...old, ...partial }, null, 2))
}

export const CLI_VERSION = pkgJson.version
