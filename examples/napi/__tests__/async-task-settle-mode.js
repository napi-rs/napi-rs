// Fakes `process.versions` the way another host would show it, then loads the addon and reports
// the settle mode its main-thread env picked.
// Usage: node <this file> control|electron|nw|bun-1.4.3|bun-1.4.4|throwing-versions <addon>
const variant = process.argv[2]
const addon = process.argv[3]

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
} else if (variant === 'bun-1.4.3' || variant === 'bun-1.4.4') {
  fakeVersion('bun', variant.slice('bun-'.length))
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
} else if (variant !== 'control') {
  console.error(`unknown variant ${variant}`)
  process.exit(2)
}

const uncaught = []
process.on('uncaughtException', (error) => uncaught.push(String(error)))

const module = { exports: {} }
process.dlopen(module, addon)
for (const undo of restore) undo()
const native = module.exports

const mode = native.asyncTaskPromiseSettleMode()
const timeout = setTimeout(() => {
  console.error('AsyncTask promise still pending after 5000 ms')
  process.exit(1)
}, 5000)
const value = await native.asyncTaskCounted()
clearTimeout(timeout)
console.log(
  `settle-mode ${JSON.stringify({ mode, value, versionsRead: versionsRead > 0, uncaught })}`,
)
