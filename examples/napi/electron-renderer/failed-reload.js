// The first page load registers the addon in this renderer's Node env, then
// reloads the page. Electron tears that env down and creates a new one on the
// same thread, where the addon image is still loaded. There the load fails, and
// the class lookups of its surviving exports must not read the constructors of
// the env that is gone.
const { ipcRenderer } = require('electron')

const addon = new URLSearchParams(location.search).get('addon')

function runChecks(binding) {
  const checks = {
    classReturningExport: () => binding.returnEitherClass(-1).constructor.name,
    classField: () =>
      binding.createObjectWithClassField().bird.constructor.name,
    instanceOf: () =>
      binding.NinjaTurtle.isInstanceOf(binding.NinjaTurtle.newRaph()),
  }
  const results = {}
  for (const [name, check] of Object.entries(checks)) {
    try {
      results[name] = check()
    } catch (error) {
      results[name] = error.message
    }
  }
  return results
}

if (!sessionStorage.getItem('first-load')) {
  const first = { exports: {} }
  process.dlopen(first, addon)
  sessionStorage.setItem(
    'first-load',
    JSON.stringify({ pid: process.pid, results: runChecks(first.exports) }),
  )
  location.reload()
} else {
  const second = { exports: {} }
  const RealSymbol = Symbol
  globalThis.Symbol = null
  let reload = 'loaded'
  try {
    process.dlopen(second, addon)
  } catch (error) {
    reload = error.message
  }
  globalThis.Symbol = RealSymbol
  ipcRenderer.send('failed-reload', {
    first: JSON.parse(sessionStorage.getItem('first-load')),
    pid: process.pid,
    reload,
    results: runChecks(second.exports),
  })
}
