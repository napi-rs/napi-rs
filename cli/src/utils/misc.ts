import {
  readFile,
  writeFile,
  copyFile,
  mkdir,
  unlink,
  stat,
  readdir,
} from 'node:fs/promises'

import { debug } from './log.js'

import pkgJson from '@napi-rs/cli/package.json' with { type: 'json' }

export const readFileAsync = readFile
export const writeFileAsync = writeFile
export const unlinkAsync = unlink
export const copyFileAsync = copyFile
export const mkdirAsync = mkdir
export const statAsync = stat
export const readdirAsync = readdir

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
  const old = await import(path, { with: { type: 'json' } })
  await writeFileAsync(path, JSON.stringify({ ...old, ...partial }, null, 2))
}

export const CLI_VERSION = pkgJson.version
