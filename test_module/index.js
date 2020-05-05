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

const future = testSpawn()

future
  .then((value) => {
    console.info(`${value} from napi`)
    testThrow()
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
