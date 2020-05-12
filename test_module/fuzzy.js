const { exec } = require('child_process')

Array.from({ length: 500 })
  .reduce(async (acc) => {
    await acc
    await run()
  }, null)
  .then(() => {
    console.info(`Fuzzy test success, passed ${500} tests.`)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })

const run = () => {
  return new Promise((resolve, reject) => {
    const testProcess = exec('node ./spawn.js', {
      env: process.env,
    })
    testProcess.stdout.pipe(process.stdout)
    testProcess.stderr.pipe(process.stderr)
    testProcess.on('error', (err) => {
      reject(err)
    })
    testProcess.on('exit', (code) => {
      if (code) {
        reject(new TypeError(`Child process exit code ${code}`))
      } else {
        resolve()
      }
    })
  })
}
