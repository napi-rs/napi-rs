import { readFile, writeFile } from 'fs'
import os from 'os'
import { join, parse } from 'path'
import { promisify } from 'util'

import { Command } from 'clipanion'
import toml from 'toml'

const readFileAsync = promisify(readFile)
const writeFileAsync = promisify(writeFile)

export class BuildCommand extends Command {
  static usage = Command.Usage({
    description: 'Copy native module into specified dir',
  })

  @Command.String(`--name`)
  name!: string

  @Command.String(`--platform`)
  appendPlatformToFilename!: string

  @Command.Boolean(`--release`)
  isRelease = false

  @Command.Boolean('--musl')
  isMusl = false

  @Command.String()
  target?: string

  @Command.Path('build')
  async execute() {
    let tomlContentString: string
    let tomlContent: any
    let moduleName: string

    try {
      tomlContentString = await readFileAsync(
        join(process.cwd(), 'Cargo.toml'),
        'utf-8',
      )
    } catch {
      throw new TypeError(`Could not find Cargo.toml in ${process.cwd()}`)
    }

    try {
      tomlContent = toml.parse(tomlContentString)
    } catch {
      throw new TypeError('Could not parse the Cargo.toml')
    }

    if (tomlContent.package ?? tomlContent.package.name) {
      moduleName = tomlContent.package.name.replace(/-/g, '_')
    } else {
      throw new TypeError('No package.name field in Cargo.toml')
    }

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

    const targetDir = this.isRelease ? 'release' : 'debug'

    const platformName = this.isMusl
      ? '.musl'
      : this.appendPlatformToFilename
      ? `.${platform}`
      : ''

    let distModulePath =
      this.target ??
      join('target', targetDir, `${moduleName}${platformName}.node`)
    const parsedDist = parse(distModulePath)

    if (!parsedDist.name || parsedDist.name === '.') {
      distModulePath = moduleName
    }

    if (!parsedDist.ext) {
      distModulePath = `${distModulePath}${platformName}.node`
    }

    const pos = __dirname.indexOf('node_modules')

    const dylibContent = await readFileAsync(
      join(
        __dirname.substring(0, pos),
        'target',
        targetDir,
        `${dylibName}${libExt}`,
      ),
    )

    await writeFileAsync(distModulePath, dylibContent)
  }
}
