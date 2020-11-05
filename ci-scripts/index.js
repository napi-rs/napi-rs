const childProcess = require('child_process')
const yargs = require('yargs')
const toml = require('toml')
const fs = require('fs')

let napiVersion = process.env['USE_NAPI_VERSION'] || process.versions.napi

const argv = yargs
  .command('build', 'Builds a module', {}, build)
  .command(
    'cargo-check-all',
    'Runs cargo check on all crates',
    {},
    cargoCheckAll,
  ).argv

function build(args) {
  childProcess.execSync(`cargo build --features=napi${napiVersion}`)
}

function cargoCheckAll(args) {
  let topLevelTomlString = fs.readFileSync('./Cargo.toml')
  let topLevelToml = toml.parse(topLevelTomlString)
  let workspaceMembers = topLevelToml.workspace.members

  for (let i = 0; i < workspaceMembers.length; i++) {
    let member = workspaceMembers[i]
    let command = `cargo check --manifest-path ${member}/Cargo.toml --bins --examples --tests -vvv`

    if (member === './napi')
      command += ` --no-default-features --features=napi${napiVersion}`

    console.log('Running: ' + command)

    childProcess.execSync(command)
  }
}
