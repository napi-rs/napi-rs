const testModule = require(`./target/debug/libtest_module.node`)

function testSpawn() {
  console.log('=== Test spawning a future on libuv event loop')
  return testModule.testSpawn()
}

function testThrow() {
  console.log('=== Test throwing from Rust')
  try {
    testModule.testThrow()
  } catch (e) {
    return
  }
  console.error('Expected function to throw an error')
  process.exit(1)
}

const future = testSpawn()

// https://github.com/nodejs/node/issues/29355
setTimeout(() => {
  future.then(testThrow).catch((e) => {
    console.error(e)
    process.exit(1)
  })
}, 10)
