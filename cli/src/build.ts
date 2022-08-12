import { execSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join, parse, sep } from 'path'

import { Instance } from 'chalk'
import { Command, Option } from 'clipanion'
import envPaths from 'env-paths'
import { groupBy } from 'lodash-es'
import toml from 'toml'

import { getNapiConfig } from './consts'
import { debugFactory } from './debug'
import { createJsBinding } from './js-binding-template'
import { getHostTargetTriple, parseTriple } from './parse-triple'
import {
  copyFileAsync,
  mkdirAsync,
  readFileAsync,
  unlinkAsync,
  writeFileAsync,
} from './utils'

const debug = debugFactory('build')
const chalk = new Instance({ level: 1 })

const ZIG_PLATFORM_TARGET_MAP = {
  'x86_64-unknown-linux-musl': 'x86_64-linux-musl',
  'x86_64-unknown-linux-gnu': 'x86_64-linux-gnu',
  // Doesn't support Windows MSVC for now
  // 'x86_64-pc-windows-gnu': 'x86_64-windows-gnu',
  // https://github.com/ziglang/zig/issues/1759
  // 'x86_64-unknown-freebsd': 'x86_64-freebsd',
  'x86_64-apple-darwin': 'x86_64-macos-gnu',
  'aarch64-apple-darwin': 'aarch64-macos-gnu',
  'aarch64-unknown-linux-gnu': 'aarch64-linux-gnu',
  'aarch64-unknown-linux-musl': 'aarch64-linux-musl',
}

function processZigLinkerArgs(platform: string, args: string[]) {
  if (platform.includes('apple')) {
    const newArgs = args.filter(
      (arg, index) =>
        !arg.startsWith('-Wl,-exported_symbols_list') &&
        arg !== '-Wl,-dylib' &&
        arg !== '-liconv' &&
        arg !== '-Wl,-dead_strip' &&
        !(arg === '-framework' && args[index + 1] === 'CoreFoundation') &&
        !(arg === 'CoreFoundation' && args[index - 1] === '-framework'),
    )
    newArgs.push('-Wl,"-undefined=dynamic_lookup"', '-dead_strip')
    return newArgs
  }
  if (platform.includes('linux')) {
    return args.map((arg) => {
      if (arg === '-lgcc_s') {
        return '-lunwind'
      }
      return arg
    })
  }
  return args
}

export class BuildCommand extends Command {
  static usage = Command.Usage({
    description: 'Build and copy native module into specified dir',
  })

  static paths = [['build']]

  appendPlatformToFilename = Option.Boolean(`--platform`, false, {
    description: `Add platform triple to the .node file. ${chalk.green(
      '[name].linux-x64-gnu.node',
    )} for example`,
  })

  isRelease = Option.Boolean(`--release`, false, {
    description: `Bypass to ${chalk.green('cargo build --release')}`,
  })

  configFileName?: string = Option.String('--config,-c', {
    description: `napi config path, only JSON format accepted. Default to ${chalk.underline(
      chalk.green('package.json'),
    )}`,
  })

  cargoName?: string = Option.String('--cargo-name', {
    description: `Override the ${chalk.green(
      'name',
    )} field in ${chalk.underline(chalk.yellowBright('Cargo.toml'))}`,
  })

  targetTripleDir = Option.String(
    '--target',
    process.env.RUST_TARGET ?? process.env.CARGO_BUILD_TARGET ?? '',
    {
      description: `Bypass to ${chalk.green('cargo build --target')}`,
    },
  )

  features?: string = Option.String('--features', {
    description: `Bypass to ${chalk.green('cargo build --features')}`,
  })

  bin?: string = Option.String('--bin', {
    description: `Bypass to ${chalk.green('cargo build --bin')}`,
  })

  dts?: string = Option.String('--dts', 'index.d.ts', {
    description: `The filename and path of ${chalk.green(
      '.d.ts',
    )} file, relative to cwd`,
  })

  noDtsHeader = Option.Boolean('--no-dts-header', false, {
    description: `Don't generate ${chalk.green('.d.ts')} header`,
  })

  project = Option.String('-p', {
    description: `Bypass to ${chalk.green('cargo -p')}`,
  })

  cargoFlags = Option.String('--cargo-flags', '', {
    description: `All the others flag passed to ${chalk.yellow('cargo build')}`,
  })

  jsBinding = Option.String('--js', 'index.js', {
    description: `Path to the JS binding file, pass ${chalk.underline(
      chalk.yellow('false'),
    )} to disable it. Only affect if ${chalk.green('--target')} is specified.`,
  })

