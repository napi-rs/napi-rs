#!/usr/bin/env node

const parseArgs = require('minimist')
const path = require('path')
const os = require('os')
const toml = require('toml')
const fs = require('fs')

let tomlContentString
let tomlContent
let moduleName

try {
  tomlContentString = fs.readFileSync(path.join(process.cwd(), 'Cargo.toml'), 'utf-8')
} catch {
  throw new TypeError('Can not find Cargo.toml in process.cwd')
}

try {
  tomlContent = toml.parse(tomlContentString)
} catch {
  throw new TypeError('Can not parse the Cargo.toml')
}

if (tomlContent.package && tomlContent.package.name) {
  moduleName = tomlContent.package.name.replace(/-/g, '_')
} else {
  throw new TypeError('No package.name field in Cargo.toml')
}

const argv = parseArgs(process.argv.slice(2), {
  boolean: ['release'],
})

const platform = os.platform()
let libExt
let dylibName = moduleName

// Platform based massaging for build commands
switch (platform) {
  case 'darwin':
    libExt = '.dylib'
    dylibName = `lib${moduleName}`
    break
  case 'win32':
    libExt = '.dll'
    break
  case 'linux':
    dylibName = `lib${moduleName}`
    libExt = '.so'
    break
  default:
    console.error(
      'Operating system not currently supported or recognized by the build script',
    )
    process.exit(1)
}

const targetDir = argv.release ? 'release' : 'debug'

let subcommand = argv._[0] || path.join('target', targetDir, `${moduleName}.node`)
const parsedDist = path.parse(subcommand)

if (parsedDist.ext && parsedDist.ext !== '.node') {
  throw new TypeError('Dist file must be end with .node extension')
}

if (!parsedDist.name || parsedDist.name === '.') {
  subcommand = moduleName
}

if (!parsedDist.ext) {
  subcommand = `${subcommand}.node`
}

const pos = __dirname.indexOf('node_modules')

const dylibContent = fs.readFileSync(path.join(
  __dirname.substring(0, pos),
  'target',
  targetDir,
  `${dylibName}${libExt}`,
))

fs.writeFileSync(subcommand, dylibContent)
