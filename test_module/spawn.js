const testModule = require('./index.node')

function testSpawnThread(n) {
  console.info('=== Test spawn task to threadpool')
  return testModule.testSpawnThread(n)
}

testSpawnThread(20)
  .then((value) => {
    console.assert(value === 6765)
    console.info('=== fibonacci result', value)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
