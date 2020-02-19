const { platform } = require('os')
const { fork } = require('child_process')

fork('./index.js', {
  stdio: 'inherit',
}).on('exit', (code) => {
  if (code !== 0) {
    if (code === 3221225477 && platform() === 'win32') {
      console.error(code)
      process.exit(0)
    }
    process.exit(code)
  }
})
