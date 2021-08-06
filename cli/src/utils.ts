import { readFile, writeFile, exists, copyFile, unlink } from 'fs'
import { promisify } from 'util'

export const readFileAsync = promisify(readFile)
export const writeFileAsync = promisify(writeFile)
export const existsAsync = promisify(exists)
export const unlinkAsync = promisify(unlink)
export const copyFileAsync = promisify(copyFile)

export function pick<O, K extends keyof O>(o: O, ...keys: K[]): Pick<O, K> {
  return keys.reduce((acc, key) => {
    acc[key] = o[key]
    return acc
  }, {} as O)
}
