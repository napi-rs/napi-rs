const assert = require('assert')
const { readFileSync } = require('fs')

const { app, BrowserWindow, ipcMain } = require('electron')

const {
  readFileAsync,
  callThreadsafeFunction,
  withAbortController,
  createExternalTypedArray,
} = require('./index')

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

    // Wait for a while to make sure if a crash happens, the 'resolve' function should be called after the crash
    setTimeout(() => {
      // make sure the renderer process is still alive
      ipcMain.once('pong', () => resolve())
      win.webContents.send('ping')
    }, 500)
  })
}

async function main() {
  const ctrl = new AbortController()
  const promise = withAbortController(1, 2, ctrl.signal)
  try {
    ctrl.abort()
    await promise
    throw new Error('Should throw AbortError')
  } catch (err) {
    assert(err.message === 'AbortError')
  }

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
      Array.from({ length: 100 }, (_, i) => i + 1).reduce((a, b) => a + b),
  )
  console.info(createExternalTypedArray())
}

Promise.all([main(), createWindowAndReload()])
  .then(() => {
    process.exit(0)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
