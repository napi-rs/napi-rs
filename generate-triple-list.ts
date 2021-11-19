import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import * as esbuild from 'esbuild'
import { groupBy, mapValues } from 'lodash'

import { parseTriple } from './cli/src/parse-triple'

const RAW_LIST = readFileSync(join(__dirname, 'triples', 'target-list'), 'utf8')

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
  .reduce((acc, cur) => {
    acc[cur.raw] = cur
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

const fileContent = `
module.exports.platformArchTriples = ${JSON.stringify(platformArchTriples)}
`

writeFileSync(
  join(__dirname, 'triples', 'index.js'),
  esbuild.transformSync(fileContent, {
    minify: true,
  }).code,
)
