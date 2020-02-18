#!/usr/bin/env node

const parseArgs = require('minimist')
const cp = require('child_process')
const path = require('path')
const os = require('os')
const parsedNodeVersion = process.versions.node.match(/^(\d+)\.(\d+)\.(\d+)$/)
const nodeMajorVersion = parseInt(parsedNodeVersion[1])

if (nodeMajorVersion < 10) {
  console.error('This build script should be run on Node 10 or greater')
  process.exit(1)
}

const argv = parseArgs(process.argv.slice(2), {
  boolean: ['release'],
})

const subcommand = argv._[0] || 'build'

const moduleName = path.basename(process.cwd()).replace(/-/g, '_')

const platform = os.platform()
let libExt, platformArgs

// Platform based massaging for build commands
switch (platform) {
  case 'darwin':
    libExt = '.dylib'
    platformArgs = '-undefined dynamic_lookup -export_dynamic'
    break
  case 'win32':
    libExt = '.dll'
    platformArgs = '-undefined dynamic_lookup -export_dynamic'
    break
  case 'linux':
    libExt = '.so'
    platformArgs = '-undefined=dynamic_lookup -export_dynamic'
    break
  default:
    console.error(
      'Operating system not currently supported or recognized by the build script',
    )
    process.exit(1)
}

switch (subcommand) {
  case 'build':
    const releaseFlag = argv.release ? '--release' : ''
    const targetDir = argv.release ? 'release' : 'debug'
    cp.execSync(
      `cargo rustc ${releaseFlag} -- -Clink-args=\"${platformArgs}\"`,
      { stdio: 'inherit' },
    )
    cp.execSync(`mkdir -p target/${targetDir}`)
    cp.execSync(
      `cp ${path.join(
        process.cwd(),
        'target',
        targetDir,
        'lib' + moduleName + libExt,
      )}  target/${targetDir}/${moduleName}.node`,
      { stdio: 'inherit' },
    )
    break
  case 'check':
    cp.execSync(`cargo check`, { stdio: 'inherit' })
  case 'doc':
    cp.execSync(`cargo doc`, { stdio: 'inherit' })
}
