// This file is generated by codegen/index.ts
// Do not edit this file manually
import { Command, Option } from 'clipanion'

export abstract class BaseBuildCommand extends Command {
  static paths = [['build']]

  static usage = Command.Usage({
    description: 'Build the NAPI-RS project',
  })

  target?: string = Option.String('--target,-t', {
    description:
      'Build for the target triple, bypassed to `cargo build --target`',
  })

  cwd?: string = Option.String('--cwd', {
    description:
      'The working directory of where napi command will be executed in, all other paths options are relative to this path',
  })

  manifestPath?: string = Option.String('--manifest-path', {
    description: 'Path to `Cargo.toml`',
  })

  configPath?: string = Option.String('--config-path,-c', {
    description: 'Path to `napi` config json file',
  })

  packageJsonPath?: string = Option.String('--package-json-path', {
    description: 'Path to `package.json`',
  })

  targetDir?: string = Option.String('--target-dir', {
    description:
      'Directory for all crate generated artifacts, see `cargo build --target-dir`',
  })

  outputDir?: string = Option.String('--output-dir,-o', {
    description:
      'Path to where all the built files would be put. Default to the crate folder',
  })

  platform?: boolean = Option.Boolean('--platform', {
    description:
      'Add platform triple to the generated nodejs binding file, eg: `[name].linux-x64-gnu.node`',
  })

  jsPackageName?: string = Option.String('--js-package-name', {
    description:
      'Package name in generated js binding file. Only works with `--platform` flag',
  })

  constEnum?: boolean = Option.Boolean('--const-enum', {
    description: 'Whether generate const enum for typescript bindings',
  })

  jsBinding?: string = Option.String('--js', {
    description:
      'Path and filename of generated JS binding file. Only works with `--platform` flag. Relative to `--output-dir`.',
  })

  noJsBinding?: boolean = Option.Boolean('--no-js', {
    description:
      'Whether to disable the generation JS binding file. Only works with `--platform` flag.',
  })

  dts?: string = Option.String('--dts', {
    description:
      'Path and filename of generated type def file. Relative to `--output-dir`',
  })

  dtsHeader?: string = Option.String('--dts-header', {
    description:
      'Custom file header for generated type def file. Only works when `typedef` feature enabled.',
  })

  noDtsHeader?: boolean = Option.Boolean('--no-dts-header', {
    description:
      'Whether to disable the default file header for generated type def file. Only works when `typedef` feature enabled.',
  })

  strip?: boolean = Option.Boolean('--strip,-s', {
    description: 'Whether strip the library to achieve the minimum file size',
  })

  release?: boolean = Option.Boolean('--release,-r', {
    description: 'Build in release mode',
  })

  verbose?: boolean = Option.Boolean('--verbose,-v', {
    description: 'Verbosely log build command trace',
  })

  bin?: string = Option.String('--bin', {
    description: 'Build only the specified binary',
  })

  package?: string = Option.String('--package,-p', {
    description: 'Build the specified library or the one at cwd',
  })

  profile?: string = Option.String('--profile', {
    description: 'Build artifacts with the specified profile',
  })

  crossCompile?: boolean = Option.Boolean('--cross-compile,-x', {
    description:
      '[experimental] cross-compile for the specified target with `cargo-xwin` on windows and `cargo-zigbuild` on other platform',
  })

  useCross?: boolean = Option.Boolean('--use-cross', {
    description:
      '[experimental] use [cross](https://github.com/cross-rs/cross) instead of `cargo`',
  })

  useNapiCross?: boolean = Option.Boolean('--use-napi-cross', {
    description:
      '[experimental] use @napi-rs/cross-toolchain to cross-compile Linux arm/arm64/x64 gnu targets.',
  })

  watch?: boolean = Option.Boolean('--watch,-w', {
    description:
      'watch the crate changes and build continuously with `cargo-watch` crates',
  })

  features?: string[] = Option.Array('--features,-F', {
    description: 'Space-separated list of features to activate',
  })

  allFeatures?: boolean = Option.Boolean('--all-features', {
    description: 'Activate all available features',
  })

