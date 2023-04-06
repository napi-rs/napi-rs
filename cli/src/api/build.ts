import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { tmpdir } from 'os'
import { parse, join, resolve } from 'path'

import * as colors from 'colorette'

import { BuildOptions as RawBuildOptions } from '../def/build.js'
import {
  CLI_VERSION,
  copyFileAsync,
  Crate,
  debugFactory,
  DEFAULT_TYPE_DEF_HEADER,
  fileExists,
  getSystemDefaultTarget,
  getTargetLinker,
  mkdirAsync,
  NapiConfig,
  parseMetadata,
  parseTriple,
  processTypeDef,
  readNapiConfig,
  Target,
  targetToEnvVar,
  tryInstallCargoBinary,
  unlinkAsync,
  writeFileAsync,
} from '../utils/index.js'

import { createJsBinding } from './templates/index.js'

const debug = debugFactory('build')

type OutputKind = 'js' | 'dts' | 'node' | 'exe'
type Output = {
  kind: OutputKind
  path: string
}

type BuildOptions = RawBuildOptions & {
  cargoOptions?: string[]
}

export async function buildProject(options: BuildOptions) {
  debug('napi build command receive options: %O', options)

  const cwd = options.cwd ?? process.cwd()

  const resolvePath = (...paths: string[]) => resolve(cwd, ...paths)

  const manifestPath = resolvePath(options.manifestPath ?? 'Cargo.toml')
  const metadata = parseMetadata(manifestPath)

  const pkg = metadata.packages.find((p) => {
    // package with given name
    if (options.package) {
      return p.name === options.package
    } else {
      return p.manifest_path === manifestPath
    }
  })

  if (!pkg) {
    throw new Error(
      'Unable to find crate to build. It seems you are trying to build a crate in a workspace, try using `--package` option to specify the package to build.',
    )
  }

  const crateDir = parse(pkg.manifest_path).dir

  const builder = new Builder(
    options,
    pkg,
    cwd,
    options.target
      ? parseTriple(options.target)
      : process.env.CARGO_BUILD_TARGET
      ? parseTriple(process.env.CARGO_BUILD_TARGET)
      : getSystemDefaultTarget(),
    crateDir,
    resolvePath(options.outputDir ?? crateDir),
    options.targetDir ??
      process.env.CARGO_BUILD_TARGET_DIR ??
      metadata.target_directory,
    await readNapiConfig(
      resolvePath(options.packageJsonPath ?? 'package.json'),
    ),
  )

  return builder.build()
}

class Builder {
  private readonly args: string[] = []
  private readonly envs: Record<string, string> = {}
  private readonly outputs: Output[] = []

  constructor(
    private readonly options: BuildOptions,
    private readonly crate: Crate,
    private readonly cwd: string,
    private readonly target: Target,
    private readonly crateDir: string,
    private readonly outputDir: string,
    private readonly targetDir: string,
    private readonly config: NapiConfig,
  ) {}

  get cdyLibName() {
    return this.crate.targets.find((t) => t.crate_types.includes('cdylib'))
      ?.name
  }

  get binName() {
    return (
      this.options.bin ??
      // only available if not cdylib or bin name specified
      (this.cdyLibName
        ? null
        : this.crate.targets.find((t) => t.crate_types.includes('bin'))?.name)
    )
  }

  build() {
    if (!this.cdyLibName) {
      const warning =
        'Missing `crate-type = ["cdylib"]` in [lib] config. The build result will not be available as node addon.'

      if (this.binName) {
        debug.warn(warning)
      } else {
        throw new Error(warning)
      }
    }

    return this.pickBinary()
      .setPackage()
      .setFeatures()
      .setTarget()
      .setEnvs()
      .setBypassArgs()
      .exec()
  }

  private exec() {
    debug(`Start building crate: ${this.crate.name}`)
    debug('  %i', `cargo ${this.args.join(' ')}`)

    const controller = new AbortController()

    const buildTask = new Promise<void>((resolve, reject) => {
      const buildProcess = spawn('cargo', this.args, {
        env: {
          ...process.env,
          ...this.envs,
        },
        stdio: 'inherit',
        cwd: this.cwd,
        signal: controller.signal,
      })

      buildProcess.once('exit', (code) => {
        if (code === 0) {
          debug('%i', `Build crate ${this.crate.name} successfully!`)
          resolve()
        } else {
          reject(new Error(`Build failed with exit code ${code}`))
        }
      })

      buildProcess.once('error', (e) => {
        reject(
          new Error(`Build failed with error: ${e.message}`, {
            cause: e,
          }),
        )
      })
    })

    return {
      task: buildTask.then(() => this.postBuild()),
      abort: () => controller.abort(),
    }
  }

