// this is just a simple wrapper for napi-cli for easier in-repo usage
// do not publish it.
const { execSync } = require('child_process')
const { existsSync } = require('fs')
const { platform } = require('os')
const { join } = require('path')

const bin_path = join(
  __dirname,
  '../../',
  'target',
  'debug',
  `napi${platform() === 'win32' ? '.exe' : ''}`,
)

const cmd = existsSync(bin_path) ? bin_path : 'cargo run -p napi-cli --'

execSync(`${cmd} ${process.argv.slice(2).join(' ')}`, {
  shell: true,
  stdio: 'inherit',
})
