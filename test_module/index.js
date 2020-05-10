const testModule = require('./index.node')

function testSpawn() {
  console.log('=== Test spawning a future on libuv event loop')
  return testModule.testSpawn()
}

function testThrow() {
  console.log('=== Test throwing from Rust')
  try {
    testModule.testThrow()
    console.error('Expected function to throw an error')
    process.exit(1)
  } catch (e) {
    console.error(e)
  }
}

function testSpawnThread(n) {
  console.info('=== Test spawn task to threadpool')
  return testModule.testSpawnThread(n)
}

const future = testSpawn()

future
  .then((value) => {
    console.info(`${value} from napi`)
    testThrow()
  })
  .then(() => testSpawnThread(20))
  .then((value) => {
    console.assert(value === 6765)
    console.info('=== fibonacci result', value)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
