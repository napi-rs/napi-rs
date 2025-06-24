const assert = require('node:assert')
const { readFileSync } = require('node:fs')

const { app, BrowserWindow, ipcMain } = require('electron')

const FILE_CONTENT = readFileSync(__filename, 'utf8')

const createWindowAndReload = async () => {
  await app.whenReady()

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  await win.loadFile('./electron-renderer/index.html')

  await new Promise((resolve, reject) => {
    win.webContents.on('render-process-gone', (e, detail) => {
      reject(
        new Error(
          `Renderer process crashed: ${detail.reason}, exitCode: ${detail.exitCode}`,
        ),
      )
    })

    // reload to check if there is any crash
    win.reload()

    // make sure the renderer process is still alive
    ipcMain.once('pong', () => {
      console.info('pong')
      resolve()
    })

    // Wait for a while to make sure if a crash happens, the 'resolve' function should be called after the crash
    setTimeout(() => {
      win.webContents.send('ping')
      console.info('ping')
    }, 1000)
  })
}

async function main() {
  const {
    readFileAsync,
    callThreadsafeFunction,
    getBufferSlice,
    createExternalBufferSlice,
    createUint8ClampedArrayFromData,
    createUint8ClampedArrayFromExternal,
    uint8ArrayFromData,
    uint8ArrayFromExternal,
    arrayBufferFromData,
    createExternalTypedArray,
    createReadableStream,
  } = require('./index.cjs')

  const buf = await readFileAsync(__filename)
  assert(FILE_CONTENT === buf.toString('utf8'))

  const value = await new Promise((resolve, reject) => {
    let i = 0
    let value = 0
    callThreadsafeFunction((err, v) => {
      if (err != null) {
        reject(err)
        return
      }
      i++
      value += v
      if (i === 100) {
        resolve(value)
      }
    })
  })

  assert(
    value ===
      Array.from({ length: 100 }, (_, i) => i).reduce((a, b) => a + b),
  )
  console.info(createExternalTypedArray())

  const stream = await createReadableStream()
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }
  assert(Buffer.concat(chunks).toString('utf-8') === 'hello'.repeat(100))

  assert(getBufferSlice().toString('utf8'), 'Hello world')
  assert(createExternalBufferSlice().toString('utf8'), 'Hello world')
  assert(Buffer.from(createUint8ClampedArrayFromData()).toString('utf8'), 'Hello world')
  assert(Buffer.from(createUint8ClampedArrayFromExternal()).toString('utf8'), 'Hello world')
  assert(Buffer.from(arrayBufferFromData()).toString('utf8'), 'Hello world')
  assert(Buffer.from(uint8ArrayFromData()).toString('utf8'), 'Hello world')
  assert(Buffer.from(uint8ArrayFromExternal()).toString('utf8'), 'Hello world')
}

Promise.all([main(), createWindowAndReload()])
  .then(() => {
    process.exit(0)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
