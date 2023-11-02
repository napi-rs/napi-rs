import { readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

import { groupBy, mapValues } from 'lodash-es'

import { parseTriple } from '../cli/src/utils/target.js'

const __dirname = resolve(fileURLToPath(import.meta.url), '..')

const RAW_LIST = readFileSync(join(__dirname, 'target-list'), 'utf8')

const SUPPORTED_PLATFORM = new Set([
  'darwin',
  'ios',
  'android',
  'win32',
  'linux',
  'freebsd',
])

const tripleLists: { [key: string]: { platform?: string } } = RAW_LIST.trim()
  .split('\n')
  .filter((line) => !line.startsWith('wasm') && line.trim().length)
  .map(parseTriple)
  .reduce((acc: Record<string, { platform?: string }>, cur) => {
    acc[cur.triple] = cur
    return acc
  }, {})

const platformArchTriples = mapValues(
  groupBy(
    Object.values(tripleLists).filter((k) =>
      SUPPORTED_PLATFORM.has(k.platform!),
    ),
    'platform',
  ),
  (v) => groupBy(v, 'arch'),
)

const mjsContent = `
export const platformArchTriples = ${JSON.stringify(
  platformArchTriples,
  null,
  2,
)}
`
const cjsContent = `
module.exports.platformArchTriples = ${JSON.stringify(
  platformArchTriples,
  null,
  2,
)}
`

writeFileSync(join(__dirname, 'index.js'), mjsContent)

writeFileSync(join(__dirname, 'index.cjs'), cjsContent)
