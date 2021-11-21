import { readFile, writeFile, copyFile, mkdir, unlink } from 'fs'
import { promisify } from 'util'

export const readFileAsync = promisify(readFile)
export const writeFileAsync = promisify(writeFile)
export const unlinkAsync = promisify(unlink)
export const copyFileAsync = promisify(copyFile)
export const mkdirAsync = promisify(mkdir)

export function pick<O, K extends keyof O>(o: O, ...keys: K[]): Pick<O, K> {
  return keys.reduce((acc, key) => {
    acc[key] = o[key]
    return acc
  }, {} as O)
}