  jsPackageName = Option.String('--js-package-name', {
    description: `Package name in generated js binding file, Only affect if ${chalk.green(
      '--target',
    )} specified and ${chalk.green('--js')} is not false.`,
    required: false,
  })

  cargoCwd?: string = Option.String('--cargo-cwd', {
    description: `The cwd of ${chalk.underline(
      chalk.yellow('Cargo.toml'),
    )} file`,
  })

  pipe?: string = Option.String('--pipe', {
    description: `Pipe [${chalk.green(
      '.js/.ts',
    )}] files to this command, eg ${chalk.green('prettier -w')}`,
  })

  // https://github.com/napi-rs/napi-rs/issues/297
  disableWindowsX32Optimize?: boolean = Option.Boolean(
    '--disable-windows-x32-optimize',
    false,
    {
      description: `Disable windows x32 ${chalk.green(
        'lto',
      )} and increase ${chalk.green(
        'codegen-units',
      )}. Enabled by default. See ${chalk.underline.blue(
        'https://github.com/napi-rs/napi-rs/issues/297',
      )}`,
    },
  )

  destDir = Option.String({
    required: false,
  })

  useZig = Option.Boolean(`--zig`, false, {
    description: `Use ${chalk.green('zig')} as linker ${chalk.yellowBright(
      '(Experimental)',
    )}`,
  })

  zigABIVersion = Option.String(`--zig-abi-suffix`, {
    description: `The suffix of the ${chalk.green(
      'zig --target',
    )} ABI version. Eg. ${chalk.cyan(
      '--target x86_64-unknown-linux-gnu',
    )} ${chalk.green('--zig-abi-suffix=2.17')}`,
  })

  isStrip = Option.Boolean(`--strip`, false, {
    description: `${chalk.green('Strip')} the library for minimum file size`,
  })

