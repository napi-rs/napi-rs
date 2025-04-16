import assert from 'node:assert'
import { test } from 'node:test'
import { Worker, isMainThread, parentPort } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'

import * as memfs from 'memfs'

import { createFsProxy, createOnMessage } from './fs-proxy.cjs'

const __filename = fileURLToPath(import.meta.url)

await test(`fs-proxy between main and worker (${isMainThread ? 'main' : 'worker'})`, async () => {
  const fs = isMainThread
    ? memfs.createFsFromVolume(
        memfs.Volume.fromJSON({
          '/test.txt': 'test',
          '/test.json': JSON.stringify({ a: 'b' }),
        }),
      )
    : createFsProxy(memfs)

  if (isMainThread) {
    fs.__custom1__ = () => {
      throw null
    }
    fs.__custom2__ = (x) => x

    const worker = new Worker(__filename)

    const onMessage = createOnMessage(fs)
    await new Promise((resolve, reject) => {
      worker.on('message', (data) => {
        if (data === 'pass') {
          resolve()
          return
        }
        onMessage({ data })
      })
      worker.on('error', (error) => {
        reject(error)
      })
    })
  } else {
    Object.assign(globalThis, {
      postMessage: (data) => {
        parentPort.postMessage(data)
      },
    })
    assert.strictEqual(fs.readFileSync('/test.txt', 'utf8'), 'test')
    assert.strictEqual(fs.readFileSync('/test.json', 'utf8'), '{"a":"b"}')
    assert.throws(() => fs.readFileSync('/notexist', 'utf8'), /ENOENT/)
    assert.throws(
      () => fs.__custom1__(),
      (err) => {
        return err === null
      },
    )
    assert.throws(() => fs.__notexist__(), TypeError)

    const primitives = [undefined, null, true, false, 1, 1.1, 1n, 'string']
    primitives.forEach((primitive) => {
      assert.strictEqual(fs.__custom2__(primitive), primitive)
    })
    postMessage('pass')
  }
})
