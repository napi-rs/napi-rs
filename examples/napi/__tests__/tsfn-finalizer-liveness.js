import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const [mode, manualStopPath, joinedPath] = process.argv.slice(2)

if (
  (mode !== 'referenced' && mode !== 'weak') ||
  !manualStopPath ||
  !joinedPath
) {
  throw new TypeError(
    'mode, manual stop path, and finalizer joined path are required',
  )
}

const lifecycle = require('../index.cjs')
const startWorker =
  mode === 'weak'
    ? lifecycle.startWeakTsfnFinalizerLivenessWorker
    : lifecycle.startReferencedTsfnFinalizerLivenessWorker

startWorker(() => {}, manualStopPath, joinedPath)
process.stdout.write('ready\n')
