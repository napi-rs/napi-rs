import { createRequire } from 'node:module'
import { basename } from 'node:path'
import { Worker } from 'node:worker_threads'

// The binding that index.cjs loaded, not any binding in the folder.
export function loadedAddon() {
  const addons = Object.keys(createRequire(import.meta.url).cache).filter(
    (file) => /^example\..+\.node$/.test(basename(file)),
  )
  if (addons.length !== 1) {
    throw new Error(`expected one loaded addon, found ${addons.join(', ')}`)
  }
  return addons[0]
}

// Runs `source` in a worker that gets the addon path as `workerData`, and
// resolves with the last message it posted once the worker has exited. The
// worker's envs are torn down by then.
export function runInWorker(source: string) {
  return new Promise<unknown>((resolve, reject) => {
    const worker = new Worker(source, {
      eval: true,
      execArgv: [],
      workerData: loadedAddon(),
    })
    let result: unknown
    worker.on('message', (message) => {
      result = message
    })
    worker.on('error', reject)
    worker.on('exit', (code) => {
      if (code === 0) resolve(result)
      else reject(new Error(`Worker exited with code ${code}`))
    })
  })
}

// Source for a worker-side `load()` that loads the addon into a new module
// object. Each call gives the addon a new env on the worker's thread.
export const LOAD_IN_WORKER = `
  const { parentPort, workerData } = require('node:worker_threads')
  const load = () => {
    const module = { exports: {} }
    process.dlopen(module, workerData)
    return module.exports
  }
`
