const test = require('ava')
const { join, resolve } = require('path')
const { readFileSync } = require('fs')

const bindings = require('../../index.node')
const napiVersion = require('../napi-version')

let threadMod

try {
  threadMod = require('worker_threads')
} catch (err) {
  //
}

const filepath = join(__dirname, './example.txt')

test('should execute future on libuv thread pool', async (t) => {
  if (napiVersion < 4) {
    t.is(bindings.uvReadFile, undefined)
    return
  }
  const fileContent = await bindings.uvReadFile(filepath)
  t.true(Buffer.isBuffer(fileContent))
  t.deepEqual(readFileSync(filepath), fileContent)
})

if (threadMod && napiVersion >= 4) {
  test('should execute future on libuv thread pool of "Worker"', async (t) => {
    // Test in threads if current Node.js supports "worker_threads".`

    const { Worker } = threadMod
    const script = resolve(__dirname, './uv_worker.js')
    const worker = new Worker(script)
    const success = await new Promise((resolve) => {
      worker.on('message', (success) => {
        resolve(success)
      })
    })

    t.is(success, true)
  })
}
