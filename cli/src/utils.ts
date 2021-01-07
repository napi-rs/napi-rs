import { readFile, writeFile, exists, copyFile, unlink } from 'fs'
import { promisify } from 'util'

export const readFileAsync = promisify(readFile)
export const writeFileAsync = promisify(writeFile)
export const existsAsync = promisify(exists)
export const unlinkAsync = promisify(unlink)
export const copyFileAsync = promisify(copyFile)