  private pickBinary() {
    let set = false
    if (this.options.watch) {
      if (process.env.CI) {
        debug.warn('Watch mode is not supported in CI environment')
      } else {
        debug('Use %i', 'cargo-watch')
        tryInstallCargoBinary('cargo-watch', 'watch')
        // yarn napi watch --target x86_64-unknown-linux-gnu [--cross-compile]
        // ===>
        // cargo watch [...] -- build --target x86_64-unknown-linux-gnu
        // cargo watch [...] -- zigbuild --target x86_64-unknown-linux-gnu
        this.args.push(
          'watch',
          '--why',
          '-i',
          '*.{js,ts,node}',
          '-w',
          this.crateDir,
          '--',
          'cargo',
        )
        set = true
      }
    }

    if (this.options.crossCompile) {
      if (this.target.platform === 'win32') {
        if (process.platform === 'win32') {
          debug.warn(
            'You are trying to cross compile to win32 platform on win32 platform which is unnecessary.',
          )
        } else {
          // use cargo-xwin to cross compile to win32 platform
          debug('Use %i', 'cargo-xwin')
          tryInstallCargoBinary('cargo-xwin', 'xwin')
          this.args.push('xwin', 'build')
          if (this.target.arch === 'ia32') {
            this.envs.XWIN_ARCH = 'x86'
          }
          set = true
        }
      } else {
        if (
          this.target.platform === 'linux' &&
          process.platform === 'linux' &&
          this.target.arch === process.arch &&
          (function (abi: string | null) {
            const glibcVersionRuntime =
              // @ts-expect-error
              process.report?.getReport()?.header?.glibcVersionRuntime
            const libc = glibcVersionRuntime ? 'gnu' : 'musl'
            return abi === libc
          })(this.target.abi)
        ) {
          debug.warn(
            'You are trying to cross compile to linux target on linux platform which is unnecessary.',
          )
        } else if (
          this.target.platform === 'darwin' &&
          process.platform === 'darwin'
        ) {
          debug.warn(
            'You are trying to cross compile to darwin target on darwin platform which is unnecessary.',
          )
        } else {
          // use cargo-zigbuild to cross compile to other platforms
          debug('Use %i', 'cargo-zigbuild')
          tryInstallCargoBinary('cargo-zigbuild', 'zigbuild')
          this.args.push('zigbuild')
          set = true
        }
      }
    }

    if (!set) {
      this.args.push('build')
    }
    return this
  }

  private setPackage() {
    const args = []

    if (this.options.package) {
      args.push('--package', this.options.package)
    }

    if (this.binName) {
      args.push('--bin', this.binName)
    }

    if (args.length) {
      debug('Set package flags: ')
      debug('  %O', args)
      this.args.push(...args)
    }

    return this
  }

  private setTarget() {
    debug('Set compiling target to: ')
    debug('  %i', this.target.triple)

    this.args.push('--target', this.target.triple)

    return this
  }

  private setEnvs() {
    // type definition intermediate file
    this.envs.TYPE_DEF_TMP_PATH = this.getIntermediateTypeFile()
    this.envs.CARGO_CFG_NAPI_RS_CLI_VERSION = CLI_VERSION

    // RUSTFLAGS
    let rustflags =
      process.env.RUSTFLAGS ?? process.env.CARGO_BUILD_RUSTFLAGS ?? ''

    if (
      this.target.abi?.includes('musl') &&
      !rustflags.includes('target-feature=-crt-static')
    ) {
      rustflags += ' -C target-feature=-crt-static'
    }

    if (this.options.strip && !rustflags.includes('link-arg=-s')) {
      rustflags += ' -C link-arg=-s'
    }

    if (rustflags.length) {
      this.envs.RUSTFLAGS = rustflags
    }
    // END RUSTFLAGS

    // LINKER
    const linker = getTargetLinker(this.target.triple)
    if (
      linker &&
      !process.env.RUSTC_LINKER &&
      !process.env[`CARGET_TARGET_${targetToEnvVar(this.target.triple)}_LINKER`]
    ) {
      this.envs.RUSTC_LINKER = linker
    }

    if (this.target.platform === 'android') {
      const { ANDROID_NDK_LATEST_HOME } = process.env
      if (!ANDROID_NDK_LATEST_HOME) {
        debug.warn(
          `${colors.red(
            'ANDROID_NDK_LATEST_HOME',
          )} environment variable is missing`,
        )
      }

      const targetArch = this.target.arch === 'arm' ? 'armv7a' : 'aarch64'
      const targetPlatform =
        this.target.arch === 'arm' ? 'androideabi24' : 'android24'
      Object.assign(this.envs, {
        CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/linux-x86_64/bin/${targetArch}-linux-android24-clang`,
        CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/linux-x86_64/bin/${targetArch}-linux-androideabi24-clang`,
        CC: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/linux-x86_64/bin/${targetArch}-linux-${targetPlatform}-clang`,
        CXX: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/linux-x86_64/bin/${targetArch}-linux-${targetPlatform}-clang++`,
        AR: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-ar`,
        ANDROID_NDK: ANDROID_NDK_LATEST_HOME,
        PATH: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/linux-x86_64/bin:${process.env.PATH}`,
      })
    }
    // END LINKER

    debug('Set envs: ')
    Object.entries(this.envs).forEach(([k, v]) => {
      debug('  %i', `${k}=${v}`)
    })

    return this
  }

