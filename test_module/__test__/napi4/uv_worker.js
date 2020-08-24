const { readFileSync } = require('fs')
const { join } = require('path')
const { isMainThread, parentPort } = require('worker_threads')

const bindings = require('../../index.node')

const filepath = join(__dirname, './example.txt')

if (!isMainThread) {
  ;(async () => {
    const fileContent = await bindings.uvReadFile(filepath)
    const success =
      Buffer.isBuffer(fileContent) &&
      readFileSync(filepath).toString('utf8') === fileContent.toString('utf8')
    parentPort.postMessage(success)
  })().catch((e) => {
    throw e
  })
}
