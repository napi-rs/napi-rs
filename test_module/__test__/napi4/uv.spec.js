const test = require('ava')
const { join } = require('path')
const { readFileSync } = require('fs')

const bindings = require('../../index.node')
const napiVersion = require('../napi-version')

const filepath = join(__dirname, './example.txt')

test('should call callback with the first arguments as an Error', async (t) => {
  if (napiVersion < 4) {
    t.is(bindings.uvReadFile, undefined)
    return
  }
  const fileContent = await bindings.uvReadFile(filepath)
  t.true(Buffer.isBuffer(fileContent))
  t.deepEqual(readFileSync(filepath), fileContent)
})