  private setFeatures() {
    const args = []
    if (this.options.allFeatures) {
      args.push('--all-features')
    } else if (this.options.noDefaultFeatures) {
      args.push('--no-default-features')
    } else if (this.options.features) {
      args.push('--features', ...this.options.features)
    }

    debug('Set features flags: ')
    debug('  %O', args)
    this.args.push(...args)

    return this
  }

  private setBypassArgs() {
    if (this.options.release) {
      this.args.push('--release')
    }

    if (this.options.verbose) {
      this.args.push('--verbose')
    }

    if (this.options.targetDir) {
      this.args.push('--target-dir', this.options.targetDir)
    }

    if (this.options.cargoOptions?.length) {
      this.args.push(...this.options.cargoOptions)
    }

    return this
  }

  private getIntermediateTypeFile() {
    return join(
      tmpdir(),
      `${this.crate.name}-${createHash('sha256')
        .update(this.crate.manifest_path)
        .update(CLI_VERSION)
        .digest('hex')
        .substring(0, 8)}.napi_type_def.tmp`,
    )
  }

  private async postBuild() {
    try {
      debug(`Try to create output directory:`)
      debug('  %i', this.outputDir)
      await mkdirAsync(this.outputDir, { recursive: true })
      debug(`Output directory created`)
    } catch (e) {
      throw new Error(`Failed to create output directory ${this.outputDir}`, {
        cause: e,
      })
    }

    await this.copyArtifact()

    // only for cdylib
    if (this.cdyLibName) {
      await this.generateTypeDef()
      await this.writeJsBinding()
    }

    return this.outputs
  }

  private async copyArtifact() {
    const [srcName, destName] = this.getArtifactNames()
    if (!srcName || !destName) {
      return
    }

    const src = join(
      this.targetDir,
      this.target.triple,
      this.options.release ? 'release' : 'debug',
      srcName,
    )
    const dest = join(this.outputDir, destName)

    try {
      if (await fileExists(dest)) {
        debug('Old artifact found, remove it first')
        await unlinkAsync(dest)
      }
      debug('Copy artifact to:')
      debug('  %i', dest)
      await copyFileAsync(src, dest)
      this.outputs.push({
        kind: dest.endsWith('.node') ? 'node' : 'exe',
        path: dest,
      })
    } catch (e) {
      throw new Error('Failed to copy artifact', {
        cause: e,
      })
    }
  }

  private getArtifactNames() {
    if (this.cdyLibName) {
      const cdyLib = this.cdyLibName.replace(/-/g, '_')

      const srcName =
        this.target.platform === 'darwin'
          ? `lib${cdyLib}.dylib`
          : this.target.platform === 'win32'
          ? `${cdyLib}.dll`
          : `lib${cdyLib}.so`

      let destName = this.config.binaryName
      // add platform suffix to binary name
      // index[.linux-x64-gnu].node
      //       ^^^^^^^^^^^^^^
      if (this.options.platform) {
        destName += `.${this.target.platformArchABI}`
      }
      destName += '.node'

      return [srcName, destName]
    } else if (this.binName) {
      const srcName =
        this.target.platform === 'win32' ? `${this.binName}.exe` : this.binName

      return [srcName, srcName]
    }

    return []
  }

  private async generateTypeDef() {
    if (!(await fileExists(this.envs.TYPE_DEF_TMP_PATH))) {
      return
    }

    const dest = join(this.outputDir, this.options.dts ?? 'index.d.ts')

    const dts = await processTypeDef(
      this.envs.TYPE_DEF_TMP_PATH,
      !this.options.noDtsHeader
        ? this.options.dtsHeader ?? DEFAULT_TYPE_DEF_HEADER
        : '',
    )

    try {
      debug('Writing type def to:')
      debug('  %i', dest)
      await writeFileAsync(dest, dts, 'utf-8')
      this.outputs.push({
        kind: 'dts',
        path: dest,
      })
    } catch (e) {
      debug.error('Failed to write type def file')
      debug.error(e as Error)
    }
  }

  private async writeJsBinding() {
    if (!this.options.platform || this.options.noJsBinding) {
      return
    }

    const dest = join(this.outputDir, this.options.jsBinding ?? 'index.js')

    const js = createJsBinding(this.config.binaryName, this.config.packageName)

    try {
      debug('Writing js binding to:')
      debug('  %i', dest)
      await writeFileAsync(dest, js, 'utf-8')
      this.outputs.push({
        kind: 'js',
        path: dest,
      })
    } catch (e) {
      throw new Error('Failed to write js binding file', { cause: e })
    }
  }
}
