const assert = require('node:assert')
const { readFileSync } = require('node:fs')
const { basename } = require('node:path')

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
    arrayBufferFromExternalReadBack,
    uint8ArraySliceFromExternalReadBack,
    uint8ClampedSliceFromExternalReadBack,
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
    value === Array.from({ length: 100 }, (_, i) => i).reduce((a, b) => a + b),
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
  assert(
    Buffer.from(createUint8ClampedArrayFromData()).toString('utf8'),
    'Hello world',
  )
  assert(
    Buffer.from(createUint8ClampedArrayFromExternal()).toString('utf8'),
    'Hello world',
  )
  // Rust-side read-back of the `from_external` constructors: Electron takes
  // the `napi_no_external_buffers_allowed` fallback, so a slice still pointing
  // at the finalized (freed) source reads groomed marker bytes here.
  assert.strictEqual(
    arrayBufferFromExternalReadBack(),
    'Hello world from external',
  )
  assert.strictEqual(uint8ArraySliceFromExternalReadBack(), 'Hello world')
  assert.strictEqual(uint8ClampedSliceFromExternalReadBack(), 'Hello world')
  assert(Buffer.from(arrayBufferFromData()).toString('utf8'), 'Hello world')
  assert(Buffer.from(uint8ArrayFromData()).toString('utf8'), 'Hello world')
  assert(Buffer.from(uint8ArrayFromExternal()).toString('utf8'), 'Hello world')
}

// The binding that index.cjs loaded, not any binding in the folder.
function loadedAddon() {
  const addons = Object.keys(require.cache).filter((file) =>
    /^example\..+\.node$/.test(basename(file)),
  )
  assert.strictEqual(addons.length, 1, addons.join(', '))
  return addons[0]
}

// A renderer reload gives the page a new Node env on the same thread. If the
// addon fails to load there, the class lookups of its surviving exports must
// fail cleanly instead of reading the constructors of the env that is gone.
const checkFailedReloadInNewEnv = async () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  const result = new Promise((resolve, reject) => {
    win.webContents.on('render-process-gone', (e, detail) => {
      reject(new Error(`Renderer process crashed: ${detail.reason}`))
    })
    ipcMain.once('failed-reload', (e, message) => resolve(message))
  })
  await win.loadFile('./electron-renderer/failed-reload.html', {
    query: { addon: loadedAddon() },
  })
  const { first, pid, reload, results } = await result
  win.destroy()

  // Same renderer process, so the same thread and thread locals.
  assert.strictEqual(pid, first.pid)
  assert.deepStrictEqual(first.results, {
    classReturningExport: 'JsClassForEither',
    classField: 'Bird',
    instanceOf: true,
  })
  assert.match(reload, /^Symbol\.\w+ is not available in this runtime$/)
  for (const [name, message] of Object.entries(results)) {
    if (name === 'instanceOf' && message === 'class not exported') continue
    assert.match(message, /^Failed to get constructor of class `/, name)
  }
}

Promise.all([main(), createWindowAndReload()])
  .then(checkFailedReloadInNewEnv)
  .then(() => {
    process.exit(0)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
