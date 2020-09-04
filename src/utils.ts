import { readFile, writeFile, exists } from 'fs'
import { promisify } from 'util'

export const readFileAsync = promisify(readFile)
export const writeFileAsync = promisify(writeFile)
export const existsAsync = promisify(exists)
