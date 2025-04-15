const memfs = require('memfs')
const assert = require('assert')
const { Worker, isMainThread, parentPort } = require('worker_threads')
const { createFsProxy, createOnMessage } = require('./fs-proxy.cjs')

const fs = isMainThread ? memfs.createFsFromVolume(memfs.Volume.fromJSON({
  '/test.txt': 'test',
  '/test.json': JSON.stringify({ a: 'b' })
})) : createFsProxy(memfs.createFsFromVolume(memfs.Volume.fromJSON({})))

if (isMainThread) {
  fs.__custom1__ = () => {
    throw null
  }
  fs.__custom2__ = (x) => x

  const worker = new Worker(__filename)

  const onMessage = createOnMessage(fs)
  worker.on('message', (data) => {
    if (data === 'pass') {
      console.log('pass')
      return
    }
    onMessage({ data })
  })
  worker.on('error', (error) => {
    console.error(error)
    process.exit(1)
  })
} else {
  Object.assign(globalThis, {
    postMessage: (data) => {
      parentPort.postMessage(data)
    }
  })
  assert.strictEqual(fs.readFileSync('/test.txt', 'utf8'), 'test')
  assert.strictEqual(fs.readFileSync('/test.json', 'utf8'), '{"a":"b"}')
  assert.throws(() => fs.readFileSync('/notexist', 'utf8'), /ENOENT/)
  assert.throws(() => fs.__custom1__(), err => {
    return err === null
  })
  assert.throws(() => fs.__notexist__(), TypeError)

  const primitives = [
    undefined,
    null,
    true,
    false,
    1,
    1.1,
    1n,
    'string'
  ]
  primitives.forEach((primitive) => {
    assert.strictEqual(fs.__custom2__(primitive), primitive)
  })
  postMessage('pass')
}
