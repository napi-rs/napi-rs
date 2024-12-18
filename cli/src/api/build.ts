import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir, homedir } from 'node:os'
import { parse, join, resolve } from 'node:path'

import * as colors from 'colorette'
import { include as setjmpInclude, lib as setjmpLib } from 'wasm-sjlj'

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
  readFileAsync,
  readNapiConfig,
  Target,
  targetToEnvVar,
  tryInstallCargoBinary,
  unlinkAsync,
  writeFileAsync,
} from '../utils/index.js'

import { createCjsBinding, createEsmBinding } from './templates/index.js'
import {
  createWasiBinding,
  createWasiBrowserBinding,
} from './templates/load-wasi-template.js'
import {
  createWasiBrowserWorkerBinding,
  WASI_WORKER_TEMPLATE,
} from './templates/wasi-worker-template.js'

const debug = debugFactory('build')
const require = createRequire(import.meta.url)

type OutputKind = 'js' | 'dts' | 'node' | 'exe' | 'wasm'
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
      resolvePath(
        options.configPath ?? options.packageJsonPath ?? 'package.json',
      ),
      options.configPath ? resolvePath(options.configPath) : undefined,
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
      .pickCrossToolchain()
      .setEnvs()
      .setBypassArgs()
      .exec()
  }

  private pickCrossToolchain() {
    if (!this.options.useNapiCross) {
      return this
    }
    if (this.options.useCross) {
      debug.warn(
        'You are trying to use both `--cross` and `--use-napi-cross` options, `--use-cross` will be ignored.',
      )
    }

    if (this.options.crossCompile) {
      debug.warn(
        'You are trying to use both `--cross-compile` and `--use-napi-cross` options, `--cross-compile` will be ignored.',
      )
    }

    try {
      const { version, download } = require('@napi-rs/cross-toolchain')

      const toolchainPath = join(
        homedir(),
        '.napi-rs',
        'cross-toolchain',
        version,
        this.target.triple,
      )
      mkdirSync(toolchainPath, { recursive: true })
      if (existsSync(join(toolchainPath, 'package.json'))) {
        debug(`Toolchain ${toolchainPath} exists, skip extracting`)
      } else {
        const tarArchive = download(process.arch, this.target.triple)
        tarArchive.unpack(toolchainPath)
      }
      const upperCaseTarget = targetToEnvVar(this.target.triple)
      const linkerEnv = `CARGO_TARGET_${upperCaseTarget}_LINKER`
      this.envs[linkerEnv] = join(
        toolchainPath,
        'bin',
        `${this.target.triple}-gcc`,
      )
      if (!process.env.TARGET_SYSROOT) {
        this.envs[`TARGET_SYSROOT`] = join(
          toolchainPath,
          this.target.triple,
          'sysroot',
        )
      }
      if (!process.env.TARGET_AR) {
        this.envs[`TARGET_AR`] = join(
          toolchainPath,
          'bin',
          `${this.target.triple}-ar`,
        )
      }
      if (!process.env.TARGET_RANLIB) {
        this.envs[`TARGET_RANLIB`] = join(
          toolchainPath,
          'bin',
          `${this.target.triple}-ranlib`,
        )
      }
      if (!process.env.TARGET_READELF) {
        this.envs[`TARGET_READELF`] = join(
          toolchainPath,
          'bin',
          `${this.target.triple}-readelf`,
        )
      }
      if (!process.env.TARGET_C_INCLUDE_PATH) {
        this.envs[`TARGET_C_INCLUDE_PATH`] = join(
          toolchainPath,
          this.target.triple,
          'sysroot',
          'usr',
          'include/',
        )
      }
      if (!process.env.CC && !process.env.TARGET_CC) {
        this.envs[`CC`] = join(
          toolchainPath,
          'bin',
          `${this.target.triple}-gcc`,
        )
        this.envs[`TARGET_CC`] = join(
          toolchainPath,
          'bin',
          `${this.target.triple}-gcc`,
        )
      }
      if (!process.env.CXX && !process.env.TARGET_CXX) {
        this.envs[`CXX`] = join(
          toolchainPath,
          'bin',
          `${this.target.triple}-g++`,
        )
        this.envs[`TARGET_CXX`] = join(
          toolchainPath,
          'bin',
          `${this.target.triple}-g++`,
        )
      }
      if (
        (process.env.CC === 'clang' &&
          (process.env.TARGET_CC === 'clang' || !process.env.TARGET_CC)) ||
        process.env.TARGET_CC === 'clang'
      ) {
        this.envs.CFLAGS = `--sysroot=${this.envs.TARGET_SYSROOT}`
      }
      if (
        (process.env.CXX === 'clang++' &&
          (process.env.TARGET_CXX === 'clang++' || !process.env.TARGET_CXX)) ||
        process.env.TARGET_CXX === 'clang++'
      ) {
        this.envs.CXXFLAGS = `--sysroot=${this.envs.TARGET_SYSROOT}`
      }
    } catch (e) {
      debug.warn('Pick cross toolchain failed', e as Error)
      // ignore, do nothing
    }
    return this
  }

  private exec() {
    debug(`Start building crate: ${this.crate.name}`)
    debug('  %i', `cargo ${this.args.join(' ')}`)

    const controller = new AbortController()

    const watch = this.options.watch
    const buildTask = new Promise<void>((resolve, reject) => {
      if (this.options.useCross && this.options.crossCompile) {
        throw new Error(
          '`--use-cross` and `--cross-compile` can not be used together',
        )
      }
      const command =
        process.env.CARGO ?? (this.options.useCross ? 'cross' : 'cargo')
      const buildProcess = spawn(command, this.args, {
        env: {
          ...process.env,
          ...this.envs,
        },
        stdio: watch ? ['inherit', 'inherit', 'pipe'] : 'inherit',
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

      // watch mode only, they are piped through stderr
      buildProcess.stderr?.on('data', (data) => {
        const output = data.toString()
        console.error(output)
        if (/Finished\s(dev|release)/.test(output)) {
          this.postBuild().catch(() => {})
        }
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
          'build',
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
    // WASI register intermediate file
    this.envs.WASI_REGISTER_TMP_PATH = this.getIntermediateWasiRegisterFile()
    // TODO:
    //   remove after napi-derive@v3 release
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
    const linker = this.options.crossCompile
      ? void 0
      : getTargetLinker(this.target.triple)
    // TODO:
    //   directly set CARGO_TARGET_<target>_LINKER will cover .cargo/config.toml
    //   will detect by cargo config when it becomes stable
    //   see: https://github.com/rust-lang/cargo/issues/9301
    const linkerEnv = `CARGO_TARGET_${targetToEnvVar(
      this.target.triple,
    )}_LINKER`
    if (linker && !process.env[linkerEnv]) {
      this.envs[linkerEnv] = linker
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
      const hostPlatform =
        process.platform === 'darwin'
          ? 'darwin'
          : process.platform === 'win32'
            ? 'windows'
            : 'linux'
      Object.assign(this.envs, {
        CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin/${targetArch}-linux-android24-clang`,
        CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin/${targetArch}-linux-androideabi24-clang`,
        TARGET_CC: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin/${targetArch}-linux-${targetPlatform}-clang`,
        TARGET_CXX: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin/${targetArch}-linux-${targetPlatform}-clang++`,
        TARGET_AR: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin/llvm-ar`,
        TARGET_RANLIB: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin/llvm-ranlib`,
        ANDROID_NDK: ANDROID_NDK_LATEST_HOME,
        PATH: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin:${process.env.PATH}`,
      })
    }
    // END LINKER

    if (this.target.platform === 'wasi') {
      const emnapi = join(
        require.resolve('emnapi'),
        '..',
        'lib',
        'wasm32-wasi-threads',
      )
      this.envs.EMNAPI_LINK_DIR = emnapi
      this.envs.SETJMP_LINK_DIR = setjmpLib
      const { WASI_SDK_PATH } = process.env

      if (WASI_SDK_PATH && existsSync(WASI_SDK_PATH)) {
        this.envs.CARGO_TARGET_WASM32_WASI_PREVIEW1_THREADS_LINKER = join(
          WASI_SDK_PATH,
          'bin',
          'wasm-ld',
        )
        this.envs.CARGO_TARGET_WASM32_WASIP1_LINKER = join(
          WASI_SDK_PATH,
          'bin',
          'wasm-ld',
        )
        this.envs.CARGO_TARGET_WASM32_WASIP1_THREADS_LINKER = join(
          WASI_SDK_PATH,
          'bin',
          'wasm-ld',
        )
        this.envs.CARGO_TARGET_WASM32_WASIP2_LINKER = join(
          WASI_SDK_PATH,
          'bin',
          'wasm-ld',
        )
        this.setEnvIfNotExists('CC', join(WASI_SDK_PATH, 'bin', 'clang'))
        this.setEnvIfNotExists('CXX', join(WASI_SDK_PATH, 'bin', 'clang++'))
        this.setEnvIfNotExists('AR', join(WASI_SDK_PATH, 'bin', 'ar'))
        this.setEnvIfNotExists('RANLIB', join(WASI_SDK_PATH, 'bin', 'ranlib'))
        this.setEnvIfNotExists(
          'CFLAGS',
          `--target=wasm32-wasi-threads --sysroot=${WASI_SDK_PATH}/share/wasi-sysroot -pthread -mllvm -wasm-enable-sjlj -I${setjmpInclude}`,
        )
        this.setEnvIfNotExists(
          'CXXFLAGS',
          `--target=wasm32-wasi-threads --sysroot=${WASI_SDK_PATH}/share/wasi-sysroot -pthread -mllvm -wasm-enable-sjlj -I${setjmpInclude}`,
        )
        this.setEnvIfNotExists(
          `LDFLAGS`,
          `-fuse-ld=${WASI_SDK_PATH}/bin/wasm-ld --target=wasm32-wasi-threads`,
        )
      }
    }

    debug('Set envs: ')
    Object.entries(this.envs).forEach(([k, v]) => {
      debug('  %i', `${k}=${v}`)
    })

    return this
  }

  private setFeatures() {
    const args = []
    if (this.options.allFeatures && this.options.noDefaultFeatures) {
      throw new Error(
        'Cannot specify --all-features and --no-default-features together',
      )
    }
    if (this.options.allFeatures) {
      args.push('--all-features')
    } else if (this.options.noDefaultFeatures) {
      args.push('--no-default-features')
    }
    if (this.options.features) {
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

    if (this.options.profile) {
      this.args.push('--profile', this.options.profile)
    }

    if (this.options.manifestPath) {
      this.args.push('--manifest-path', this.options.manifestPath)
    }

    if (this.options.cargoOptions?.length) {
      this.args.push(...this.options.cargoOptions)
    }

    return this
  }

  private getIntermediateTypeFile() {
    const dtsPath = join(
      tmpdir(),
      `${this.crate.name}-${createHash('sha256')
        .update(this.crate.manifest_path)
        .update(CLI_VERSION)
        .digest('hex')
        .substring(0, 8)}.napi_type_def`,
    )
    if (!this.options.dtsCache) {
      try {
        unlinkSync(dtsPath)
      } catch {}
      return `${dtsPath}_${Date.now()}.tmp`
    }
    return `${dtsPath}.tmp`
  }

  private getIntermediateWasiRegisterFile() {
    return join(
      tmpdir(),
      `${this.crate.name}-${createHash('sha256')
        .update(this.crate.manifest_path)
        .update(CLI_VERSION)
        .digest('hex')
        .substring(0, 8)}.napi_wasi_register.tmp`,
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

    const wasmBinaryName = await this.copyArtifact()

    // only for cdylib
    if (this.cdyLibName) {
      const idents = await this.generateTypeDef()
      const intermediateWasiRegisterFile = this.envs.WASI_REGISTER_TMP_PATH
      const wasiRegisterFunctions = this.config.targets.some(
        (t) => t.platform === 'wasi',
      )
        ? await (async function readIntermediateWasiRegisterFile() {
            const fileContent = await readFileAsync(
              intermediateWasiRegisterFile,
              'utf8',
            ).catch((err) => {
              console.warn(
                `Read ${colors.yellowBright(
                  intermediateWasiRegisterFile,
                )} failed, reason: ${err.message}`,
              )
              return ``
            })
            return fileContent
              .split('\n')
              .map((l) => l.trim())
              .filter((l) => l.length)
              .map((line) => {
                const [_, fn] = line.split(':')
                return fn.trim()
              })
          })()
        : []
      const jsOutput = await this.writeJsBinding(idents)
      const wasmBindingsOutput = await this.writeWasiBinding(
        wasiRegisterFunctions,
        wasmBinaryName ?? 'index.wasm',
        idents,
      )
      if (jsOutput) {
        this.outputs.push(jsOutput)
      }
      if (wasmBindingsOutput) {
        this.outputs.push(...wasmBindingsOutput)
      }
    }

    return this.outputs
  }

  private async copyArtifact() {
    const [srcName, destName, wasmBinaryName] = this.getArtifactNames()
    if (!srcName || !destName) {
      return
    }

    const profile =
      this.options.profile ?? (this.options.release ? 'release' : 'debug')
    const src = join(this.targetDir, this.target.triple, profile, srcName)
    debug(`Copy artifact from: [${src}]`)
    const dest = join(this.outputDir, destName)
    const isWasm = dest.endsWith('.wasm')

    try {
      if (await fileExists(dest)) {
        debug('Old artifact found, remove it first')
        await unlinkAsync(dest)
      }
      debug('Copy artifact to:')
      debug('  %i', dest)
      if (isWasm) {
        const { ModuleConfig } = await import('@napi-rs/wasm-tools')
        debug('Generate debug wasm module')
        try {
          const debugWasmModule = new ModuleConfig()
            .generateDwarf(true)
            .generateNameSection(true)
            .generateProducersSection(true)
            .preserveCodeTransform(true)
            .strictValidate(false)
            .parse(await readFileAsync(src))
          const debugWasmBinary = debugWasmModule.emitWasm(true)
          await writeFileAsync(
            dest.replace('.wasm', '.debug.wasm'),
            debugWasmBinary,
          )
          debug('Generate release wasm module')
          const releaseWasmModule = new ModuleConfig()
            .generateDwarf(false)
            .generateNameSection(false)
            .generateProducersSection(false)
            .preserveCodeTransform(false)
            .strictValidate(false)
            .onlyStableFeatures(false)
            .parse(debugWasmBinary)
          const releaseWasmBinary = releaseWasmModule.emitWasm(false)
          await writeFileAsync(dest, releaseWasmBinary)
        } catch (e) {
          debug.warn(
            `Failed to generate debug wasm module: ${(e as any).message ?? e}`,
          )
          await copyFileAsync(src, dest)
        }
      } else {
        await copyFileAsync(src, dest)
      }
      this.outputs.push({
        kind: dest.endsWith('.node') ? 'node' : isWasm ? 'wasm' : 'exe',
        path: dest,
      })
      return wasmBinaryName ? join(this.outputDir, wasmBinaryName) : null
    } catch (e) {
      throw new Error('Failed to copy artifact', {
        cause: e,
      })
    }
  }

  private getArtifactNames() {
    if (this.cdyLibName) {
      const cdyLib = this.cdyLibName.replace(/-/g, '_')
      const wasiTarget = this.config.targets.find((t) => t.platform === 'wasi')

      const srcName =
        this.target.platform === 'darwin'
          ? `lib${cdyLib}.dylib`
          : this.target.platform === 'win32'
            ? `${cdyLib}.dll`
            : this.target.platform === 'wasi' || this.target.platform === 'wasm'
              ? `${cdyLib}.wasm`
              : `lib${cdyLib}.so`

      let destName = this.config.binaryName
      // add platform suffix to binary name
      // index[.linux-x64-gnu].node
      //       ^^^^^^^^^^^^^^
      if (this.options.platform) {
        destName += `.${this.target.platformArchABI}`
      }
      if (srcName.endsWith('.wasm')) {
        destName += '.wasm'
      } else {
        destName += '.node'
      }

      return [
        srcName,
        destName,
        wasiTarget
          ? `${this.config.binaryName}.${wasiTarget.platformArchABI}.wasm`
          : null,
      ]
    } else if (this.binName) {
      const srcName =
        this.target.platform === 'win32' ? `${this.binName}.exe` : this.binName

      return [srcName, srcName]
    }

    return []
  }

  private async generateTypeDef() {
    if (!(await fileExists(this.envs.TYPE_DEF_TMP_PATH))) {
      return []
    }

    const dest = join(this.outputDir, this.options.dts ?? 'index.d.ts')

    const { dts, exports } = await processTypeDef(
      this.envs.TYPE_DEF_TMP_PATH,
      this.options.constEnum ?? this.config.constEnum ?? true,
      !this.options.noDtsHeader
        ? (this.options.dtsHeader ??
            (this.config.dtsHeaderFile
              ? await readFileAsync(
                  join(this.cwd, this.config.dtsHeaderFile),
                  'utf-8',
                ).catch(() => {
                  debug.warn(
                    `Failed to read dts header file ${this.config.dtsHeaderFile}`,
                  )
                  return null
                })
              : null) ??
            this.config.dtsHeader ??
            DEFAULT_TYPE_DEF_HEADER)
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

    return exports
  }

  private async writeJsBinding(idents: string[]) {
    if (
      !this.options.platform ||
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      this.options.noJsBinding ||
      idents.length === 0
    ) {
      return
    }

    const name = this.options.jsBinding ?? 'index.js'

    const createBinding = this.options.esm ? createEsmBinding : createCjsBinding
    const binding = createBinding(
      this.config.binaryName,
      this.config.packageName,
      idents,
    )

    try {
      const dest = join(this.outputDir, name)
      debug('Writing js binding to:')
      debug('  %i', dest)
      await writeFileAsync(dest, binding, 'utf-8')
      return {
        kind: 'js',
        path: dest,
      } satisfies Output
    } catch (e) {
      throw new Error('Failed to write js binding file', { cause: e })
    }
  }

  private async writeWasiBinding(
    wasiRegisterFunctions: string[],
    distFileName: string | undefined,
    idents: string[],
  ) {
    if (distFileName && wasiRegisterFunctions.length) {
      const { name, dir } = parse(distFileName)
      const bindingPath = join(dir, `${this.config.binaryName}.wasi.cjs`)
      const browserBindingPath = join(
        dir,
        `${this.config.binaryName}.wasi-browser.js`,
      )
      const workerPath = join(dir, 'wasi-worker.mjs')
      const browserWorkerPath = join(dir, 'wasi-worker-browser.mjs')
      const browserEntryPath = join(dir, 'browser.js')
      const exportsCode = idents
        .map(
          (ident) => `module.exports.${ident} = __napiModule.exports.${ident}`,
        )
        .join('\n')
      await writeFileAsync(
        bindingPath,
        createWasiBinding(
          name,
          this.config.packageName,
          wasiRegisterFunctions,
          this.config.wasm?.initialMemory,
          this.config.wasm?.maximumMemory,
        ) +
          exportsCode +
          '\n',
        'utf8',
      )
      await writeFileAsync(
        browserBindingPath,
        createWasiBrowserBinding(
          name,
          wasiRegisterFunctions,
          this.config.wasm?.initialMemory,
          this.config.wasm?.maximumMemory,
          this.config.wasm?.browser?.fs,
        ) +
          idents
            .map(
              (ident) =>
                `export const ${ident} = __napiModule.exports.${ident}`,
            )
            .join('\n') +
          '\n',
        'utf8',
      )
      await writeFileAsync(workerPath, WASI_WORKER_TEMPLATE, 'utf8')
      await writeFileAsync(
        browserWorkerPath,
        createWasiBrowserWorkerBinding(this.config.wasm?.browser?.fs ?? false),
        'utf8',
      )
      await writeFileAsync(
        browserEntryPath,
        `export * from '${this.config.packageName}-wasm32-wasi'\n`,
      )
      return [
        {
          kind: 'js',
          path: bindingPath,
        },
        {
          kind: 'js',
          path: browserBindingPath,
        },
        {
          kind: 'js',
          path: workerPath,
        },
        {
          kind: 'js',
          path: browserWorkerPath,
        },
        {
          kind: 'js',
          path: browserEntryPath,
        },
      ] satisfies Output[]
    }
    return []
  }

  private setEnvIfNotExists(env: string, value: string) {
    if (!process.env[env]) {
      this.envs[env] = value
    }
  }
}
