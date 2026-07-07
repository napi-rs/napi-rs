import { createRequire } from 'node:module'
import { parentPort } from 'node:worker_threads'

const require = createRequire(import.meta.url)
const lifecycle = require('../example.wasi.cjs')

lifecycle.dropUnregisteredWeakTsfnForWasi(() => {})
parentPort.postMessage('ready')
