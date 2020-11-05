const childProcess = require('child_process')
const yargs = require('yargs')

let napiVersion = process.env['USE_NAPI_VERSION']

if (!napiVersion) {
  throw 'Missing `USE_NAPI_VERSION`'
}

const argv = yargs.command('build', 'Builds a module', {}, build).argv

function build(args) {
  childProcess.execSync(`cargo build --features=napi${napiVersion}`)
}

childProcess.execSync('node ../scripts/index.js build')