  async execute() {
    const cwd = this.cargoCwd
      ? join(process.cwd(), this.cargoCwd)
      : process.cwd()

    let tomlContentString: string
    let tomlContent: any
    try {
      debug('Start read toml')
      tomlContentString = await readFileAsync(join(cwd, 'Cargo.toml'), 'utf-8')
    } catch {
      throw new TypeError(`Could not find Cargo.toml in ${cwd}`)
    }

    try {
      debug('Start parse toml')
      tomlContent = toml.parse(tomlContentString)
    } catch {
      throw new TypeError('Could not parse the Cargo.toml')
    }

    let cargoPackageName: string
    if (tomlContent.package?.name) {
      cargoPackageName = tomlContent.package.name
    } else if (this.cargoName) {
      cargoPackageName = this.cargoName
    } else {
      throw new TypeError('No package.name field in Cargo.toml')
    }

    const cargoMetadata = JSON.parse(
      execSync('cargo metadata --format-version 1', {
        stdio: 'pipe',
        maxBuffer: 1024 * 1024 * 10,
      }).toString('utf8'),
    )
    const packages = cargoMetadata.packages
    const cargoPackage = packages.find(
      (p: { name: string }) => p.name === cargoPackageName,
    )
    if (
      !this.bin &&
      cargoPackage?.targets?.length === 1 &&
      cargoPackage?.targets[0].kind.length === 1 &&
      cargoPackage?.targets[0].kind[0] === 'bin'
    ) {
      this.bin = cargoPackageName
    }
    const releaseFlag = this.isRelease ? `--release` : ''

    const targetFlag = this.targetTripleDir
      ? `--target ${this.targetTripleDir}`
      : ''
    const featuresFlag = this.features ? `--features ${this.features}` : ''
    const binFlag = this.bin ? `--bin ${this.bin}` : ''
    const triple = this.targetTripleDir
      ? parseTriple(this.targetTripleDir)
      : getHostTargetTriple()
    debug(`Current triple is: ${chalk.green(triple.raw)}`)
    const pFlag = this.project ? `-p ${this.project}` : ''
    const externalFlags = [
      releaseFlag,
      targetFlag,
      featuresFlag,
      binFlag,
      pFlag,
      this.cargoFlags,
    ]
      .filter((flag) => Boolean(flag))
      .join(' ')
    const cargo = process.env.CARGO ?? 'cargo'
    const cargoCommand = `${cargo} build ${externalFlags}`
    const intermediateTypeFile = join(tmpdir(), `type_def.${Date.now()}.tmp`)
    debug(`Run ${chalk.green(cargoCommand)}`)
    const additionalEnv = {}

    const rustflags = process.env.RUSTFLAGS
      ? process.env.RUSTFLAGS.split(' ')
      : []
    if (triple.raw.includes('musl') && !this.bin) {
      if (!rustflags.includes('target-feature=-crt-static')) {
        rustflags.push('-C target-feature=-crt-static')
      }
    }

    if (this.isStrip && !rustflags.includes('-C link-arg=-s')) {
      rustflags.push('-C link-arg=-s')
    }

    if (rustflags.length > 0) {
      additionalEnv['RUSTFLAGS'] = rustflags.join(' ')
    }

    if (this.useZig) {
      const zigTarget = `${ZIG_PLATFORM_TARGET_MAP[triple.raw]}${
        this.zigABIVersion ? `.${this.zigABIVersion}` : ''
      }`
      if (!zigTarget) {
        throw new Error(`${triple.raw} can not be cross compiled by zig`)
      }
      const paths = envPaths('napi-rs')
      const shellFileExt = process.platform === 'win32' ? 'bat' : 'sh'
      const linkerWrapperShell = join(
        paths.cache,
        `zig-linker-${triple.raw}.${shellFileExt}`,
      )
      const CCWrapperShell = join(
        paths.cache,
        `zig-cc-${triple.raw}.${shellFileExt}`,
      )
      const CXXWrapperShell = join(
        paths.cache,
        `zig-cxx-${triple.raw}.${shellFileExt}`,
      )
      const linkerWrapper = join(paths.cache, `zig-cc-${triple.raw}.js`)
      mkdirSync(paths.cache, { recursive: true })
      const forwardArgs = process.platform === 'win32' ? '%*' : '$@'
      await writeFileAsync(
        linkerWrapperShell,
        `#!/bin/sh\nnode ${linkerWrapper} ${forwardArgs}`,
        {
          mode: '777',
        },
      )
      await writeFileAsync(
        CCWrapperShell,
        `#!/bin/sh\nzig cc -target ${zigTarget} ${forwardArgs}`,
        {
          mode: '777',
        },
      )
      await writeFileAsync(
        CXXWrapperShell,
        `#!/bin/sh\nzig c++ -target ${zigTarget} ${forwardArgs}`,
        {
          mode: '777',
        },
      )
      await writeFileAsync(
        linkerWrapper,
        `#!/usr/bin/env node\nconst{writeFileSync} = require('fs')\n${processZigLinkerArgs.toString()}\nconst {status} = require('child_process').spawnSync('zig', ['${
          triple.platform === 'win32' ? 'c++' : 'cc'
        }', ...processZigLinkerArgs('${
          triple.raw
        }', process.argv.slice(2)), '-target', '${zigTarget}'], { stdio: 'inherit', shell: true })\nwriteFileSync('${linkerWrapper.replaceAll(
          '\\',
          '/',
        )}.args.log', process.argv.slice(2).join(' '))\n\nprocess.exit(status || 0)\n`,
        {
          mode: '777',
        },
      )
      const envTarget = triple.raw.replaceAll('-', '_').toUpperCase()
      Object.assign(additionalEnv, {
        CC: CCWrapperShell,
        CXX: CXXWrapperShell,
        TARGET_CC: CCWrapperShell,
        TARGET_CXX: CXXWrapperShell,
      })
      additionalEnv[`CARGO_TARGET_${envTarget}_LINKER`] = linkerWrapperShell
    }

    execSync(cargoCommand, {
      env: {
        ...process.env,
        ...additionalEnv,
        TYPE_DEF_TMP_PATH: intermediateTypeFile,
      },
      stdio: 'inherit',
      cwd,
    })
    const { binaryName, packageName } = getNapiConfig(this.configFileName)
    let cargoArtifactName = this.cargoName
    if (!cargoArtifactName) {
      if (this.bin) {
        cargoArtifactName = cargoPackageName
      } else {
        cargoArtifactName = cargoPackageName.replace(/-/g, '_')
      }

      if (!this.bin && !tomlContent.lib?.['crate-type']?.includes?.('cdylib')) {
        throw new TypeError(
          `Missing ${chalk.green('crate-type = ["cdylib"]')} in ${chalk.green(
            '[lib]',
          )}`,
        )
      }
    }

    if (this.bin) {
      debug(`Binary name: ${chalk.greenBright(cargoArtifactName)}`)
    } else {
      debug(`Dylib name: ${chalk.greenBright(cargoArtifactName)}`)
    }

    const platform = triple.platform
    let libExt = ''

    debug(`Platform: ${chalk.greenBright(platform)}`)

    // Platform based massaging for build commands
    if (!this.bin) {
      switch (platform) {
        case 'darwin':
          libExt = '.dylib'
          cargoArtifactName = `lib${cargoArtifactName}`
          break
        case 'win32':
          libExt = '.dll'
          break
        case 'linux':
        case 'freebsd':
        case 'openbsd':
        case 'android':
        case 'sunos':
          cargoArtifactName = `lib${cargoArtifactName}`
          libExt = '.so'
          break
        default:
          throw new TypeError(
            'Operating system not currently supported or recognized by the build script',
          )
      }
    }

    const targetRootDir =
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      process.env.CARGO_TARGET_DIR ||
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      process.env.CARGO_BUILD_TARGET_DIR ||
      (await findUp(cwd))

    if (!targetRootDir) {
      throw new TypeError('No target dir found')
    }

    const targetDir = join(
      this.targetTripleDir,
      this.isRelease ? 'release' : 'debug',
    )

    const platformName = this.appendPlatformToFilename
      ? `.${triple.platformArchABI}`
      : ''

    debug(`Platform name: ${platformName || chalk.green('[Empty]')}`)
    const distFileName = this.bin
      ? cargoArtifactName!
      : `${binaryName}${platformName}.node`

    const distModulePath = join(this.destDir ?? '.', distFileName)

    const parsedDist = parse(distModulePath)

    if (parsedDist.dir && !existsSync(parsedDist.dir)) {
      await mkdirAsync(parsedDist.dir, { recursive: true }).catch((e) => {
        console.warn(
          chalk.bgYellowBright(
            `Create dir [${parsedDist.dir}] failed, reason: ${e.message}`,
          ),
        )
      })
    }

    const sourcePath = join(
      targetRootDir,
      'target',
      targetDir,
      `${cargoArtifactName}${libExt}`,
    )

    if (existsSync(distModulePath)) {
      debug(`remove old binary [${chalk.yellowBright(distModulePath)}]`)
      await unlinkAsync(distModulePath)
    }

    debug(`Write binary content to [${chalk.yellowBright(distModulePath)}]`)
    await copyFileAsync(sourcePath, distModulePath)

    if (!this.bin) {
      const dtsFilePath = join(
        process.cwd(),
        this.destDir ?? '.',
        this.dts ?? 'index.d.ts',
      )

      if (this.pipe) {
        const pipeCommand = `${this.pipe} ${dtsFilePath}`
        console.info(`Run ${chalk.green(pipeCommand)}`)
        try {
          execSync(pipeCommand, { stdio: 'inherit', env: process.env })
        } catch (e) {
          console.warn(
            chalk.bgYellowBright('Pipe the dts file to command failed'),
            e,
          )
        }
      }
      const jsBindingFilePath =
        this.jsBinding &&
        this.jsBinding !== 'false' &&
        this.appendPlatformToFilename
          ? join(process.cwd(), this.jsBinding)
          : null
      const idents = await processIntermediateTypeFile(
        intermediateTypeFile,
        dtsFilePath,
        this.noDtsHeader,
      )
      await writeJsBinding(
        binaryName,
        this.jsPackageName ?? packageName,
        jsBindingFilePath,
        idents,
      )
      if (this.pipe && jsBindingFilePath) {
        const pipeCommand = `${this.pipe} ${jsBindingFilePath}`
        console.info(`Run ${chalk.green(pipeCommand)}`)
        try {
          execSync(pipeCommand, { stdio: 'inherit', env: process.env })
        } catch (e) {
          console.warn(
            chalk.bgYellowBright('Pipe the js binding file to command failed'),
            e,
          )
        }
      }
    }
  }
}

