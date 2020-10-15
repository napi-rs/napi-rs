const { readFileSync, writeFileSync } = require('fs')
const { join } = require('path')

const { groupBy, mapValues } = require('lodash')
const prettier = require('prettier')

const { parseTriple } = require('./cli/scripts/parse-triple')

const rawLists = readFileSync(join(__dirname, 'triples', 'target-list'), 'utf8')

const tripleLists = rawLists
  .trim()
  .split('\n')
  .filter((line) => !line.startsWith('wasm') && line.trim().length)
  .map(parseTriple)
  .reduce((acc, cur) => {
    acc[cur.raw] = cur
    return acc
  }, {})

const platformArchTriples = mapValues(
  groupBy([...Object.values(tripleLists)], 'platform'),
  (v) => groupBy(v, 'arch'),
)

const fileContent = `
module.exports = ${JSON.stringify(tripleLists, null, 2)}

module.exports.platformArchTriples = ${JSON.stringify(platformArchTriples)}
`

writeFileSync(
  join(__dirname, 'triples', 'index.js'),
  prettier.format(fileContent, {
    semi: false,
    singleQuote: true,
    trailingComma: 'es5',
    parser: 'typescript',
  }),
)
