const testModule = require('./index.node')

function testSpawn() {
  console.log('=== Test spawning a future on libuv event loop')
  return testModule.testSpawn()
}

function testThrow() {
  console.log('=== Test throwing from Rust')
  try {
    testModule.testThrow()
    console.log('Expected function to throw an error')
    process.exit(1)
  } catch (e) {
    console.log(e)
  }
}
testSpawn()
  .then((value) => {
    console.info(`${value} from napi`)
    testThrow()
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
