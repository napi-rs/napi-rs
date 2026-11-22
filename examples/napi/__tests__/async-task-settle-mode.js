// Fakes `process.versions` the way another host would show it, loads the addon, starts its first
// task (which picks the env's settle mode) and reports that mode: for the main-thread env, or for
// `bun-worker` the env of a worker_threads Worker that fakes `versions.bun` and loads the addon
// itself. `process.versions` stays faked until the mode is picked.
// Usage: node <this file> <variant> <addon>, where <variant> is one of
// control|deleted-bun|electron|nw|bun|bun-worker|throwing-versions|getter-dlopen
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from 'node:worker_threads'

const [variant, addon] = isMainThread
  ? process.argv.slice(2, 4)
  : [workerData.variant, workerData.addon]

// Prints from the main thread, so the line is out before the process exits.
function report(result) {
  if (isMainThread) {
    console.log(`settle-mode ${JSON.stringify(result)}`)
  } else {
    parentPort.postMessage(result)
  }
}

if (variant === 'bun-worker') {
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { variant: 'bun', addon },
  })
  worker.on('message', report)
  worker.on('error', (error) => {
    console.error(error)
    process.exitCode = 1
  })
  worker.on('exit', (code) => {
    if (code !== 0) process.exitCode = 1
  })
} else {
  let versionsRead = 0
  const restore = []

  // A counting getter for `process.versions[key]`, on the real object.
  function fakeVersion(key, value) {
    Object.defineProperty(process.versions, key, {
      configurable: true,
      enumerable: true,
      get() {
        versionsRead++
        return value
      },
    })
    restore.push(() => delete process.versions[key])
  }

  if (variant === 'electron') {
    fakeVersion('electron', '99.0.0')
  } else if (variant === 'nw') {
    fakeVersion('nw', '0.99.0')
  } else if (variant === 'bun') {
    // A Bun whose `uv_default_loop` is the crash stub. The version is not read any more.
    fakeVersion('bun', '1.4.3')
  } else if (variant === 'throwing-versions') {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'versions')
    Object.defineProperty(process, 'versions', {
      configurable: true,
      get() {
        versionsRead++
        throw new Error('process.versions getter threw')
      },
    })
    restore.push(() => Object.defineProperty(process, 'versions', descriptor))
  } else if (variant === 'getter-dlopen') {
    // A getter that loads another native addon. Node holds its addon-loader lock while an addon
    // registers, and that lock is not re-entrant, so this getter aborts the process if the addon
    // reads `process.versions` while it registers.
    const descriptor = Object.getOwnPropertyDescriptor(process, 'versions')
    const versions = process.versions
    let loading = false
    Object.defineProperty(process, 'versions', {
      configurable: true,
      get() {
        versionsRead++
        if (!loading) {
          loading = true
          process.dlopen({ exports: {} }, addon)
          loading = false
        }
        return versions
      },
    })
    restore.push(() => Object.defineProperty(process, 'versions', descriptor))
  } else if (variant === 'deleted-bun') {
    // What a script may do under Bun. Node is still found by its exported symbol.
    delete process.versions.bun
  } else if (variant !== 'control') {
    console.error(`unknown variant ${variant}`)
    process.exit(2)
  }

  const uncaught = []
  process.on('uncaughtException', (error) => uncaught.push(String(error)))

  const module = { exports: {} }
  process.dlopen(module, addon)
  const native = module.exports

  // The env's first task picks its settle mode, after the load has returned.
  const pending = native.asyncTaskCounted()
  const mode = native.asyncTaskPromiseSettleMode()
  for (const undo of restore) undo()
  const timeout = setTimeout(() => {
    console.error('AsyncTask promise still pending after 5000 ms')
    process.exit(1)
  }, 5000)
  const value = await pending
  clearTimeout(timeout)
  report({ mode, value, versionsRead: versionsRead > 0, uncaught })
}
