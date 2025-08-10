import { readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

import { groupBy, mapValues } from 'es-toolkit'

import { parseTriple } from '@napi-rs/cli'

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

const tripleLists = RAW_LIST.trim()
  .split('\n')
  .filter((line) => !line.startsWith('wasm') && line.trim().length > 0)
  .map(parseTriple)
  .reduce((acc: Record<string, { platform: string; arch: string }>, cur) => {
    acc[cur.triple] = cur
    return acc
  }, {})

const platformArchTriples = mapValues(
  groupBy(
    Object.values(tripleLists).filter((k) =>
      SUPPORTED_PLATFORM.has(k.platform),
    ),
    (x) => x.platform,
  ),
  (v) => groupBy(v, (v) => v.arch),
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