async function findUp(dir = process.cwd()): Promise<string | null> {
  const dist = join(dir, 'target')
  if (existsSync(dist)) {
    return dir
  }
  const dirs = dir.split(sep)
  if (dirs.length < 2) {
    return null
  }
  dirs.pop()
  return findUp(dirs.join(sep))
}

interface TypeDef {
  kind: 'fn' | 'struct' | 'impl' | 'enum' | 'interface'
  name: string
  original_name?: string
  def: string
  js_mod?: string
  js_doc: string
}

async function processIntermediateTypeFile(
  source: string,
  target: string,
  noDtsHeader: boolean,
): Promise<string[]> {
  const idents: string[] = []
  if (!existsSync(source)) {
    debug(`do not find tmp type file. skip type generation`)
    return idents
  }

  const tmpFile = await readFileAsync(source, 'utf8')
  const lines = tmpFile
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (!lines.length) {
    return idents
  }

  const allDefs = lines.map((line) => JSON.parse(line) as TypeDef)

  function convertDefs(defs: TypeDef[], nested = false): string {
    const classes = new Map<
      string,
      { def: string; js_doc: string; original_name?: string }
    >()
    const impls = new Map<string, string>()
    let dts = ''
    const nest = nested ? 2 : 0

    defs.forEach((def) => {
      switch (def.kind) {
        case 'struct':
          if (!nested) {
            idents.push(def.name)
          }
          classes.set(def.name, {
            original_name: def.original_name,
            def: def.def,
            js_doc: def.js_doc,
          })
          break
        case 'impl':
          const existed = impls.get(def.name)
          impls.set(
            def.name,
            `${existed ? existed + '\n' : ''}${def.js_doc}${def.def}`,
          )
          break
        case 'interface':
          dts +=
            indentLines(`${def.js_doc}export interface ${def.name} {`, nest) +
            '\n'
          dts += indentLines(def.def, nest + 2) + '\n'
          dts += indentLines(`}`, nest) + '\n'
          break
        case 'enum':
          if (!nested) {
            idents.push(def.name)
          }
          dts +=
            indentLines(`${def.js_doc}export const enum ${def.name} {`, nest) +
            '\n'
          dts += indentLines(def.def, nest + 2) + '\n'
          dts += indentLines(`}`, nest) + '\n'
          break
        default:
          if (!nested) {
            idents.push(def.name)
          }
          dts += indentLines(`${def.js_doc}${def.def}`, nest) + '\n'
      }
    })

    for (const [name, { js_doc, def, original_name }] of classes.entries()) {
      const implDef = impls.get(name)

      if (original_name && name !== original_name) {
        dts += indentLines(`export type ${original_name} = ${name}\n`, nest)
      }

      dts += indentLines(`${js_doc}export class ${name} {`, nest)

      if (def) {
        dts += '\n' + indentLines(def, nest + 2)
      }

      if (implDef) {
        dts += '\n' + indentLines(implDef, nest + 2)
      }

      if (def || implDef) {
        dts += '\n'
      } else {
        dts += ` `
      }

      dts += indentLines(`}`, nest) + '\n'
    }

    return dts
  }

  const topLevelDef = convertDefs(allDefs.filter((def) => !def.js_mod))

  const namespaceDefs = Object.entries(
    groupBy(
      allDefs.filter((def) => def.js_mod),
      'js_mod',
    ),
  ).reduce((acc, [mod, defs]) => {
    idents.push(mod)
    return acc + `export namespace ${mod} {\n${convertDefs(defs, true)}}\n`
  }, '')

  const dtsHeader = noDtsHeader
    ? ''
    : `/* tslint:disable */
/* eslint-disable */

/* auto-generated by NAPI-RS */\n
`

  const externalDef =
    topLevelDef.indexOf('ExternalObject<') > -1 ||
    namespaceDefs.indexOf('ExternalObject<') > -1
      ? `export class ExternalObject<T> {
  readonly '': {
    readonly '': unique symbol
    [K: symbol]: T
  }
}\n`
      : ''

  await unlinkAsync(source)
  await writeFileAsync(
    target,
    dtsHeader + externalDef + topLevelDef + namespaceDefs,
    'utf8',
  )
  return idents
}

function indentLines(input: string, spaces: number) {
  return input
    .split('\n')
    .map(
      (line) =>
        ''.padEnd(spaces, ' ') +
        (line.startsWith(' *') ? line.trimEnd() : line.trim()),
    )
    .join('\n')
}

async function writeJsBinding(
  localName: string,
  packageName: string,
  distFileName: string | null,
  idents: string[],
) {
  if (distFileName && idents.length) {
    const template = createJsBinding(localName, packageName)
    const declareCodes = `const { ${idents.join(', ')} } = nativeBinding\n`
    const exportsCode = idents.reduce(
      (acc, cur) => `${acc}\nmodule.exports.${cur} = ${cur}`,
      '',
    )
    await writeFileAsync(
      distFileName,
      template + declareCodes + exportsCode + '\n',
      'utf8',
    )
  }
}