  noDefaultFeatures?: boolean = Option.Boolean('--no-default-features', {
    description: 'Do not activate the `default` feature',
  })

  getOptions() {
    return {
      target: this.target,
      cwd: this.cwd,
      manifestPath: this.manifestPath,
      configPath: this.configPath,
      packageJsonPath: this.packageJsonPath,
      targetDir: this.targetDir,
      outputDir: this.outputDir,
      platform: this.platform,
      jsPackageName: this.jsPackageName,
      constEnum: this.constEnum,
      jsBinding: this.jsBinding,
      noJsBinding: this.noJsBinding,
      dts: this.dts,
      dtsHeader: this.dtsHeader,
      noDtsHeader: this.noDtsHeader,
      strip: this.strip,
      release: this.release,
      verbose: this.verbose,
      bin: this.bin,
      package: this.package,
      profile: this.profile,
      crossCompile: this.crossCompile,
      useCross: this.useCross,
      useNapiCross: this.useNapiCross,
      watch: this.watch,
      features: this.features,
      allFeatures: this.allFeatures,
      noDefaultFeatures: this.noDefaultFeatures,
    }
  }
}

/**
 * Build the NAPI-RS project
 */
export interface BuildOptions {
  /**
   * Build for the target triple, bypassed to `cargo build --target`
   */
  target?: string
  /**
   * The working directory of where napi command will be executed in, all other paths options are relative to this path
   */
  cwd?: string
  /**
   * Path to `Cargo.toml`
   */
  manifestPath?: string
  /**
   * Path to `napi` config json file
   */
  configPath?: string
  /**
   * Path to `package.json`
   */
  packageJsonPath?: string
  /**
   * Directory for all crate generated artifacts, see `cargo build --target-dir`
   */
  targetDir?: string
  /**
   * Path to where all the built files would be put. Default to the crate folder
   */
  outputDir?: string
  /**
   * Add platform triple to the generated nodejs binding file, eg: `[name].linux-x64-gnu.node`
   */
  platform?: boolean
  /**
   * Package name in generated js binding file. Only works with `--platform` flag
   */
  jsPackageName?: string
  /**
   * Whether generate const enum for typescript bindings
   */
  constEnum?: boolean
  /**
   * Path and filename of generated JS binding file. Only works with `--platform` flag. Relative to `--output-dir`.
   */
  jsBinding?: string
  /**
   * Whether to disable the generation JS binding file. Only works with `--platform` flag.
   */
  noJsBinding?: boolean
  /**
   * Path and filename of generated type def file. Relative to `--output-dir`
   */
  dts?: string
  /**
   * Custom file header for generated type def file. Only works when `typedef` feature enabled.
   */
  dtsHeader?: string
  /**
   * Whether to disable the default file header for generated type def file. Only works when `typedef` feature enabled.
   */
  noDtsHeader?: boolean
  /**
   * Whether strip the library to achieve the minimum file size
   */
  strip?: boolean
  /**
   * Build in release mode
   */
  release?: boolean
  /**
   * Verbosely log build command trace
   */
  verbose?: boolean
  /**
   * Build only the specified binary
   */
  bin?: string
  /**
   * Build the specified library or the one at cwd
   */
  package?: string
  /**
   * Build artifacts with the specified profile
   */
  profile?: string
  /**
   * [experimental] cross-compile for the specified target with `cargo-xwin` on windows and `cargo-zigbuild` on other platform
   */
  crossCompile?: boolean
  /**
   * [experimental] use [cross](https://github.com/cross-rs/cross) instead of `cargo`
   */
  useCross?: boolean
  /**
   * [experimental] use @napi-rs/cross-toolchain to cross-compile Linux arm/arm64/x64 gnu targets.
   */
  useNapiCross?: boolean
  /**
   * watch the crate changes and build continuously with `cargo-watch` crates
   */
  watch?: boolean
  /**
   * Space-separated list of features to activate
   */
  features?: string[]
  /**
   * Activate all available features
   */
  allFeatures?: boolean
  /**
   * Do not activate the `default` feature
   */
  noDefaultFeatures?: boolean
}
